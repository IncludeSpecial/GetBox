import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getAppDataDir, getMetaDir, getImagesDir, getBundledIconsDir } from '../paths.js';
import { loadCuratedCatalog } from '../providers/catalog.js';
import { getSettings } from '../store/settings.js';
import {
  ICON_EXTENSIONS,
  iconCandidates,
  iconExtFor,
  iconSlugFor,
  normalizeDarkSvg,
  paintSvg,
  type IconTarget,
} from './icons.js';

export type MetaLang = 'ru' | 'en';

export interface MetaEntry {
  slug: string;
  description?: string;
  descriptions?: Partial<Record<MetaLang, string>>;
  iconUrl?: string;
  /** Vendor site, kept so a favicon can be retried without asking the provider again. */
  homepage?: string;
  complete: boolean;
  fetchedAt: number;
}

const memoryCache = new Map<string, MetaEntry>();

export interface MetaProgress {
  running: boolean;
  total: number;
  done: number;
  current?: string;
  completeness: number;
}

let prewarmRunning = false;
let metaProgress: MetaProgress = { running: false, total: 0, done: 0, completeness: 0 };
const pendingSlugs = new Set<string>();

export type MetaProgressCallback = (progress: MetaProgress) => void;

function emitProgress(onProgress?: MetaProgressCallback): void {
  metaProgress = { ...metaProgress, completeness: getMetaCompleteness() };
  onProgress?.(metaProgress);
}

export function getMetaProgress(): MetaProgress {
  return { ...metaProgress, completeness: getMetaCompleteness() };
}

export function isMetaPendingForSlug(slug: string): boolean {
  return pendingSlugs.has(slug);
}

export function isPrewarmRunning(): boolean {
  return prewarmRunning;
}

function mediaUrl(filename: string): string {
  return `getbox-media://local/${encodeURIComponent(filename)}`;
}

function metaFilePath(slug: string): string {
  return path.join(getMetaDir(), `${slug}.json`);
}

function readMetaFromDisk(slug: string): MetaEntry | null {
  try {
    const p = metaFilePath(slug);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as MetaEntry;
  } catch {
    return null;
  }
}

function saveMeta(entry: MetaEntry): void {
  fs.mkdirSync(getMetaDir(), { recursive: true });
  fs.writeFileSync(metaFilePath(entry.slug), JSON.stringify(entry));
  memoryCache.set(entry.slug, entry);
}

function localIconPath(slug: string): string | undefined {
  for (const ext of ICON_EXTENSIONS) {
    const cached = path.join(getImagesDir(), `${slug}${ext}`);
    if (fs.existsSync(cached)) return mediaUrl(`${slug}${ext}`);
    const bundled = path.join(getBundledIconsDir(), `${slug}${ext}`);
    if (fs.existsSync(bundled)) {
      fs.mkdirSync(getImagesDir(), { recursive: true });
      fs.copyFileSync(bundled, cached);
      return mediaUrl(`${slug}${ext}`);
    }
  }
  return undefined;
}

function getMetaEntry(slug: string): MetaEntry | undefined {
  return memoryCache.get(slug) ?? readMetaFromDisk(slug) ?? undefined;
}

function aliasCatalogIcons(): void {
  for (const item of loadCuratedCatalog()) {
    const keys = new Set([item.id, item.logoSlug].filter(Boolean) as string[]);
    let iconUrl: string | undefined;
    for (const key of keys) {
      iconUrl = localIconPath(key) ?? getMetaEntry(key)?.iconUrl;
      if (iconUrl) break;
    }
    if (!iconUrl) continue;
    for (const key of keys) {
      const existing = getMetaEntry(key);
      const entry: MetaEntry = {
        slug: key,
        descriptions: existing?.descriptions,
        description: existing?.description,
        iconUrl,
        complete: existing?.complete ?? !!iconUrl,
        fetchedAt: existing?.fetchedAt ?? Date.now(),
      };
      memoryCache.set(key, entry);
    }
  }
}

