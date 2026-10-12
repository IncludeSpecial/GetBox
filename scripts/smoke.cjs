/**
 * GetBox smoke tests — pure logic, no Electron UI
 */
const { strict: assert } = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

let passed = 0;
let failed = 0;

/** Load a TypeScript module for testing by bundling it with the esbuild vite already ships. */
function loadTsModule(entry, stubs = {}) {
  const { buildSync } = require('esbuild');
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['node:*', ...Object.keys(stubs)],
    // The main-process code is ESM; import.meta.url has no meaning once bundled to cjs.
    define: { 'import.meta.url': JSON.stringify(require('node:url').pathToFileURL(entry).href) },
  });
  const req = (id) => (id in stubs ? stubs[id] : require(id));
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, req);
  return module.exports;
}

/** Modules under electron/ reach for app paths; the data dir is all they need here. */
const electronStub = {
  app: {
    isPackaged: false,
    getAppPath: () => path.join(__dirname, '..'),
    getPath: () => path.join(__dirname, '..'),
  },
};

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

// --- softIsInstalled (mirrors electron/providers/types.ts) ---
const SHORT_TOKENS = new Set(['git', 'code', 'go', 'npm', 'jdk', 'jre', 'vc', 'vs']);

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
}

function abbrevNorm(name) {
  return normalizeName(name)
    .replace(/visualstudio/g, 'vs')
    .replace(/nodejs/g, 'node');
}

function softIsInstalled(appName, installedSet) {
  const norm = normalizeName(appName);
  const abbrev = abbrevNorm(appName);
  if (norm.length < 5) return false;
  if (SHORT_TOKENS.has(norm)) return false;
  for (const inst of installedSet) {
    const instNorm = normalizeName(inst);
    if (instNorm.length < 2) continue;
    if (SHORT_TOKENS.has(instNorm) && SHORT_TOKENS.has(norm)) continue;
    for (const form of [norm, abbrev]) {
      if (instNorm === form || instNorm.includes(form) || form.includes(instNorm)) {
        return true;
      }
    }
  }
  return false;
}

// --- categorizePackage (mirrors electron/index-builder.ts) ---
const CATEGORY_RULES = [
  { pattern: /chrome|firefox|edge|brave|opera|browser|safari/i, category: 'browsers' },
  { pattern: /git|node|python|java|docker|vscode|visual|studio|code|dev|npm|rust|go-lang|golang/i, category: 'dev' },
  { pattern: /game|steam|epic|minecraft|unity|unreal/i, category: 'games' },
  { pattern: /vlc|spotify|obs|discord|telegram|media|video|audio|music/i, category: 'media' },
  { pattern: /office|word|excel|libre|writer|calc/i, category: 'office' },
  { pattern: /keepass|password|security|vpn|antivirus|malware/i, category: 'security' },
  { pattern: /zip|7z|rar|archiver|everything|putty|util|tool/i, category: 'utils' },
];

