import { useI18n } from '../i18n/I18nContext';
import { appDescription } from '../i18n/helpers';
import type { MergedApp, QueueJob } from '../types';
import { AppCover } from './AppMonogram';
import { IconStar, IconStarFilled } from './Icons';
import { InstallButton } from './InstallButton';

interface AppModalProps {
  app: MergedApp;
  job?: QueueJob;
  onClose: () => void;
  onInstall: (app: MergedApp) => void;
  onToggleFavorite: (app: MergedApp) => void;
}

export function AppModal({ app, job, onClose, onInstall, onToggleFavorite }: AppModalProps) {
  const { t } = useI18n();
  const desc = appDescription(app, t);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ ['--brand' as string]: app.brandColor ?? '#3a4b5c' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <AppCover name={app.name} iconUrl={app.iconUrl} size="lg" />
          <div>
            <div className="modal-title">{app.name}</div>
            <div className="modal-provider mono">{app.provider}:{app.id}</div>
            {app.pickWhy && <div className="modal-pick-why">{app.pickWhy}</div>}
          </div>
        </div>
        <p className={`modal-description${desc.loading ? ' modal-description--loading' : ''}`}>
          {desc.loading && <span className="desc-spinner" aria-hidden />}
          {desc.text}
        </p>
        {app.features && app.features.length > 0 && (
          <div className="modal-features">
            {app.features.map((f) => (
              <span key={f} className="feature-tag mono">{f}</span>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <InstallButton app={app} job={job} onInstall={onInstall} />
          <button className="btn btn-accent" onClick={() => onToggleFavorite(app)}>
            {app.isFavorite ? (
              <><IconStarFilled size={14} /> {t.app.unfavorite}</>
            ) : (
              <><IconStar size={14} /> {t.app.favorite}</>
            )}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>{t.app.close}</button>
        </div>
      </div>
    </div>
  );
}
