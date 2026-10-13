import { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { InstallErrorCode, InstallProgress, QueueJob } from '../types';
import { IconClose } from './Icons';

interface QueuePanelProps {
  open: boolean;
  jobs: QueueJob[];
  onClose: () => void;
  onClearDone: () => void;
  onClearAll: () => void;
  onRetryFailed: () => void;
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onDismiss: (jobId: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function JobProgress({ progress }: { progress?: InstallProgress }) {
  const { t } = useI18n();
  const percent = progress?.percent;
  const determinate = typeof percent === 'number';
  const phaseLabel = progress ? t.queue.phase[progress.phase] : t.queue.preparing;

  const size =
    progress?.bytesTotal && progress.bytesDone !== undefined
      ? `${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`
      : undefined;
  const speed = progress?.bytesPerSecond
    ? `${(progress.bytesPerSecond / 1024 ** 2).toFixed(1)} ${t.queue.speed}`
    : undefined;

  return (
    <>
      <div className={`queue-progress${determinate ? '' : ' queue-progress--indeterminate'}`}>
        <div
          className="queue-progress-fill"
          style={determinate ? { width: `${Math.round(percent)}%` } : undefined}
        />
      </div>
      <div className="queue-progress-meta">
        <span>{phaseLabel}</span>
        {size && <span className="mono">{size}</span>}
        <span className="queue-progress-spacer" />
        {speed && <span className="mono">{speed}</span>}
        {determinate && <span className="queue-progress-percent mono">{Math.round(percent)}%</span>}
      </div>
      {progress?.note && <div className="queue-item-note">{progress.note}</div>}
    </>
  );
}

function errorLabel(
  t: ReturnType<typeof useI18n>['t'],
  code?: InstallErrorCode,
  fallback?: string,
): string {
  if (code && t.queue.errors[code]) return t.queue.errors[code];
  return fallback || t.queue.errors.unknown;
}

function QueueJobRow({
  job,
  onCancel,
  onRetry,
  onDismiss,
}: {
  job: QueueJob;
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onDismiss: (jobId: string) => void;
}) {
  const { t } = useI18n();
  const [detailOpen, setDetailOpen] = useState(false);
  const canCancel = job.status === 'pending' || job.status === 'running';
  const canRetry = job.status === 'failed' || job.status === 'cancelled';
  const canDismiss = job.status === 'failed' || job.status === 'cancelled' || job.status === 'done';
  const friendly =
    job.status === 'failed' || job.status === 'cancelled'
      ? errorLabel(t, job.errorCode, job.message)
      : job.message;

  return (
    <div className={`queue-item ${job.status}`}>
      <div className="queue-item-top">
        <div className="queue-item-name">
          {job.name}
          {(job.kind === 'upgrade' || job.kind === 'rollback') && (
            <span className="queue-item-kind mono">
              {job.kind === 'rollback' ? t.updates.queueRollback : t.updates.queueLabel}
              {job.fromVersion && job.toVersion ? ` ${job.fromVersion} → ${job.toVersion}` : ''}
            </span>
          )}
        </div>
        <div className="queue-item-status">
          {job.status === 'running' && job.kind === 'upgrade' ? t.updates.updating : t.queue.status[job.status]}
        </div>
      </div>
      {friendly && job.status !== 'pending' && job.status !== 'running' && (
        <div className="queue-item-detail">{friendly}</div>
      )}
      {job.detail && (job.status === 'failed' || job.status === 'cancelled') && (
        <button
          type="button"
          className="queue-detail-toggle"
          onClick={() => setDetailOpen((v) => !v)}
        >
          {detailOpen ? t.queue.hideDetail : t.queue.showDetail}
        </button>
      )}
      {detailOpen && job.detail && (
        <div className="queue-item-detail mono queue-item-detail--full">{job.detail}</div>
      )}
      {job.status === 'running' && <JobProgress progress={job.progress} />}
      <div className="queue-item-actions">
        {canCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCancel(job.id)}>
            {t.queue.cancel}
          </button>
        )}
        {canRetry && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRetry(job.id)}>
            {t.queue.retry}
          </button>
        )}
        {canDismiss && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDismiss(job.id)}>
            {t.queue.dismiss}
          </button>
        )}
      </div>
    </div>
  );
}

export function QueuePanel({
  open,
  jobs,
  onClose,
  onClearDone,
  onClearAll,
  onRetryFailed,
  onCancel,
  onRetry,
  onDismiss,
}: QueuePanelProps) {
  const { t } = useI18n();
  const activeCount = jobs.filter((j) => j.status === 'pending' || j.status === 'running').length;

  return (
    <aside className={`queue-panel${open ? ' open' : ''}`}>
      <div className="queue-header">
        <h3>
          {t.queue.title} {activeCount > 0 && <span className="mono">({activeCount})</span>}
        </h3>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label={t.app.close}>
          <IconClose size={16} />
        </button>
      </div>
      <div className="queue-list">
        {jobs.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <p>{t.queue.empty}</p>
          </div>
        ) : (
          jobs.map((job) => (
            <QueueJobRow
              key={job.id}
              job={job}
              onCancel={onCancel}
              onRetry={onRetry}
              onDismiss={onDismiss}
            />
          ))
        )}
      </div>
      {jobs.length > 0 && (
        <div className="queue-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClearDone}>
            {t.queue.clearDone}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onRetryFailed}>
            {t.queue.retryFailed}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClearAll}>
            {t.queue.clearAll}
          </button>
        </div>
      )}
    </aside>
  );
}
