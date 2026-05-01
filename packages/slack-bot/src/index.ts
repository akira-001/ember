import dotenv from 'dotenv';
dotenv.config();

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadBotConfigs } from './bot-config';
import { BotOrchestrator } from './bot-orchestrator';
import { Logger } from './logger';

const logger = new Logger('Main');
const LOCK_FILE = join(process.cwd(), 'data', '.bot-instance.lock');

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireInstanceLock(): boolean {
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });

  if (existsSync(LOCK_FILE)) {
    try {
      const content = readFileSync(LOCK_FILE, 'utf-8').trim();
      const lockedPid = parseInt(content, 10);
      if (lockedPid && isProcessAlive(lockedPid)) {
        logger.error(`Another bot instance is already running (PID ${lockedPid}). Exiting.`);
        return false;
      }
      logger.info(`Removing stale lock from dead PID ${lockedPid}`);
    } catch {
      // Corrupted lock file, remove it
    }
  }

  writeFileSync(LOCK_FILE, String(process.pid));
  logger.info(`Acquired instance lock (PID ${process.pid})`);

  const releaseLock = () => {
    try {
      if (existsSync(LOCK_FILE)) {
        const content = readFileSync(LOCK_FILE, 'utf-8').trim();
        if (parseInt(content, 10) === process.pid) {
          unlinkSync(LOCK_FILE);
        }
      }
    } catch {}
  };

  process.on('exit', releaseLock);
  process.on('SIGINT', () => { releaseLock(); process.exit(0); });
  process.on('SIGTERM', () => { releaseLock(); process.exit(0); });

  return true;
}

async function start() {
  if (!acquireInstanceLock()) {
    process.exit(1);
  }

  try {
    const configs = loadBotConfigs();
    logger.info(`Starting with ${configs.length} bot(s): ${configs.map((c) => c.name).join(', ')}`);

    const orchestrator = new BotOrchestrator(configs);
    await orchestrator.start();

    logger.info('All bots are running!');
  } catch (error) {
    logger.error('Failed to start', error);
    process.exit(1);
  }
}

start();