function categorizePackage(pkg) {
  const haystack = `${pkg.id} ${pkg.name} ${pkg.description ?? ''}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }
  return pkg.category ?? 'other';
}

// --- search cache (mirrors electron/search-cache.ts) ---
const SEARCH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function writeSearchCache(dir, query, results) {
  fs.mkdirSync(dir, { recursive: true });
  const hash = createHash('sha256').update(query.toLowerCase().trim()).digest('hex');
  const entry = { query, results, cachedAt: Date.now() };
  fs.writeFileSync(path.join(dir, `${hash}.json`), JSON.stringify(entry));
  return hash;
}

function readSearchCache(dir, query) {
  const hash = createHash('sha256').update(query.toLowerCase().trim()).digest('hex');
  const p = path.join(dir, `${hash}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function mergeSearchResults(live, cached, cacheValid) {
  if (live.length > 0) return { results: live, fromCache: false, stale: false };
  if (cacheValid && cached) return { results: cached.results, fromCache: true, stale: true };
  return { results: cached?.results ?? [], fromCache: !!cached, stale: !cacheValid };
}

// --- InstallQueue emit counter (mirrors electron/queue/install-queue.ts) ---
class MockQueue {
  constructor() {
    this.jobs = [];
    this.emitCount = 0;
  }
  emitUpdated() { this.emitCount++; }
  addMany(items) {
    for (const item of items) {
      this.jobs.push({ ...item, status: 'pending' });
    }
    this.emitUpdated();
  }
}

// --- catalog.json validation ---
function loadCatalog() {
  const p = path.join(__dirname, '..', 'data', 'catalog.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

console.log('\nGetBox smoke tests\n');

console.log('softIsInstalled:');
test('Git → false (short token)', () => {
  assert.equal(softIsInstalled('Git', new Set(['git'])), false);
});
test('Git for Windows → true', () => {
  assert.equal(softIsInstalled('Git for Windows', new Set(['Git'])), true);
});
test('Code → false (short token)', () => {
  assert.equal(softIsInstalled('Code', new Set(['code'])), false);
});
test('Visual Studio Code → true', () => {
  assert.equal(softIsInstalled('Visual Studio Code', new Set(['vscode'])), true);
});

console.log('\ncategorizePackage:');
test('firefox → browsers', () => {
  assert.equal(categorizePackage({ id: 'firefox', name: 'Firefox' }), 'browsers');
});
test('vscode → dev', () => {
  assert.equal(categorizePackage({ id: 'vscode', name: 'Visual Studio Code' }), 'dev');
});
test('steam → games', () => {
  assert.equal(categorizePackage({ id: 'steam', name: 'Steam' }), 'games');
});
test('7zip → utils', () => {
  assert.equal(categorizePackage({ id: '7zip', name: '7-Zip' }), 'utils');
});

console.log('\nsearch-cache:');
test('write and read cache', () => {
  const tmpDir = path.join(__dirname, '..', '.smoke-cache');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const results = [{ id: 'test', provider: 'catalog', name: 'Test App' }];
  writeSearchCache(tmpDir, 'test query', results);
  const cached = readSearchCache(tmpDir, 'test query');
  assert.equal(cached.results.length, 1);
  assert.equal(cached.results[0].name, 'Test App');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
test('empty live preserves valid cache', () => {
  const cached = { results: [{ id: 'a', name: 'A' }], cachedAt: Date.now() };
  const merged = mergeSearchResults([], cached, true);
  assert.equal(merged.results.length, 1);
  assert.equal(merged.fromCache, true);
  assert.equal(merged.stale, true);
});
test('empty live does not use expired cache as fresh', () => {
  const cached = { results: [{ id: 'a' }], cachedAt: Date.now() - SEARCH_TTL_MS - 1000 };
  const merged = mergeSearchResults([], cached, false);
  assert.equal(merged.stale, true);
});

console.log('\nqueue emit:');
test('addMany emits once', () => {
  const q = new MockQueue();
  q.addMany([
    { provider: 'scoop', packageId: 'a', name: 'A' },
    { provider: 'scoop', packageId: 'b', name: 'B' },
  ]);
  assert.equal(q.emitCount, 1);
  assert.equal(q.jobs.length, 2);
});

console.log('\ncatalog:');
test('catalog.json is curation only, every app has an install source', () => {
  const catalog = loadCatalog();
  assert.ok(catalog.length >= 70, `Expected >= 70 entries, got ${catalog.length}`);
  const installers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'installers.json'), 'utf-8'));
  for (const c of catalog) {
    assert.equal(c.provider, 'catalog', c.id);
    assert.ok(!('installUrl' in c) && !('silentArgs' in c), `${c.id}: links belong in installers.json`);
    assert.ok(installers[c.id], `${c.id}: missing from installers.json`);
  }
});
test('game launchers cover the major stores', () => {
  const games = loadCatalog().filter((c) => c.category === 'games');
  assert.ok(games.length >= 8, `Expected >= 8 launchers, got ${games.length}`);
  for (const id of ['steam', 'epic', 'gog-galaxy', 'battlenet']) {
    assert.ok(games.some((g) => g.id === id), `missing launcher ${id}`);
  }
});

console.log('\nicons:');
test('every app has an icon file and a brand colour', () => {
  const catalog = loadCatalog();
  const iconsDir = path.join(__dirname, '..', 'data', 'icons');
  const colors = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'brand-colors.json'), 'utf-8'));
  const missing = [];
  for (const entry of catalog) {
    const slug = entry.logoSlug || entry.id;
    const hasFile = ['.svg', '.png', '.ico', '.jpg'].some((ext) => fs.existsSync(path.join(iconsDir, slug + ext)));
    if (!hasFile) missing.push(`${entry.id} (no file for ${slug})`);
    if (!colors[slug]) missing.push(`${entry.id} (no brand colour for ${slug})`);
  }
  assert.equal(missing.length, 0, missing.join(', '));
});
test('no two apps share the same icon slug', () => {
  const slugs = loadCatalog().map((c) => c.logoSlug || c.id);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate logoSlug would show one brand under two names');
});

