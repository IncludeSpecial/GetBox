import { useI18n } from '../i18n/I18nContext';
import type { InstallProgress, QueueJob } from '../types';
import { IconClose } from './Icons';

interface QueuePanelProps {
  open: boolean;
  jobs: QueueJob[];
  onClose: () => void;
  onClearDone: () => void;
  onClearAll: () => void;
  onRetryFailed: () => void;
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

export function QueuePanel({ open, jobs, onClose, onClearDone, onClearAll, onRetryFailed }: QueuePanelProps) {
  const { t } = useI18n();
  const activeCount = jobs.filter((j) => j.status === 'pending' || j.status === 'running').length;

  return (
    <aside className={`queue-panel${open ? ' open' : ''}`}>
      <div className="queue-header">
        <h3>{t.queue.title} {activeCount > 0 && <span className="mono">({activeCount})</span>}</h3>
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
            <div key={job.id} className={`queue-item ${job.status}`}>
              <div className="queue-item-name">{job.name}</div>
              <div className="queue-item-status">{t.queue.status[job.status]}</div>
              {job.message && job.status !== 'pending' && (
                <div className="queue-item-detail">{job.message}</div>
              )}
              {job.detail && job.status === 'failed' && (
                <div className="queue-item-detail mono">{job.detail.slice(0, 160)}</div>
              )}
              {job.status === 'running' && <JobProgress progress={job.progress} />}
            </div>
          ))
        )}
      </div>
      {jobs.length > 0 && (
        <div className="queue-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClearDone}>{t.queue.clearDone}</button>
          <button className="btn btn-ghost btn-sm" onClick={onRetryFailed}>{t.queue.retryFailed}</button>
          <button className="btn btn-ghost btn-sm" onClick={onClearAll}>{t.queue.clearAll}</button>
        </div>
      )}
    </aside>
  );
}
