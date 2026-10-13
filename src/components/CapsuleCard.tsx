import { memo } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { MergedApp, QueueJob } from '../types';
import { AppCover } from './AppMonogram';
import { IconStar, IconStarFilled } from './Icons';
import { AppAction } from './AppAction';

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
  /** Square tile with name only; used by the "tiles" list view. */
  tile?: boolean;
}

function CapsuleCardInner({ app, categoryLabel, reason, job, onInstall, onRetry, onCancel, onOpen, onToggleFavorite, tile }: CapsuleCardProps) {
  const { t } = useI18n();

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <article
      className={`capsule${tile ? ' capsule--tile' : ''}`}
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
        {/* Tiles keep the action over the art so the name row stays compact. */}
        {tile && <AppAction app={app} job={job} onInstall={onInstall} onRetry={onRetry} onCancel={onCancel} className="capsule-cta--tile" />}
      </div>
      <div className="capsule-body">
        <div className="capsule-text">
          <div className="capsule-name" title={app.name}>{app.name}</div>
          {categoryLabel && <div className="capsule-meta">{categoryLabel}</div>}
        </div>
        {!tile && <AppAction app={app} job={job} onInstall={onInstall} onRetry={onRetry} onCancel={onCancel} />}
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
  prev.reason === next.reason &&
  prev.tile === next.tile &&
  prev.job?.status === next.job?.status &&
  prev.job?.errorCode === next.job?.errorCode &&
  prev.job?.progress?.phase === next.job?.progress?.phase &&
  prev.job?.progress?.percent === next.job?.progress?.percent &&
  prev.onCancel === next.onCancel &&
  prev.onRetry === next.onRetry
));