console.log('\nproviders:');
test('registry includes 4 provider ids', () => {
  const registryPath = path.join(__dirname, '..', 'electron', 'providers', 'registry.ts');
  const src = fs.readFileSync(registryPath, 'utf-8');
  assert.ok(src.includes("'catalog'"), 'catalog provider missing');
  assert.ok(src.includes("'scoop'"), 'scoop provider missing');
  assert.ok(src.includes("'winget'"), 'winget provider missing');
  assert.ok(src.includes("'chocolatey'"), 'chocolatey provider missing');
  assert.ok(src.includes("PROVIDER_IDS"), 'PROVIDER_IDS export missing');
});

console.log('\ninstall progress:');
const { parseProgressLine } = loadTsModule(
  path.join(__dirname, '..', 'electron', 'providers', 'cli-progress.ts'),
);

test('winget size pair yields percent and byte counts', () => {
  const p = parseProgressLine('  ██████████  12.5 MB / 50.0 MB', 'download');
  assert.equal(p.phase, 'download');
  assert.equal(Math.round(p.percent), 25);
  assert.equal(p.bytesTotal, 50 * 1024 ** 2);
});
test('choco percent line is parsed', () => {
  const p = parseProgressLine('Progress: Downloading vlc 3.0.21... 47%', 'download');
  assert.equal(Math.round(p.percent), 47);
  assert.equal(p.phase, 'download');
});
test('phase flips to install on installer output', () => {
  const p = parseProgressLine('Starting package install...', 'download');
  assert.equal(p.phase, 'install');
});
test('phase is kept when a line says nothing about it', () => {
  const p = parseProgressLine('63%', 'install');
  assert.equal(p.phase, 'install');
  assert.equal(p.percent, 63);
});
test('bare separator lines are ignored', () => {
  assert.equal(parseProgressLine('  ██████████  ', 'download'), undefined);
  assert.equal(parseProgressLine('', 'download'), undefined);
});
test('out-of-range percent is rejected', () => {
  const p = parseProgressLine('error 404% weird', 'download');
  assert.equal(p.percent, undefined);
});

console.log('\npackage metadata:');
const { parseShowOutput, isWingetInstallSuccess } = loadTsModule(
  path.join(__dirname, '..', 'electron', 'providers', 'winget.ts'),
  { electron: electronStub },
);
const { parseInfoOutput } = loadTsModule(
  path.join(__dirname, '..', 'electron', 'providers', 'chocolatey.ts'),
  { electron: electronStub },
);

test('winget treats already-installed as success', () => {
  assert.equal(
    isWingetInstallSuccess(1, 'Found an existing package already installed.\nNo available upgrade found.'),
    true,
  );
  assert.equal(isWingetInstallSuccess(1, 'Installer failed with unknown error'), false);
});

test('winget show yields description and homepage', () => {
  const d = parseShowOutput(
    [
      'Found Mozilla Firefox [Mozilla.Firefox]',
      'Version: 133.0',
      'Publisher: Mozilla',
      'Homepage: https://www.mozilla.org/firefox/',
      'Description: A free and open source web browser',
      '  developed by the Mozilla Foundation.',
      'License: MPL-2.0',
    ].join('\n'),
  );
  assert.equal(d.homepage, 'https://www.mozilla.org/firefox/');
  assert.equal(d.publisher, 'Mozilla');
  assert.ok(d.description.endsWith('Mozilla Foundation.'), 'wrapped line not joined');
  assert.ok(!d.description.includes('License'), 'swallowed the next field');
});

