import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { categoryLabel } from '../i18n/helpers';
import type { MergedApp, QueueJob } from '../types';
import { packageKey } from '../types';
import { CapsuleCard } from './CapsuleCard';
import { IconChevronLeft, IconChevronRight } from './Icons';

interface ShelfRowProps {
  title: string;
  apps: MergedApp[];
  categories: Record<string, string>;
  activeJobs?: Map<string, QueueJob>;
  onInstall: (app: MergedApp) => void;
  onOpen: (app: MergedApp) => void;
  onToggleFavorite: (app: MergedApp) => void;
  onSeeAll?: () => void;
}

export function ShelfRow({ title, apps, categories, activeJobs, onInstall, onOpen, onToggleFavorite, onSeeAll }: ShelfRowProps) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const syncArrows = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    syncArrows();
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(syncArrows);
    observer.observe(el);
    return () => observer.disconnect();
  }, [syncArrows, apps.length]);

  const scrollBy = (direction: -1 | 1) => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth - 80, 200), behavior: 'smooth' });
  };

  if (apps.length === 0) return null;

  return (
    <section className="shelf">
      <div className="shelf-header">
        <h3 className="shelf-title">{title}</h3>
        <span className="shelf-count mono">{apps.length}</span>
        <div className="shelf-spacer" />
        <button
          className="shelf-arrow"
          onClick={() => scrollBy(-1)}
          disabled={atStart}
          aria-label={t.shelf.scrollLeft}
        >
          <IconChevronLeft size={14} />
        </button>
        <button
          className="shelf-arrow"
          onClick={() => scrollBy(1)}
          disabled={atEnd}
          aria-label={t.shelf.scrollRight}
        >
          <IconChevronRight size={14} />
        </button>
        {onSeeAll && (
          <button className="btn btn-ghost btn-sm" onClick={onSeeAll}>
            {t.app.seeAll}
          </button>
        )}
      </div>
      <div className="shelf-viewport" ref={viewportRef} onScroll={syncArrows}>
        {apps.slice(0, 16).map((app) => (
          <CapsuleCard
            key={`${app.provider}:${app.id}`}
            app={app}
            categoryLabel={app.category ? categoryLabel(t, app.category, categories[app.category]) : undefined}
            job={activeJobs?.get(packageKey(app.provider, app.id))}
            onInstall={onInstall}
            onOpen={onOpen}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </section>
  );
}
