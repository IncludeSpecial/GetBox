import { contextBridge, ipcRenderer } from 'electron';
import type { MergedApp, Package, QueueJob, SearchResult, AppSettings } from './providers/types.js';

export interface RuntimeToolInfo {
  status: string;
  ok: boolean;
  version?: string;
  message?: string;
  uacPending?: boolean;
}

export interface BootstrapStatus {
  state: {
    scoop: string;
    winget: string;
    chocolatey: string;
    completedAt?: number;
    chocoUacPending?: boolean;
    messages?: Record<string, string>;
  };
  complete: boolean;
  running: boolean;
  tools: {
    scoop: RuntimeToolInfo;
    winget: RuntimeToolInfo;
    chocolatey: RuntimeToolInfo;
  };
}

export interface MetaProgress {
  running: boolean;
  total: number;
  done: number;
  current?: string;
  completeness: number;
}

export interface GetBoxAPI {
  getCatalog: () => Promise<{ apps: MergedApp[]; categories: Record<string, string>; profiles: ProfileEntry[] }>;
  onCatalogDirty: (cb: () => void) => () => void;
  search: (query: string) => Promise<SearchResult>;
  enrichMeta: (items: Array<{ slug: string; wikiTitle?: string; logoSlug?: string }>) => Promise<unknown[]>;
  enrichPackages: (items: Array<{ provider: string; id: string; name: string }>) => Promise<void>;
  onPackageMeta: (cb: (updates: PackageMetaUpdate[]) => void) => () => void;
  prewarmMeta: () => Promise<{ ok: boolean; count: number; message?: string }>;
  getMetaCompleteness: () => Promise<number>;
  getMetaProgress: () => Promise<MetaProgress>;
  getQueue: () => Promise<QueueJob[]>;
  addToQueue: (provider: string, packageId: string, name: string) => Promise<void>;
  addManyToQueue: (items: Array<{ provider: string; packageId: string; name: string }>) => Promise<void>;
  clearDoneQueue: () => Promise<void>;
  clearAllQueue: () => Promise<void>;
  retryFailedQueue: () => Promise<void>;
  cancelQueueJob: (jobId: string) => Promise<boolean>;
  dismissQueueJob: (jobId: string) => Promise<boolean>;
  retryQueueJob: (jobId: string) => Promise<boolean>;
  onQueueUpdated: (cb: (jobs: QueueJob[]) => void) => () => void;
  rebuildIndex: () => Promise<{ ok: boolean; count: number; message?: string }>;
  onIndexProgress: (cb: (msg: string) => void) => () => void;
  onIndexDone: (cb: (count: number) => void) => () => void;
  getProvidersStatus: () => Promise<Array<{ id: string; displayName: string; ok: boolean; version?: string; message?: string }>>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  toggleFavorite: (provider: string, packageId: string) => Promise<boolean>;
  installProfile: (profileId: string) => Promise<{ ok: boolean; message: string }>;
  onToastError: (cb: (msg: string) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
  getBootstrapStatus: () => Promise<BootstrapStatus>;
  retryBootstrap: () => Promise<BootstrapStatus['state']>;
  approveChocolatey: () => Promise<BootstrapStatus['state']>;
  skipChocolatey: () => Promise<BootstrapStatus['state']>;
  onBootstrapProgress: (cb: (msg: string) => void) => () => void;
  onBootstrapDone: (cb: (state: BootstrapStatus['state']) => void) => () => void;
  onBootstrapError: (cb: (msg: string) => void) => () => void;
  onMetaProgress: (cb: (progress: MetaProgress) => void) => () => void;
  onMetaDone: (cb: () => void) => () => void;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  onWindowState: (cb: (state: { maximized: boolean }) => void) => () => void;
}

export interface PackageMetaUpdate {
  provider: string;
  id: string;
  description?: string;
  iconUrl?: string;
}

interface ProfileEntry {
  id: string;
  name: string;
  description: string;
  packages: Array<{ provider: string; packageId: string }>;
}

const api: GetBoxAPI = {
  getCatalog: () => ipcRenderer.invoke('catalog:get'),
  onCatalogDirty: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('catalog:onDirty', handler);
    return () => ipcRenderer.removeListener('catalog:onDirty', handler);
  },
  search: (query) => ipcRenderer.invoke('search:query', query),
  enrichMeta: (items) => ipcRenderer.invoke('meta:enrich', items),
  enrichPackages: (items) => ipcRenderer.invoke('meta:enrichPackages', items),
  onPackageMeta: (cb) => {
    const handler = (_: unknown, updates: PackageMetaUpdate[]) => cb(updates);
    ipcRenderer.on('meta:packages', handler);
    return () => ipcRenderer.removeListener('meta:packages', handler);
  },
  prewarmMeta: () => ipcRenderer.invoke('meta:prewarm'),
  getMetaCompleteness: () => ipcRenderer.invoke('meta:completeness'),
  getMetaProgress: () => ipcRenderer.invoke('meta:progress'),
  getQueue: () => ipcRenderer.invoke('queue:get'),
  addToQueue: (provider, packageId, name) => ipcRenderer.invoke('queue:add', provider, packageId, name),
  addManyToQueue: (items) => ipcRenderer.invoke('queue:addMany', items),
  clearDoneQueue: () => ipcRenderer.invoke('queue:clearDone'),
  clearAllQueue: () => ipcRenderer.invoke('queue:clearAll'),
  retryFailedQueue: () => ipcRenderer.invoke('queue:retryFailed'),
  cancelQueueJob: (jobId) => ipcRenderer.invoke('queue:cancel', jobId),
  dismissQueueJob: (jobId) => ipcRenderer.invoke('queue:dismiss', jobId),
  retryQueueJob: (jobId) => ipcRenderer.invoke('queue:retryJob', jobId),
  onQueueUpdated: (cb) => {
    const handler = (_: unknown, jobs: QueueJob[]) => cb(jobs);
    ipcRenderer.on('queue:updated', handler);
    return () => ipcRenderer.removeListener('queue:updated', handler);
  },
  rebuildIndex: () => ipcRenderer.invoke('index:rebuild'),
  onIndexProgress: (cb) => {
    const handler = (_: unknown, msg: string) => cb(msg);
    ipcRenderer.on('index:progress', handler);
    return () => ipcRenderer.removeListener('index:progress', handler);
  },
  onIndexDone: (cb) => {
    const handler = (_: unknown, count: number) => cb(count);
    ipcRenderer.on('index:done', handler);
    return () => ipcRenderer.removeListener('index:done', handler);
  },
  getProvidersStatus: () => ipcRenderer.invoke('providers:status'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  toggleFavorite: (provider, packageId) => ipcRenderer.invoke('favorites:toggle', provider, packageId),
  installProfile: (profileId) => ipcRenderer.invoke('profiles:install', profileId),
  onToastError: (cb) => {
    const handler = (_: unknown, msg: string) => cb(msg);
    ipcRenderer.on('toast:error', handler);
    return () => ipcRenderer.removeListener('toast:error', handler);
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getBootstrapStatus: () => ipcRenderer.invoke('bootstrap:status'),
  retryBootstrap: () => ipcRenderer.invoke('bootstrap:retry'),
  approveChocolatey: () => ipcRenderer.invoke('bootstrap:approveChoco'),
  skipChocolatey: () => ipcRenderer.invoke('bootstrap:skipChoco'),
  onBootstrapProgress: (cb) => {
    const handler = (_: unknown, msg: string) => cb(msg);
    ipcRenderer.on('bootstrap:progress', handler);
    return () => ipcRenderer.removeListener('bootstrap:progress', handler);
  },
  onBootstrapDone: (cb) => {
    const handler = (_: unknown, state: BootstrapStatus['state']) => cb(state);
    ipcRenderer.on('bootstrap:done', handler);
    return () => ipcRenderer.removeListener('bootstrap:done', handler);
  },
  onBootstrapError: (cb) => {
    const handler = (_: unknown, msg: string) => cb(msg);
    ipcRenderer.on('bootstrap:error', handler);
    return () => ipcRenderer.removeListener('bootstrap:error', handler);
  },
  onMetaProgress: (cb) => {
    const handler = (_: unknown, progress: MetaProgress) => cb(progress);
    ipcRenderer.on('meta:progress', handler);
    return () => ipcRenderer.removeListener('meta:progress', handler);
  },
  onMetaDone: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('meta:done', handler);
    return () => ipcRenderer.removeListener('meta:done', handler);
  },
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowState: (cb) => {
    const handler = (_: unknown, state: { maximized: boolean }) => cb(state);
    ipcRenderer.on('window:state', handler);
    return () => ipcRenderer.removeListener('window:state', handler);
  },
};

contextBridge.exposeInMainWorld('getbox', api);

declare global {
  interface Window {
    getbox: GetBoxAPI;
  }
}

export type { MergedApp, Package, QueueJob, SearchResult, AppSettings };
