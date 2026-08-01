import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { get } from 'node:https';
import { get as httpGet } from 'node:http';
import type {
  CuratedEntry,
  InstallOptions,
  InstallProgress,
  InstallResult,
  Package,
  PackageProvider,
} from './types.js';
import { getAppDataDir, getDataDir } from '../paths.js';

const execFileAsync = promisify(execFile);

interface CatalogItem extends CuratedEntry {
  installUrl?: string;
  silentArgs?: string;
  version?: string;
}

let catalogCache: CatalogItem[] | null = null;
let remoteCatalogCache: CatalogItem[] | null = null;
let remoteCatalogFetchedAt = 0;

function loadLocalCatalog(): CatalogItem[] {
  if (catalogCache) return catalogCache;
  const p = path.join(getDataDir(), 'catalog.json');
  catalogCache = JSON.parse(fs.readFileSync(p, 'utf-8')) as CatalogItem[];
  return catalogCache;
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

const REDIRECT_CODES = [301, 302, 303, 307, 308];
/** Emit at most five updates per second: byte events fire far faster than the UI can use. */
const PROGRESS_INTERVAL_MS = 200;

function downloadFile(
  url: string,
  dest: string,
  onProgress?: (progress: InstallProgress) => void,
  depth = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (depth > 5) {
      reject(new Error('Too many redirects'));
      return;
    }
    const getter = url.startsWith('https') ? get : httpGet;
    getter(url, (res) => {
      const loc = res.headers.location;
      if (res.statusCode && REDIRECT_CODES.includes(res.statusCode) && loc) {
        res.resume();
        const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
        downloadFile(next, dest, onProgress, depth + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download failed: ${res.statusCode}`));
        return;
      }

      const header = Number(res.headers['content-length']);
      const bytesTotal = Number.isFinite(header) && header > 0 ? header : undefined;
      let bytesDone = 0;
      let lastEmit = 0;
      let windowStart = Date.now();
      let windowBytes = 0;
      let bytesPerSecond: number | undefined;

      if (onProgress) {
        onProgress({ phase: 'download', percent: bytesTotal ? 0 : undefined, bytesDone: 0, bytesTotal });
        res.on('data', (chunk: Buffer) => {
          bytesDone += chunk.length;
          windowBytes += chunk.length;
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
      }

      const file = createWriteStream(dest);
      pipeline(res, file)
        .then(() => {
          onProgress?.({
            phase: 'download',
            percent: 100,
            bytesDone,
            bytesTotal: bytesTotal ?? bytesDone,
          });
          resolve();
        })
        .catch(reject);
    }).on('error', reject);
  });
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
      return { ok: false, message: `Пакет ${packageId} не найден или без installUrl` };
    }

    const tempDir = path.join(getAppDataDir(), 'downloads');
    fs.mkdirSync(tempDir, { recursive: true });
    const ext = path.extname(new URL(item.installUrl).pathname) || '.exe';
    const dest = path.join(tempDir, `${packageId}${ext}`);

    try {
      await downloadFile(item.installUrl, dest, opts.onProgress);
      // The vendor installer owns this phase and reports nothing back to us.
      opts.onProgress?.({ phase: 'install' });
      const args = opts.quiet && item.silentArgs ? item.silentArgs.split(' ') : [];
      await execFileAsync(dest, args, { timeout: 600000, windowsHide: true, shell: true });

      const tracking = loadInstalledTracking();
      tracking.add(packageId);
      saveInstalledTracking(tracking);

      return { ok: true, message: `Установлено: ${item.name}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Ошибка установки ${item.name}`, detail: msg };
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
}
