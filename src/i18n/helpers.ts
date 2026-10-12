import type { MergedApp } from '../types';
import type { RecommendationReason } from '../recommend';
import type { TranslationKey } from './translations';

export function categoryLabel(t: TranslationKey, id: string, fallback?: string): string {
  const cats = t.categories as Record<string, string>;
  return cats[id] ?? fallback ?? id;
}

export function profileLabel(
  t: TranslationKey,
  id: string,
  field: 'name' | 'description',
  fallback: string,
): string {
  const profiles = t.profiles as Record<string, { name: string; description: string }>;
  return profiles[id]?.[field] ?? fallback;
}

/** One line under a recommended app saying why it is there. */
export function reasonLabel(
  t: TranslationKey,
  reason: RecommendationReason,
  categories: Record<string, string>,
): string {
  switch (reason.kind) {
    case 'favorite':
      return t.recommend.favorite;
    case 'pairs':
      return t.recommend.pairs.replace('{name}', reason.withName);
    case 'category':
      return t.recommend.category.replace('{category}', categoryLabel(t, reason.category, categories[reason.category]));
    case 'editor':
      return reason.tag ?? t.recommend.editor;
    default:
      return t.recommend.popular;
  }
}

export function localeLabel(t: TranslationKey, locale: 'ru' | 'en'): string {
  return t.lang[locale];
}

export function appDescription(
  app: MergedApp,
  t: TranslationKey,
): { text: string; loading: boolean } {
  const text = app.enrichedDescription?.trim() || app.description?.trim();
  if (text) return { text, loading: false };
  if (app.metaPending) return { text: t.meta.loadingDescription, loading: true };
  return { text: t.app.noDescription, loading: false };
}

/** Curated GetBox catalog apps — full icons & descriptions. */
export function isStoreApp(app: MergedApp): boolean {
  return app.provider === 'catalog';
}