export function warmMetaCacheFromDisk(): void {
  seedBundledIcons();
  const dir = getMetaDir();
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as MetaEntry;
        memoryCache.set(entry.slug, entry);
      } catch {
        // skip corrupt
      }
    }
  }
  hydrateIconsFromDisk();
  aliasCatalogIcons();
}

function isIconFile(file: string): boolean {
  return ICON_EXTENSIONS.some((ext) => file.endsWith(ext));
}

function hydrateIconsFromDisk(): void {
  const imagesDir = getImagesDir();
  if (!fs.existsSync(imagesDir)) return;
  for (const file of fs.readdirSync(imagesDir)) {
    if (!isIconFile(file)) continue;
    const slug = path.basename(file, path.extname(file));
    const iconUrl = mediaUrl(file);
    const existing = getMetaEntry(slug);
    if (existing?.iconUrl) continue;
    memoryCache.set(slug, {
      slug,
      descriptions: existing?.descriptions,
      description: existing?.description,
      iconUrl,
      complete: !!(iconUrl || existing?.descriptions?.en || existing?.descriptions?.ru),
      fetchedAt: existing?.fetchedAt ?? Date.now(),
    });
  }
}

function iconRevisionFile(): string {
  return path.join(getAppDataDir(), 'icon-revision');
}

function bundledIconRevision(): string {
  try {
    const raw = fs.readFileSync(path.join(getBundledIconsDir(), 'manifest.json'), 'utf-8');
    return createHash('sha1').update(raw).digest('hex').slice(0, 16);
  } catch {
    return 'none';
  }
}

/**
 * The bundled icon set changed, so cached images and any iconUrl pointing at
 * them are stale. Descriptions survive; only the icon side is invalidated.
 */
function resetIconCacheIfStale(): void {
  const revision = bundledIconRevision();
  let previous = '';
  try {
    previous = fs.readFileSync(iconRevisionFile(), 'utf-8').trim();
  } catch {
    previous = '';
  }
  if (previous === revision) return;

  const imagesDir = getImagesDir();
  if (fs.existsSync(imagesDir)) {
    for (const file of fs.readdirSync(imagesDir)) {
      if (isIconFile(file)) fs.rmSync(path.join(imagesDir, file), { force: true });
    }
  }

  const metaDir = getMetaDir();
  if (fs.existsSync(metaDir)) {
    for (const file of fs.readdirSync(metaDir)) {
      if (!file.endsWith('.json')) continue;
      const p = path.join(metaDir, file);
      try {
        const entry = JSON.parse(fs.readFileSync(p, 'utf-8')) as MetaEntry;
        if (!entry.iconUrl) continue;
        delete entry.iconUrl;
        entry.complete = false;
        fs.writeFileSync(p, JSON.stringify(entry));
      } catch {
        // skip corrupt
      }
    }
  }

  memoryCache.clear();
  fs.mkdirSync(getAppDataDir(), { recursive: true });
  fs.writeFileSync(iconRevisionFile(), revision);
}

export function seedBundledIcons(): void {
  const bundledDir = getBundledIconsDir();
  if (!fs.existsSync(bundledDir)) return;
  resetIconCacheIfStale();
  fs.mkdirSync(getImagesDir(), { recursive: true });
  for (const file of fs.readdirSync(bundledDir)) {
    if (!isIconFile(file)) continue;
    const dest = path.join(getImagesDir(), file);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(bundledDir, file), dest);
    }
  }
}

export function getMetaFromMemory(slug: string): MetaEntry | undefined {
  return getMetaEntry(slug);
}

export function saveMetaEntry(entry: MetaEntry): void {
  saveMeta(entry);
}

export function getDescriptionForLang(meta: MetaEntry | undefined, lang: MetaLang, fallback?: string): string | undefined {
  const fb = fallback?.trim() || undefined;
  if (!meta) return fb;
  const primary = meta.descriptions?.[lang]?.trim();
  if (primary) return primary;
  const other: MetaLang = lang === 'en' ? 'ru' : 'en';
  const secondary = meta.descriptions?.[other]?.trim();
  if (secondary) return secondary;
  const legacy = meta.description?.trim();
  if (legacy) return legacy;
  return fb;
}

