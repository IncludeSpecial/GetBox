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
  onRetry?: (app: MergedApp) => void;
  onCancel?: (jobId: string) => void;
  onToggleFavorite: (app: MergedApp) => void;
  /** Apps from the same stacks; shown as chips that open their own card. */
  pairs?: MergedApp[];
  alternatives?: MergedApp[];
  onOpen?: (app: MergedApp) => void;
}

function RelatedChips({ title, apps, onOpen }: { title: string; apps: MergedApp[]; onOpen?: (app: MergedApp) => void }) {
  const { t } = useI18n();
  if (apps.length === 0) return null;
  return (
    <section className="modal-related">
      <h4 className="modal-related-title">{title}</h4>
      <div className="modal-related-list">
        {apps.map((a) => (
          <button key={a.id} type="button" className="related-chip" onClick={() => onOpen?.(a)} title={a.name}>
            <AppCover name={a.name} iconUrl={a.iconUrl} size="xs" />
            <span className="related-chip-name">{a.name}</span>
            {a.isInstalled && <span className="related-chip-badge">{t.app.installedBadge}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

export function AppModal({
  app,
  job,
  onClose,
  onInstall,
  onRetry,
  onCancel,
  onToggleFavorite,
  pairs = [],
  alternatives = [],
  onOpen,
}: AppModalProps) {
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
        <RelatedChips title={t.recommend.pairsWith} apps={pairs} onOpen={onOpen} />
        <RelatedChips title={t.recommend.alternatives} apps={alternatives} onOpen={onOpen} />
        <div className="modal-actions">
          <InstallButton app={app} job={job} onInstall={onInstall} onRetry={onRetry} onCancel={onCancel} />
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
