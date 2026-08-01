import { app, BrowserWindow, ipcMain, shell, protocol, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initProviders, getAllProviders, setCatalogRemoteUrl } from './providers/registry.js';
import { warmMetaCacheFromDisk, enrichMeta, prewarmMeta, maybeAutoPrewarm, getMetaCompleteness, getMetaProgress, type MetaProgress } from './enrich/meta-cache.js';
import { enqueuePackageMeta, onPackageMetaUpdate, type PackageMetaRequest } from './enrich/package-meta.js';
import { getCatalog, invalidateCatalog, setInstalledSet, findApp } from './catalog/merge.js';
import { searchPackages } from './search-cache.js';
import { installQueue } from './queue/install-queue.js';
import { buildIndex, isIndexEmptyOrSmall } from './index-builder.js';
import { getSettings, updateSettings } from './store/settings.js';
import { toggleFavorite, isFavorite } from './store/favorites.js';
import { registerMediaProtocol } from './protocol.js';
import { loadCuratedCatalog } from './providers/catalog.js';
import { packageKey } from './providers/types.js';
import fs from 'node:fs';
import { getDataDir } from './paths.js';
import type { ProfileEntry } from './providers/types.js';
import {
  bootstrapRuntime,
  isBootstrapComplete,
  shouldRetryBootstrap,
  loadRuntimeState,
  retryBootstrap,
  approveChocolatey,
  skipChocolatey,
  testScoop,
  testWinget,
  testChocolatey,
} from './bootstrap/runtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'getbox-media',
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let bootstrapRunning = false;

/** Single entry point for index builds so the renderer always gets progress and a terminating event. */
async function runIndexBuild(): Promise<{ ok: boolean; count: number; message?: string }> {
  try {
    const result = await buildIndex((msg) => sendToRenderer('index:progress', msg));
    invalidateCatalog('index');
    sendToRenderer('catalog:onDirty');
    sendToRenderer('index:done', result.count);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendToRenderer('index:done', 0);
    sendToRenderer('toast:error', message);
    return { ok: false, count: 0, message };
  }
}

async function startBootstrap(): Promise<void> {
  if (bootstrapRunning || isBootstrapComplete()) return;
  bootstrapRunning = true;
  try {
    const state = await bootstrapRuntime(
      (msg) => sendToRenderer('bootstrap:progress', msg),
      true,
    );
    sendToRenderer('bootstrap:done', state);
    await runIndexBuild();
    await refreshInstalledInBackground();
  } catch (err) {
    sendToRenderer('bootstrap:error', err instanceof Error ? err.message : String(err));
  } finally {
    bootstrapRunning = false;
  }
}

function resolvePreloadPath(): string {
  const candidates = ['preload.cjs', 'preload.js', 'preload.mjs'];
  for (const name of candidates) {
    const p = path.join(__dirname, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, 'preload.cjs');
}

function createWindow(): void {
  const preloadPath = resolvePreloadPath();
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log('[GetBox] preload:', preloadPath);
  }
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a1118',
    icon: path.join(getDataDir(), 'logo.png'),
    frame: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'GetBox',
    show: false,
  });

  mainWindow.on('maximize', () => sendToRenderer('window:state', { maximized: true }));
  mainWindow.on('unmaximize', () => sendToRenderer('window:state', { maximized: false }));

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[GetBox] did-fail-load:', code, desc, url);
  });

  mainWindow.webContents.on('preload-error', (_e, preload, err) => {
    console.error('[GetBox] preload-error:', preload, err);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args);
}

async function refreshInstalledInBackground(): Promise<void> {
  const allInstalled = new Set<string>();
  for (const provider of getAllProviders()) {
    try {
      const items = await provider.listInstalled();
      for (const item of items) allInstalled.add(item);
    } catch {
      // provider unavailable
    }
  }
  setInstalledSet(allInstalled);
  sendToRenderer('catalog:onDirty');
}

