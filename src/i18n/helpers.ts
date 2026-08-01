import type { MergedApp } from '../types';
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
