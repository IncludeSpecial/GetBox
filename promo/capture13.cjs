// Capture GetBox 1.3 UI states for promo13.html: the built renderer (npm run build)
// with window.getbox stubbed from data/*.json, in every theme and list view. Writes promo/shots/13/*.png.
// Playwright is not a project dependency: npx playwright, or point PLAYWRIGHT_MODULE at an install.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const fs = require('fs'); const path = require('path'); const http = require('http');
const ROOT = path.join(__dirname, '..'); const OUT = path.join(__dirname, 'shots', '13');
fs.mkdirSync(OUT, { recursive: true });
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf-8'));
const catalog = read('catalog.json'), picks = read('picks.json'), installers = read('installers.json');
const pickMap = new Map(picks.map((p) => [p.packageRef, p]));
const iconFor = (c) => { for (const s of [c.logoSlug, c.id]) for (const e of ['.svg', '.png', '.jpg']) if (s && fs.existsSync(path.join(ROOT, 'data/icons', s + e))) return `/data/icons/${s}${e}`; };
// Index packages for «Все пакеты»: real ids from the winget map plus a few Scoop / Chocolatey ones.
const wingetIds = Object.values(read('winget-map.json')).slice(0, 48);
const INDEX = [
  ...wingetIds.map((id) => ({ id, provider: 'winget', name: id.split('.').slice(1).join(' ') || id, version: undefined })),
  ...['neovim', 'ripgrep', 'fzf', 'bat', 'fd', 'jq', 'curl', 'lazygit'].map((id) => ({ id, provider: 'scoop', name: id })),
  ...['putty', 'wget', 'sysinternals', 'notepadplusplus', 'winscp'].map((id) => ({ id, provider: 'chocolatey', name: id })),
].map((a) => ({ ...a, isInstalled: false, isFavorite: false }));
const FAVS = new Set(['obsidian', 'firefox', 'vlc', 'blender', 'telegram', 'spotify', 'bitwarden']);
function buildData(owned, lang) {
  const apps = catalog.map((c) => { const p = pickMap.get(`catalog:${c.packageId}`); const en = lang === 'en';
    return { id: c.packageId, provider: 'catalog', name: c.name, description: (en ? p?.descriptionOverlayEn : p?.descriptionOverlay) ?? c.description,
      category: c.category, features: c.features, recommended: c.recommended, curatedId: c.id, isInstalled: owned.has(c.id), isFavorite: FAVS.has(c.id),
      iconUrl: iconFor(c), pickTag: en ? p?.tagEn : p?.tag, pickWhy: en ? p?.whyEn : p?.why, version: installers[c.id]?.version }; });
  apps.push(...INDEX);
  return { apps, categories: read('categories.json'), profiles: read('profiles.json'), related: read('related.json') };
}
const QUEUE = [
  { id: 'j1', packageId: 'firefox', provider: 'catalog', name: 'Mozilla Firefox', status: 'running', progress: { phase: 'download', percent: 64, bytesDone: 61e6, bytesTotal: 95e6, bytesPerSecond: 11.8e6 } },
  { id: 'j2', packageId: 'discord', provider: 'catalog', name: 'Discord', status: 'pending' },
  { id: 'j3', packageId: 'obs-studio', provider: 'catalog', name: 'OBS Studio', status: 'pending' },
  { id: 'j4', packageId: 'vscode', provider: 'catalog', name: 'Visual Studio Code', status: 'done', message: 'Установлено' },
  { id: 'j5', packageId: '7zip', provider: 'catalog', name: '7-Zip', status: 'done', message: 'Установлено' },
];
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res);
});
async function shot(browser, base, name, { owned = [], lang = 'ru', queue = [], act, look = {}, results = [], zoom = 1 }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(({ d, lang, queue, look, results }) => {
    const ok = async () => ({ ok: true });
    const values = {
      getCatalog: async () => d, getSettings: async () => (window.__s), updateSettings: async (p) => (window.__s = { ...window.__s, ...p }), windowNativeMica: async () => false,
      getUpdates: async () => {
        const now = Date.now(), h = 3600e3, today = new Date(); today.setHours(14, 2, 0, 0);
        const t = today.getTime();
        return { checking: false, checkedAt: now - 2 * 60e3, items: [
          { provider: 'winget', packageId: 'Mozilla.Firefox', name: 'Mozilla Firefox (x64 ru)', installed: '156.0', available: '157.0.1', catalogId: 'firefox' },
          { provider: 'winget', packageId: 'Telegram.TelegramDesktop', name: 'Telegram Desktop', installed: '7.2.4', available: '7.3.1', catalogId: 'telegram' },
          { provider: 'scoop', packageId: 'obs-studio', name: 'obs-studio', installed: '32.1.0', available: '32.2.2' },
        ], history: [
          { id: 'h1', kind: 'upgrade', provider: 'winget', packageId: 'Google.Chrome', name: 'Google Chrome', catalogId: 'chrome', from: '154.0.7980', to: '155.0.8059', at: t, ok: true },
          { id: 'h2', kind: 'upgrade', provider: 'winget', packageId: 'Microsoft.VisualStudioCode', name: 'VS Code', catalogId: 'vscode', from: '1.140.2', to: '1.141.0', at: t - 5 * h, ok: true },
          { id: 'h3', kind: 'upgrade', provider: 'winget', packageId: 'Telegram.TelegramDesktop', name: 'Telegram', catalogId: 'telegram', from: '7.2.4', to: '7.3.1', at: t - 24 * h, ok: false, errorCode: 'installer' },
          { id: 'h4', kind: 'upgrade', provider: 'scoop', packageId: 'vlc', name: 'vlc', from: '3.0.23', to: '3.0.24', at: t - 25 * h, ok: true },
        ] };
      },
      getProvidersStatus: async () => [['catalog', 'Каталог GetBox'], ['scoop', 'Scoop'], ['winget', 'winget'], ['chocolatey', 'Chocolatey']].map(([id, displayName]) => ({ id, displayName, ok: true })),
      getQueue: async () => queue,
      getBootstrapStatus: async () => ({ complete: true, running: false, state: {}, tools: { scoop: { status: 'ok', ok: true }, winget: { status: 'ok', ok: true }, chocolatey: { status: 'ok', ok: true } } }),
      getMetaProgress: async () => null, enrichMeta: async () => [], search: async () => ({ results, fromCache: false, stale: false }),
    };
    window.__s = { enabledProviders: ['catalog', 'scoop', 'winget', 'chocolatey'], quietInstall: true, language: lang, theme: 'classic', uiScale: 1, listView: 'cards', autoCheckUpdates: true, autoInstallUpdates: false, ...look };
    window.getbox = new Proxy({}, { get: (_t, k) => values[k] ?? (String(k).startsWith('on') ? () => () => {} : ok) });
  }, { d: buildData(new Set(owned), lang), lang, queue, look, results });
  await page.goto(`${base}/dist/index.html`);
  await page.waitForTimeout(1200);
  // The app scales through Electron's zoom factor; in a plain browser CSS zoom stands in for it.
  if (zoom !== 1) await page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, zoom);
  if (act) await act(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  await page.close();
  console.log('shot', name);
}
server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(launchOpts);
  const me = ['vscode', 'steam', 'firefox', 'git'];
  const tab = (name) => (p) => p.getByRole('button', { name }).first().click();
  const catalogTab = tab(/Каталог/);
  const settings = (p) => p.locator('.sidebar').getByText('Расширенные').first().click();
  const updatesTab = tab(/Обновления/);

  for (const theme of ['classic', 'light', 'oled', 'contrast', 'mica']) {
    await shot(browser, base, `home-${theme}`, { owned: me, look: { theme } });
  }
  for (const listView of ['cards', 'list', 'table', 'tiles']) {
    await shot(browser, base, `cat-${listView}`, { owned: me, look: { listView }, act: catalogTab });
  }
  await shot(browser, base, 'cat-tiles-hover', { owned: me, look: { listView: 'tiles' }, act: async (p) => {
    await catalogTab(p); await p.waitForTimeout(300); await p.locator('.capsule--tile').nth(1).hover();
  } });
  for (const [name, accent] of [['blue', '#66c0f4'], ['violet', '#8b6cff'], ['teal', '#2dd4bf'], ['pink', '#ef5da8']]) {
    await shot(browser, base, `accent-${name}`, { owned: me, look: { theme: 'oled', accent }, act: settings });
  }
  await shot(browser, base, 'install-queue', { owned: me, queue: QUEUE, act: tab(/Очередь/) });
  await shot(browser, base, 'updates', { owned: me, act: updatesTab });
  await shot(browser, base, 'updates-queue', { owned: me, queue: [
    { id: 'q1', provider: 'winget', packageId: 'Mozilla.Firefox', name: 'Mozilla Firefox', status: 'running', kind: 'upgrade', fromVersion: '156.0', toVersion: '157.0.1', progress: { phase: 'download', percent: 42 } },
    { id: 'q2', provider: 'winget', packageId: 'Telegram.TelegramDesktop', name: 'Telegram Desktop', status: 'pending', kind: 'upgrade', fromVersion: '7.2.4', toVersion: '7.3.1' },
  ], act: async (p) => { await updatesTab(p); await tab(/Очередь/)(p); } });
  // «Ещё фишки» montage.
  await shot(browser, base, 'feat-search', { owned: me, results: [
    { id: 'vlc', provider: 'catalog', name: 'VLC media player', category: 'media' },
    { id: 'VideoLAN.VLC', provider: 'winget', name: 'VLC media player' },
    { id: 'vlc', provider: 'scoop', name: 'vlc' },
    { id: 'vlc', provider: 'chocolatey', name: 'vlc' },
    { id: 'VideoLAN.VLC.Nightly', provider: 'winget', name: 'VLC media player Nightly' },
  ], look: { listView: 'list' }, act: async (p) => { const box = p.getByPlaceholder(/Поиск/); await box.fill('vlc'); await box.press('Enter'); } });
  await shot(browser, base, 'feat-games', { owned: me, act: (p) => p.locator('.sidebar').getByText('Игры').first().click() });
  await shot(browser, base, 'feat-profiles', { owned: me, act: (p) => p.locator('.content-area').evaluate((el) => {
    const target = el.querySelector('.profiles-section');
    el.scrollTo(0, target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 24);
  }) });
  await shot(browser, base, 'feat-favorites', { owned: me, act: tab(/Избранное/) });
  await shot(browser, base, 'feat-packages', { owned: me, look: { listView: 'table' }, act: tab(/Все пакеты/) });
  await shot(browser, base, 'feat-scale', { owned: me, zoom: 1.25 });
  await shot(browser, base, 'feat-english', { owned: me, lang: 'en' });
  await shot(browser, base, 'feat-fallback', { owned: me, queue: [
    { id: 'f1', packageId: 'notepadplusplus', provider: 'catalog', name: 'Notepad++', status: 'done', message: 'Установлено: Notepad++ (через winget)' },
    { id: 'f2', packageId: 'vlc', provider: 'catalog', name: 'VLC media player', status: 'done', message: 'Установлено: VLC media player' },
    { id: 'f3', packageId: 'obs-studio', provider: 'catalog', name: 'OBS Studio', status: 'running', progress: { phase: 'install', note: 'winget:OBSProject.OBSStudio' } },
  ], act: tab(/Очередь/) });
  await shot(browser, base, 'modal-light', { owned: me, look: { theme: 'light' }, act: async (p) => {
    await catalogTab(p); await p.waitForTimeout(300); await p.locator('.capsule').first().click();
  } });
  await browser.close(); server.close();
});