function setupIpc(): void {
  ipcMain.handle('catalog:get', () => {
    try {
      return getCatalog();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[GetBox] catalog:get failed:', message);
      return { apps: [], categories: {}, profiles: [], error: message };
    }
  });

  ipcMain.handle('search:query', (_e, query: string) => searchPackages(query));

  ipcMain.handle('meta:enrich', async (_e, items: Array<{ slug: string; wikiTitle?: string; logoSlug?: string }>) => {
    // The renderer only knows the resolved media URL, so pull the icon sources
    // (simpleSlug, explicit iconUrl) straight from the curated catalog.
    const curated = new Map(loadCuratedCatalog().map((entry) => [entry.id, entry]));
    return enrichMeta(
      items.map((item) => {
        const entry = curated.get(item.slug);
        return {
          ...item,
          logoSlug: item.logoSlug ?? entry?.logoSlug,
          simpleSlug: entry?.simpleSlug,
          iconUrl: entry?.iconUrl,
          homepage: entry?.homepage,
          name: entry?.name,
        };
      }),
    );
  });

  ipcMain.handle('meta:prewarm', () =>
    prewarmMeta((progress) => {
      sendToRenderer('meta:progress', progress);
      invalidateCatalog('index');
      sendToRenderer('catalog:onDirty');
    }),
  );

  ipcMain.handle('meta:enrichPackages', (_e, items: PackageMetaRequest[]) => {
    enqueuePackageMeta(items);
  });

  ipcMain.handle('meta:progress', () => getMetaProgress());
  ipcMain.handle('meta:completeness', () => getMetaCompleteness());

  ipcMain.handle('queue:get', () => installQueue.getJobs());

  ipcMain.handle('queue:add', (_e, provider: string, packageId: string, name: string) => {
    installQueue.add(provider, packageId, name);
  });

  ipcMain.handle('queue:addMany', (_e, items: Array<{ provider: string; packageId: string; name: string }>) => {
    installQueue.addMany(items);
  });

  ipcMain.handle('queue:clearDone', () => installQueue.clearDone());
  ipcMain.handle('queue:clearAll', () => installQueue.clearAll());
  ipcMain.handle('queue:retryFailed', () => installQueue.retryFailed());

  ipcMain.handle('index:rebuild', () => runIndexBuild());

  ipcMain.handle('providers:status', async () => {
    const providers = getAllProviders();
    return Promise.all(
      providers.map(async (p) => ({
        id: p.id,
        displayName: p.displayName,
        ...(await p.available()),
      })),
    );
  });

  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:update', (_e, partial) => {
    const prev = getSettings();
    const next = updateSettings(partial);
    setCatalogRemoteUrl(next.remoteCatalogUrl);
    if (partial.language && partial.language !== prev.language) {
      invalidateCatalog('index');
      sendToRenderer('catalog:onDirty');
    }
    return next;
  });

  ipcMain.handle('favorites:toggle', (_e, provider: string, packageId: string) => {
    return toggleFavorite(provider, packageId);
  });

  ipcMain.handle('favorites:is', (_e, provider: string, packageId: string) => {
    return isFavorite(provider, packageId);
  });

  ipcMain.handle('profiles:install', (_e, profileId: string) => {
    const profiles = JSON.parse(
      fs.readFileSync(path.join(getDataDir(), 'profiles.json'), 'utf-8'),
    ) as ProfileEntry[];
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return { ok: false, message: 'Профиль не найден' };

    const items = profile.packages.map((pkg) => {
      const app = findApp(pkg.provider, pkg.packageId);
      return { provider: pkg.provider, packageId: pkg.packageId, name: app?.name ?? pkg.packageId };
    });
    installQueue.addMany(items);
    return { ok: true, message: `Добавлено в очередь: ${items.length}` };
  });

  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url));

  ipcMain.handle('bootstrap:status', async () => {
    const state = loadRuntimeState();
    const [scoop, winget, chocolatey] = await Promise.all([
      testScoop(),
      testWinget(),
      testChocolatey(),
    ]);
    return {
      state,
      complete: isBootstrapComplete(),
      running: bootstrapRunning,
      tools: {
        scoop: { status: state.scoop, ok: scoop.ok, version: scoop.version, message: state.messages?.scoop },
        winget: { status: state.winget, ok: winget.ok, version: winget.version, message: state.messages?.winget },
        chocolatey: {
          status: state.chocolatey,
          ok: chocolatey.ok,
          version: chocolatey.version,
          message: state.messages?.chocolatey,
          uacPending: state.chocoUacPending,
        },
      },
    };
  });

  ipcMain.handle('bootstrap:retry', async () => {
    const state = await retryBootstrap((msg) => sendToRenderer('bootstrap:progress', msg));
    sendToRenderer('bootstrap:done', state);
    await runIndexBuild();
    await refreshInstalledInBackground();
    return state;
  });

  ipcMain.handle('bootstrap:approveChoco', async () => {
    const state = await approveChocolatey((msg) => sendToRenderer('bootstrap:progress', msg));
    sendToRenderer('bootstrap:done', state);
    await runIndexBuild();
    await refreshInstalledInBackground();
    return state;
  });

  ipcMain.handle('bootstrap:skipChoco', () => {
    const state = skipChocolatey();
    sendToRenderer('bootstrap:done', state);
    return state;
  });

  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    }
    mainWindow.maximize();
    return true;
  });

  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
}

app.whenReady().then(async () => {
  // Drop the default File/Edit/View menu — chrome lives in the custom title bar.
  Menu.setApplicationMenu(null);

  initProviders();
  const settings = getSettings();
  setCatalogRemoteUrl(settings.remoteCatalogUrl);

  warmMetaCacheFromDisk();
  registerMediaProtocol();
  setupIpc();

  onPackageMetaUpdate((updates) => {
    invalidateCatalog('index');
    sendToRenderer('meta:packages', updates);
  });

  installQueue.on('updated', (jobs) => sendToRenderer('queue:updated', jobs));
  installQueue.on('installed-changed', () => {
    refreshInstalledInBackground();
  });

  createWindow();

  if (shouldRetryBootstrap()) {
    startBootstrap();
  }

  // Background tasks — don't block first paint
  setImmediate(async () => {
    if (process.argv.includes('--index-rebuild') || isIndexEmptyOrSmall()) {
      runIndexBuild();
    }

    if (process.argv.includes('--prewarm-meta')) {
      prewarmMeta((progress) => {
        sendToRenderer('meta:progress', progress);
        invalidateCatalog('index');
        sendToRenderer('catalog:onDirty');
      })
        .then(() => sendToRenderer('meta:done'))
        .catch((err) => sendToRenderer('toast:error', err instanceof Error ? err.message : String(err)));
    } else {
      maybeAutoPrewarm((progress) => {
        sendToRenderer('meta:progress', progress);
        invalidateCatalog('index');
        sendToRenderer('catalog:onDirty');
      })
        .then((didPrewarm) => {
          if (didPrewarm) sendToRenderer('meta:done');
        })
        .catch(() => {});
    }

    refreshInstalledInBackground();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
