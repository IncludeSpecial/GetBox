/**
 * Resilience audit: every catalog app must have winget install fallback
 * (altProvider, winget-map entry, or explicit noWingetFallback).
 *
 * Run: node scripts/test-resilience.cjs [--winget]
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog.json'), 'utf-8'));
const wingetMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'winget-map.json'), 'utf-8'));
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

function hasInstallFallback(entry) {
  if (entry.noWingetFallback) return false;
  if (entry.altProvider?.provider === 'winget' && entry.altProvider.packageId) return true;
  return Boolean(wingetMap[entry.id]);
}

function resolveWingetId(entry) {
  if (entry.altProvider?.provider === 'winget') return entry.altProvider.packageId;
  return wingetMap[entry.id];
}

console.log('\nresilience audit:');

test('every recommended app has install fallback', () => {
  const missing = catalog.filter((e) => e.recommended && !hasInstallFallback(e)).map((e) => e.id);
  if (missing.length) throw new Error(`missing install fallback: ${missing.join(', ')}`);
});

test('catalog ids are covered by winget-map or noWingetFallback', () => {
  const missing = catalog
    .filter((e) => !e.noWingetFallback && !wingetMap[e.id] && e.altProvider?.provider !== 'winget')
    .map((e) => e.id);
  if (missing.length) throw new Error(`uncovered catalog ids: ${missing.join(', ')}`);
});

test('every altProvider has winget or scoop + packageId', () => {
  for (const entry of catalog) {
    if (!entry.altProvider) continue;
    const { provider, packageId } = entry.altProvider;
    if (!['winget', 'scoop'].includes(provider)) {
      throw new Error(`${entry.id}: invalid altProvider.provider "${provider}"`);
    }
    if (!packageId || !String(packageId).trim()) {
      throw new Error(`${entry.id}: empty altProvider.packageId`);
    }
  }
});

const withFallback = catalog.filter((e) => hasInstallFallback(e));
const withMap = catalog.filter((e) => wingetMap[e.id]);
const withAlt = catalog.filter((e) => e.altProvider);
const withFallbacks = catalog.filter((e) => e.installUrlFallbacks?.length);
console.log(`\n  coverage: ${withFallback.length}/${catalog.length} apps with winget fallback`);
console.log(`  coverage: ${withMap.length}/${catalog.length} apps in winget-map.json`);
console.log(`  coverage: ${withAlt.length}/${catalog.length} apps with legacy altProvider`);
console.log(`  coverage: ${withFallbacks.length}/${catalog.length} apps with URL fallbacks`);

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
