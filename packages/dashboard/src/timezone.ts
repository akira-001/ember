let _tz = 'Asia/Tokyo';

export function setTimezone(tz: string) { _tz = tz; }
export function tz(): string { return _tz; }

export async function initTimezone() {
  try {
    const res = await fetch('/api/global');
    if (res.ok) {
      const data = await res.json();
      if (data.timezone) _tz = data.timezone;
    }
  } catch {}
}
