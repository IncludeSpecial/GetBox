import { getAllProviders } from '../providers/registry.js';
import { matchIcon } from './icon-index.js';
import { faviconCandidates } from './icons.js';
import {
  downloadIcon,
  getMetaFromMemory,
  localIconUrl,
  saveMetaEntry,
  type MetaEntry,
} from './meta-cache.js';

/**
 * Icons and descriptions for packages that came from scoop, winget or Chocolatey.
 * The curated catalog ships its metadata; provider packages have to be asked for
 * one at a time, so requests are queued, answered newest-first (that is what the
 * user is looking at) and cached on disk so a package is only ever resolved once.
 */

export interface PackageMetaRequest {
  provider: string;
  id: string;
  name: string;
}

export interface PackageMetaUpdate {
  provider: string;
  id: string;
  description?: string;
  iconUrl?: string;
}

/** A package we failed to describe is retried, but not on every launch. */
const RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 2;
const MAX_QUEUE = 300;
const FLUSH_MS = 400;
const FLUSH_SIZE = 6;

const queue: PackageMetaRequest[] = [];
const queued = new Set<string>();
let workers = 0;

let listener: ((updates: PackageMetaUpdate[]) => void) | null = null;
let pendingUpdates: PackageMetaUpdate[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function onPackageMetaUpdate(cb: (updates: PackageMetaUpdate[]) => void): void {
  listener = cb;
}

export function packageMetaSlug(provider: string, id: string): string {
  const safe = id.toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
  return `pkg-${provider}-${safe}`;
}

function requestKey(item: PackageMetaRequest): string {
  return `${item.provider}:${item.id}`;
}

export function packageNeedsMeta(provider: string, id: string): boolean {
  const entry = getMetaFromMemory(packageMetaSlug(provider, id));
  if (!entry) return true;
  if (entry.complete) return false;
  return Date.now() - entry.fetchedAt > RETRY_AFTER_MS;
}

export function enqueuePackageMeta(items: PackageMetaRequest[]): void {
  for (const item of items) {
    if (!item.id || item.provider === 'catalog') continue;
    if (!packageNeedsMeta(item.provider, item.id)) continue;
    const key = requestKey(item);
    if (queued.has(key)) continue;
    queued.add(key);
    queue.push(item);
  }

  // The tail is what the user is looking at right now, so trim from the front.
  while (queue.length > MAX_QUEUE) {
    const dropped = queue.shift();
    if (dropped) queued.delete(requestKey(dropped));
  }

  while (workers < CONCURRENCY && queue.length > 0) {
    workers++;
    void runWorker();
  }
}

async function runWorker(): Promise<void> {
  try {
    for (;;) {
      const item = queue.pop();
      if (!item) return;
      queued.delete(requestKey(item));
      try {
        // Emitted even when nothing was found, so the UI can stop showing a spinner.
        emit(await resolvePackageMeta(item));
      } catch {
        // one bad package must not stop the queue
      }
    }
  } finally {
    workers--;
    flush();
  }
}

function emit(update: PackageMetaUpdate): void {
  pendingUpdates.push(update);
  if (pendingUpdates.length >= FLUSH_SIZE) {
    flush();
    return;
  }
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
}

function flush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingUpdates.length === 0) return;
  const batch = pendingUpdates;
  pendingUpdates = [];
  listener?.(batch);
}

async function resolvePackageMeta(item: PackageMetaRequest): Promise<PackageMetaUpdate> {
  const slug = packageMetaSlug(item.provider, item.id);
  const existing = getMetaFromMemory(slug);

  let description = existing?.description?.trim() || undefined;
  let homepage = existing?.homepage;
  let iconUrl = existing?.iconUrl ?? localIconUrl(slug);

  // The provider call also yields the homepage, which the favicon tier needs.
  if (!description || (!iconUrl && !homepage)) {
    const details = await getAllProviders()
      .find((p) => p.id === item.provider)
      ?.describe?.(item.id);
    description = description ?? details?.description?.trim() ?? undefined;
    homepage = homepage ?? details?.homepage;
  }

  if (!iconUrl) {
    const match = matchIcon(item.id, item.name);
    if (match) iconUrl = await downloadIcon(slug, match.url, match.paintWith);
  }
  if (!iconUrl && homepage) {
    for (const candidate of faviconCandidates(homepage)) {
      iconUrl = await downloadIcon(slug, candidate.url);
      if (iconUrl) break;
    }
  }

  // winget answers in the Windows display language and scoop manifests are
  // English, so the text is stored language-agnostically rather than as en/ru.
  const entry: MetaEntry = {
    slug,
    description,
    iconUrl,
    homepage,
    complete: !!(iconUrl && description),
    fetchedAt: Date.now(),
  };
  saveMetaEntry(entry);

  return { provider: item.provider, id: item.id, description, iconUrl };
}