test('winget show is parsed with russian labels', () => {
  const d = parseShowOutput(
    ['Издатель: Mozilla', 'Домашняя страница: https://mozilla.org', 'Описание: Свободный браузер.'].join('\n'),
  );
  assert.equal(d.description, 'Свободный браузер.');
  assert.equal(d.homepage, 'https://mozilla.org');
});

test('choco info prefers the summary line', () => {
  const d = parseInfoOutput(
    [
      'vlc 3.0.21 [Approved]',
      ' Title: VLC media player | Published: 2024',
      ' Software Site: https://www.videolan.org/vlc/',
      ' Summary: VLC plays most media files.',
      ' Description: A much longer text.',
    ].join('\n'),
  );
  assert.equal(d.description, 'VLC plays most media files.');
  assert.equal(d.homepage, 'https://www.videolan.org/vlc/');
});

test('choco info without metadata yields nothing', () => {
  assert.equal(parseInfoOutput('Chocolatey v2.3.0\n0 packages found.'), undefined);
});

const { matchIcon, iconKeyCandidates } = loadTsModule(
  path.join(__dirname, '..', 'electron', 'enrich', 'icon-index.ts'),
  { electron: electronStub },
);

test('icon candidates put the full name before a bare word', () => {
  const keys = iconKeyCandidates('Microsoft.VisualStudioCode', 'Visual Studio Code');
  assert.ok(keys.indexOf('visualstudiocode') < keys.indexOf('code') || !keys.includes('code'));
});

test('winget-style ids match a real logo', () => {
  const match = matchIcon('Mozilla.Firefox', 'Mozilla Firefox');
  assert.ok(match, 'firefox not matched');
  assert.ok(match.url.includes('firefox'), match.url);
});

test('scoop-style ids match a real logo', () => {
  const match = matchIcon('extras/googlechrome', 'googlechrome');
  assert.ok(match, 'chrome not matched');
});

test('unknown packages do not borrow another brand logo', () => {
  assert.equal(matchIcon('Zzz.Qqqwww', 'Zzz Qqqwww'), undefined);
});

console.log('\nruntime bootstrap:');
test('runtime-state shape is documented in runtime.ts', () => {
  const runtimePath = path.join(__dirname, '..', 'electron', 'bootstrap', 'runtime.ts');
  const src = fs.readFileSync(runtimePath, 'utf-8');
  assert.ok(src.includes('runtime-state.json'), 'runtime state file missing');
  assert.ok(src.includes('bootstrapRuntime'), 'bootstrapRuntime missing');
  assert.ok(src.includes('isBootstrapComplete'), 'isBootstrapComplete missing');
});

console.log('\ninstall errors + queue cancel:');
const {
  classifyError,
  classifyHttpStatus,
  isRetryableDownloadError,
  shouldTryAltProvider,
  InstallError,
} = loadTsModule(path.join(__dirname, '..', 'electron', 'providers', 'install-errors.ts'), {
  electron: electronStub,
});

test('HTTP 404 maps to not_found', () => {
  assert.equal(classifyHttpStatus(404), 'not_found');
  const c = classifyError(new Error('Download failed: 404'));
  assert.equal(c.code, 'not_found');
});

test('HTTP 403 maps to forbidden (geo/CDN)', () => {
  assert.equal(classifyHttpStatus(403), 'forbidden');
  const c = classifyError(new Error('Download failed: 403'));
  assert.equal(c.code, 'forbidden');
});

test('ECONNRESET suggests retry / winget instead of bare offline', () => {
  const c = classifyError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
  assert.equal(c.code, 'network');
  assert.ok(/Повторить|winget/i.test(c.message), c.message);
});

