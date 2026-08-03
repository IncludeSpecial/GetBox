import { spawn, execFile } from 'node:child_process';
import type { InstallPhase, InstallProgress } from './types.js';
import { InstallError } from './install-errors.js';

/**
 * Package CLIs (scoop, winget, choco) report their progress as plain stdout,
 * often redrawing a single line with carriage returns. Buffering the output
 * until exit throws that away, so installs run with a streamed reader instead.
 */

export interface CliRunResult {
  code: number | null;
  output: string;
}

export interface CliRunOptions {
  timeout?: number;
  env?: Record<string, string>;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
}

const PROGRESS_INTERVAL_MS = 200;
const MAX_OUTPUT_CHARS = 200_000;

const PERCENT = /(\d{1,3}(?:[.,]\d+)?)\s*%/;
const SIZE_PAIR =
  /(\d+(?:[.,]\d+)?)\s*(B|KB|KiB|MB|MiB|GB|GiB)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(B|KB|KiB|MB|MiB|GB|GiB)/i;
const DOWNLOAD_HINT = /download|скачив|загруж|fetch/i;
const INSTALL_HINT = /install|extract|unpack|распаков|устан|verifying|hash/i;

const UNIT_BYTES: Record<string, number> = {
  b: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
};

function toBytes(value: string, unit: string): number {
  return Number(value.replace(',', '.')) * (UNIT_BYTES[unit.toLowerCase()] ?? 1);
}

/** Progress bars are noise once the numbers are extracted; text lines are worth showing. */
function asNote(line: string): string | undefined {
  const clean = line.replace(/[█▒░■□▓\-=#|]{3,}/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (clean.length < 3 || !/[a-zа-я]/i.test(clean)) return undefined;
  return clean.slice(0, 120);
}

export function parseProgressLine(line: string, phase: InstallPhase): InstallProgress | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  let nextPhase = phase;
  if (INSTALL_HINT.test(trimmed)) nextPhase = 'install';
  else if (DOWNLOAD_HINT.test(trimmed)) nextPhase = 'download';

  const progress: InstallProgress = { phase: nextPhase, note: asNote(trimmed) };

  const sizes = SIZE_PAIR.exec(trimmed);
  if (sizes) {
    const bytesDone = toBytes(sizes[1], sizes[2]);
    const bytesTotal = toBytes(sizes[3], sizes[4]);
    progress.bytesDone = bytesDone;
    progress.bytesTotal = bytesTotal;
    if (bytesTotal > 0) progress.percent = Math.min(100, (bytesDone / bytesTotal) * 100);
  }

  const percent = PERCENT.exec(trimmed);
  if (percent) {
    const value = Number(percent[1].replace(',', '.'));
    if (value >= 0 && value <= 100) progress.percent = value;
  }

  if (progress.percent === undefined && !progress.note) return undefined;
  return progress;
}

/** Kill a process and its children on Windows; fall back to SIGTERM elsewhere. */
export function killProcessTree(pid: number | undefined): void {
  if (!pid || pid <= 0) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, () => {
      // best-effort
    });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

export function runCliWithProgress(
  exe: string,
  args: string[],
  opts: CliRunOptions = {},
): Promise<CliRunResult> {
  const { timeout = 600_000, env, onProgress, signal } = opts;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new InstallError('cancelled', 'Установка отменена'));
      return;
    }

    const child = spawn(exe, args, {
      windowsHide: true,
      shell: true,
      env: { ...process.env, ...env },
    });

    let output = '';
    let phase: InstallPhase = 'download';
    let lastEmit = 0;
    let pending: InstallProgress | undefined;
    let settled = false;

    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      finish(new InstallError('timeout', 'Превышено время ожидания', `Timed out after ${Math.round(timeout / 1000)}s`));
    }, timeout);

    const flush = setInterval(() => {
      if (!pending || !onProgress) return;
      onProgress(pending);
      pending = undefined;
      lastEmit = Date.now();
    }, PROGRESS_INTERVAL_MS);

    const onAbort = () => {
      killProcessTree(child.pid);
      finish(new InstallError('cancelled', 'Установка отменена'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    function finish(err?: Error, code?: number | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(flush);
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve({ code: code ?? null, output: output.trim() });
    }

    function consume(chunk: Buffer): void {
      const text = chunk.toString('utf-8');
      output = (output + text).slice(-MAX_OUTPUT_CHARS);
      if (!onProgress) return;

      for (const line of text.split(/[\r\n]+/)) {
        const progress = parseProgressLine(line, phase);
        if (!progress) continue;
        phase = progress.phase;
        if (Date.now() - lastEmit >= PROGRESS_INTERVAL_MS) {
          onProgress(progress);
          lastEmit = Date.now();
          pending = undefined;
        } else {
          pending = progress;
        }
      }
    }

    child.stdout?.on('data', consume);
    child.stderr?.on('data', consume);
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (signal?.aborted) {
        finish(new InstallError('cancelled', 'Установка отменена'));
        return;
      }
      finish(undefined, code);
    });
  });
}
