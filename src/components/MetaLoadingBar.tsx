import { useI18n } from '../i18n/I18nContext';
import type { MetaProgress } from '../types';

interface MetaLoadingBarProps {
  progress: MetaProgress | null;
}

export function MetaLoadingBar({ progress }: MetaLoadingBarProps) {
  const { t } = useI18n();
  if (!progress?.running) return null;

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="meta-loading-bar" role="status" aria-live="polite">
      <div className="meta-loading-header">
        <span className="meta-loading-title">{t.meta.title}</span>
        <span className="meta-loading-count mono">
          {progress.done}/{progress.total} · {pct}%
        </span>
      </div>
      <div className="meta-loading-track">
        <div className="meta-loading-fill" style={{ width: `${pct}%` }} />
      </div>
      {progress.current && (
        <p className="meta-loading-current mono">{t.meta.current}: {progress.current}</p>
      )}
    </div>
  );
}
