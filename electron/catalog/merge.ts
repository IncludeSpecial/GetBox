import fs from 'node:fs';
import path from 'node:path';
import type { MergedApp, Package, PickEntry, ProfileEntry, RelatedData } from '../providers/types.js';
import { packageKey, softIsInstalled } from '../providers/types.js';
import { loadCuratedCatalog } from '../providers/catalog.js';
import { peekScoopInstalledCache } from '../providers/scoop.js';
import { peekCatalogInstalledCache } from '../providers/catalog.js';
import { loadIndexFromDisk } from '../index-builder.js';
import { getDataDir } from '../paths.js';
import { getSettings } from '../store/settings.js';
import { getFavorites } from '../store/favorites.js';
import { getMetaFromMemory, getDescriptionForLang, appNeedsMetaEnrich, isMetaPendingForSlug, isPrewarmRunning, type MetaLang } from '../enrich/meta-cache.js';
import { resolveBrandColor } from '../enrich/icons.js';
import { packageBrandColor } from '../enrich/icon-index.js';
import { packageMetaSlug } from '../enrich/package-meta.js';

function resolveLang(): MetaLang {
  return getSettings().language === 'en' ? 'en' : 'ru';
}

function resolveMeta(slug: string, logoSlug?: string) {
  return getMetaFromMemory(slug) ?? (logoSlug ? getMetaFromMemory(logoSlug) : undefined);
}

function resolveAppDescription(
  meta: ReturnType<typeof getMetaFromMemory>,
  lang: MetaLang,
  fallback?: string,
  overlay?: string,
): string | undefined {
  const base = overlay?.trim() || fallback?.trim();
  const resolved = getDescriptionForLang(meta, lang, base);
  return resolved?.trim() || base;
}

function isCuratedMetaPending(
  entry: { id: string; logoSlug?: string; wikiTitle?: string; description?: string; provider: string },
  _meta: ReturnType<typeof getMetaFromMemory>,
  _lang: MetaLang,
): boolean {
  if (entry.provider !== 'catalog') return false;
  if (isMetaPendingForSlug(entry.id) || (entry.logoSlug && isMetaPendingForSlug(entry.logoSlug))) return true;
  if (isPrewarmRunning() && appNeedsMetaEnrich(entry)) return true;
  return false;
}

type InvalidateReason = 'favorites' | 'index' | 'installed';

interface MergeCache {
  apps: MergedApp[];
  indexEntries: Package[];
  installedSet: Set<string>;
  invalidated: Set<InvalidateReason>;
}

let cache: MergeCache | null = null;
let installedSetLive: Set<string> = new Set();

export function invalidateCatalog(reason: InvalidateReason): void {
  if (!cache) {
    cache = { apps: [], indexEntries: [], installedSet: new Set(), invalidated: new Set([reason]) };
    return;
  }
  cache.invalidated.add(reason);
}

export function setInstalledSet(installed: Set<string>): void {
  installedSetLive = installed;
  invalidateCatalog('installed');
}

export function peekInstalledSet(): Set<string> {
  if (installedSetLive.size > 0) return installedSetLive;
  const scoop = peekScoopInstalledCache();
  const catalog = peekCatalogInstalledCache();
  return new Set([...scoop, ...catalog]);
}

interface LocalizedPick {
  why: string;
  tag: string;
  descriptionOverlay?: string;
}

function localizePick(pick: PickEntry | undefined, lang: MetaLang): LocalizedPick | undefined {
  if (!pick) return undefined;
  if (lang !== 'en') return pick;
  return {
    why: pick.whyEn ?? pick.why,
    tag: pick.tagEn ?? pick.tag,
    descriptionOverlay: pick.descriptionOverlayEn ?? pick.descriptionOverlay,
  };
}

function loadPicks(): PickEntry[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(getDataDir(), 'picks.json'), 'utf-8')) as PickEntry[];
  } catch {
    return [];
  }
}

function loadProfiles(): ProfileEntry[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(getDataDir(), 'profiles.json'), 'utf-8')) as ProfileEntry[];
  } catch {
    return [];
  }
}

const EMPTY_RELATED: RelatedData = { stacks: [], alternatives: [] };

