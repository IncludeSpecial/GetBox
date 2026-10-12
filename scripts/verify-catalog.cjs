/**
 * Validate data/catalog.json and the files that reference it.
 *
 * Structural checks always run. Link checks run too, but if virtually every
 * request dies at the network layer the run is treated as offline and skipped
 * rather than reported as ~90 broken installers.
 *
 * Run: node scripts/verify-catalog.cjs [--no-links]
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const ICONS = path.join(DATA, 'icons');
const CHECK_LINKS = !process.argv.includes('--no-links');
const CONCURRENCY = 8;

const REQUIRED = ['id', 'name', 'description', 'category', 'packageId', 'provider'];
/** Install fields moved to installers.json, generated from winget manifests. */
const LINK_FIELDS = ['installUrl', 'installUrlFallbacks', 'silentArgs', 'altProvider', 'noWingetFallback'];
const ICON_EXTENSIONS = ['.svg', '.png', '.ico', '.jpg'];
const NETWORK_ERRORS = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'TIMEOUT', 'EPROTO'];
/** Statuses that say "not now" rather than "gone". */
const UNVERIFIABLE_STATUS = new Set([403, 429, 503]);

const errors = [];
const warnings = [];

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf-8'));
}

/** Resolve redirects manually so we can report the final status of each installer. */
function checkUrl(url, depth = 0) {
  return new Promise((resolve) => {
    if (depth > 6) return resolve({ ok: false, status: 'too many redirects' });
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return resolve({ ok: false, status: 'malformed url' });
    }
    const getter = parsed.protocol === 'http:' ? http : https;
    const req = getter.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: '*/*',
          'Accept-Encoding': 'identity',
        },
      },
      (res) => {
        res.on('error', () => {});
        const loc = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc) {
          res.resume();
          const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
          return checkUrl(next, depth + 1).then(resolve);
        }
        const status = res.statusCode;
        const length = Number(res.headers['content-length'] || 0);
        req.destroy();
        resolve({ ok: status === 200, status, length, finalUrl: url });
      },
    );
    req.on('error', (err) => resolve({ ok: false, status: err.code || 'ERR', network: NETWORK_ERRORS.includes(err.code) }));
    req.setTimeout(20000, () => {
      req.destroy();
      resolve({ ok: false, status: 'TIMEOUT', network: true });
    });
  });
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

function verifyStructure(catalog, categories, picks, profiles) {
  const seenIds = new Set();
  const seenPackageIds = new Set();
  const knownCategories = new Set(Object.keys(categories));

  for (const entry of catalog) {
    const label = entry.id || entry.name || '(unnamed)';

    for (const field of REQUIRED) {
      const value = entry[field];
      if (value === undefined || value === null || String(value).trim() === '') {
        errors.push(`${label}: missing required field "${field}"`);
      }
    }

    if (!Array.isArray(entry.features) || entry.features.length === 0) {
      errors.push(`${label}: "features" must be a non-empty array`);
    }
    for (const field of LINK_FIELDS) {
      if (field in entry) errors.push(`${label}: "${field}" belongs in installers.json (npm run catalog:installers)`);
    }
    if (entry.provider !== 'catalog') {
      errors.push(`${label}: provider must be "catalog", got "${entry.provider}"`);
    }
    if (entry.category && !knownCategories.has(entry.category)) {
      errors.push(`${label}: category "${entry.category}" is not in categories.json`);
    }

    if (entry.id) {
      if (seenIds.has(entry.id)) errors.push(`duplicate id "${entry.id}"`);
      seenIds.add(entry.id);
    }
    if (entry.packageId) {
      if (seenPackageIds.has(entry.packageId)) errors.push(`duplicate packageId "${entry.packageId}"`);
      seenPackageIds.add(entry.packageId);
    }

    const slug = entry.logoSlug || entry.id;
    const hasIcon = ICON_EXTENSIONS.some((ext) => fs.existsSync(path.join(ICONS, slug + ext)));
    if (!hasIcon) {
      errors.push(`${label}: no icon in data/icons for slug "${slug}" — run node scripts/fetch-icons.cjs`);
    }
  }

  for (const category of knownCategories) {
    if (category === 'other') continue;
    if (!catalog.some((e) => e.category === category)) {
      warnings.push(`category "${category}" has no apps`);
    }
  }

  for (const pick of picks) {
    const [provider, packageId] = String(pick.packageRef).split(':');
    if (provider !== 'catalog') {
      errors.push(`picks.json: "${pick.packageRef}" uses unknown provider "${provider}"`);
      continue;
    }
    if (!catalog.some((e) => e.packageId === packageId || e.id === packageId)) {
      errors.push(`picks.json: "${pick.packageRef}" does not match any catalog entry`);
    }
    if (!pick.whyEn || !pick.tagEn) {
      warnings.push(`picks.json: "${pick.packageRef}" has no English copy`);
    }
  }

  for (const profile of profiles) {
    for (const pkg of profile.packages || []) {
      if (pkg.provider !== 'catalog') {
        errors.push(`profiles.json: ${profile.id} uses unknown provider "${pkg.provider}"`);
        continue;
      }
      if (!catalog.some((e) => e.packageId === pkg.packageId || e.id === pkg.packageId)) {
        errors.push(`profiles.json: ${profile.id} references missing package "${pkg.packageId}"`);
      }
    }
  }
}

