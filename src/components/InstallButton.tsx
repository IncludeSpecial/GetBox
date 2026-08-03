import { useI18n } from '../i18n/I18nContext';
import type { MergedApp, QueueJob } from '../types';

interface InstallButtonProps {
  app: MergedApp;
  job?: QueueJob;
  onInstall: (app: MergedApp) => void;
  onRetry?: (app: MergedApp) => void;
  onCancel?: (jobId: string) => void;
  className?: string;
}

/** Install action that turns into a progress readout while the job is queued or running. */
export function InstallButton({
  app,
  job,
  onInstall,
  onRetry,
  onCancel,
  className = 'btn btn-primary',
}: InstallButtonProps) {
  const { t } = useI18n();
  const busy = job?.status === 'running' || job?.status === 'pending';
  const failed = job?.status === 'failed';
  const percent = job?.progress?.percent;

  if (failed) {
    return (
      <div className="install-btn-stack">
        <button
          className={`${className} btn-danger-soft`}
          onClick={() => (onRetry ?? onInstall)(app)}
        >
          {t.app.retry}
        </button>
        {job.errorCode && (
          <span className="install-btn-error" title={job.detail}>
            {t.queue.errors[job.errorCode] ?? t.app.failed}
          </span>
        )}
      </div>
    );
  }

  if (!busy) {
    return (
      <button className={className} onClick={() => onInstall(app)}>
        {app.isInstalled ? t.app.reinstall : t.app.install}
      </button>
    );
  }

  const label =
    job?.status === 'pending'
      ? t.queue.status.pending
      : `${t.queue.phase[job?.progress?.phase ?? 'install']}${
          typeof percent === 'number' ? ` ${Math.round(percent)}%` : '…'
        }`;

  return (
    <div className="install-btn-stack">
      <div className={`${className} btn-busy`} role="status" aria-live="polite">
        <span
          className={`btn-busy-fill${typeof percent === 'number' ? '' : ' pulse'}`}
          style={typeof percent === 'number' ? { width: `${Math.round(percent)}%` } : undefined}
        />
        <span className="btn-busy-label">{label}</span>
      </div>
      {job && onCancel && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCancel(job.id)}>
          {t.app.cancel}
        </button>
      )}
    </div>
  );
}
