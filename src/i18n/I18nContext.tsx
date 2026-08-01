import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { translations, type Locale, type TranslationKey } from './translations';

interface I18nContextValue {
  locale: Locale;
  t: TranslationKey;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'ru',
  t: translations.ru,
});

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(
    () => ({ locale, t: translations[locale] }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