async function fetchWikipediaSummary(title: string, lang: MetaLang): Promise<string | undefined> {
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { extract?: string };
    return data.extract;
  } catch {
    return undefined;
  }
}

/** Download one icon into the local cache and return its media URL. */
export async function downloadIcon(slug: string, url: string, paintWith?: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return undefined;
    const raw = Buffer.from(await res.arrayBuffer());
    if (raw.length < 64) return undefined;

    const ext = iconExtFor(url, res.headers.get('content-type') ?? '');
    let body = raw;
    if (ext === '.svg') {
      body = Buffer.from(
        paintWith ? paintSvg(raw.toString('utf-8'), paintWith) : normalizeDarkSvg(raw.toString('utf-8')),
      );
    }

    fs.mkdirSync(getImagesDir(), { recursive: true });
    fs.writeFileSync(path.join(getImagesDir(), `${slug}${ext}`), body);
    return mediaUrl(`${slug}${ext}`);
  } catch {
    return undefined;
  }
}

export function localIconUrl(slug: string): string | undefined {
  return localIconPath(slug);
}

/**
 * Explicit iconUrl, then dashboard-icons, then a recoloured simple-icons glyph.
 * Returns undefined when no tier answers — never another brand's logo.
 */
async function fetchIcon(target: IconTarget): Promise<string | undefined> {
  const slug = iconSlugFor(target);
  const existing = localIconPath(slug);
  if (existing) return existing;

  for (const candidate of iconCandidates(target)) {
    const stored = await downloadIcon(slug, candidate.url, candidate.paintWith);
    if (stored) return stored;
  }
  return undefined;
}

function needsEnrich(item: { id: string; logoSlug?: string; wikiTitle?: string; description?: string }): boolean {
  const slug = item.id;
  const meta = getMetaEntry(slug) ?? getMetaEntry(item.logoSlug || slug);
  const iconSlug = iconSlugFor(item);
  const hasIcon = !!meta?.iconUrl || !!localIconPath(iconSlug);
  const hasEn = !!meta?.descriptions?.en?.trim() || !!meta?.description?.trim();
  const hasRu = !!meta?.descriptions?.ru?.trim() || !!item.description?.trim();
  if (!hasIcon) return true;
  if (item.wikiTitle && !hasEn) return true;
  if (item.wikiTitle && !hasRu) return true;
  return false;
}

export function appNeedsMetaEnrich(item: { id: string; logoSlug?: string; wikiTitle?: string; description?: string }): boolean {
  return needsEnrich(item);
}

export interface EnrichRequest {
  slug: string;
  wikiTitle?: string;
  logoSlug?: string;
  simpleSlug?: string;
  iconUrl?: string;
  homepage?: string;
  description?: string;
  name?: string;
}

export async function enrichMeta(slugs: EnrichRequest[]): Promise<MetaEntry[]> {
  const results: MetaEntry[] = [];

  for (const item of slugs) {
    const cacheKey = item.slug;
    const target: IconTarget = {
      id: item.slug,
      logoSlug: item.logoSlug,
      simpleSlug: item.simpleSlug,
      iconUrl: item.iconUrl,
      homepage: item.homepage,
      name: item.name,
    };
    const iconSlug = iconSlugFor(target);
    const entry = getMetaEntry(cacheKey) ?? getMetaEntry(iconSlug) ?? readMetaFromDisk(cacheKey);

    const iconUrl = entry?.iconUrl ?? localIconPath(iconSlug) ?? (await fetchIcon(target));

    const descriptions: Partial<Record<MetaLang, string>> = { ...(entry?.descriptions ?? {}) };
    if (item.description && !descriptions.ru) descriptions.ru = item.description;
    if (item.wikiTitle) {
      if (!descriptions.ru) {
        descriptions.ru = (await fetchWikipediaSummary(item.wikiTitle, 'ru')) ?? descriptions.ru;
      }
      if (!descriptions.en) {
        descriptions.en = (await fetchWikipediaSummary(item.wikiTitle, 'en')) ?? descriptions.en;
      }
    }

    const merged: MetaEntry = {
      slug: cacheKey,
      descriptions,
      description: descriptions.en ?? descriptions.ru ?? entry?.description,
      iconUrl: iconUrl ?? entry?.iconUrl,
      complete: !!(iconUrl && (descriptions.en || descriptions.ru || item.description)),
      fetchedAt: Date.now(),
    };
    saveMeta(merged);
    if (iconSlug !== cacheKey) {
      saveMeta({ ...merged, slug: iconSlug });
    }
    const lang: MetaLang = getSettings().language === 'en' ? 'en' : 'ru';
    results.push({
      ...merged,
      description: getDescriptionForLang(merged, lang, item.description),
    });
  }

  aliasCatalogIcons();
  return results;
}

