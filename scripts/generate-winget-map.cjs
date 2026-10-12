/**
 * Generate data/winget-map.json from catalog + winget search/show.
 *
 *   node scripts/generate-winget-map.cjs           — build/update map
 *   node scripts/generate-winget-map.cjs --verify  — CI: keys + Id format only
 *   node scripts/generate-winget-map.cjs --dry-run — report without writing
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CATALOG_PATH = path.join(DATA, 'catalog.json');
const OVERRIDES_PATH = path.join(DATA, 'winget-overrides.json');
const MAP_PATH = path.join(DATA, 'winget-map.json');
const INSTALLERS_PATH = path.join(DATA, 'installers.json');

const VERIFY = process.argv.includes('--verify');
const DRY_RUN = process.argv.includes('--dry-run');
const LIVE = process.argv.includes('--live');

/** Publisher.Package — winget Id shape used in CI verify. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.+-]+\.[A-Za-z0-9][A-Za-z0-9_.+-]+$/;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function wingetAvailable() {
  try {
    const r = spawnSync('winget', ['--version'], { encoding: 'utf-8', timeout: 8000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

function wingetShow(id) {
  const r = spawnSync(
    'winget',
    ['show', '--id', id, '-e', '--accept-source-agreements', '--disable-interactivity'],
    { encoding: 'utf-8', timeout: 30000 },
  );
  return r.status === 0;
}

function wingetSearch(query) {
  const r = spawnSync(
    'winget',
    ['search', query, '--count', '15', '--accept-source-agreements', '--disable-interactivity'],
    { encoding: 'utf-8', timeout: 45000 },
  );
  if (r.status !== 0) return [];
  return parseSearchTable(r.stdout || '');
}

/** Parse winget search table rows: Name | Id | Version | Match | Source */
function parseSearchTable(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (/^Name\s+Id\s+Version/i.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.trim() || /^-+/.test(line)) continue;
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length < 2) continue;
    const name = parts[0].trim();
    const id = parts[1].trim();
    if (!id || id === 'Id') continue;
    rows.push({ name, id });
  }
  return rows;
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function pickBestMatch(entry, results) {
  if (!results.length) return null;
  const nameNorm = normalize(entry.name);
  for (const row of results) {
    if (normalize(row.name) === nameNorm) return row.id;
  }
  for (const row of results) {
    if (normalize(row.name).includes(nameNorm) || nameNorm.includes(normalize(row.name))) {
      return row.id;
    }
  }
  const idHint = normalize(entry.id).replace(/-/g, '');
  for (const row of results) {
    const idNorm = normalize(row.id);
    if (idNorm.includes(idHint) || idHint.includes(idNorm.split('.')[1] || '')) {
      return row.id;
    }
  }
  return results[0]?.id ?? null;
}

/** Apps hand-pinned to another package manager in installers.json need no winget Id. */
function pinnedElsewhere() {
  const installers = readJson(INSTALLERS_PATH, {});
  return new Set(Object.keys(installers).filter((id) => installers[id].provider));
}

function validateMapStructure(catalog, map) {
  const pinned = pinnedElsewhere();
  let errors = 0;
  const orphans = Object.keys(map).filter((id) => !catalog.some((e) => e.id === id));
  for (const id of orphans) {
    console.warn(`  ! orphan winget-map key "${id}" (not in catalog)`);
  }

  for (const entry of catalog) {
    if (pinned.has(entry.id)) continue;
    if (map[entry.id]) continue;
    console.error(`  x ${entry.id}: missing winget-map entry and not pinned to another provider in installers.json`);
    errors++;
  }

  for (const [id, pkgId] of Object.entries(map)) {
    if (!ID_PATTERN.test(pkgId)) {
      console.error(`  x ${id}: invalid winget Id "${pkgId}"`);
      errors++;
    }
  }

  const withFallback = catalog.filter(
    (e) => !pinned.has(e.id) && map[e.id],
  );
  console.log(`\n  coverage: ${withFallback.length}/${catalog.length} apps with winget fallback`);
  console.log(`  pinned to another provider: ${pinned.size}`);
  return errors;
}

function buildMap(catalog, overrides, useWinget) {
  const pinned = pinnedElsewhere();
  const map = { ...overrides };

  const pending = catalog.filter((e) => !pinned.has(e.id) && !map[e.id]);
  if (pending.length && useWinget) {
    console.log(`\n  searching winget for ${pending.length} unmapped apps…`);
    for (const entry of pending) {
      const results = wingetSearch(entry.name);
      const picked = pickBestMatch(entry, results);
      if (picked && wingetShow(picked)) {
        map[entry.id] = picked;
        console.log(`    ✓ ${entry.id} → ${picked}`);
      } else {
        console.log(`    ? ${entry.id} (${entry.name}) — no match`);
      }
    }
  } else if (pending.length) {
    console.log(`\n  ${pending.length} apps still unmapped (winget not available — use overrides)`);
    for (const entry of pending) console.log(`    ? ${entry.id}`);
  }

  if (useWinget && LIVE) {
    console.log('\n  verifying all map IDs via winget show…');
    for (const [id, pkgId] of Object.entries(map)) {
      if (!wingetShow(pkgId)) console.warn(`    x winget show failed: ${id} → ${pkgId}`);
    }
  }

  const sorted = {};
  for (const key of Object.keys(map).sort()) sorted[key] = map[key];
  return sorted;
}

function main() {
  const catalog = readJson(CATALOG_PATH, []);
  const overrides = readJson(OVERRIDES_PATH, {});
  const existing = readJson(MAP_PATH, {});

  if (!Array.isArray(catalog) || catalog.length === 0) {
    console.error('catalog.json missing or empty');
    process.exit(1);
  }

  console.log(`winget-map: ${catalog.length} catalog apps`);

  if (VERIFY) {
    const map = { ...existing, ...overrides };
    const errors = validateMapStructure(catalog, map);
    if (errors) {
      console.error(`\n${errors} error(s)\n`);
      process.exit(1);
    }
    console.log('\nwinget-map verify OK\n');
    return;
  }

  const useWinget = wingetAvailable();
  if (!useWinget) console.log('  winget not on PATH — using seeds + overrides only');

  const map = buildMap(catalog, overrides, useWinget);
  const errors = validateMapStructure(catalog, map);
  if (errors) {
    console.error(`\n${errors} structural error(s) — fix winget-overrides.json or pin a provider in installers.json\n`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('\n  dry-run — would write', Object.keys(map).length, 'entries');
    return;
  }

  fs.writeFileSync(MAP_PATH, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`\n  wrote ${MAP_PATH} (${Object.keys(map).length} entries)\n`);
}

main();
