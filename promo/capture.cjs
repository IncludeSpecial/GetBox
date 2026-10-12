// Capture real GetBox UI states for the promo: the built renderer (npm run build)
// with window.getbox stubbed from data/*.json. Writes promo/shots/*.png.
// Playwright is not a project dependency: npx playwright, or point PLAYWRIGHT_MODULE at an install.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const fs = require('fs'); const path = require('path'); const http = require('http');
const ROOT = path.join(__dirname, '..'); const OUT = path.join(__dirname, 'shots');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf-8'));
const catalog = read('catalog.json'), picks = read('picks.json'), installers = read('installers.json');
const pickMap = new Map(picks.map((p) => [p.packageRef, p]));
const iconFor = (c) => { for (const s of [c.logoSlug, c.id]) for (const e of ['.svg', '.png', '.jpg']) if (s && fs.existsSync(path.join(ROOT, 'data/icons', s + e))) return `/data/icons/${s}${e}`; };
function buildData(owned, lang) {
  const apps = catalog.map((c) => { const p = pickMap.get(`catalog:${c.packageId}`); const en = lang === 'en';
    return { id: c.packageId, provider: 'catalog', name: c.name, description: (en ? p?.descriptionOverlayEn : p?.descriptionOverlay) ?? c.description,
      category: c.category, features: c.features, recommended: c.recommended, curatedId: c.id, isInstalled: owned.has(c.id), isFavorite: c.id === 'obsidian',
      iconUrl: iconFor(c), pickTag: en ? p?.tagEn : p?.tag, pickWhy: en ? p?.whyEn : p?.why, version: installers[c.id]?.version }; });
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
async function shot(browser, base, name, { owned = [], lang = 'ru', queue = [], act }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(({ d, lang, queue }) => {
    const ok = async () => ({ ok: true });
    const values = {
      getCatalog: async () => d, getSettings: async () => ({ enabledProviders: ['catalog', 'scoop', 'winget', 'chocolatey'], quietInstall: true, language: lang }),
      getProvidersStatus: async () => [['catalog', 'Каталог GetBox'], ['scoop', 'Scoop'], ['winget', 'winget'], ['chocolatey', 'Chocolatey']].map(([id, displayName]) => ({ id, displayName, ok: true })),
      getQueue: async () => queue,
      getBootstrapStatus: async () => ({ complete: true, running: false, state: {}, tools: { scoop: { status: 'ok', ok: true }, winget: { status: 'ok', ok: true }, chocolatey: { status: 'ok', ok: true } } }),
      getMetaProgress: async () => null, enrichMeta: async () => [], search: async () => ({ results: [] }),
    };
    window.getbox = new Proxy({}, { get: (_t, k) => values[k] ?? (String(k).startsWith('on') ? () => () => {} : ok) });
  }, { d: buildData(new Set(owned), lang), lang, queue });
  await page.goto(`${base}/dist/index.html`);
  await page.waitForTimeout(1200);
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
  await shot(browser, base, 'home-cold', {});
  await shot(browser, base, 'home', { owned: me });
  await shot(browser, base, 'home-scrolled', { owned: me, act: (p) => p.locator('.content-area').evaluate((el) => el.scrollTo(0, 330)) });
  await shot(browser, base, 'recommended', { owned: me, act: (p) => p.getByRole('button', { name: /Рекомендуем/ }).first().click() });
  await shot(browser, base, 'games', { owned: me, act: (p) => p.locator('.sidebar').getByText('Игры').first().click() });
  await shot(browser, base, 'modal', { owned: me, act: async (p) => { await p.getByRole('button', { name: /Рекомендуем/ }).first().click(); await p.waitForTimeout(300); await p.locator('.capsule', { hasText: 'Discord' }).first().click(); } });
  await shot(browser, base, 'queue', { owned: me, queue: QUEUE, act: (p) => p.getByRole('button', { name: /Очередь/ }).first().click() });
  await shot(browser, base, 'home-en', { owned: me, lang: 'en' });
  await browser.close(); server.close();
});