test('network and timeout codes are retryable; 404 is not', () => {
  assert.equal(isRetryableDownloadError(new InstallError('network', 'x')), true);
  assert.equal(isRetryableDownloadError(new InstallError('timeout', 'x')), true);
  assert.equal(isRetryableDownloadError(new InstallError('not_found', 'x')), false);
  assert.equal(isRetryableDownloadError(new InstallError('forbidden', 'x')), false);
  assert.equal(isRetryableDownloadError(new InstallError('cancelled', 'x')), false);
});

test('shouldTryAltProvider includes forbidden/not_found for winget fallback', () => {
  assert.equal(shouldTryAltProvider(new InstallError('forbidden', 'x')), true);
  assert.equal(shouldTryAltProvider(new InstallError('not_found', 'x')), true);
  assert.equal(shouldTryAltProvider(new InstallError('network', 'x')), true);
  assert.equal(shouldTryAltProvider(new InstallError('cancelled', 'x')), false);
  assert.equal(shouldTryAltProvider(new InstallError('installer', 'x')), false);
});

test('catalog uses shouldTryAltProvider for winget fallback', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'providers', 'catalog.ts'), 'utf-8');
  assert.ok(src.includes('shouldTryAltProvider(err)'), 'install should use shouldTryAltProvider');
  assert.ok(src.includes('resolveInstallPlan'), 'resolveInstallPlan missing');
});

const { resolveInstallPlan, isSafeInstallerArgs } = loadTsModule(
  path.join(__dirname, '..', 'electron', 'providers', 'catalog.ts'),
  { electron: electronStub },
);

test('resolveInstallPlan: direct installer with winget as fallback', () => {
  const direct = { wingetId: 'Mozilla.Firefox', version: '1', type: 'nullsoft', url: 'https://x/y.exe', sha256: 'ab' };
  const plan = resolveInstallPlan('firefox', { firefox: direct }, {});
  assert.equal(plan.direct, direct);
  assert.deepEqual(plan.fallback, { provider: 'winget', packageId: 'Mozilla.Firefox' });
});

test('resolveInstallPlan: winget-only and hand-pinned providers', () => {
  const plan = resolveInstallPlan('teams', { teams: { wingetId: 'Microsoft.Teams', version: '1', type: 'msix', direct: false } }, {});
  assert.equal(plan.direct, undefined);
  assert.deepEqual(plan.fallback, { provider: 'winget', packageId: 'Microsoft.Teams' });

  const choco = resolveInstallPlan('filezilla', { filezilla: { provider: 'chocolatey', packageId: 'filezilla' } }, {});
  assert.deepEqual(choco, { fallback: { provider: 'chocolatey', packageId: 'filezilla' } });
});

test('resolveInstallPlan: app not refreshed yet falls back to winget-map', () => {
  assert.deepEqual(resolveInstallPlan('new-app', {}, { 'new-app': 'Vendor.App' }), {
    fallback: { provider: 'winget', packageId: 'Vendor.App' },
  });
  assert.deepEqual(resolveInstallPlan('nothing', {}, {}), { fallback: undefined });
});

test('isSafeInstallerArgs allows manifest quoting, refuses cmd metacharacters', () => {
  assert.ok(isSafeInstallerArgs(''));
  assert.ok(isSafeInstallerArgs('/SP- /VERYSILENT /mergetasks=!runcode'));
  assert.ok(isSafeInstallerArgs('--install "C:\\Program Files (x86)\\AnyDesk" --silent'));
  for (const bad of ['/S & calc', '/S | x', '/S > out', '%PATH%', '/S ^', '"unbalanced', '/S\ncalc']) {
    assert.ok(!isSafeInstallerArgs(bad), bad);
  }
});

test('queue exposes cancel / dismiss / retryJob APIs', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'queue', 'install-queue.ts'), 'utf-8');
  assert.ok(src.includes('cancel(jobId'), 'cancel missing');
  assert.ok(src.includes('dismiss(jobId'), 'dismiss missing');
  assert.ok(src.includes('retryJob(jobId'), 'retryJob missing');
  assert.ok(src.includes('signal:'), 'AbortSignal not passed to install');
});

