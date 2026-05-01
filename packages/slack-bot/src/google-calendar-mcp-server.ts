#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

const CREDS_DIR = path.join(process.env.HOME || '', '.gmail-mcp');
const CREDS_PATH = path.join(CREDS_DIR, 'credentials.json');
const OAUTH_PATH = path.join(CREDS_DIR, 'gcp-oauth.keys.json');
const DEFAULT_CALENDAR_NAME = 'Akira_public';
const TIMEZONE = 'Asia/Tokyo';

let cachedToken: string | null = null;
let tokenExpiry = 0;
let calendarIdCache: Map<string, string> = new Map();

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  organizer?: {
    email?: string;
    displayName?: string;
  };
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{
      method?: string;
      minutes?: number;
    }>;
  };
}

interface Calendar {
  id: string;
  summary?: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
}

async function httpsRequest(options: https.RequestOptions, body?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data ? JSON.parse(data) : {});
          } else {
            const err = data ? JSON.parse(data) : {};
            reject(new Error(err.error?.message || `HTTP ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Response parsing failed: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf-8'));
  const oauth = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf-8'));
  const client = oauth.installed || oauth.web;

  const params = new URLSearchParams({
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  });

  const response = await httpsRequest({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(params.toString()),
    },
  }, params.toString());

  cachedToken = response.access_token;
  tokenExpiry = Date.now() + (response.expires_in - 300) * 1000;
  return cachedToken!;
}

async function calendarApiRequest(path: string, method: string = 'GET', body?: any): Promise<any> {
  const token = await getAccessToken();
  const bodyStr = body ? JSON.stringify(body) : undefined;

  return httpsRequest({
    hostname: 'www.googleapis.com',
    path: `/calendar/v3${path}`,
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(bodyStr && { 'Content-Length': Buffer.byteLength(bodyStr) }),
    },
  }, bodyStr);
}

async function listCalendars(): Promise<Calendar[]> {
  const response = await calendarApiRequest('/users/me/calendarList');
  return response.items || [];
}

async function getCalendarId(calendarName?: string): Promise<string> {
  const name = calendarName || DEFAULT_CALENDAR_NAME;

  if (calendarIdCache.has(name)) {
    return calendarIdCache.get(name)!;
  }

  const calendars = await listCalendars();
  const calendar = calendars.find(c => c.summary === name);

  if (!calendar) {
    const primary = calendars.find(c => c.primary);
    if (primary) {
      calendarIdCache.set(name, primary.id);
      return primary.id;
    }
    throw new Error(`Calendar "${name}" not found`);
  }

  calendarIdCache.set(name, calendar.id);
  return calendar.id;
}

function formatDateTime(dt?: { dateTime?: string; date?: string }): string {
  if (!dt) return '';
  if (dt.date) return dt.date;
  if (dt.dateTime) {
    const d = new Date(dt.dateTime);
    return d.toLocaleString('ja-JP', { timeZone: TIMEZONE, hour12: false });
  }
  return '';
}

function formatEvent(event: GoogleEvent, calendarName?: string): string {
  const start = formatDateTime(event.start);
  const end = formatDateTime(event.end);
  const title = event.summary || '(無題)';
  const location = event.location ? ` @ ${event.location}` : '';
  const calendar = calendarName ? ` [${calendarName}]` : '';

  if (event.start?.date) {
    return `${start} 終日: ${title}${location}${calendar}`;
  }

  return `${start} - ${end?.split(' ')[1] || end}: ${title}${location}${calendar}`;
}

function groupEventsByDate(events: Array<{ event: GoogleEvent; calendar?: string }>): Map<string, Array<{ event: GoogleEvent; calendar?: string }>> {
  const grouped = new Map<string, Array<{ event: GoogleEvent; calendar?: string }>>();

  for (const item of events) {
    const dateStr = item.event.start?.date || item.event.start?.dateTime?.split('T')[0] || '';
    if (!grouped.has(dateStr)) {
      grouped.set(dateStr, []);
    }
    grouped.get(dateStr)!.push(item);
  }

  return grouped;
}

function formatGroupedEvents(groupedEvents: Map<string, Array<{ event: GoogleEvent; calendar?: string }>>): string {
  const output: string[] = [];
  const sortedDates = Array.from(groupedEvents.keys()).sort();

  for (const date of sortedDates) {
    const events = groupedEvents.get(date)!;
    const d = new Date(date + 'T00:00:00');
    const dateHeader = d.toLocaleDateString('ja-JP', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });

    output.push(`\n${dateHeader}`);
    output.push('-'.repeat(40));

    for (const item of events) {
      output.push(formatEvent(item.event, item.calendar));
    }
  }

  return output.join('\n').trim() || '(予定なし)';
}

const server = new McpServer({
  name: 'google-calendar',
  version: '2.0.0',
});

server.tool(
  'agenda',
  'Get events for N days (default 3). Returns structured event data from all calendars.',
  { days: z.number().optional().describe('Number of days to show (default: 3)') },
  async ({ days = 3 }) => {
    const timeMin = new Date();
    timeMin.setHours(0, 0, 0, 0);

    const timeMax = new Date(timeMin);
    timeMax.setDate(timeMax.getDate() + days);

    const calendars = await listCalendars();
    const allEvents: Array<{ event: GoogleEvent; calendar: string }> = [];

    for (const calendar of calendars) {
      try {
        const params = new URLSearchParams({
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          timeZone: TIMEZONE,
        });

        const response = await calendarApiRequest(`/calendars/${encodeURIComponent(calendar.id)}/events?${params}`);
        const events = response.items || [];

        for (const event of events) {
          allEvents.push({ event, calendar: calendar.summary || calendar.id });
        }
      } catch (e) {
        console.error(`Failed to fetch events from ${calendar.summary}: ${e}`);
      }
    }

    allEvents.sort((a, b) => {
      const aTime = a.event.start?.dateTime || a.event.start?.date || '';
      const bTime = b.event.start?.dateTime || b.event.start?.date || '';
      return aTime.localeCompare(bTime);
    });

    const grouped = groupEventsByDate(allEvents);
    const output = formatGroupedEvents(grouped);

    return { content: [{ type: 'text', text: output }] };
  }
);

server.tool(
  'today',
  'Get today\'s events from all calendars.',
  {},
  async () => {
    const timeMin = new Date();
    timeMin.setHours(0, 0, 0, 0);

    const timeMax = new Date(timeMin);
    timeMax.setDate(timeMax.getDate() + 1);

    const calendars = await listCalendars();
    const allEvents: Array<{ event: GoogleEvent; calendar: string }> = [];

    for (const calendar of calendars) {
      try {
        const params = new URLSearchParams({
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          timeZone: TIMEZONE,
        });

        const response = await calendarApiRequest(`/calendars/${encodeURIComponent(calendar.id)}/events?${params}`);
        const events = response.items || [];

        for (const event of events) {
          allEvents.push({ event, calendar: calendar.summary || calendar.id });
        }
      } catch (e) {
        console.error(`Failed to fetch events from ${calendar.summary}: ${e}`);
      }
    }

    allEvents.sort((a, b) => {
      const aTime = a.event.start?.dateTime || a.event.start?.date || '';
      const bTime = b.event.start?.dateTime || b.event.start?.date || '';
      return aTime.localeCompare(bTime);
    });

    const output = allEvents.length > 0
      ? allEvents.map(item => formatEvent(item.event, item.calendar)).join('\n')
      : '(今日の予定なし)';

    return { content: [{ type: 'text', text: output }] };
  }
);

server.tool(
  'search',
  'Search events by keyword with optional date range from all calendars.',
  {
    query: z.string().describe('Search keyword'),
    start: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    end: z.string().optional().describe('End date (YYYY-MM-DD)'),
  },
  async ({ query, start, end }) => {
    const params: any = {
      q: query,
      singleEvents: 'true',
      orderBy: 'startTime',
      timeZone: TIMEZONE,
    };

    if (start) {
      params.timeMin = new Date(start + 'T00:00:00').toISOString();
    }
    if (end) {
      params.timeMax = new Date(end + 'T23:59:59').toISOString();
    }

    const calendars = await listCalendars();
    const allEvents: Array<{ event: GoogleEvent; calendar: string }> = [];

    for (const calendar of calendars) {
      try {
        const queryString = new URLSearchParams(params).toString();
        const response = await calendarApiRequest(`/calendars/${encodeURIComponent(calendar.id)}/events?${queryString}`);
        const events = response.items || [];

        for (const event of events) {
          allEvents.push({ event, calendar: calendar.summary || calendar.id });
        }
      } catch (e) {
        console.error(`Failed to search events in ${calendar.summary}: ${e}`);
      }
    }

    allEvents.sort((a, b) => {
      const aTime = a.event.start?.dateTime || a.event.start?.date || '';
      const bTime = b.event.start?.dateTime || b.event.start?.date || '';
      return aTime.localeCompare(bTime);
    });

    const grouped = groupEventsByDate(allEvents);
    const output = formatGroupedEvents(grouped);

    return { content: [{ type: 'text', text: output || '(該当なし)' }] };
  }
);

server.tool(
  'add',
  'Add event with title, when, duration, location, description. Default calendar is Akira_public.',
  {
    title: z.string().describe('Event title'),
    when: z.string().describe('Start datetime (e.g. "2026-03-26 14:00")'),
    duration: z.number().optional().describe('Duration in minutes (default: 60)'),
    where: z.string().optional().describe('Location'),
    description: z.string().optional().describe('Event description'),
    calendar: z.string().optional().describe('Calendar name (default: Akira_public)'),
    reminders: z.array(z.object({
      method: z.enum(['email', 'popup']),
      minutes: z.number()
    })).optional().describe('Reminder settings (default: 2min popup)'),
  },
  async ({ title, when, duration = 60, where, description, calendar, reminders }) => {
    const calendarId = await getCalendarId(calendar);

    const startDt = new Date(when.replace(' ', 'T'));
    if (isNaN(startDt.getTime())) {
      throw new Error(`Invalid date format: ${when}`);
    }

    const endDt = new Date(startDt);
    endDt.setMinutes(endDt.getMinutes() + duration);

    const event: any = {
      summary: title,
      start: {
        dateTime: startDt.toISOString(),
        timeZone: TIMEZONE,
      },
      end: {
        dateTime: endDt.toISOString(),
        timeZone: TIMEZONE,
      },
    };

    if (where) event.location = where;
    if (description) event.description = description;

    if (reminders) {
      event.reminders = {
        useDefault: false,
        overrides: reminders,
      };
    } else {
      event.reminders = {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 2 }],
      };
    }

    const response = await calendarApiRequest(`/calendars/${encodeURIComponent(calendarId)}/events`, 'POST', event);

    return { content: [{ type: 'text', text: `「${title}」を追加しました (ID: ${response.id})` }] };
  }
);

server.tool(
  'update',
  'Update an existing event by eventId. Provide only the fields you want to change.',
  {
    eventId: z.string().describe('Event ID to update'),
    title: z.string().optional().describe('New event title'),
    when: z.string().optional().describe('New start datetime'),
    duration: z.number().optional().describe('New duration in minutes'),
    where: z.string().optional().describe('New location'),
    description: z.string().optional().describe('New description'),
    calendar: z.string().optional().describe('Calendar name (default: Akira_public)'),
    reminders: z.array(z.object({
      method: z.enum(['email', 'popup']),
      minutes: z.number()
    })).optional().describe('New reminder settings'),
  },
  async ({ eventId, title, when, duration, where, description, calendar, reminders }) => {
    const calendarId = await getCalendarId(calendar);

    const existing = await calendarApiRequest(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);

    const updates: any = { ...existing };

    if (title !== undefined) updates.summary = title;
    if (where !== undefined) updates.location = where;
    if (description !== undefined) updates.description = description;

    if (when !== undefined) {
      const startDt = new Date(when.replace(' ', 'T'));
      if (isNaN(startDt.getTime())) {
        throw new Error(`Invalid date format: ${when}`);
      }

      const existingDuration = existing.end?.dateTime && existing.start?.dateTime
        ? (new Date(existing.end.dateTime).getTime() - new Date(existing.start.dateTime).getTime()) / 60000
        : 60;

      const actualDuration = duration !== undefined ? duration : existingDuration;
      const endDt = new Date(startDt);
      endDt.setMinutes(endDt.getMinutes() + actualDuration);

      updates.start = {
        dateTime: startDt.toISOString(),
        timeZone: TIMEZONE,
      };
      updates.end = {
        dateTime: endDt.toISOString(),
        timeZone: TIMEZONE,
      };
    } else if (duration !== undefined && existing.start?.dateTime) {
      const startDt = new Date(existing.start.dateTime);
      const endDt = new Date(startDt);
      endDt.setMinutes(endDt.getMinutes() + duration);

      updates.end = {
        dateTime: endDt.toISOString(),
        timeZone: TIMEZONE,
      };
    }

    if (reminders !== undefined) {
      updates.reminders = {
        useDefault: false,
        overrides: reminders,
      };
    }

    const response = await calendarApiRequest(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, 'PUT', updates);

    return { content: [{ type: 'text', text: `イベント「${response.summary}」を更新しました` }] };
  }
);

server.tool(
  'delete',
  'Delete an event by eventId.',
  {
    eventId: z.string().describe('Event ID to delete'),
    calendar: z.string().optional().describe('Calendar name (default: Akira_public)'),
  },
  async ({ eventId, calendar }) => {
    const calendarId = await getCalendarId(calendar);

    const existing = await calendarApiRequest(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    const title = existing.summary || '(無題)';

    await calendarApiRequest(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, 'DELETE');

    return { content: [{ type: 'text', text: `イベント「${title}」を削除しました` }] };
  }
);

server.tool(
  'list_calendars',
  'List all calendars the user has access to.',
  {},
  async () => {
    const calendars = await listCalendars();
    const output = calendars.map(cal => {
      const primary = cal.primary ? ' (PRIMARY)' : '';
      const tz = cal.timeZone ? ` [${cal.timeZone}]` : '';
      return `• ${cal.summary || cal.id}${primary}${tz}\n  ID: ${cal.id}`;
    }).join('\n\n');

    return { content: [{ type: 'text', text: output || '(カレンダーなし)' }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);