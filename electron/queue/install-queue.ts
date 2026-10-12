import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type { InstallProgress, QueueJob } from '../providers/types.js';
import { getProvider } from '../providers/registry.js';
import { getSettings } from '../store/settings.js';
import { classifyError, isCancelledError } from '../providers/install-errors.js';

const PROGRESS_EMIT_MS = 250;

export class InstallQueue extends EventEmitter {
  private jobs: QueueJob[] = [];
  private running = false;
  private hadRunning = false;
  private newDoneSinceRun = false;
  private lastProgressEmit = 0;
  private activeController: AbortController | null = null;
  private dropRunningOnComplete = false;

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
    this.jobs = this.jobs.filter(
      (j) => j.status !== 'done' && j.status !== 'cancelled' && j.status !== 'failed',
    );
    this.emitUpdated();
  }

  /** Abort the running job (if any), drop pending/done/failed/cancelled. */
  clearAll(): void {
    this.dropRunningOnComplete = true;
    this.activeController?.abort();
    this.jobs = this.jobs.filter((j) => j.status === 'running');
    this.emitUpdated();
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return false;

    if (job.status === 'pending') {
      job.status = 'cancelled';
      job.errorCode = 'cancelled';
      job.message = 'Установка отменена';
      job.progress = undefined;
      this.emitUpdated();
      return true;
    }

    if (job.status === 'running') {
      this.activeController?.abort();
      return true;
    }

    return false;
  }

  dismiss(jobId: string): boolean {
    const idx = this.jobs.findIndex((j) => j.id === jobId);
    if (idx < 0) return false;
    const job = this.jobs[idx];
    if (job.status === 'running' || job.status === 'pending') return false;
    this.jobs.splice(idx, 1);
    this.emitUpdated();
    return true;
  }

  retryJob(jobId: string): boolean {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return false;
    job.status = 'pending';
    job.message = undefined;
    job.detail = undefined;
    job.errorCode = undefined;
    job.progress = undefined;
    this.emitUpdated();
    this.processNext();
    return true;
  }

  retryFailed(): void {
    for (const job of this.jobs) {
      if (job.status === 'failed' || job.status === 'cancelled') {
        job.status = 'pending';
        job.message = undefined;
        job.detail = undefined;
        job.errorCode = undefined;
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
    this.dropRunningOnComplete = false;
    next.status = 'running';
    next.progress = { phase: 'download' };
    this.emitUpdated();

    const provider = getProvider(next.provider);
    const settings = getSettings();
    const controller = new AbortController();
    this.activeController = controller;

    if (!provider) {
      next.status = 'failed';
      next.errorCode = 'unknown';
      next.message = `Провайдер ${next.provider} не найден`;
      this.finishJob();
      return;
    }

    try {
      const result = await provider.install(next.packageId, {
        quiet: settings.quietInstall,
        signal: controller.signal,
        onProgress: (progress) => this.reportProgress(next.id, progress),
      });

      if (controller.signal.aborted || result.errorCode === 'cancelled') {
        next.status = 'cancelled';
        next.errorCode = 'cancelled';
        next.message = result.message || 'Установка отменена';
        next.detail = result.detail;
      } else if (result.ok) {
        next.status = 'done';
        next.message = result.message;
        next.errorCode = undefined;
        this.newDoneSinceRun = true;
      } else {
        const classified = result.errorCode
          ? { code: result.errorCode, message: result.message, detail: result.detail }
          : classifyError(new Error(result.detail || result.message));
        next.status = 'failed';
        next.errorCode = classified.code;
        next.message = result.message || classified.message;
        next.detail = result.detail || classified.detail;
      }
    } catch (err) {
      const classified = classifyError(err);
      if (controller.signal.aborted || classified.code === 'cancelled') {
        next.status = 'cancelled';
        next.errorCode = 'cancelled';
        next.message = 'Установка отменена';
        next.detail = classified.detail;
      } else {
        next.status = 'failed';
        next.errorCode = classified.code;
        next.message = classified.message;
        next.detail = classified.detail;
      }
    }


    this.finishJob(next.id);
  }

  private finishJob(jobId?: string): void {
    const job = jobId ? this.jobs.find((j) => j.id === jobId) : undefined;
    if (job) job.progress = undefined;

    if (this.dropRunningOnComplete && job) {
      this.jobs = this.jobs.filter((j) => j.id !== job.id);
      this.dropRunningOnComplete = false;
    }

    this.activeController = null;
    this.running = false;
    this.emitUpdated();
    this.processNext();
  }
}

export const installQueue = new InstallQueue();