test('catalog download uses browser User-Agent', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'providers', 'catalog.ts'), 'utf-8');
  assert.ok(src.includes('User-Agent'), 'UA header missing');
  assert.ok(src.includes('Chrome/131'), 'UA not aligned with verify-catalog');
  assert.ok(src.includes('.part'), 'temp .part file missing');
  assert.ok(src.includes('IDLE_TIMEOUT_MS'), 'idle timeout missing');
});

console.log('\ninstall queue in-memory:');
const { InstallQueue } = loadTsModule(path.join(__dirname, '..', 'electron', 'queue', 'install-queue.ts'), {
  '../providers/registry.js': {
    getProvider: () => ({
      install: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, message: 'ok' }), 50)),
    }),
  },
  '../store/settings.js': { getSettings: () => ({ quietInstall: true, enabledProviders: ['catalog'] }) },
});

test('cancel pending job marks cancelled', async () => {
  const q = new InstallQueue();
  q.add('catalog', 'blocker', 'Blocker');
  q.add('catalog', 'test', 'Test');
  await new Promise((r) => setTimeout(r, 20));
  const pending = q.getJobs().find((j) => j.packageId === 'test');
  assert.ok(pending, 'second job should exist');
  assert.equal(pending.status, 'pending');
  assert.ok(q.cancel(pending.id));
  assert.equal(q.getJobs().find((j) => j.id === pending.id).status, 'cancelled');
  assert.equal(q.getJobs().find((j) => j.id === pending.id).errorCode, 'cancelled');
});

test('retryJob resets failed job to pending', () => {
  const q = new InstallQueue();
  q.add('catalog', 'test', 'Test');
  const id = q.getJobs()[0].id;
  q.getJobs()[0].status = 'failed';
  q.getJobs()[0].errorCode = 'network';
  assert.ok(q.retryJob(id));
  assert.equal(q.getJobs()[0].status, 'pending');
  assert.equal(q.getJobs()[0].errorCode, undefined);
});

test('clearDone removes done, cancelled, and failed', () => {
  const q = new InstallQueue();
  q.add('catalog', 'a', 'A');
  q.add('catalog', 'b', 'B');
  q.add('catalog', 'c', 'C');
  const jobs = q.getJobs();
  jobs[0].status = 'done';
  jobs[1].status = 'cancelled';
  jobs[2].status = 'failed';
  q.clearDone();
  assert.equal(q.getJobs().length, 0);
});

// --- data/installers.json (generated by scripts/refresh-installers.cjs) ---
{
  const { isSafeInstallerArgs: safeArgs } = loadTsModule(
    path.join(__dirname, '..', 'electron', 'providers', 'catalog.ts'),
    { electron: electronStub },
  );
  const installers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'installers.json'), 'utf-8'));

  test('installers: direct entries are https + sha256 with safe switches', () => {
    for (const [id, e] of Object.entries(installers)) {
      if (!e.url) continue;
      assert.ok(e.url.startsWith('https://'), `${id}: url must be https`);
      assert.match(e.sha256, /^[0-9a-f]{64}$/, `${id}: sha256`);
      assert.ok(['nullsoft', 'inno', 'burn', 'exe', 'msi', 'wix'].includes(e.type), `${id}: type ${e.type}`);
      assert.ok(e.wingetId && e.version, `${id}: wingetId/version`);
      for (const args of [e.silentArgs, e.args]) {
        if (args) assert.ok(safeArgs(args), `${id}: unsafe switches ${args}`);
      }
    }
  });

  test('installers: every entry is direct, winget-only or another provider', () => {
    for (const [id, e] of Object.entries(installers)) {
      const kind = e.url ? 'direct' : e.direct === false ? 'winget' : e.provider ? 'provider' : null;
      assert.ok(kind, `${id}: unrecognised entry`);
      if (kind === 'provider') {
        assert.ok(['winget', 'scoop', 'chocolatey'].includes(e.provider) && e.packageId, id);
      }
    }
  });
}

