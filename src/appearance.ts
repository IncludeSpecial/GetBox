import type { AppSettings, ThemeId } from './types';

export interface ThemePreview {
  id: ThemeId;
  /** Swatches for the gallery card: background, surface, text, accent. */
  bg: string;
  surface: string;
  text: string;
  accent: string;
}

export const THEMES: ThemePreview[] = [
  { id: 'classic', bg: '#0b1219', surface: '#1a2735', text: '#dfe7ee', accent: '#66c0f4' },
  { id: 'light', bg: '#eef2f6', surface: '#ffffff', text: '#14202b', accent: '#8b6cff' },
  { id: 'oled', bg: '#000000', surface: '#141414', text: '#e8e8e8', accent: '#2dd4bf' },
  { id: 'contrast', bg: '#000000', surface: '#000000', text: '#ffffff', accent: '#ffd400' },
  { id: 'mica', bg: '#dfe6f2', surface: '#f7f9fc', text: '#1b1b1f', accent: '#0067c0' },
];

export const ACCENT_PRESETS = ['#66c0f4', '#8b6cff', '#2dd4bf', '#7cb928', '#f59e0b', '#ef5da8', '#0067c0'];

export const UI_SCALES = [0.9, 1, 1.1, 1.25];

/** Picks black or white text for a solid accent background. */
function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.36 ? '#06131d' : '#ffffff';
}

/** Mirrors the appearance settings onto <html>; the stylesheet does the rest. */
export function applyAppearance(settings: Pick<AppSettings, 'theme' | 'accent'>, nativeMica: boolean): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.toggleAttribute('data-native-mica', settings.theme === 'mica' && nativeMica);
  // High contrast keeps its own yellow so focus and actions stay legible.
  if (settings.accent && settings.theme !== 'contrast') {
    const light = settings.theme === 'light' || settings.theme === 'mica';
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty(
      '--accent-hover',
      `color-mix(in srgb, ${settings.accent} 65%, ${light ? '#000' : '#fff'})`,
    );
    root.style.setProperty('--on-accent', onColor(settings.accent));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-hover');
    root.style.removeProperty('--on-accent');
  }
}
