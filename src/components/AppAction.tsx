import { useI18n } from '../i18n/I18nContext';
import type { MergedApp, QueueJob } from '../types';

interface AppActionProps {
  app: MergedApp;
  job?: QueueJob;
  onInstall: (app: MergedApp) => void;
  onRetry?: (app: MergedApp) => void;
  onCancel?: (jobId: string) => void;
  className?: string;
}

/** Install / progress / retry button shared by every list layout. */
export function AppAction({ app, job, onInstall, onRetry, onCancel, className = '' }: AppActionProps) {
  const { t } = useI18n();
  const busy = job?.status === 'running' || job?.status === 'pending';
  const failed = job?.status === 'failed';
  const percent = job?.progress?.percent;

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  if (busy) {
    return (
      <button
        type="button"
        className={`capsule-cta busy ${className}`}
        aria-live="polite"
        onClick={stop(() => job && onCancel?.(job.id))}
        title={t.app.cancel}
      >
        <span
          className={`capsule-cta-fill${typeof percent === 'number' ? '' : ' pulse'}`}
          style={typeof percent === 'number' ? { width: `${Math.round(percent)}%` } : undefined}
        />
        <span className="capsule-cta-label">
          {job?.status === 'pending'
            ? t.queue.status.pending
            : typeof percent === 'number'
              ? `${Math.round(percent)}%`
              : t.queue.phase[job?.progress?.phase ?? 'install']}
        </span>
      </button>
    );
  }
  if (failed) {
    return (
      <button
        type="button"
        className={`capsule-cta failed ${className}`}
        onClick={stop(() => (onRetry ?? onInstall)(app))}
        title={job?.errorCode ? t.queue.errors[job.errorCode] : t.app.failed}
      >
        {t.app.retry}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`capsule-cta${app.isInstalled ? ' reinstall' : ''} ${className}`}
      onClick={stop(() => onInstall(app))}
    >
      {app.isInstalled ? t.app.reinstall : t.app.install}
    </button>
  );
}
