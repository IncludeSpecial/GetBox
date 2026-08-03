/**
 * Full application surface audit (no Electron UI).
 * IPC/preload parity, i18n error codes, queue API, provider registry.
 *
 * Run: node scripts/test-app-full.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf-8');
}

const ERROR_CODES = [
  'cancelled', 'not_found', 'forbidden', 'network', 'timeout', 'http', 'installer', 'unknown',
];

console.log('\napp surface audit:');

test('preload exposes queue cancel/retry/dismiss/clear', () => {
  const src = read('electron/preload.ts');
  for (const fn of ['cancelQueueJob', 'retryQueueJob', 'dismissQueueJob', 'clearDoneQueue', 'clearAllQueue', 'retryFailedQueue']) {
    if (!src.includes(fn)) throw new Error(`preload missing ${fn}`);
  }
});

test('main registers queue IPC handlers', () => {
  const src = read('electron/main.ts');
  for (const ch of ['queue:cancel', 'queue:retryJob', 'queue:dismiss', 'queue:clearDone', 'queue:clearAll', 'queue:retryFailed']) {
    if (!src.includes(ch)) throw new Error(`main missing ${ch}`);
  }
});

test('i18n RU/EN cover all install error codes', () => {
  const src = read('src/i18n/translations.ts');
  for (const code of ERROR_CODES) {
    if (!src.includes(`${code}:`)) throw new Error(`translations missing error code ${code}`);
  }
});

test('InstallButton supports onRetry prop', () => {
  const src = read('src/components/InstallButton.tsx');
  if (!src.includes('onRetry')) throw new Error('InstallButton missing onRetry');
});

test('App.tsx wires handleRetryJob', () => {
  const src = read('src/App.tsx');
  if (!src.includes('handleRetryJob')) throw new Error('App missing handleRetryJob');
  if (!src.includes('retryQueueJob')) throw new Error('App missing retryQueueJob call');
});

test('clearDone removes failed jobs', () => {
  const src = read('electron/queue/install-queue.ts');
  if (!src.includes("j.status !== 'failed'")) throw new Error('clearDone should filter failed');
});

test('catalog uses shouldTryAltProvider', () => {
  const src = read('electron/providers/catalog.ts');
  if (!src.includes('shouldTryAltProvider(err)')) throw new Error('catalog missing shouldTryAltProvider');
});

test('provider registry has catalog/winget/scoop/chocolatey', () => {
  const src = read('electron/providers/registry.ts');
  for (const id of ['catalog', 'winget', 'scoop', 'chocolatey']) {
    if (!src.includes(id)) throw new Error(`registry missing ${id}`);
  }
});

test('profiles.json packages reference catalog entries', () => {
  const catalog = JSON.parse(read('data/catalog.json'));
  const profiles = JSON.parse(read('data/profiles.json'));
  for (const profile of profiles) {
    for (const pkg of profile.packages || []) {
      const found = catalog.some((e) => e.packageId === pkg.packageId || e.id === pkg.packageId);
      if (!found) throw new Error(`profile ${profile.id} references unknown ${pkg.packageId}`);
    }
  }
});

test('picks.json references valid catalog packages', () => {
  const catalog = JSON.parse(read('data/catalog.json'));
  const picks = JSON.parse(read('data/picks.json'));
  for (const pick of picks) {
    const [, packageId] = String(pick.packageRef).split(':');
    const found = catalog.some((e) => e.packageId === packageId || e.id === packageId);
    if (!found) throw new Error(`pick ${pick.packageRef} not in catalog`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
