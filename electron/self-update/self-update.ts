import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, net } from 'electron';
import { getAppDataDir } from '../paths.js';
import { getSettings } from '../store/settings.js';
import type { SelfUpdateState } from '../providers/types.js';
import { logger } from '../log.js';

const log = logger('self-update');

const REPO = 'IncludeSpecial/GetBox';
const API = `https://api.github.com/repos/${REPO}/releases`;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 20 * 1000;
const ASSET = /^GetBox-(.+)-portable\.exe$/;
/** Release assets are served from github.com and redirect to GitHub's object storage. */
const ALLOWED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

interface GhAsset { name: string; browser_download_url: string; size: number; digest?: string | null }
interface GhRelease { tag_name: string; name: string; body: string; html_url: string; prerelease: boolean; draft: boolean; assets: GhAsset[] }

/** Compare dotted versions with an optional -prerelease suffix; a release beats its prereleases. */
export function compareVersions(a: string, b: string): number {
  const [ma, pa = ''] = a.replace(/^v/, '').split('-', 2);
  const [mb, pb = ''] = b.replace(/^v/, '').split('-', 2);
  const na = ma.split('.').map(Number), nb = mb.split('.').map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] || 0) - (nb[i] || 0);
    if (d) return Math.sign(d);
  }
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa < pb ? -1 : 1;
}

/** Picks the newest release for the channel that ships a portable exe. */
export function pickRelease(releases: GhRelease[], channel: 'stable' | 'beta'): { release: GhRelease; asset: GhAsset; version: string } | null {
  let best: { release: GhRelease; asset: GhAsset; version: string } | null = null;
  for (const release of releases) {
    if (release.draft || (release.prerelease && channel !== 'beta')) continue;
    const asset = release.assets.find((a) => ASSET.test(a.name));
    if (!asset) continue;
    const version = release.tag_name.replace(/^v/, '');
    if (!best || compareVersions(version, best.version) > 0) best = { release, asset, version };
  }
  return best;
}

/** The exe this app was started from; only set for electron-builder portable builds. */
function portableExe(): string | undefined {
  return process.env.PORTABLE_EXECUTABLE_FILE || undefined;
}

function updatesDir(): string {
  return path.join(getAppDataDir(), 'self-update');
}

/**
 * Electron's net.fetch goes through Chromium's network stack and so honours the Windows
 * proxy settings, like the browser does; Node's fetch ignores them. Tests run without
 * Electron and get the global fetch.
 */
function httpFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = { 'User-Agent': 'GetBox', ...(init.headers as Record<string, string> | undefined) };
  return typeof net?.fetch === 'function' ? net.fetch(url, { ...init, headers }) : fetch(url, { ...init, headers });
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await httpFetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return (await res.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const res = await httpFetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * Where `url` redirects to (null when it answers directly). net.fetch neither reports the final
 * URL nor supports manual redirects, so Electron's net.request is used; Node's fetch in tests.
 */
export function redirectTarget(url: string): Promise<string | null> {
  if (typeof net?.request !== 'function') {
    return fetch(url, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'GetBox' } })
      .then((res) => (res.status >= 300 && res.status < 400 ? res.headers.get('location') : null));
  }
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'HEAD', redirect: 'manual' });
    req.setHeader('User-Agent', 'GetBox');
    req.on('redirect', (_status, _method, location) => { req.abort(); resolve(location); });
    req.on('response', () => resolve(null));
    req.on('error', reject);
    req.end();
  });
}

/**
 * Without the API: github.com/…/releases/latest redirects to the newest stable release's
 * tag page, and asset URLs follow from the tag. Used when the API refuses (it allows 60
 * anonymous requests an hour per IP, which a shared office or mobile IP runs out of).
 * Release notes are not available this way.
 */
export async function latestViaRedirect(): Promise<GhRelease | null> {
  const page = await redirectTarget(`https://github.com/${REPO}/releases/latest`);
  const m = /\/releases\/tag\/v?([0-9][\w.-]*)$/.exec(page ?? '');
  return page && m ? releaseFromTag(m[1], page) : null;
}

export function releaseFromTag(version: string, pageUrl: string): GhRelease {
  const exe = `GetBox-${version}-portable.exe`;
  const base = `https://github.com/${REPO}/releases/download/v${version}/`;
  return {
    tag_name: `v${version}`, name: `GetBox ${version}`, body: '', html_url: pageUrl, prerelease: false, draft: false,
    assets: [{ name: exe, browser_download_url: base + exe, size: 0 }, { name: `${exe}.sha256`, browser_download_url: `${base}${exe}.sha256`, size: 0 }],
  };
}

async function listReleases(channel: 'stable' | 'beta'): Promise<GhRelease[]> {
  try {
    return await fetchJson<GhRelease[]>(`${API}?per_page=15`);
  } catch (err) {
    // Prereleases are only listed by the API; the stable channel can do without it.
    if (channel !== 'stable') throw err;
    log.warn('API unavailable, using the releases/latest redirect:', err instanceof Error ? err.message : String(err));
    const latest = await latestViaRedirect();
    if (!latest) throw err;
    return [latest];
  }
}

function assertAllowed(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error(`Недопустимый адрес загрузки: ${u.hostname}`);
}

/**
 * The cmd script that replaces the portable exe once GetBox (process `pid`) has exited:
 * waits for the process, copies `next` over `exe`, optionally starts it, deletes itself.
 */
