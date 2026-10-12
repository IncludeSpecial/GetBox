/**
 * Resilience audit: every catalog app must have a package-manager route —
 * a winget Id (winget-map / installers.json) or a hand-pinned provider —
 * so a dead direct download never leaves the user stuck.
 *
 * Run: node scripts/test-resilience.cjs [--winget]
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog.json'), 'utf-8'));
const wingetMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'winget-map.json'), 'utf-8'));
const installers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'installers.json'), 'utf-8'));
const CHECK_WINGET = process.argv.includes('--winget');

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    errors.push(`${name}: ${err.message}`);
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

function wingetIdExists(id) {
  const r = spawnSync('winget', ['show', '--id', id, '-e', '--accept-source-agreements'], {
    encoding: 'utf-8',
    timeout: 20000,
  });
  return r.status === 0;
}

function resolveWingetId(entry) {
  return installers[entry.id]?.wingetId ?? wingetMap[entry.id];
}

function hasInstallFallback(entry) {
  return Boolean(resolveWingetId(entry) || installers[entry.id]?.provider);
}

console.log('\nresilience audit:');

test('every recommended app has install fallback', () => {
  const missing = catalog.filter((e) => e.recommended && !hasInstallFallback(e)).map((e) => e.id);
  if (missing.length) throw new Error(`missing install fallback: ${missing.join(', ')}`);
});

test('installers.json winget Ids agree with winget-map', () => {
  const drift = catalog
    .filter((e) => installers[e.id]?.wingetId && wingetMap[e.id] && installers[e.id].wingetId.toLowerCase() !== wingetMap[e.id].toLowerCase())
    .map((e) => `${e.id} (${wingetMap[e.id]} vs ${installers[e.id].wingetId})`);
  if (drift.length) throw new Error(`drift: ${drift.join(', ')}`);
});

const values = catalog.map((e) => installers[e.id] ?? {});
console.log(`\n  coverage: ${catalog.filter(hasInstallFallback).length}/${catalog.length} apps with a package-manager route`);
console.log(`  coverage: ${values.filter((v) => v.url).length}/${catalog.length} apps with a verified direct installer`);

if (CHECK_WINGET && wingetAvailable()) {
  console.log('\n  validating winget IDs…');
  const ids = [...new Set(catalog.filter(hasInstallFallback).map(resolveWingetId).filter(Boolean))];
  let bad = 0;
  for (const id of ids) {
    if (!wingetIdExists(id)) {
      bad++;
      errors.push(`winget show failed for ${id}`);
      console.log(`    x ${id}`);
    } else {
      console.log(`    ✓ ${id}`);
    }
  }
  test('all winget fallback IDs resolve via winget show', () => {
    if (bad) throw new Error(`${bad} invalid winget ID(s)`);
  });
} else if (CHECK_WINGET) {
  console.log('\n  winget not on PATH — skipping ID validation');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
