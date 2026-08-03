import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { get, Agent as HttpsAgent } from 'node:https';
import { get as httpGet, Agent as HttpAgent } from 'node:http';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import type {
  CuratedEntry,
  InstallOptions,
  InstallProgress,
  InstallResult,
  Package,
  PackageProvider,
} from './types.js';
import { getAppDataDir, getDataDir } from '../paths.js';
import {
  InstallError,
  classifyError,
  classifyHttpStatus,
  isCancelledError,
  isRetryableDownloadError,
  shouldTryAltProvider,
} from './install-errors.js';
import { killProcessTree } from './cli-progress.js';
import { debugLog } from '../debug-log.js';

interface CatalogItem extends CuratedEntry {
  installUrl?: string;
  installUrlFallbacks?: string[];
  altProvider?: { provider: string; packageId: string };
  noWingetFallback?: boolean;
  silentArgs?: string;
  version?: string;
}

export type InstallFallback = { provider: 'winget'; packageId: string };

let catalogCache: CatalogItem[] | null = null;
let wingetMapCache: Record<string, string> | null = null;
let remoteCatalogCache: CatalogItem[] | null = null;
let remoteCatalogFetchedAt = 0;

/** Same UA as scripts/verify-catalog.cjs — some CDNs reject bare Node clients. */
const DOWNLOAD_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Fresh TCP per attempt — keep-alive pools amplify ECONNRESET on flaky CDNs (Discord). */
const httpsAgent = new HttpsAgent({ keepAlive: false, maxSockets: 4 });
const httpAgent = new HttpAgent({ keepAlive: false, maxSockets: 4 });

const REDIRECT_CODES = [301, 302, 303, 307, 308];
const PROGRESS_INTERVAL_MS = 200;
const IDLE_TIMEOUT_MS = 90_000;
const OVERALL_TIMEOUT_MS = 30 * 60_000;
const MAX_RETRIES = 4;
const RETRY_BASE_MS = 1200;

function loadLocalCatalog(): CatalogItem[] {
  if (catalogCache) return catalogCache;
  const p = path.join(getDataDir(), 'catalog.json');
  catalogCache = JSON.parse(fs.readFileSync(p, 'utf-8')) as CatalogItem[];
  return catalogCache;
}

function loadWingetMap(): Record<string, string> {
  if (wingetMapCache) return wingetMapCache;
  const p = path.join(getDataDir(), 'winget-map.json');
  try {
    wingetMapCache = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, string>;
  } catch {
    wingetMapCache = {};
  }
  return wingetMapCache;
}

export function resolveInstallFallback(item: CatalogItem): InstallFallback | null {
  if (item.noWingetFallback) return null;
  if (item.altProvider?.provider === 'winget' && item.altProvider.packageId) {
    return { provider: 'winget', packageId: item.altProvider.packageId };
  }
  const mapped = loadWingetMap()[item.id];
  if (mapped) return { provider: 'winget', packageId: mapped };
  return null;
}

function installedTrackingPath(): string {
  return path.join(getAppDataDir(), 'installed-catalog.json');
}

function loadInstalledTracking(): Set<string> {
  try {
    const p = installedTrackingPath();
    if (!fs.existsSync(p)) return new Set();
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as string[];
    return new Set(raw);
  } catch {
    return new Set();
  }
}

function saveInstalledTracking(ids: Set<string>): void {
  fs.mkdirSync(getAppDataDir(), { recursive: true });
  fs.writeFileSync(installedTrackingPath(), JSON.stringify([...ids]));
}

function toPackage(item: CatalogItem): Package {
  return {
    id: item.packageId || item.id,
    provider: 'catalog',
    name: item.name,
    description: item.description,
    category: item.category,
    version: item.version,
    installUrl: item.installUrl,
    silentArgs: item.silentArgs,
    wikiTitle: item.wikiTitle,
    logoSlug: item.logoSlug,
    simpleSlug: item.simpleSlug,
    features: item.features,
    recommended: item.recommended,
  };
}

function filterCatalog(items: CatalogItem[], query: string): Package[] {
  const q = query.toLowerCase().trim();
  if (!q) return items.map(toPackage);
  return items
    .filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.packageId?.toLowerCase().includes(q),
    )
    .map(toPackage);
}