function loadRelated(): RelatedData {
  try {
    return JSON.parse(fs.readFileSync(path.join(getDataDir(), 'related.json'), 'utf-8')) as RelatedData;
  } catch {
    return EMPTY_RELATED;
  }
}

function loadCategories(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(path.join(getDataDir(), 'categories.json'), 'utf-8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function mergeApps(): MergedApp[] {
  const lang = resolveLang();
  const curated = loadCuratedCatalog();
  const index = loadIndexFromDisk();
  const favorites = getFavorites();
  const installed = peekInstalledSet();
  const picks = loadPicks();
  const pickMap = new Map(picks.map((p) => [p.packageRef, p]));

  const appsMap = new Map<string, MergedApp>();

  for (const entry of curated) {
    const key = packageKey(entry.provider, entry.packageId);
    const pick = localizePick(pickMap.get(key), lang);
    const meta = resolveMeta(entry.id, entry.logoSlug);
    appsMap.set(key, {
      id: entry.packageId,
      provider: entry.provider,
      name: entry.name,
      description: pick?.descriptionOverlay ?? entry.description,
      category: entry.category,
      features: entry.features,
      wikiTitle: entry.wikiTitle,
      logoSlug: entry.logoSlug,
      recommended: entry.recommended,
      curatedId: entry.id,
      isInstalled: softIsInstalled(entry.name, installed) || installed.has(entry.packageId),
      isFavorite: favorites.has(key),
      enrichedDescription: resolveAppDescription(meta, lang, entry.description, pick?.descriptionOverlay),
      iconUrl: meta?.iconUrl,
      brandColor: resolveBrandColor({ id: entry.id, logoSlug: entry.logoSlug, simpleSlug: entry.simpleSlug, name: entry.name }),
      pickTag: pick?.tag,
      pickWhy: pick?.why,
      metaPending: isCuratedMetaPending(entry, meta, lang),
    });
  }

  for (const pkg of index) {
    const key = packageKey(pkg.provider, pkg.id);
    if (appsMap.has(key)) continue;
    // Provider packages are enriched under their own slug, resolved on demand.
    const meta = resolveMeta(packageMetaSlug(pkg.provider, pkg.id), pkg.logoSlug);
    appsMap.set(key, {
      ...pkg,
      isInstalled: softIsInstalled(pkg.name, installed) || installed.has(pkg.id),
      isFavorite: favorites.has(key),
      enrichedDescription: resolveAppDescription(meta, lang, pkg.description),
      iconUrl: meta?.iconUrl,
      brandColor: packageBrandColor(pkg.id, pkg.name),
    });
  }

  return [...appsMap.values()];
}

export function getCatalog(): {
  apps: MergedApp[];
  categories: Record<string, string>;
  profiles: ProfileEntry[];
  related: RelatedData;
} {
  if (!cache || cache.invalidated.size > 0) {
    const apps = mergeApps();
    cache = {
      apps,
      indexEntries: loadIndexFromDisk(),
      installedSet: peekInstalledSet(),
      invalidated: new Set(),
    };
  }
  return {
    apps: cache.apps,
    categories: loadCategories(),
    profiles: loadProfiles(),
    related: loadRelated(),
  };
}

export function getAppsByCategory(category: string): MergedApp[] {
  return getCatalog().apps.filter((a) => a.category === category);
}

export function getRecommendedApps(): MergedApp[] {
  const { apps } = getCatalog();
  const picks = loadPicks();
  const pickRefs = new Set(picks.map((p) => p.packageRef));
  return apps.filter((a) => {
    const key = packageKey(a.provider, a.id);
    return pickRefs.has(key) || a.recommended;
  });
}

export function getFavoriteApps(): MergedApp[] {
  return getCatalog().apps.filter((a) => a.isFavorite);
}

export function getInstalledApps(): MergedApp[] {
  return getCatalog().apps.filter((a) => a.isInstalled);
}

export function findApp(provider: string, packageId: string): MergedApp | undefined {
  const key = packageKey(provider, packageId);
  return getCatalog().apps.find((a) => packageKey(a.provider, a.id) === key);
}

