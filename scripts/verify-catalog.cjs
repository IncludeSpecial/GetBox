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

const REQUIRED = ['id', 'name', 'description', 'category', 'packageId', 'provider', 'installUrl'];
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
    if (!entry.silentArgs) {
      warnings.push(`${label}: no silentArgs, install will show the vendor UI`);
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

(async () => {
  let catalog;
  let categories;
  let picks;
  let profiles;
  try {
    catalog = readJson('catalog.json');
    categories = readJson('categories.json');
    picks = readJson('picks.json');
    profiles = readJson('profiles.json');
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

  const byCategory = {};
  for (const entry of catalog) byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
  for (const key of Object.keys(categories)) {
    console.log(`  ${key.padEnd(10)} ${byCategory[key] || 0}`);
  }

  if (CHECK_LINKS) {
    const targets = catalog.filter((e) => e.installUrl);
    console.log(`\nChecking ${targets.length} install links…`);
    const results = await mapLimit(targets, CONCURRENCY, async (entry) => {
      const res = await checkUrl(entry.installUrl);
      if (!res.ok) console.log(`  x ${entry.id.padEnd(18)} ${res.status}`);
      return { entry, res };
    });

    let ok = 0;
    let unverified = 0;
    for (const { entry, res } of results) {
      if (res.ok) {
        ok++;
        if (res.length && res.length < 20000) {
          warnings.push(`${entry.id}: installUrl is only ${res.length} bytes, may be an error page`);
        }
        continue;
      }
      // A reset connection, a bot-blocking 403 or a rate-limiting 429/503 means
      // we could not check the link, not that the installer is gone. Only a real
      // HTTP error is fatal.
      if (res.network || UNVERIFIABLE_STATUS.has(res.status)) {
        unverified++;
        warnings.push(`${entry.id}: could not verify (${res.status}) — ${entry.installUrl}`);
        continue;
      }
      errors.push(`${entry.id}: installUrl returned ${res.status} — ${entry.installUrl}`);
    }
    console.log(`  ${ok} OK, ${unverified} unverifiable, ${targets.length - ok - unverified} broken`);
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