async function fetchRemoteCatalog(url: string): Promise<CatalogItem[]> {
  if (remoteCatalogCache && Date.now() - remoteCatalogFetchedAt < 3600000) {
    return remoteCatalogCache;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  remoteCatalogCache = (await res.json()) as CatalogItem[];
  remoteCatalogFetchedAt = Date.now();
  return remoteCatalogCache;
}

function unlinkQuiet(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore cleanup errors
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new InstallError('cancelled', 'Установка отменена'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new InstallError('cancelled', 'Установка отменена'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function downloadFileOnce(
  url: string,
  destPart: string,
  onProgress?: (progress: InstallProgress) => void,
  signal?: AbortSignal,
  depth = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new InstallError('cancelled', 'Установка отменена'));
      return;
    }
    if (depth > 5) {
      reject(new InstallError('http', 'Слишком много перенаправлений'));
      return;
    }

    unlinkQuiet(destPart);

    const getter = url.startsWith('https') ? get : httpGet;
    let req: ClientRequest;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let overallTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const cleanupTimers = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (overallTimer) clearTimeout(overallTimer);
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      try {
        req.destroy();
      } catch {
        // ignore
      }
      unlinkQuiet(destPart);
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      resolve();
    };

    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fail(new InstallError('timeout', 'Превышено время ожидания', `No data for ${IDLE_TIMEOUT_MS / 1000}s`));
      }, IDLE_TIMEOUT_MS);
    };

    const onAbort = () => {
      fail(new InstallError('cancelled', 'Установка отменена'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    overallTimer = setTimeout(() => {
      fail(new InstallError('timeout', 'Превышено время ожидания', `Download exceeded ${OVERALL_TIMEOUT_MS / 60000} min`));
    }, OVERALL_TIMEOUT_MS);

    bumpIdle();

    const opts: RequestOptions = {
      agent: url.startsWith('https') ? httpsAgent : httpAgent,
      headers: {
        'User-Agent': DOWNLOAD_UA,
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        // Avoid compressed streams that some CDNs reset mid-transfer for non-browser clients.
        'Accept-Encoding': 'identity',
        Connection: 'close',
      },
      timeout: IDLE_TIMEOUT_MS,
    };

    req = getter(url, opts, (res: IncomingMessage) => {
        const loc = res.headers.location;
        if (res.statusCode && REDIRECT_CODES.includes(res.statusCode) && loc) {
          res.resume();
          cleanupTimers();
          signal?.removeEventListener('abort', onAbort);
          const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
          downloadFileOnce(next, destPart, onProgress, signal, depth + 1).then(succeed).catch(fail);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          const status = res.statusCode ?? 0;
          const code = classifyHttpStatus(status);
          fail(new InstallError(code, `Download failed: ${status}`, `HTTP ${status}`));
          return;
        }

        const header = Number(res.headers['content-length']);
        const bytesTotal = Number.isFinite(header) && header > 0 ? header : undefined;
        let bytesDone = 0;
        let lastEmit = 0;
        let windowStart = Date.now();
        let windowBytes = 0;
        let bytesPerSecond: number | undefined;

        bumpIdle();
        if (onProgress) {
          onProgress({ phase: 'download', percent: bytesTotal ? 0 : undefined, bytesDone: 0, bytesTotal });
        }

        res.on('data', (chunk: Buffer) => {
          bumpIdle();
          bytesDone += chunk.length;
          windowBytes += chunk.length;
          if (!onProgress) return;
          const now = Date.now();
          if (now - lastEmit < PROGRESS_INTERVAL_MS) return;

          const elapsed = (now - windowStart) / 1000;
          if (elapsed >= 0.5) {
            bytesPerSecond = windowBytes / elapsed;
            windowStart = now;
            windowBytes = 0;
          }
          lastEmit = now;
          onProgress({
            phase: 'download',
            percent: bytesTotal ? Math.min(99, (bytesDone / bytesTotal) * 100) : undefined,
            bytesDone,
            bytesTotal,
            bytesPerSecond,
          });
        });

        const file = createWriteStream(destPart);
        pipeline(res, file)
          .then(() => {
            onProgress?.({
              phase: 'download',
              percent: 100,
              bytesDone,
              bytesTotal: bytesTotal ?? bytesDone,
            });
            succeed();
          })
          .catch(fail);
      },
    );

    req.on('timeout', () => {
      fail(new InstallError('timeout', 'Превышено время ожидания', 'Socket idle timeout'));
    });
    req.on('error', fail);
  });
}

function isConnectionReset(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = 'code' in err ? String((err as { code?: unknown }).code) : '';
  const msg = err instanceof Error ? err.message : String(err);
  return code === 'ECONNRESET' || /ECONNRESET|socket hang up/i.test(msg);
}

