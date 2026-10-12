import { memo } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { MergedApp, QueueJob } from '../types';
import { AppCover } from './AppMonogram';
import { IconStar, IconStarFilled } from './Icons';

interface CapsuleCardProps {
  app: MergedApp;
  categoryLabel?: string;
  /** Why the app is recommended; one line under the card body. */
  reason?: string;
  job?: QueueJob;
  onInstall: (app: MergedApp) => void;
  onRetry?: (app: MergedApp) => void;
  onCancel?: (jobId: string) => void;
  onOpen: (app: MergedApp) => void;
  onToggleFavorite: (app: MergedApp) => void;
}

function CapsuleCardInner({ app, categoryLabel, reason, job, onInstall, onRetry, onCancel, onOpen, onToggleFavorite }: CapsuleCardProps) {
  const { t } = useI18n();
  const busy = job?.status === 'running' || job?.status === 'pending';
  const failed = job?.status === 'failed';
  const percent = job?.progress?.percent;

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <article
      className="capsule"
      style={{ ['--brand' as string]: app.brandColor ?? '#3a4b5c' }}
      onClick={() => onOpen(app)}
    >
      <div className="capsule-art">
        {app.iconUrl ? (
          <img className="capsule-logo" src={app.iconUrl} alt="" loading="lazy" aria-hidden />
        ) : (
          <AppCover name={app.name} size="md" />
        )}
        {app.isInstalled && <span className="capsule-installed">{t.app.installedBadge}</span>}
        <button
          className={`capsule-fav${app.isFavorite ? ' active' : ''}`}
          onClick={stop(() => onToggleFavorite(app))}
          title={app.isFavorite ? t.app.unfavorite : t.app.favorite}
          aria-label={app.isFavorite ? t.app.unfavorite : t.app.favorite}
        >
          {app.isFavorite ? <IconStarFilled size={13} /> : <IconStar size={13} />}
        </button>
      </div>
      <div className="capsule-body">
        <div className="capsule-text">
          <div className="capsule-name" title={app.name}>{app.name}</div>
          {categoryLabel && <div className="capsule-meta">{categoryLabel}</div>}
        </div>
        {busy ? (
          <button
            type="button"
            className="capsule-cta busy"
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
        ) : failed ? (
          <button
            className="capsule-cta failed"
            onClick={stop(() => (onRetry ?? onInstall)(app))}
            title={job?.errorCode ? t.queue.errors[job.errorCode] : t.app.failed}
          >
            {t.app.retry}
          </button>
        ) : (
          <button
            className={`capsule-cta${app.isInstalled ? ' reinstall' : ''}`}
            onClick={stop(() => onInstall(app))}
          >
            {app.isInstalled ? t.app.reinstall : t.app.install}
          </button>
        )}
      </div>
      {reason && <div className="capsule-reason" title={reason}>{reason}</div>}
    </article>
  );
}

export const CapsuleCard = memo(CapsuleCardInner, (prev, next) => (
  prev.app.id === next.app.id &&
  prev.app.provider === next.app.provider &&
  prev.app.isInstalled === next.app.isInstalled &&
  prev.app.isFavorite === next.app.isFavorite &&
  prev.app.iconUrl === next.app.iconUrl &&
  prev.app.brandColor === next.app.brandColor &&
  prev.app.name === next.app.name &&
  prev.categoryLabel === next.categoryLabel &&
  prev.job?.status === next.job?.status &&
  prev.job?.errorCode === next.job?.errorCode &&
  prev.job?.progress?.phase === next.job?.progress?.phase &&
  prev.job?.progress?.percent === next.job?.progress?.percent &&
  prev.onCancel === next.onCancel &&
  prev.onRetry === next.onRetry
));
