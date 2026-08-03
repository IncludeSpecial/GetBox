import { useI18n } from '../i18n/I18nContext';
import { appDescription } from '../i18n/helpers';
import type { MergedApp, QueueJob } from '../types';
import { AppCover } from './AppMonogram';
import { InstallButton } from './InstallButton';

interface HeroBannerProps {
  featured: MergedApp;
  related: MergedApp[];
  job?: QueueJob;
  onInstall: (app: MergedApp) => void;
  onRetry?: (app: MergedApp) => void;
  onCancel?: (jobId: string) => void;
  onOpen: (app: MergedApp) => void;
  onSelect: (app: MergedApp) => void;
}

export function HeroBanner({ featured, related, job, onInstall, onRetry, onCancel, onOpen, onSelect }: HeroBannerProps) {
  const { t } = useI18n();
  const desc = appDescription(featured, t);
  const tag = featured.pickTag ?? (featured.recommended ? t.app.recommended : undefined);

  return (
    <section className="hero-banner" style={{ ['--brand' as string]: featured.brandColor ?? '#3a4b5c' }}>
      <div className="hero-banner-art">
        <div className="hero-banner-glow" aria-hidden />
        <div className="hero-banner-logo">
          {featured.iconUrl ? (
            <img src={featured.iconUrl} alt="" aria-hidden />
          ) : (
            <AppCover name={featured.name} size="lg" />
          )}
        </div>
        <div className="hero-banner-info">
          {tag && <span className="hero-banner-tag">{tag}</span>}
          <h2 className="hero-banner-title">{featured.name}</h2>
          <p className="hero-banner-desc">
            {desc.loading && <span className="desc-spinner" aria-hidden />}
            {desc.text}
          </p>
          {featured.features && featured.features.length > 0 && (
            <div className="hero-banner-features">
              {featured.features.map((f) => (
                <span key={f} className="feature-tag">{f}</span>
              ))}
            </div>
          )}
          <div className="hero-banner-actions">
            <InstallButton app={featured} job={job} onInstall={onInstall} onRetry={onRetry} onCancel={onCancel} />
            <button className="btn btn-accent" onClick={() => onOpen(featured)}>
              {t.app.details}
            </button>
          </div>
        </div>
      </div>
      {related.length > 0 && (
        <div className="hero-banner-thumbs">
          {related.map((app) => (
            <button
              key={`${app.provider}:${app.id}`}
              type="button"
              className={`hero-thumb-item${app.id === featured.id ? ' active' : ''}`}
              onClick={() => onSelect(app)}
            >
              {app.iconUrl ? <img src={app.iconUrl} alt="" aria-hidden /> : <AppCover name={app.name} size="sm" />}
              <span>{app.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