async function downloadUrlWithRetries(
  url: string,
  destPart: string,
  onProgress?: (progress: InstallProgress) => void,
  signal?: AbortSignal,
  maxRetries = MAX_RETRIES,
): Promise<void> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new InstallError('cancelled', 'Установка отменена');
    try {
      await downloadFileOnce(url, destPart, onProgress, signal);
      return;
    } catch (err) {
      lastErr = err;
      unlinkQuiet(destPart);
      if (isCancelledError(err) || !isRetryableDownloadError(err) || attempt === maxRetries) {
        throw err;
      }
      const delay = RETRY_BASE_MS * 2 ** attempt + (isConnectionReset(err) ? 1500 : 0);
      await sleep(delay, signal);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function runInstaller(exe: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new InstallError('cancelled', 'Установка отменена'));
      return;
    }

    const child = spawn(exe, args, { windowsHide: true, shell: true });
    let settled = false;

    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      finish(new InstallError('timeout', 'Превышено время ожидания', 'Installer timed out after 600s'));
    }, 600_000);

    const onAbort = () => {
      killProcessTree(child.pid);
      finish(new InstallError('cancelled', 'Установка отменена'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    function finish(err?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    }

    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (signal?.aborted) {
        finish(new InstallError('cancelled', 'Установка отменена'));
        return;
      }
      if (code !== 0 && code !== null) {
        finish(new InstallError('installer', 'Ошибка установщика', `Exit code ${code}`));
        return;
      }
      finish();
    });
  });
}