export function getMetaCompleteness(): number {
  const curated = loadCuratedCatalog();
  if (curated.length === 0) return 1;
  let score = 0;
  for (const item of curated) {
    const meta = getMetaFromMemory(item.id);
    const hasIcon = !!meta?.iconUrl || !!localIconPath(iconSlugFor(item));
    const hasEn = !!meta?.descriptions?.en;
    if (hasIcon) score += 0.5;
    if (hasEn || item.description) score += 0.5;
  }
  return score / curated.length;
}

export async function prewarmMeta(onProgress?: MetaProgressCallback): Promise<{ ok: boolean; count: number; message?: string }> {
  if (prewarmRunning) {
    return { ok: true, count: 0, message: 'Meta: already running' };
  }
  prewarmRunning = true;
  seedBundledIcons();
  hydrateIconsFromDisk();
  aliasCatalogIcons();

  const curated = loadCuratedCatalog();
  const toFetch: Array<EnrichRequest & { name: string }> = curated.filter(needsEnrich).map((item) => ({
    slug: item.id,
    wikiTitle: item.wikiTitle,
    logoSlug: item.logoSlug,
    simpleSlug: item.simpleSlug,
    iconUrl: item.iconUrl,
    homepage: item.homepage,
    description: item.description,
    name: item.name,
  }));

  metaProgress = {
    running: true,
    total: curated.length,
    done: curated.length - toFetch.length,
    completeness: getMetaCompleteness(),
  };
  emitProgress(onProgress);

  const chunkSize = 4;
  let count = 0;
  for (let i = 0; i < toFetch.length; i += chunkSize) {
    const chunk = toFetch.slice(i, i + chunkSize);
    for (const item of chunk) {
      pendingSlugs.add(item.slug);
      if (item.logoSlug) pendingSlugs.add(item.logoSlug);
    }
    metaProgress = {
      ...metaProgress,
      current: chunk.map((c) => c.name).join(', '),
    };
    emitProgress(onProgress);

    await enrichMeta(chunk);

    for (const item of chunk) {
      pendingSlugs.delete(item.slug);
      if (item.logoSlug) pendingSlugs.delete(item.logoSlug);
      count++;
    }
    metaProgress = {
      ...metaProgress,
      done: metaProgress.done + chunk.length,
      current: undefined,
    };
    emitProgress(onProgress);
  }

  aliasCatalogIcons();
  prewarmRunning = false;
  metaProgress = {
    running: false,
    total: curated.length,
    done: curated.length,
    completeness: getMetaCompleteness(),
  };
  emitProgress(onProgress);

  return { ok: true, count, message: `Meta: ${count} apps` };
}

export async function maybeAutoPrewarm(onProgress?: MetaProgressCallback): Promise<boolean> {
  seedBundledIcons();
  hydrateIconsFromDisk();
  aliasCatalogIcons();
  const curated = loadCuratedCatalog();
  const anyNeed = curated.some(needsEnrich);
  if (!anyNeed && getMetaCompleteness() >= 0.98) return false;
  await prewarmMeta(onProgress);
  return true;
}
