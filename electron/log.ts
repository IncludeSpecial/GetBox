/**
 * Plain-text log in %LOCALAPPDATA%\GetBox\logs: getbox.log, rotated to getbox.1.log at 1 MB.
 * Nothing leaves the computer; the diagnostics report reads the tail of these files.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { getAppDataDir } from './paths.js';

type Level = 'info' | 'warn' | 'error';

const MAX_BYTES = 1024 * 1024;
const original = { log: console.log, warn: console.warn, error: console.error };

export function logDir(): string {
  return path.join(getAppDataDir(), 'logs');
}

const current = () => path.join(logDir(), 'getbox.log');
const previous = () => path.join(logDir(), 'getbox.1.log');

function format(value: unknown): string {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level: Level, scope: string, parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${parts.map(format).join(' ')}\n`;
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const file = current();
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, previous());
    fs.appendFileSync(file, line);
  } catch {
    // A full disk or a locked file must never break the app.
  }
}

export interface Logger {
  info: (...parts: unknown[]) => void;
  warn: (...parts: unknown[]) => void;
  error: (...parts: unknown[]) => void;
}

export function logger(scope: string): Logger {
  return {
    info: (...p) => { write('info', scope, p); original.log(`[${scope}]`, ...p); },
    warn: (...p) => { write('warn', scope, p); original.warn(`[${scope}]`, ...p); },
    error: (...p) => { write('error', scope, p); original.error(`[${scope}]`, ...p); },
  };
}

/** Last `lines` lines of the log (both files), with the home folder shortened to ~. */
export function readRecentLog(lines = 200): string {
  const read = (f: string) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const all = (read(previous()) + read(current())).split('\n').filter(Boolean);
  return redact(all.slice(-lines).join('\n'));
}

export function redact(text: string): string {
  const home = os.homedir();
  return home ? text.split(home).join('~') : text;
}

/**
 * Start of the main process: console warnings and errors (the existing «[GetBox] …» messages)
 * go to the file too, and crashes of the main process, renderer and helpers are recorded.
 */
export function installLogging(): void {
  console.warn = (...p: unknown[]) => { write('warn', 'console', p); original.warn(...p); };
  console.error = (...p: unknown[]) => { write('error', 'console', p); original.error(...p); };
  process.on('uncaughtException', (err) => write('error', 'main', ['uncaught exception', err]));
  process.on('unhandledRejection', (reason) => write('error', 'main', ['unhandled rejection', reason]));
  app.on('render-process-gone', (_e, _wc, details) => write('error', 'renderer', ['gone', details]));
  app.on('child-process-gone', (_e, details) => write('error', 'process', ['gone', details]));
  write('info', 'main', [`GetBox ${app.getVersion()} · Electron ${process.versions.electron} · ${os.type()} ${os.release()} ${process.arch}`]);
}
