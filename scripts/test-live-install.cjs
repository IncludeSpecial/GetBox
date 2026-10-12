/**
 * Live install-path probe (no UI). Exercises catalog.install for flaky CDN apps.
 * Run: node scripts/test-live-install.cjs [packageId]
 */
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

function loadTsModule(entry, stubs = {}) {
  const { buildSync } = require('esbuild');
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['node:*', ...Object.keys(stubs)],
    define: { 'import.meta.url': JSON.stringify(require('node:url').pathToFileURL(entry).href) },
  });
  const req = (id) => (id in stubs ? stubs[id] : require(id));
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, req);
  return module.exports;
}

const electronStub = {
  app: {
    isPackaged: false,
    getAppPath: () => ROOT,
    getPath: (name) => (name === 'userData' ? ROOT : ROOT),
  },
};

const packageId = process.argv[2] || 'discord';

(async () => {
  console.log(`\nLive install probe: ${packageId}\n`);
  const { CatalogProvider } = loadTsModule(
    path.join(ROOT, 'electron', 'providers', 'catalog.ts'),
    { electron: electronStub },
  );
  // Registry is dynamically imported inside catalog.install — init via registry module.
  loadTsModule(path.join(ROOT, 'electron', 'providers', 'registry.ts'), { electron: electronStub }).initProviders();
  const provider = new CatalogProvider();
  const item = provider.findItem(packageId);
  if (!item) {
    console.error('Package not in catalog:', packageId);
    process.exit(1);
  }
  console.log('  name:', item.name);
  const { resolveInstallPlan } = loadTsModule(path.join(ROOT, 'electron', 'providers', 'catalog.ts'), { electron: electronStub });
  const plan = resolveInstallPlan(item.id);
  console.log('  direct:', plan.direct ? `${plan.direct.type} ${plan.direct.version} ${plan.direct.url}` : 'none');
  console.log('  fallback:', plan.fallback ? `${plan.fallback.provider}:${plan.fallback.packageId}` : 'none');
  console.log('  starting install (may take minutes; uses real network + winget)…\n');

  const t0 = Date.now();
  const result = await provider.install(packageId, {
    quiet: true,
    onProgress: (p) => {
      if (p.note) console.log('  progress:', p.phase, p.note);
      else if (typeof p.percent === 'number') console.log('  progress:', p.phase, Math.round(p.percent) + '%');
    },
  });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\nResult (' + sec + 's):');
  console.log('  ok:', result.ok);
  console.log('  errorCode:', result.errorCode);
  console.log('  message:', result.message);
  if (result.detail) console.log('  detail:', result.detail.slice(0, 300));
  process.exit(result.ok ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
