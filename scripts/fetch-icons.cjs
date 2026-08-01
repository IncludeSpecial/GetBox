/**
 * Resolve one authentic icon per catalog entry and cache it in data/icons/.
 *
 * Waterfall per app — the first tier that answers wins, and a miss never falls
 * back to another brand's logo:
 *   1. entry.iconUrl        explicit, hand-verified source
 *   2. dashboard-icons      real full-colour product logos
 *   3. simple-icons         monochrome glyph, recoloured with the brand hex
 *   4. entry.homepage       the vendor's own favicon
 *
 * Also emits data/brand-colors.json, used by the UI for capsule gradients.
 *
 * Run: node scripts/fetch-icons.cjs [--force]
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const ROOT = path.join(__dirname, '..');
const CATALOG = path.join(ROOT, 'data', 'catalog.json');
const OUT_DIR = path.join(ROOT, 'data', 'icons');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');
const BRAND_COLORS = path.join(ROOT, 'data', 'brand-colors.json');
const SIMPLE_COLORS = path.join(ROOT, 'data', 'simple-icons-colors.json');

const ICON_INDEX = path.join(ROOT, 'data', 'icon-index.json');

const DASHBOARD = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/';
const DASHBOARD_TREE = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/tree.json';
const DASHBOARD_META = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/metadata.json';
const SIMPLE = 'https://cdn.jsdelivr.net/npm/simple-icons@11/icons/';
const SIMPLE_META = 'https://cdn.jsdelivr.net/npm/simple-icons@11/_data/simple-icons.json';

const FORCE = process.argv.includes('--force');

/** Bump when the resolution or colourisation rules change, to invalidate cached icons. */
const PIPELINE_REV = 'v3';

function fetchBuffer(url, depth = 0) {
  return new Promise((resolve) => {
    if (depth > 5) return resolve(null);
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 GetBox/1.0' } }, (res) => {
      res.on('error', () => resolve(null));
      const loc = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc) {
        res.resume();
        const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchBuffer(next, depth + 1).then(resolve);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve(body.length > 64 ? { body, type: res.headers['content-type'] || '' } : null);
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
  });
}

function extFor(url, contentType) {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.svg') || contentType.includes('svg')) return '.svg';
  if (clean.endsWith('.ico') || contentType.includes('icon')) return '.ico';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg') || contentType.includes('jpeg')) return '.jpg';
  return '.png';
}

/** simple-icons ship glyphs with no fill, so they render black. Paint them with the brand hex. */
function colorizeSvg(buf, hex) {
  let svg = buf.toString('utf8');
  if (!hex) return Buffer.from(svg);
  if (/<svg[^>]*\sfill=/.test(svg)) return Buffer.from(svg);
  svg = svg.replace(/<svg\b/, `<svg fill="${legibleOnDark(hex)}"`);
  return Buffer.from(svg);
}

const NAMED = { black: '#000000', white: '#ffffff' };
const COLOR_ATTR = /(fill|stroke|stop-color)\s*=\s*"([^"]+)"/g;

function toHex(value) {
  const v = value.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  return null;
}

function isDarkHex(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.3;
}

/**
 * Some authentic logos (Rust, Sublime's wordmark) are pure black and vanish on
 * the dark capsule. Lift them only when the whole icon is dark — a black detail
 * inside a colourful logo must stay black.
 */
function normalizeDarkSvg(buf) {
  const svg = buf.toString('utf8');
  const colors = [];
  for (const [, , value] of svg.matchAll(COLOR_ATTR)) {
    const v = value.trim().toLowerCase();
    if (v === 'none' || v === 'currentcolor') continue;
    const hex = toHex(v);
    if (hex) colors.push(hex);
  }
  if (colors.length === 0 || !colors.every(isDarkHex)) return buf;

  const lifted = svg.replace(COLOR_ATTR, (match, attr, value) => {
    const hex = toHex(value);
    return hex ? `${attr}="${legibleOnDark(hex)}"` : match;
  });
  return Buffer.from(lifted);
}

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Brands like OBS (#302E31) or Rockstar are almost black, so their glyph would
 * disappear on the dark capsule. Keep the hue, lift the lightness until it reads.
 */
function legibleOnDark(hex, minL = 0.58) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (l >= minL) return hex;
  const d = max - min;
  if (d === 0) return '#d8dde2';
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return hslToHex(h, Math.min(100, s * 100) || 40, minL * 100);
}

const NEUTRAL = /^#?(0{3,8}|f{3,8}|fff(fff)?|000(000)?)$/i;

