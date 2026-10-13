/**
 * `GetBox.exe --smoke` (CI): open the window, wait until the interface has rendered, check that
 * the catalog loads and the renderer logged no errors, then quit with 0 (ok) or 1.
 * Background work that needs the network (package-manager setup, index build, update checks)
 * is skipped in this mode. The result is also written as JSON to GETBOX_SMOKE_OUT when set.
 */
import fs from 'node:fs';
import { app, type BrowserWindow } from 'electron';
import { getCatalog } from './catalog/merge.js';
import { logger } from './log.js';

export const SMOKE = process.argv.includes('--smoke');

const log = logger('smoke');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function runSmoke(win: BrowserWindow): void {
  const errors: string[] = [];
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  let done = false;
  const finish = (result: Record<string, unknown>) => {
    if (done) return;
    done = true;
    const ok = result.ok === true;
    log[ok ? 'info' : 'error'](JSON.stringify(result));
    if (process.env.GETBOX_SMOKE_OUT) fs.writeFileSync(process.env.GETBOX_SMOKE_OUT, JSON.stringify(result, null, 2));
    app.exit(ok ? 0 : 1);
  };
  setTimeout(() => finish({ ok: false, reason: 'timeout', errors }), 90_000);

  win.webContents.once('did-finish-load', async () => {
    try {
      let nodes = 0;
      for (let i = 0; i < 60 && nodes < 100; i++) {
        nodes = await win.webContents.executeJavaScript('document.getElementById("root")?.querySelectorAll("*").length ?? 0');
        if (nodes < 100) await sleep(500);
      }
      const bridge = await win.webContents.executeJavaScript('typeof window.getbox === "object"');
      const catalog = getCatalog();
      await sleep(1500); // let effects settle so late renderer errors are caught
      const result = { ok: nodes >= 100 && bridge && catalog.apps.length > 0 && errors.length === 0,
        version: app.getVersion(), electron: process.versions.electron, nodes, bridge, apps: catalog.apps.length, errors };
      finish(result);
    } catch (err) {
      finish({ ok: false, reason: err instanceof Error ? err.message : String(err), errors });
    }
  });
}
