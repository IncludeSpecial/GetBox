import path from 'node:path';
import { app } from 'electron';
import { APP_NAME } from './providers/types.js';

export function getAppDataDir(): string {
  const localAppData = process.env.LOCALAPPDATA || app.getPath('userData');
  return path.join(localAppData, APP_NAME);
}

export function getDataDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'data');
  }
  return path.join(app.getAppPath(), 'data');
}

export function getMetaDir(): string {
  return path.join(getAppDataDir(), 'web-meta');
}

export function getImagesDir(): string {
  return path.join(getAppDataDir(), 'web-images');
}

export function getBundledIconsDir(): string {
  return path.join(getDataDir(), 'icons');
}

export function getSearchCacheDir(): string {
  return path.join(getAppDataDir(), 'search-cache');
}

export function getIndexPath(): string {
  return path.join(getAppDataDir(), 'package-index.json');
}