/** Pick the dominant non-neutral colour out of an SVG so capsules get a brand tint. */
function dominantSvgColor(buf) {
  const svg = buf.toString('utf8');
  const counts = new Map();
  const re = /(?:fill|stop-color|stroke)\s*[=:]\s*["']?(#[0-9a-fA-F]{3,8})/g;
  let m;
  while ((m = re.exec(svg))) {
    let hex = m[1].toLowerCase();
    if (hex.length === 4) hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    if (hex.length > 7) hex = hex.slice(0, 7);
    if (NEUTRAL.test(hex.slice(1))) continue;
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  if (counts.size === 0) return undefined;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function hashColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return hslToHex(hue, 48, 42);
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

/**
 * Brand hexes for the simple-icons tier. Cached on disk: a flaky fetch must not
 * silently downgrade every glyph to a hashed colour.
 */
/**
 * simple-icons only ships an explicit slug when it cannot be derived from the
 * title, so the derivation has to match theirs: + becomes plus, . becomes dot,
 * & becomes and. Getting this wrong silently aims at the wrong logo — deriving
 * "Notepad++" as "notepad" used to fetch a different product's glyph.
 */
function simpleSlugFromTitle(title) {
  return title
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/^\./, 'dot-')
    .replace(/\.$/, '-dot')
    .replace(/\./g, '-dot-')
    .replace(/^&/, 'and-')
    .replace(/&$/, '-and')
    .replace(/&/g, '-and-')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function loadSimpleIconsMeta() {
  const res = await fetchBuffer(SIMPLE_META);
  if (res) {
    try {
      const parsed = JSON.parse(res.body.toString('utf-8'));
      const list = Array.isArray(parsed) ? parsed : parsed.icons || [];
      const colors = {};
      const titles = {};
      for (const icon of list) {
        if (!icon.title || !icon.hex) continue;
        const slug = icon.slug || simpleSlugFromTitle(icon.title);
        const hex = '#' + String(icon.hex).replace(/^#/, '').toLowerCase();
        colors[slug] = hex;
        const key = normalizeKey(icon.title);
        if (key && !titles[key]) titles[key] = { slug, hex };
      }
      if (Object.keys(colors).length > 0) {
        fs.writeFileSync(SIMPLE_COLORS, JSON.stringify(colors, null, 2));
        return { colors: new Map(Object.entries(colors)), titles };
      }
    } catch {
      // fall through to the cached copy
    }
  }

  const cached = readJson(SIMPLE_COLORS, null);
  if (cached && Object.keys(cached).length > 0) {
    console.log('simple-icons metadata unreachable — using cached palette');
    return { colors: new Map(Object.entries(cached)), titles: null };
  }
  console.error('simple-icons palette unavailable and no local cache; refusing to guess brand colours');
  process.exit(1);
}

/** Mirrors normalizeIconKey() in electron/enrich/icon-index.ts — keys must match. */
function normalizeKey(value) {
  return String(value)
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Slug list plus alias map for dashboard-icons, written to data/icon-index.json.
 * Provider packages (winget, scoop, choco) carry only an id and a name, so the
 * app matches them against this index offline instead of probing the CDN per
 * package. Keeps the previous file when the network is unavailable.
 */
async function buildIconIndex(simpleTitles) {
  const previous = readJson(ICON_INDEX, null);
  const tree = await fetchBuffer(DASHBOARD_TREE);
  if (!tree) {
    console.log(previous ? 'dashboard-icons tree unreachable — keeping cached index' : 'dashboard-icons tree unreachable and no cache');
    return;
  }

  let slugs = [];
  try {
    const parsed = JSON.parse(tree.body.toString('utf-8'));
    slugs = (parsed.svg || []).map((f) => f.replace(/\.svg$/, ''));
  } catch {
    return;
  }
  if (slugs.length === 0) return;

  const aliases = {};
  const meta = await fetchBuffer(DASHBOARD_META);
  if (meta) {
    try {
      const parsed = JSON.parse(meta.body.toString('utf-8'));
      for (const [slug, info] of Object.entries(parsed)) {
        for (const alias of info.aliases || []) {
          const key = normalizeKey(alias);
          if (key && !aliases[key]) aliases[key] = slug;
        }
      }
    } catch {
      // aliases are a bonus; the slug list alone still matches most packages
    }
  }

  // A cached palette has no titles; the previous mapping is better than none.
  const simple = simpleTitles ?? previous?.simple ?? {};
  fs.writeFileSync(ICON_INDEX, JSON.stringify({ dashboard: slugs.sort(), aliases, simple }, null, 2));
  console.log(
    `icon index: ${slugs.length} dashboard slugs, ${Object.keys(aliases).length} aliases, ${Object.keys(simple).length} simple-icons titles`,
  );
}

function existingFileFor(slug) {
  for (const ext of ['.svg', '.png', '.ico', '.jpg']) {
    const p = path.join(OUT_DIR, slug + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function removeExisting(slug) {
  for (const ext of ['.svg', '.png', '.ico', '.jpg']) {
    const p = path.join(OUT_DIR, slug + ext);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

/** Vendor favicon, for the many small Windows tools no logo catalogue carries. */
function faviconTiers(homepage) {
  try {
    const host = new URL(homepage).hostname;
    if (!host) return [];
    return [
      { tier: 'favicon', url: `https://www.google.com/s2/favicons?domain=${host}&sz=256` },
      { tier: 'favicon', url: `https://${host}/favicon.ico` },
    ];
  } catch {
    return [];
  }
}

async function resolveIcon(entry, simpleMeta) {
  const slug = entry.logoSlug || entry.id;
  const simpleSlug = entry.simpleSlug || slug;
  const tiers = [];

  if (entry.iconUrl) tiers.push({ tier: 'explicit', url: entry.iconUrl });
  tiers.push({ tier: 'dashboard', url: `${DASHBOARD}${slug}.svg` });
  tiers.push({ tier: 'simple', url: `${SIMPLE}${simpleSlug}.svg`, hex: simpleMeta.get(simpleSlug) });
  if (entry.homepage) tiers.push(...faviconTiers(entry.homepage));

  for (const t of tiers) {
    const res = await fetchBuffer(t.url);
    if (!res) continue;
    let body = res.body;
    const ext = extFor(t.url, res.type);
    if (t.tier === 'simple' && ext === '.svg') {
      body = colorizeSvg(body, t.hex || hashColor(entry.name));
    } else if (ext === '.svg') {
      body = normalizeDarkSvg(body);
    }
    let color = simpleMeta.get(simpleSlug);
    if (!color && ext === '.svg') color = dominantSvgColor(body);
    if (!color) color = hashColor(entry.name);
    return { tier: t.tier, url: t.url, ext, body, color };
  }
  return null;
}

(async () => {
  const catalog = readJson(CATALOG, null);
  if (!Array.isArray(catalog)) {
    console.error('catalog.json is missing or malformed');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = FORCE ? {} : readJson(MANIFEST, {});
  const { colors: simpleMeta, titles: simpleTitles } = await loadSimpleIconsMeta();
  console.log(`simple-icons brand colours: ${simpleMeta.size}`);
  await buildIconIndex(simpleTitles);
  console.log(`Resolving icons for ${catalog.length} apps…\n`);

  const nextManifest = {};
  const brandColors = {};
  const missing = [];
  let downloaded = 0;
  let cached = 0;

  for (const entry of catalog) {
    const slug = entry.logoSlug || entry.id;
    const simpleSlug = entry.simpleSlug || slug;
    const expectedSource = `${entry.iconUrl || `${DASHBOARD}${slug}.svg|${SIMPLE}${simpleSlug}.svg|${entry.homepage || ''}`}#${PIPELINE_REV}`;
    const prev = manifest[slug];
    const onDisk = existingFileFor(slug);

    if (prev && onDisk && prev.source === expectedSource) {
      nextManifest[slug] = prev;
      brandColors[slug] = prev.color;
      cached++;
      console.log(`  = ${entry.name} (cached, ${prev.tier})`);
      continue;
    }

    const resolved = await resolveIcon(entry, simpleMeta);
    if (!resolved) {
      // A transient network miss must not throw away an icon we already have.
      if (prev && onDisk) {
        nextManifest[slug] = prev;
        brandColors[slug] = prev.color;
        cached++;
        console.log(`  = ${entry.name} (kept, source unreachable)`);
        continue;
      }
      missing.push(`${entry.name} [${entry.id}] slug=${slug}`);
      console.log(`  x ${entry.name} — no authentic icon found`);
      continue;
    }

    removeExisting(slug);
    fs.writeFileSync(path.join(OUT_DIR, slug + resolved.ext), resolved.body);
    nextManifest[slug] = { source: expectedSource, tier: resolved.tier, url: resolved.url, color: resolved.color };
    brandColors[slug] = resolved.color;
    downloaded++;
    console.log(`  + ${entry.name} (${resolved.tier}${resolved.ext})`);
  }

  // Drop icons whose app is no longer in the catalog.
  const keep = new Set(catalog.map((e) => e.logoSlug || e.id));
  for (const file of fs.readdirSync(OUT_DIR)) {
    if (file === 'manifest.json') continue;
    const base = path.basename(file, path.extname(file));
    if (!keep.has(base)) {
      fs.unlinkSync(path.join(OUT_DIR, file));
      console.log(`  - ${file} (orphaned)`);
    }
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(nextManifest, null, 2));
  fs.writeFileSync(BRAND_COLORS, JSON.stringify(brandColors, null, 2));

  console.log(`\n${downloaded} downloaded, ${cached} cached, ${missing.length} missing`);
  console.log(`brand colours -> data/brand-colors.json`);

  if (missing.length > 0) {
    console.error('\nApps without an authentic icon:');
    for (const m of missing) console.error('  - ' + m);
    console.error('\nAdd a verified "iconUrl" for these entries in data/catalog.json.');
    process.exit(1);
  }
})();
