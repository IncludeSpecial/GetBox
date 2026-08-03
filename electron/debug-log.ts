import fs from 'node:fs';
import path from 'node:path';

const INGEST =
  'http://127.0.0.1:7367/ingest/dbc9a94a-a1bd-45aa-8c77-df800b115a35';

function logFilePath(): string | null {
  try {
    // Lazy require so smoke tests can bundle queue code without Electron.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    if (app.isPackaged) {
      const base = process.env.LOCALAPPDATA || app.getPath('userData');
      return path.join(base, 'GetBox', 'debug', 'debug-7931cb.log');
    }
    return path.join(app.getAppPath(), '.cursor', 'debug-7931cb.log');
  } catch {
    return null;
  }
}

/** Dual-write debug events: ingest server + local NDJSON file (works in Electron main). */
export function debugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  const payload = {
    sessionId: '7931cb',
    location,
    message,
    data,
    hypothesisId,
    timestamp: Date.now(),
  };
  const line = `${JSON.stringify(payload)}\n`;

  fetch(INGEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7931cb' },
    body: JSON.stringify(payload),
  }).catch(() => {});

  const file = logFilePath();
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line);
  } catch {
    // ignore file write errors
  }
}
