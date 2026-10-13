import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { QueueJob, UpdateHistoryEntry, UpdateInfo, UpdatesState } from '../providers/types.js';
import { getAllProviders } from '../providers/registry.js';
import { catalogIdsBySource } from '../providers/catalog.js';
import { getSettings } from '../store/settings.js';
import { getAppDataDir } from '../paths.js';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30 * 1000;
const HISTORY_LIMIT = 200;

interface Persisted {
  items: UpdateInfo[];
  checkedAt?: number;
  history: UpdateHistoryEntry[];
}

function statePath(): string {
  return path.join(getAppDataDir(), 'updates.json');
}

function load(): Persisted {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf-8')) as Partial<Persisted>;
    return {
      items: Array.isArray(raw.items) ? raw.items : [],
      checkedAt: typeof raw.checkedAt === 'number' ? raw.checkedAt : undefined,
      history: Array.isArray(raw.history) ? raw.history : [],
    };
  } catch {
    return { items: [], history: [] };
  }
}

const sameUpdate = (a: { provider: string; packageId: string }, b: { provider: string; packageId: string }) =>
  a.provider === b.provider && a.packageId.toLowerCase() === b.packageId.toLowerCase();

class UpdatesService extends EventEmitter {
  private data: Persisted = load();
  private checking = false;
  private timer: NodeJS.Timeout | null = null;

  getState(): UpdatesState {
    return { ...this.data, checking: this.checking };
  }

  private save(): void {
    try {
      fs.mkdirSync(getAppDataDir(), { recursive: true });
      fs.writeFileSync(statePath(), JSON.stringify(this.data));
    } catch (err) {
      console.error('[GetBox] updates save failed:', err);
    }
    this.emit('changed', this.getState());
  }

  /** Asks every enabled package manager; one failing source does not hide the others. */
  async check(): Promise<UpdatesState> {
    if (this.checking) return this.getState();
    this.checking = true;
    this.emit('changed', this.getState());
    try {
      const enabled = new Set(getSettings().enabledProviders);
      const sources = getAllProviders().filter((p) => p.listUpgrades && enabled.has(p.id));
      const results = await Promise.allSettled(sources.map((p) => p.listUpgrades!()));
      const catalogIds = catalogIdsBySource();
      const items: UpdateInfo[] = [];
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`[GetBox] ${sources[i].id} upgrade check failed:`, r.reason);
          return;
        }
        for (const u of r.value) {
          if (items.some((x) => sameUpdate(x, u))) continue;
          items.push({ ...u, catalogId: catalogIds.get(`${u.provider}:${u.packageId.toLowerCase()}`) });
        }
      });
      this.data.items = items;
      this.data.checkedAt = Date.now();
    } finally {
      this.checking = false;
      this.save();
    }
    if (getSettings().autoInstallUpdates && this.data.items.length > 0) {
      this.emit('auto-install', this.data.items);
    }
    return this.getState();
  }

  /** Called by the queue when an upgrade or rollback finishes. */
  record(job: QueueJob): void {
    if (job.kind !== 'upgrade' && job.kind !== 'rollback') return;
    if (job.status !== 'done' && job.status !== 'failed') return;
    const ok = job.status === 'done';
    this.data.history.unshift({
      id: crypto.randomUUID(),
      kind: job.kind,
      provider: job.provider,
      packageId: job.packageId,
      name: job.name,
      catalogId: job.catalogId,
      from: job.fromVersion,
      to: job.toVersion,
      at: Date.now(),
      ok,
      message: ok ? undefined : job.message,
      errorCode: ok ? undefined : job.errorCode,
    });
    this.data.history = this.data.history.slice(0, HISTORY_LIMIT);
    if (ok && job.kind === 'upgrade') {
      this.data.items = this.data.items.filter((u) => !sameUpdate(u, job));
    }
    this.save();
  }

  clearHistory(): void {
    this.data.history = [];
    this.save();
  }

  /**
   * Checks shortly after launch, then every 6 hours. Call again after the
   * setting changes; `atLaunch` is only for the first call.
   */
  schedule(atLaunch = false): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!getSettings().autoCheckUpdates) return;
    const due = atLaunch ? 0 : (this.data.checkedAt ?? 0) + CHECK_INTERVAL_MS - Date.now();
    this.timer = setTimeout(async () => {
      await this.check().catch((err) => console.error('[GetBox] update check failed:', err));
      this.schedule();
    }, Math.max(FIRST_CHECK_DELAY_MS, due));
  }
}

export const updates = new UpdatesService();