/** Exported for smoke tests. Tries each URL with retries before failing. */
export async function downloadFile(
  urlOrUrls: string | string[],
  dest: string,
  onProgress?: (progress: InstallProgress) => void,
  signal?: AbortSignal,
  maxRetriesPerUrl?: number,
): Promise<void> {
  const urls = (Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls]).filter(Boolean);
  if (urls.length === 0) throw new InstallError('not_found', 'Нет URL для загрузки');

  const destPart = `${dest}.part`;
  let lastErr: unknown;

  for (let i = 0; i < urls.length; i++) {
    if (signal?.aborted) throw new InstallError('cancelled', 'Установка отменена');
    try {
      await downloadUrlWithRetries(urls[i], destPart, onProgress, signal, maxRetriesPerUrl);
      unlinkQuiet(dest);
      fs.renameSync(destPart, dest);
      // #region agent log
      debugLog('catalog.ts:downloadFile', 'download ok', { urlIndex: i, urlCount: urls.length, dest: path.basename(dest) }, 'H3');
      // #endregion
      return;
    } catch (err) {
      lastErr = err;
      unlinkQuiet(destPart);
      const code = err instanceof InstallError ? err.code : classifyError(err).code;
      // #region agent log
      debugLog('catalog.ts:downloadFile', 'url failed', { urlIndex: i, urlCount: urls.length, code, hasMore: i < urls.length - 1 }, 'H3');
      // #endregion
      if (isCancelledError(err)) throw err;
      // Try the next mirror for connection/CDN failures.
      if (i < urls.length - 1 && isRetryableDownloadError(err)) continue;
      if (i < urls.length - 1) continue;
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export class CatalogProvider implements PackageProvider {
  id = 'catalog';
  displayName = 'Каталог GetBox';
  private remoteUrl?: string;

  setRemoteUrl(url?: string): void {
    this.remoteUrl = url;
    remoteCatalogCache = null;
  }

  async available() {
    return { ok: true, version: '1.0' };
  }

  async getAllItems(): Promise<CatalogItem[]> {
    const local = loadLocalCatalog();
    if (!this.remoteUrl) return local;
    try {
      const remote = await fetchRemoteCatalog(this.remoteUrl);
      const map = new Map<string, CatalogItem>();
      for (const item of local) map.set(item.id, item);
      for (const item of remote) map.set(item.id, item);
      return [...map.values()];
    } catch {
      return local;
    }
  }

  async search(query: string): Promise<Package[]> {
    const items = await this.getAllItems();
    return filterCatalog(items, query);
  }

  async listAll(): Promise<Package[]> {
    const items = await this.getAllItems();
    return items.map(toPackage);
  }

  findItem(packageId: string): CatalogItem | undefined {
    const items = loadLocalCatalog();
    return items.find((i) => i.packageId === packageId || i.id === packageId);
  }

  async install(packageId: string, opts: InstallOptions): Promise<InstallResult> {
    const item = this.findItem(packageId);
    if (!item?.installUrl) {
      return {
        ok: false,
        errorCode: 'not_found',
        message: `Пакет ${packageId} не найден или без installUrl`,
      };
    }

    const urls = [item.installUrl, ...(item.installUrlFallbacks ?? [])];
    const tempDir = path.join(getAppDataDir(), 'downloads');
    fs.mkdirSync(tempDir, { recursive: true });
    let ext = '.exe';
    try {
      ext = path.extname(new URL(item.installUrl).pathname) || '.exe';
    } catch {
      ext = '.exe';
    }
    const dest = path.join(tempDir, `${packageId}${ext}`);

    const fallback = resolveInstallFallback(item);

    // #region agent log
    debugLog('catalog.ts:install', 'install start', {
      packageId,
      urlCount: urls.length,
      hasFallback: Boolean(fallback),
      fallbackProvider: fallback?.provider,
      maxRetriesPerUrl: fallback ? 1 : MAX_RETRIES,
    }, 'H1');
    // #endregion

    try {
      if (opts.signal?.aborted) {
        return { ok: false, errorCode: 'cancelled', message: 'Установка отменена' };
      }

      await downloadFile(
        urls,
        dest,
        opts.onProgress,
        opts.signal,
        fallback ? 1 : undefined,
      );

      if (opts.signal?.aborted) {
        unlinkQuiet(dest);
        return { ok: false, errorCode: 'cancelled', message: 'Установка отменена' };
      }

      opts.onProgress?.({ phase: 'install' });
      const args = opts.quiet && item.silentArgs ? item.silentArgs.split(' ') : [];
      await runInstaller(dest, args, opts.signal);

      if (opts.signal?.aborted) {
        return { ok: false, errorCode: 'cancelled', message: 'Установка отменена' };
      }

      const tracking = loadInstalledTracking();
      tracking.add(packageId);
      saveInstalledTracking(tracking);

      // #region agent log
      debugLog('catalog.ts:install', 'install ok direct', { packageId }, 'H4');
      // #endregion
      return { ok: true, message: `Установлено: ${item.name}` };
    } catch (err) {
      unlinkQuiet(dest);
      unlinkQuiet(`${dest}.part`);

      if (isCancelledError(err)) {
        return { ok: false, errorCode: 'cancelled', message: 'Установка отменена' };
      }

      // CDN / geo resets: fall back to winget when catalog URLs fail.
      // Dynamic import avoids a catalog ↔ registry cycle at module load.
      if (fallback && shouldTryAltProvider(err)) {
        // #region agent log
        debugLog('catalog.ts:install', 'winget fallback', {
          packageId,
          wingetId: fallback.packageId,
          primaryError: err instanceof InstallError ? err.code : classifyError(err).code,
        }, 'H1');
        // #endregion
        const registry = await import('./registry.js');
        registry.initProviders();
        const winget = registry.getProvider(fallback.provider);
        if (!winget) {
          // #region agent log
          debugLog('catalog.ts:install', 'winget registry miss', {
            packageId,
            provider: fallback.provider,
          }, 'H1');
          // #endregion
        }
        if (winget) {
          opts.onProgress?.({
            phase: 'download',
            note: `winget:${fallback.packageId}`,
          });
          const wingetResult = await winget.install(fallback.packageId, opts);
          if (wingetResult.ok) {
            // #region agent log
            debugLog('catalog.ts:install', 'winget ok', { packageId, via: fallback.provider }, 'H1');
            // #endregion
            const tracking = loadInstalledTracking();
            tracking.add(packageId);
            saveInstalledTracking(tracking);
            return {
              ok: true,
              message: `Установлено: ${item.name} (через ${fallback.provider})`,
              detail: wingetResult.detail,
            };
          }
          const classified = classifyError(err);
          // #region agent log
          debugLog('catalog.ts:install', 'winget failed', {
            packageId,
            via: fallback.provider,
            wingetErrorCode: wingetResult.errorCode,
            wingetMessage: wingetResult.message?.slice(0, 120),
            primaryCode: classified.code,
          }, 'H1');
          // #endregion
          return {
            ok: false,
            errorCode: wingetResult.errorCode ?? classified.code,
            message: `Ошибка установки ${item.name}`,
            detail: [
              classified.detail || classified.message,
              `Запасной ${fallback.provider}: ${wingetResult.detail || wingetResult.message}`,
            ]
              .filter(Boolean)
              .join('\n'),
          };
        }
      }

      const classified = classifyError(err);
      // #region agent log
      debugLog('catalog.ts:install', 'install failed', {
        packageId,
        errorCode: classified.code,
        hasFallback: Boolean(fallback),
      }, 'H2');
      // #endregion
      return {
        ok: false,
        errorCode: classified.code,
        message:
          classified.code === 'cancelled'
            ? 'Установка отменена'
            : `Ошибка установки ${item.name}`,
        detail: classified.detail || classified.message,
      };
    }
  }

  async listInstalled(): Promise<Set<string>> {
    return loadInstalledTracking();
  }
}

export function peekCatalogInstalledCache(): Set<string> {
  return loadInstalledTracking();
}

export function loadCuratedCatalog(): CuratedEntry[] {
  return loadLocalCatalog();
}

export function invalidateCatalogCache(): void {
  catalogCache = null;
  wingetMapCache = null;
}
