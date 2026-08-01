import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Package, SearchResult } from './providers/types.js';
import { packageKey } from './providers/types.js';
import { getSearchCacheDir } from './paths.js';
import { getEnabledProviders } from './providers/registry.js';
import { getSettings } from './store/settings.js';

const TTL_MS = 14 * 24 * 60 * 60 * 1000;

function cachePath(query: string): string {
  const hash = crypto.createHash('sha256').update(query.toLowerCase().trim()).digest('hex');
  return path.join(getSearchCacheDir(), `${hash}.json`);
}

interface CacheEntry {
  query: string;
  results: Package[];
  cachedAt: number;
}

function readCache(query: string): CacheEntry | null {
  try {
    const p = cachePath(query);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(query: string, results: Package[]): void {
  const dir = getSearchCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const entry: CacheEntry = { query, results, cachedAt: Date.now() };
  fs.writeFileSync(cachePath(query), JSON.stringify(entry));
}

function dedupeResults(results: Package[]): Package[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = packageKey(r.provider, r.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function liveSearch(query: string): Promise<Package[]> {
  const settings = getSettings();
  const providers = getEnabledProviders(settings.enabledProviders);
  const batches = await Promise.all(
    providers.map(async (p: import('./providers/types.js').PackageProvider) => {
      const status = await p.available();
      if (!status.ok) return [] as Package[];
      try {
        return await p.search(query);
      } catch {
        return [] as Package[];
      }
    }),
  );
  return dedupeResults(batches.flat());
}

export async function searchPackages(query: string): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { results: [], fromCache: false, stale: false };

  const cached = readCache(q);
  const cacheValid = cached && Date.now() - cached.cachedAt < TTL_MS;

  try {
    const live = await liveSearch(q);
    if (live.length > 0) {
      writeCache(q, live);
      return { results: live, fromCache: false, stale: false };
    }
    if (cacheValid && cached) {
      return { results: cached.results, fromCache: true, stale: true };
    }
    return { results: cached?.results ?? [], fromCache: !!cached, stale: !cacheValid };
  } catch {
    if (cached) {
      return { results: cached.results, fromCache: true, stale: !cacheValid };
    }
    return { results: [], fromCache: false, stale: true };
  }
}

// Smoke test exports
export { readCache as _readSearchCache, writeCache as _writeSearchCache, TTL_MS as SEARCH_CACHE_TTL };
