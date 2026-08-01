import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../paths.js';
import { fallbackBrandColor } from './icons.js';

export { faviconCandidates } from './icons.js';

/**
 * Provider packages arrive with nothing but an id and a display name, so their
 * logo has to be guessed. Probing the icon CDNs per package would cost thousands
 * of requests, so both catalogues are indexed offline: dashboard-icons slugs and
 * aliases come from data/icon-index.json (written by scripts/fetch-icons.cjs),
 * simple-icons slugs from the bundled brand-colour map.
 */

const DASHBOARD_BASE = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/';
const SIMPLE_BASE = 'https://cdn.jsdelivr.net/npm/simple-icons@11/icons/';

export interface IconMatch {
  url: string;
  /** simple-icons glyphs render black until painted with the brand hex. */
  paintWith?: string;
}

interface Index {
  dashboard: Map<string, string>;
  aliases: Map<string, string>;
  simple: Map<string, { slug: string; hex: string }>;
}

let index: Index | null = null;

export function normalizeIconKey(value: string): string {
  // Spelling out ++ and # keeps Notepad++ and C# from collapsing onto Notepad and C.
  return value
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]/g, '');
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(getDataDir(), file), 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function loadIndex(): Index {
  if (index) return index;

  const raw = readJson<{
    dashboard?: string[];
    aliases?: Record<string, string>;
    simple?: Record<string, { slug: string; hex: string }>;
  }>('icon-index.json', {});
  const dashboard = new Map<string, string>();
  for (const slug of raw.dashboard ?? []) {
    const key = normalizeIconKey(slug);
    if (!dashboard.has(key)) dashboard.set(key, slug);
  }

  const aliases = new Map<string, string>();
  for (const [alias, slug] of Object.entries(raw.aliases ?? {})) {
    const key = normalizeIconKey(alias);
    if (!dashboard.has(key) && !aliases.has(key)) aliases.set(key, slug);
  }

  // Keyed by normalized product title: simple-icons slugs spell out punctuation
  // (nodedotjs, notepadplusplus), so the slug itself is a poor lookup key.
  const simple = new Map<string, { slug: string; hex: string }>(Object.entries(raw.simple ?? {}));
  for (const [slug, hex] of Object.entries(readJson<Record<string, string>>('simple-icons-colors.json', {}))) {
    const key = normalizeIconKey(slug);
    if (!simple.has(key)) simple.set(key, { slug, hex });
  }

  index = { dashboard, aliases, simple };
  return index;
}

/** Packaging noise: matching on these would pull in an unrelated logo. */
const EDITION_WORDS = new Set([
  'edition', 'community', 'professional', 'enterprise', 'ultimate', 'desktop', 'client',
  'server', 'launcher', 'portable', 'installer', 'setup', 'beta', 'nightly', 'stable',
  'preview', 'insider', 'latest', 'win64', 'win32', 'x86_64', '64bit', 'bundle', 'suite',
  'free', 'open', 'tool', 'tools', 'apps', 'game', 'games', 'plus', 'full', 'lite',
]);

/**
 * Ordered guesses for one package. Most specific first: a package called
 * "Visual Studio Code" must not match the bare "code" logo.
 */
export function iconKeyCandidates(id: string, name: string): string[] {
  const candidates: string[] = [name, id];
  // winget ids are Publisher.Product; the product half is the recognisable part.
  const dotted = id.split('.');
  if (dotted.length > 1) {
    candidates.push(dotted.join('-'), dotted[dotted.length - 1]);
  }
  // scoop buckets prefix with the bucket name: extras/googlechrome.
  const slashed = id.split('/');
  if (slashed.length > 1) candidates.push(slashed[slashed.length - 1]);

  // "IntelliJ IDEA Community Edition" is not a logo, "IntelliJ IDEA" is. Drop
  // trailing words one at a time, then fall back to single distinctive words.
  const words = name.split(/\s+/).filter(Boolean);
  for (let end = words.length - 1; end >= 2; end--) {
    candidates.push(words.slice(0, end).join('-'));
  }
  if (words.length > 1) {
    candidates.push(words.slice(1).join('-'));
    for (const word of [...words].reverse()) {
      const lower = word.toLowerCase();
      if (word.length < 4 || EDITION_WORDS.has(lower) || !/[a-z]{3}/.test(lower)) continue;
      candidates.push(word);
    }
  }

  const seen = new Set<string>();
  const keys: string[] = [];
  for (const candidate of candidates) {
    const key = normalizeIconKey(candidate);
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function matchIcon(id: string, name: string): IconMatch | undefined {
  const { dashboard, aliases, simple } = loadIndex();
  for (const key of iconKeyCandidates(id, name)) {
    const dashboardSlug = dashboard.get(key) ?? aliases.get(key);
    if (dashboardSlug) return { url: `${DASHBOARD_BASE}${dashboardSlug}.svg` };

    const simpleHit = simple.get(key);
    if (simpleHit) {
      return { url: `${SIMPLE_BASE}${simpleHit.slug}.svg`, paintWith: simpleHit.hex };
    }
  }
  return undefined;
}

export function packageBrandColor(id: string, name: string): string {
  const { simple } = loadIndex();
  for (const key of iconKeyCandidates(id, name)) {
    const hit = simple.get(key);
    if (hit) return hit.hex;
  }
  return fallbackBrandColor(name || id);
}
