import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../paths.js';

/** Runtime mirror of the icon waterfall in scripts/fetch-icons.cjs. */

export const ICON_EXTENSIONS = ['.svg', '.png', '.ico', '.jpg'] as const;

const DASHBOARD_BASE = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/';
const SIMPLE_BASE = 'https://cdn.jsdelivr.net/npm/simple-icons@11/icons/';

export interface IconTarget {
  id: string;
  logoSlug?: string;
  simpleSlug?: string;
  iconUrl?: string;
  name?: string;
  /** Vendor site, used for the favicon tier when no logo catalogue has the app. */
  homepage?: string;
}

export interface IconCandidate {
  url: string;
  ext: string;
  /** simple-icons glyphs ship with no fill and render black until painted. */
  paintWith?: string;
}

export function iconExtFor(url: string, contentType = ''): string {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.svg') || contentType.includes('svg')) return '.svg';
  if (clean.endsWith('.ico') || contentType.includes('icon')) return '.ico';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg') || contentType.includes('jpeg')) return '.jpg';
  return '.png';
}

export function iconSlugFor(target: IconTarget): string {
  return target.logoSlug || target.id;
}

/**
 * Ordered sources for one app. A miss on every tier leaves the app without an
 * icon rather than borrowing another brand's logo.
 */
export function iconCandidates(target: IconTarget): IconCandidate[] {
  const slug = iconSlugFor(target);
  const simpleSlug = target.simpleSlug || slug;
  const candidates: IconCandidate[] = [];
  if (target.iconUrl) {
    candidates.push({ url: target.iconUrl, ext: iconExtFor(target.iconUrl) });
  }
  candidates.push({ url: `${DASHBOARD_BASE}${slug}.svg`, ext: '.svg' });
  candidates.push({
    url: `${SIMPLE_BASE}${simpleSlug}.svg`,
    ext: '.svg',
    paintWith: getBrandColor(simpleSlug, slug) ?? fallbackBrandColor(target.name ?? slug),
  });
  if (target.homepage) candidates.push(...faviconCandidates(target.homepage));
  return candidates;
}

/**
 * Most CLI tools live on a forge, and its favicon says nothing about the package
 * — a wall of identical GitHub marks reads worse than a name monogram.
 */
const FORGE_HOSTS = /(^|\.)(github\.com|gitlab\.com|sourceforge\.net|bitbucket\.org|codeberg\.org)$/i;

/**
 * Last resort: the vendor's own favicon. Google's service normalises size and
 * format, the site's own file is the backup.
 */
export function faviconCandidates(homepage: string): IconCandidate[] {
  try {
    const host = new URL(homepage).hostname;
    if (!host || FORGE_HOSTS.test(host)) return [];
    return [
      { url: `https://www.google.com/s2/favicons?domain=${host}&sz=256`, ext: '.png' },
      { url: `https://${host}/favicon.ico`, ext: '.ico' },
    ];
  } catch {
    return [];
  }
}

export function paintSvg(svg: string, hex?: string): string {
  if (!hex) return svg;
  if (/<svg[^>]*\sfill=/.test(svg)) return svg;
  return svg.replace(/<svg\b/, `<svg fill="${legibleOnDark(hex)}"`);
}

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff' };
const COLOR_ATTR = /(fill|stroke|stop-color)\s*=\s*"([^"]+)"/g;

function toHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  return null;
}

function isDarkHex(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.3;
}

/**
 * Lift an all-dark logo (Rust and friends) so it stays visible on the dark
 * capsule. A black detail inside a colourful logo is left alone.
 */
export function normalizeDarkSvg(svg: string): string {
  const colors: string[] = [];
  for (const [, , value] of svg.matchAll(COLOR_ATTR)) {
    const v = value.trim().toLowerCase();
    if (v === 'none' || v === 'currentcolor') continue;
    const hex = toHex(v);
    if (hex) colors.push(hex);
  }
  if (colors.length === 0 || !colors.every(isDarkHex)) return svg;

  return svg.replace(COLOR_ATTR, (match, attr: string, value: string) => {
    const hex = toHex(value);
    return hex ? `${attr}="${legibleOnDark(hex)}"` : match;
  });
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Brands like OBS (#302E31) are almost black and vanish on the dark capsule.
 * Keep the hue, lift the lightness until the glyph reads.
 */
export function legibleOnDark(hex: string, minL = 0.58): string {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (l >= minL) return hex;
  const d = max - min;
  if (d === 0) return '#d8dde2';
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return hslToHex(h, Math.min(100, s * 100) || 40, minL * 100);
}

let brandColors: Record<string, string> | null = null;

function loadBrandColors(): Record<string, string> {
  if (brandColors) return brandColors;
  try {
    const raw = fs.readFileSync(path.join(getDataDir(), 'brand-colors.json'), 'utf-8');
    brandColors = JSON.parse(raw) as Record<string, string>;
  } catch {
    brandColors = {};
  }
  return brandColors;
}

export function getBrandColor(...slugs: Array<string | undefined>): string | undefined {
  const colors = loadBrandColors();
  for (const slug of slugs) {
    if (slug && colors[slug]) return colors[slug];
  }
  return undefined;
}

/** Deterministic tint so a capsule never renders on a flat grey block. */
export function fallbackBrandColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return hslToHex(hue, 48, 42);
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) =>
    Math.round(255 * (ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function resolveBrandColor(target: IconTarget): string {
  return (
    getBrandColor(iconSlugFor(target), target.simpleSlug, target.id) ??
    fallbackBrandColor(target.name ?? target.id)
  );
}