export function swapScript(pid: number, next: string, exe: string, restart: boolean): string {
  const q = (p: string) => `"${p.replace(/"/g, '')}"`;
  return [
    '@echo off',
    ':wait',
    `tasklist /FI "PID eq ${pid}" | find "${pid}" >nul && (timeout /t 1 /nobreak >nul & goto wait)`,
    // No write access to the exe's folder: bring the old version back instead of leaving GetBox closed.
    `copy /Y ${q(next)} ${q(exe)} >nul || (${restart ? `start "" ${q(exe)} & ` : ''}goto end)`,
    `del ${q(next)} >nul 2>&1`,
    restart ? `start "" ${q(exe)}` : 'rem no restart',
    ':end',
    'del "%~f0"',
  ].join('\r\n');
}

class SelfUpdater extends EventEmitter {
  private state: SelfUpdateState = { status: 'idle', current: app.getVersion(), canApply: Boolean(portableExe()) };
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  getState(): SelfUpdateState {
    return { ...this.state };
  }

  private set(patch: Partial<SelfUpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.emit('changed', this.getState());
  }

  /** Looks for a newer release and, when allowed, downloads and verifies it in the background. */
  async check(manual = false): Promise<SelfUpdateState> {
    if (this.busy || this.state.status === 'ready') return this.getState();
    this.busy = true;
    this.set({ status: 'checking', error: undefined });
    try {
      const { appUpdateChannel } = getSettings();
      const releases = await listReleases(appUpdateChannel);
      const found = pickRelease(releases, appUpdateChannel);
      if (!found || compareVersions(found.version, this.state.current) <= 0) {
        log.info(`up to date: ${this.state.current} (latest ${found?.version ?? '—'}, ${appUpdateChannel})`);
        this.set({ status: 'idle', latest: found?.version, checkedAt: Date.now() });
        return this.getState();
      }
      log.info(`found ${found.version} (current ${this.state.current}, ${manual ? 'manual' : 'scheduled'} check, portable: ${this.state.canApply})`);
      this.set({
        status: 'available', latest: found.version, notes: found.release.body, releaseUrl: found.release.html_url, checkedAt: Date.now(),
      });
      if (this.state.canApply && (manual || getSettings().autoUpdateApp)) await this.download(found.release, found.asset);
    } catch (err) {
      log.error('check/download failed:', err);
      // A failed download keeps the update visible as «available» so it can be retried.
      const status = this.state.status === 'downloading' || this.state.status === 'available' ? 'available' : 'error';
      this.set({ status, progress: undefined, error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.busy = false;
    }
    return this.getState();
  }

  /** Downloads the portable exe and checks it against the .sha256 file (or GitHub's digest) of the release. */
  private async download(release: GhRelease, asset: GhAsset): Promise<void> {
    const shaAsset = release.assets.find((a) => a.name === `${asset.name}.sha256`);
    let expected = shaAsset ? (await fetchText(shaAsset.browser_download_url)).trim().split(/\s+/)[0].toLowerCase() : '';
    if (!expected && asset.digest?.startsWith('sha256:')) expected = asset.digest.slice(7).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('У релиза нет контрольной суммы SHA256 — обновление не скачано');

    assertAllowed(asset.browser_download_url);
    fs.mkdirSync(updatesDir(), { recursive: true });
    const target = path.join(updatesDir(), asset.name);
    const part = target + '.part';
    this.set({ status: 'downloading', progress: 0 });

    // github.com hands the file to its object storage; that host is checked before anything is read.
    const source = (await redirectTarget(asset.browser_download_url)) ?? asset.browser_download_url;
    assertAllowed(source);
    log.info(`downloading ${asset.name} from ${new URL(source).hostname}`);
    const res = await httpFetch(source, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Загрузка: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || asset.size;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    let done = 0, lastEmit = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      hash.update(value);
      done += value.length;
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      if (Date.now() - lastEmit > 300) {
        lastEmit = Date.now();
        this.set({ progress: total ? Math.min(99, Math.round((done / total) * 100)) : undefined });
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    const actual = hash.digest('hex');
    if (actual !== expected) {
      fs.rmSync(part, { force: true });
      throw new Error(`SHA256 не совпал: ${actual}`);
    }
    fs.renameSync(part, target);
    log.info(`downloaded ${asset.name}, ${done} bytes, SHA256 ok`);
    this.set({ status: 'ready', progress: 100, downloadedPath: target });
  }

  /**
   * Swaps the running portable exe for the downloaded one. The exe is locked while
   * this process runs, so a detached script waits for it to exit, copies the new
   * file over and (optionally) starts it again.
   */
  apply(restart: boolean): boolean {
    const exe = portableExe();
    const next = this.state.downloadedPath;
    if (!exe || !next || this.state.status !== 'ready' || !fs.existsSync(next)) return false;
    const script = path.join(os.tmpdir(), `getbox-update-${process.pid}.cmd`);
    fs.writeFileSync(script, swapScript(process.pid, next, exe, restart));
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    log.info(`applying ${this.state.latest} over ${exe} (restart: ${restart})`);
    return true;
  }

  /** «При выходе»: remember the choice and swap the exe when the app closes. */
  setApplyOnQuit(on: boolean): void {
    this.set({ applyOnQuit: on });
  }

  onQuit(): void {
    if (this.state.applyOnQuit) this.apply(false);
  }

  schedule(atLaunch = false): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.check().catch(() => {});
      this.schedule();
    }, atLaunch ? FIRST_CHECK_DELAY_MS : CHECK_INTERVAL_MS);
  }
}

export const selfUpdater = new SelfUpdater();
