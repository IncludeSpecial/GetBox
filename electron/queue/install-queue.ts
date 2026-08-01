import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type { InstallProgress, QueueJob } from '../providers/types.js';
import { getProvider } from '../providers/registry.js';
import { getSettings } from '../store/settings.js';

const PROGRESS_EMIT_MS = 250;

export class InstallQueue extends EventEmitter {
  private jobs: QueueJob[] = [];
  private running = false;
  private hadRunning = false;
  private newDoneSinceRun = false;
  private lastProgressEmit = 0;

  getJobs(): QueueJob[] {
    return [...this.jobs];
  }

  add(provider: string, packageId: string, name: string): void {
    const id = crypto.randomUUID();
    this.jobs.push({ id, provider, packageId, name, status: 'pending' });
    this.emitUpdated();
    this.processNext();
  }

  addMany(items: Array<{ provider: string; packageId: string; name: string }>): void {
    for (const item of items) {
      this.jobs.push({
        id: crypto.randomUUID(),
        provider: item.provider,
        packageId: item.packageId,
        name: item.name,
        status: 'pending',
      });
    }
    this.emitUpdated();
    this.processNext();
  }

  clearDone(): void {
    this.jobs = this.jobs.filter((j) => j.status !== 'done');
    this.emitUpdated();
  }

  clearAll(): void {
    this.jobs = this.jobs.filter((j) => j.status === 'running');
    this.emitUpdated();
  }

  retryFailed(): void {
    for (const job of this.jobs) {
      if (job.status === 'failed') {
        job.status = 'pending';
        job.message = undefined;
        job.detail = undefined;
        job.progress = undefined;
      }
    }
    this.emitUpdated();
    this.processNext();
  }

  private emitUpdated(): void {
    this.lastProgressEmit = Date.now();
    this.emit('updated', this.getJobs());
  }

  /**
   * Providers push byte-level updates; the renderer only needs a few per second.
   * A phase change always goes through so the label never lags behind.
   */
  private reportProgress(jobId: string, progress: InstallProgress): void {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || job.status !== 'running') return;

    const phaseChanged = job.progress?.phase !== progress.phase;
    job.progress = progress;
    if (!phaseChanged && Date.now() - this.lastProgressEmit < PROGRESS_EMIT_MS) return;
    this.emitUpdated();
  }

  private async processNext(): Promise<void> {
    if (this.running) return;
    const next = this.jobs.find((j) => j.status === 'pending');
    if (!next) {
      if (this.hadRunning && this.newDoneSinceRun) {
        this.emit('installed-changed');
        this.newDoneSinceRun = false;
      }
      this.hadRunning = false;
      return;
    }

    this.running = true;
    this.hadRunning = true;
    next.status = 'running';
    next.progress = { phase: 'download' };
    this.emitUpdated();

    const provider = getProvider(next.provider);
    const settings = getSettings();

    if (!provider) {
      next.status = 'failed';
      next.message = `Провайдер ${next.provider} не найден`;
      this.running = false;
      this.emitUpdated();
      this.processNext();
      return;
    }

    try {
      const result = await provider.install(next.packageId, {
        quiet: settings.quietInstall,
        onProgress: (progress) => this.reportProgress(next.id, progress),
      });
      if (result.ok) {
        next.status = 'done';
        next.message = result.message;
        this.newDoneSinceRun = true;
      } else {
        next.status = 'failed';
        next.message = result.message;
        next.detail = result.detail;
      }
    } catch (err) {
      next.status = 'failed';
      next.message = err instanceof Error ? err.message : String(err);
    }

    next.progress = undefined;
    this.running = false;
    this.emitUpdated();
    this.processNext();
  }
}

export const installQueue = new InstallQueue();