// --- recommendations (src/recommend.ts + data/related.json) ---
{
  const { buildRecommender } = loadTsModule(path.join(__dirname, '..', 'src', 'recommend.ts'));
  const related = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'related.json'), 'utf-8'));
  const catalogIds = new Set(loadCatalog().map((c) => c.id));

  test('related.json: groups reference catalog ids and have 2+ apps', () => {
    for (const kind of ['stacks', 'alternatives']) {
      const seen = new Set();
      for (const g of related[kind]) {
        assert.ok(!seen.has(g.id), `${kind}: duplicate ${g.id}`);
        seen.add(g.id);
        assert.ok(g.apps.length >= 2, `${kind}/${g.id}: needs 2+ apps`);
        for (const id of g.apps) assert.ok(catalogIds.has(id), `${kind}/${g.id}: unknown app "${id}"`);
      }
    }
  });

  const app = (id, extra = {}) => ({
    id, curatedId: id, provider: 'catalog', name: id, category: 'x', isInstalled: false, isFavorite: false, ...extra,
  });
  const rel = {
    stacks: [{ id: 'dev', apps: ['vscode', 'git', 'nodejs'] }, { id: 'web', apps: ['vscode', 'postman'] }],
    alternatives: [{ id: 'browser', apps: ['firefox', 'chrome'] }],
  };

  test('recommend: cold start falls back to editorial picks', () => {
    const r = buildRecommender([app('a', { pickTag: 'Must-have' }), app('b', { recommended: true }), app('c')], rel);
    assert.equal(r.personalized, false);
    assert.deepEqual(r.forYou().map((x) => x.app.id), ['a', 'b']);
    assert.equal(r.forYou()[0].reason.kind, 'editor');
  });

  test('recommend: installed app pulls in its stack-mates with a named reason', () => {
    const apps = [app('vscode', { isInstalled: true, name: 'VS Code' }), app('git'), app('nodejs'), app('postman'), app('c', { recommended: true })];
    const top = buildRecommender(apps, rel).forYou();
    assert.ok(top.every((x) => x.app.id !== 'vscode'), 'installed apps are not recommended');
    assert.deepEqual(top.slice(0, 3).map((x) => x.app.id).sort(), ['git', 'nodejs', 'postman']);
    assert.deepEqual(top[0].reason, { kind: 'pairs', withName: 'VS Code' });
  });

  test('recommend: owning an alternative demotes the rest', () => {
    const apps = [app('firefox', { isInstalled: true }), app('chrome', { pickTag: 'Popular', category: 'browsers' }), app('vlc', { recommended: true })];
    const ids = buildRecommender(apps, rel).forYou().map((x) => x.app.id);
    assert.ok(ids.indexOf('vlc') < ids.indexOf('chrome'), ids.join(','));
  });

  test('recommend: starred but not installed comes first', () => {
    const apps = [app('x', { isFavorite: true }), app('y', { pickTag: 'Top' })];
    const top = buildRecommender(apps, rel).forYou()[0];
    assert.equal(top.app.id, 'x');
    assert.equal(top.reason.kind, 'favorite');
  });

  test('recommend: pairsWith skips alternatives, alternativesTo lists them', () => {
    const r = buildRecommender([app('vscode'), app('git'), app('nodejs'), app('postman'), app('firefox'), app('chrome')], rel);
    assert.deepEqual(r.pairsWith(app('vscode')).map((a) => a.id), ['git', 'nodejs', 'postman']);
    assert.deepEqual(r.alternativesTo(app('firefox')).map((a) => a.id), ['chrome']);
  });

  test('recommend: profiles count as stacks (by package id)', () => {
    const apps = [app('steam', { isInstalled: true, id: 'steam-pkg' }), app('discord', { id: 'discord-pkg' })];
    const profiles = [{ id: 'p', name: 'p', description: '', packages: [{ provider: 'catalog', packageId: 'steam-pkg' }, { provider: 'catalog', packageId: 'discord-pkg' }] }];
    const top = buildRecommender(apps, { stacks: [], alternatives: [] }, profiles).forYou();
    assert.equal(top[0]?.app.curatedId, 'discord');
  });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
