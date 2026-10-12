import { useEffect, useRef, useState, useCallback } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { categoryLabel } from '../i18n/helpers';
import type { MergedApp, QueueJob } from '../types';
import { listIdentity, packageKey } from '../types';
import { CapsuleCard } from './CapsuleCard';

const PAGE_SIZE = 48;

/** Index packages have no curated category worth showing, so name their source instead. */
function metaLabel(
  app: MergedApp,
  t: Parameters<typeof categoryLabel>[0],
  categories: Record<string, string>,
): string | undefined {
  if (app.provider !== 'catalog') return app.provider;
  return app.category ? categoryLabel(t, app.category, categories[app.category]) : undefined;
}

interface PagedGridProps {
  apps: MergedApp[];
  categories: Record<string, string>;
  activeJobs?: Map<string, QueueJob>;
  onInstall: (app: MergedApp) => void;
  onRetry?: (app: MergedApp) => void;
  onCancel?: (jobId: string) => void;
  onOpen: (app: MergedApp) => void;
  onToggleFavorite: (app: MergedApp) => void;
  onVisibleChange?: (visibleApps: MergedApp[]) => void;
  /** Why each app is shown, keyed by packageKey. */
  reasons?: Map<string, string>;
}

export function PagedGrid({
  apps,
  categories,
  activeJobs,
  onInstall,
  onRetry,
  onCancel,
  onOpen,
  onToggleFavorite,
  onVisibleChange,
  reasons,
}: PagedGridProps) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const listIdRef = useRef(listIdentity(apps));
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const currentListId = listIdentity(apps);
    if (currentListId !== listIdRef.current) {
      listIdRef.current = currentListId;
      setPage(1);
    }
  }, [apps]);

  const visible = apps.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < apps.length;

  const loadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [visible, onVisibleChange]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div className="paged-grid-wrap">
      <div className="paged-grid">
        {visible.map((app) => (
          <CapsuleCard
            key={`${app.provider}:${app.id}`}
            app={app}
            categoryLabel={metaLabel(app, t, categories)}
            reason={reasons?.get(packageKey(app.provider, app.id))}
            job={activeJobs?.get(packageKey(app.provider, app.id))}
            onInstall={onInstall}
            onRetry={onRetry}
            onCancel={onCancel}
            onOpen={onOpen}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
        {hasMore && <div ref={sentinelRef} className="grid-sentinel" />}
      </div>
      {hasMore && (
        <button className="btn btn-secondary load-more-btn" onClick={loadMore}>
          {t.app.loadMore} ({apps.length - visible.length} {t.app.remaining})
        </button>
      )}
    </div>
  );
}