function verifyInstallers(catalog, installers) {
  for (const entry of catalog) {
    const inst = installers[entry.id];
    if (!inst) {
      errors.push(`${entry.id}: missing from installers.json — run npm run catalog:installers`);
      continue;
    }
    if (inst.url && !inst.silentArgs) {
      warnings.push(`${entry.id}: ${inst.type} installer has no silent switches, the vendor UI will show`);
    }
  }
  for (const id of Object.keys(installers)) {
    if (!catalog.some((e) => e.id === id)) warnings.push(`installers.json: orphan key "${id}"`);
  }
}

function verifyWingetMap(catalog, installers) {
  let wingetMap;
  try {
    wingetMap = readJson('winget-map.json');
  } catch (err) {
    errors.push(`winget-map.json: ${err.message}`);
    return;
  }

  if (typeof wingetMap !== 'object' || wingetMap === null || Array.isArray(wingetMap)) {
    errors.push('winget-map.json must be a JSON object');
    return;
  }

  const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.+-]+\.[A-Za-z0-9][A-Za-z0-9_.+-]+$/;
  const catalogIds = new Set(catalog.map((e) => e.id));

  for (const [id, pkgId] of Object.entries(wingetMap)) {
    if (!catalogIds.has(id)) {
      warnings.push(`winget-map.json: orphan key "${id}" (not in catalog)`);
    }
    if (typeof pkgId !== 'string' || !idPattern.test(pkgId)) {
      errors.push(`winget-map.json: invalid Id for "${id}": "${pkgId}"`);
    }
  }

  for (const entry of catalog) {
    if (wingetMap[entry.id] || installers[entry.id]?.provider) continue;
    errors.push(`${entry.id}: no winget-map entry and no hand-pinned provider in installers.json`);
  }
}

(async () => {
  let catalog;
  let categories;
  let picks;
  let profiles;
  let installers;
  try {
    catalog = readJson('catalog.json');
    categories = readJson('categories.json');
    picks = readJson('picks.json');
    profiles = readJson('profiles.json');
    installers = readJson('installers.json');
  } catch (err) {
    console.error('Failed to read catalog data:', err.message);
    process.exit(1);
  }

  if (!Array.isArray(catalog) || catalog.length === 0) {
    console.error('catalog.json must be a non-empty array');
    process.exit(1);
  }

  console.log(`Catalog: ${catalog.length} apps, ${Object.keys(categories).length} categories\n`);
  verifyStructure(catalog, categories, picks, profiles);
  verifyInstallers(catalog, installers);
  verifyWingetMap(catalog, installers);

  const byCategory = {};
  for (const entry of catalog) byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
  for (const key of Object.keys(categories)) {
    console.log(`  ${key.padEnd(10)} ${byCategory[key] || 0}`);
  }

  if (CHECK_LINKS) {
    const linkTargets = [];
    for (const entry of catalog) {
      const url = installers[entry.id]?.url;
      if (url) linkTargets.push({ entry, url, kind: 'primary' });
    }
    console.log(`\nChecking ${linkTargets.length} installer links from installers.json…`);
    const results = await mapLimit(linkTargets, CONCURRENCY, async ({ entry, url, kind }) => {
      const res = await checkUrl(url);
      if (!res.ok) console.log(`  x ${entry.id.padEnd(18)} [${kind}] ${res.status}`);
      return { entry, url, kind, res };
    });

    let ok = 0;
    let unverified = 0;
    for (const { entry, url, kind, res } of results) {
      if (res.ok) {
        ok++;
        if (kind === 'primary' && res.length && res.length < 20000) {
          warnings.push(`${entry.id}: installer is only ${res.length} bytes, may be an error page`);
        }
        continue;
      }
      if (res.network || UNVERIFIABLE_STATUS.has(res.status)) {
        unverified++;
        warnings.push(`${entry.id}: could not verify ${kind} (${res.status}) — ${url}`);
        continue;
      }
      // The app falls back to winget, so a dead pinned link is stale data, not a broken install.
      warnings.push(`${entry.id}: installer link returned ${res.status}, refresh installers.json — ${url}`);
    }
    console.log(`  ${ok} OK, ${unverified} unverifiable, ${linkTargets.length - ok - unverified} broken`);
  }

  if (warnings.length > 0) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.log('  ! ' + w);
  }

  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s):`);
    for (const e of errors) console.error('  x ' + e);
    process.exit(1);
  }

  console.log('\nCatalog OK');
})();
