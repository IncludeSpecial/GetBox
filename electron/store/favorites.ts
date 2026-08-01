import Store from 'electron-store';
import { packageKey } from '../providers/types.js';
import { invalidateCatalog } from '../catalog/merge.js';

const store = new Store<{ favorites: string[] }>({
  name: 'getbox-favorites',
  defaults: { favorites: [] },
});

export function getFavorites(): Set<string> {
  return new Set(store.get('favorites'));
}

export function toggleFavorite(provider: string, packageId: string): boolean {
  const key = packageKey(provider, packageId);
  const favs = getFavorites();
  if (favs.has(key)) {
    favs.delete(key);
  } else {
    favs.add(key);
  }
  store.set('favorites', [...favs]);
  invalidateCatalog('favorites');
  return favs.has(key);
}

export function isFavorite(provider: string, packageId: string): boolean {
  return getFavorites().has(packageKey(provider, packageId));
}
