import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MergedApp, ProfileEntry, QueueJob, SearchResult, ViewMode, AppSettings, ListView, UpdatesState, SelfUpdateState } from './types';
import { packageKey } from './types';
import { I18nProvider } from './i18n/I18nContext';
import { translations, type Locale } from './i18n/translations';
import { categoryLabel, profileLabel, reasonLabel } from './i18n/helpers';
import { buildRecommender, type RelatedData } from './recommend';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { HeroBanner } from './components/HeroBanner';
import { TabBar, type TabDescriptor } from './components/TabBar';
import { ShelfRow } from './components/ShelfRow';
import { PagedGrid } from './components/PagedGrid';
import { QueuePanel } from './components/QueuePanel';
import { AppModal } from './components/AppModal';
import { EmptyState } from './components/EmptyState';
import { ProviderBanner } from './components/ProviderBanner';
import { BootstrapOverlay } from './components/BootstrapOverlay';
import { MetaLoadingBar } from './components/MetaLoadingBar';
import { ToastContainer } from './components/Toast';
import { ViewSwitcher } from './components/ViewSwitcher';
import { UpdatesView } from './components/UpdatesView';
import { SelfUpdateButton } from './components/SelfUpdateButton';
import { WhatsNew, notesFor } from './components/WhatsNew';
import { AppUpdateSettings } from './components/AppUpdateSettings';

/** -1 / 0 / 1 for dotted versions; enough for «is this a newer GetBox». */
function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map(Number), pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return Math.sign((pa[i] || 0) - (pb[i] || 0));
  return 0;
}
import { AppearanceSettings } from './components/AppearanceSettings';
import { applyAppearance } from './appearance';
import type { MetaProgress } from './types';
import { isStoreApp } from './i18n/helpers';

type BootstrapTools = {
  scoop: { status: string; ok: boolean; version?: string; message?: string; uacPending?: boolean };
  winget: { status: string; ok: boolean; version?: string; message?: string; uacPending?: boolean };
  chocolatey: { status: string; ok: boolean; version?: string; message?: string; uacPending?: boolean };
};

export default function App() {
  const [view, setView] = useState<ViewMode>('home');
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [apps, setApps] = useState<MergedApp[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [profiles, setProfiles] = useState<ProfileEntry[]>([]);
  const [related, setRelated] = useState<RelatedData>({ stacks: [], alternatives: [] });
  const [providers, setProviders] = useState<Array<{ id: string; displayName: string; ok: boolean; version?: string; message?: string }>>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [nativeMica, setNativeMica] = useState(false);
  const [selfUpdate, setSelfUpdate] = useState<SelfUpdateState | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [whatsNew, setWhatsNew] = useState<{ version: string; previous?: string } | null>(null);
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [searchBadge, setSearchBadge] = useState<string | undefined>();
  const [queueJobs, setQueueJobs] = useState<QueueJob[]>([]);
  const [updatesState, setUpdatesState] = useState<UpdatesState>({ items: [], checking: false, history: [] });
  const [queueOpen, setQueueOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState<MergedApp | null>(null);
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'error' | 'info' }>>([]);
  const [bootstrapRunning, setBootstrapRunning] = useState(false);
  const [bootstrapVisible, setBootstrapVisible] = useState(false);
  const [bootstrapProgress, setBootstrapProgress] = useState<string | undefined>();
  const [bootstrapTools, setBootstrapTools] = useState<BootstrapTools>({
    scoop: { status: 'pending', ok: false },
    winget: { status: 'pending', ok: false },
    chocolatey: { status: 'pending', ok: false },
  });
  const [metaProgress, setMetaProgress] = useState<MetaProgress | null>(null);
  const [indexBuilding, setIndexBuilding] = useState(false);
  const [indexStatus, setIndexStatus] = useState<string | undefined>();
  const [packageFilter, setPackageFilter] = useState('');
  const enrichTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addToast = useCallback((message: string, type: 'error' | 'info' = 'info') => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const locale: Locale = settings?.language ?? 'ru';
  const t = translations[locale];
  const storeApps = apps.filter(isStoreApp);
  // Everything the providers discovered: no curated icons or copy, but thousands of entries.
  const indexApps = apps.filter((a) => !isStoreApp(a));

  // Read inside callbacks that must stay stable: the mount effect subscribes to
  // IPC events and must not tear down and resubscribe on every language switch.
  const tRef = useRef(t);
  tRef.current = t;

  const loadCatalog = useCallback(async () => {
    try {
      const data = await window.getbox.getCatalog() as {
        apps: MergedApp[];
        categories: Record<string, string>;
        profiles: ProfileEntry[];
        related?: RelatedData;
        error?: string;
      };
      setApps(data.apps ?? []);
      setCategories(data.categories ?? {});
      setProfiles(data.profiles ?? []);
      setRelated(data.related ?? { stacks: [], alternatives: [] });
      if (data.error) addToast(`${tRef.current.nav.catalog}: ${data.error}`, 'error');
    } catch (err) {
      addToast(err instanceof Error ? err.message : tRef.current.toast.catalogError, 'error');
    }
  }, [addToast]);

  const loadProviders = useCallback(async () => {
    try {
      const status = await window.getbox.getProvidersStatus();
      setProviders(status);
    } catch {
      setProviders([]);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const s = await window.getbox.getSettings();
      setSettings(s);
    } catch {
      setSettings(null);
    }
  }, []);

  const patchSettings = useCallback(async (partial: Partial<AppSettings>) => {
    const s = await window.getbox.updateSettings(partial);
    setSettings(s);
  }, []);

  useEffect(() => {
    window.getbox.windowNativeMica().then(setNativeMica, () => setNativeMica(false));
    window.getbox.getAppVersion().then(setAppVersion, () => {});
    window.getbox.getSelfUpdate().then(setSelfUpdate, () => {});
    setTitleSlot(document.getElementById('titlebar-slot'));
    return window.getbox.onSelfUpdateChanged(setSelfUpdate);
  }, []);

  // «Что нового»: once per version after an update; a fresh install just remembers its version.
  const seenChecked = useRef(false);
  useEffect(() => {
    if (!settings || !appVersion || seenChecked.current) return;
    seenChecked.current = true;
    const last = settings.lastSeenVersion;
    if (last && compareVersions(appVersion, last) > 0 && notesFor(appVersion)) {
      setWhatsNew({ version: appVersion, previous: last });
    } else if (last !== appVersion) {
      void window.getbox.updateSettings({ lastSeenVersion: appVersion }).then(setSettings);
    }
  }, [settings, appVersion]);

  const closeWhatsNew = useCallback(() => {
    setWhatsNew(null);
    if (appVersion) void window.getbox.updateSettings({ lastSeenVersion: appVersion }).then(setSettings);
  }, [appVersion]);
  const showWhatsNew = useCallback(() => {
    if (appVersion && notesFor(appVersion)) setWhatsNew({ version: appVersion });
  }, [appVersion]);

  useEffect(() => {
    if (settings) applyAppearance(settings, nativeMica);
  }, [settings, nativeMica]);

  const listView: ListView = settings?.listView ?? 'cards';

  const loadBootstrap = useCallback(async () => {
    try {
      const status = await window.getbox.getBootstrapStatus();
      setBootstrapRunning(status.running);
      setBootstrapTools(status.tools);
      setBootstrapVisible(!status.complete || !!status.state.chocoUacPending);
    } catch {
      // bootstrap optional in dev without preload
    }
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const jobs = await window.getbox.getQueue();
      setQueueJobs(jobs);
    } catch {
      setQueueJobs([]);
    }
  }, []);

  const enrichVisible = useCallback((visibleApps: MergedApp[]) => {
    if (enrichTimer.current) clearTimeout(enrichTimer.current);
    enrichTimer.current = setTimeout(async () => {
      // Provider packages are resolved one CLI call at a time in the main
      // process, so they are handed over as a fire-and-forget request.
      const packages = visibleApps.filter(
        (a) => a.provider !== 'catalog' && !a.metaPending && (!a.iconUrl || !a.enrichedDescription),
      );
      if (packages.length > 0) {
        window.getbox
          .enrichPackages(packages.map((a) => ({ provider: a.provider, id: a.id, name: a.name })))
          .catch(() => {});
        const requested = new Set(packages.map((a) => packageKey(a.provider, a.id)));
        setApps((prev) =>
          prev.map((a) =>
            requested.has(packageKey(a.provider, a.id)) ? { ...a, metaPending: true } : a,
          ),
        );
      }

      const needsEnrich = visibleApps.filter(
        (a) => (!a.iconUrl || !a.enrichedDescription) && (a.wikiTitle || a.logoSlug),
      );
      if (needsEnrich.length === 0) return;
      try {
        const chunk = needsEnrich.slice(0, 20).map((a) => ({
          slug: a.curatedId ?? a.id,
          wikiTitle: a.wikiTitle,
          logoSlug: a.logoSlug,
          description: a.description,
        }));
        const enriched = (await window.getbox.enrichMeta(chunk)) as Array<{
          slug: string;
          description?: string;
          iconUrl?: string;
        }>;
        setApps((prev) =>
          prev.map((app) => {
            const match = enriched.find(
              (e) => e.slug === (app.curatedId ?? app.id) || e.slug === app.logoSlug || e.slug === app.id,
            );
            if (!match) return app;
            return {
              ...app,
              enrichedDescription: match.description ?? app.enrichedDescription,
              iconUrl: match.iconUrl ?? app.iconUrl,
            };
          }),
        );
      } catch {
        // enrich optional
      }
    }, 200);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadCatalog(), loadProviders(), loadSettings(), loadQueue(), loadBootstrap()]);
        try {
          const mp = await window.getbox.getMetaProgress();
          setMetaProgress(mp);
        } catch {
          // optional
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubDirty = window.getbox.onCatalogDirty(() => loadCatalog());
    const unsubQueue = window.getbox.onQueueUpdated((jobs) => setQueueJobs(jobs));
    window.getbox.getUpdates().then(setUpdatesState, () => {});
    const unsubUpdates = window.getbox.onUpdatesChanged(setUpdatesState);
    const unsubToast = window.getbox.onToastError((msg) => addToast(msg, 'error'));
    const unsubIndex = window.getbox.onIndexProgress((msg) => {
      setIndexBuilding(true);
      setIndexStatus(msg);
    });
    const unsubPackageMeta = window.getbox.onPackageMeta((updates) => {
      setApps((prev) =>
        prev.map((app) => {
          const match = updates.find((u) => u.provider === app.provider && u.id === app.id);
          if (!match) return app;
          return {
            ...app,
            enrichedDescription: match.description ?? app.enrichedDescription,
            iconUrl: match.iconUrl ?? app.iconUrl,
            metaPending: false,
          };
        }),
      );
    });
    const unsubIndexDone = window.getbox.onIndexDone(() => {
      setIndexBuilding(false);
      setIndexStatus(undefined);
    });
    const unsubBootstrapProgress = window.getbox.onBootstrapProgress((msg) => {
      setBootstrapProgress(msg);
      setBootstrapRunning(true);
      setBootstrapVisible(true);
    });
    const unsubBootstrapDone = window.getbox.onBootstrapDone(() => {
      setBootstrapRunning(false);
      setBootstrapProgress(undefined);
      loadBootstrap();
      loadProviders();
    });
    const unsubBootstrapError = window.getbox.onBootstrapError((msg) => {
      setBootstrapRunning(false);
      addToast(msg, 'error');
      loadBootstrap();
      loadProviders();
    });
    const unsubMetaProgress = window.getbox.onMetaProgress((progress) => {
      setMetaProgress(progress);
      if (progress.running) loadCatalog();
    });
    const unsubMetaDone = window.getbox.onMetaDone(() => {
      setMetaProgress((p) => (p ? { ...p, running: false, done: p.total } : null));
      loadCatalog();
    });

    return () => {
      cancelled = true;
      unsubDirty();
      unsubQueue();
      unsubUpdates();
      unsubToast();
      unsubIndex();
      unsubIndexDone();
      unsubPackageMeta();
      unsubBootstrapProgress();
      unsubBootstrapDone();
      unsubBootstrapError();
      unsubMetaProgress();
      unsubMetaDone();
    };
  }, [loadCatalog, loadProviders, loadSettings, loadQueue, loadBootstrap, addToast]);

  useEffect(() => {
    if (loading || storeApps.length === 0) return;
    enrichVisible(storeApps.slice(0, 40));
    // storeApps is a fresh array every render; its length is the change worth reacting to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, storeApps.length, enrichVisible]);

  const handleInstall = useCallback(async (app: MergedApp) => {
    try {
      await window.getbox.addToQueue(app.provider, app.id, app.name);
      setQueueOpen(true);
    } catch (err) {
      addToast(err instanceof Error ? err.message : t.toast.queueError, 'error');
    }
  }, [addToast, t]);

  const handleCancelJob = useCallback((jobId: string) => {
    void window.getbox.cancelQueueJob(jobId);
  }, []);

  const handleRetryJob = useCallback(
    (app: MergedApp) => {
      const key = packageKey(app.provider, app.id);
      const job = queueJobs.find(
        (j) =>
          packageKey(j.provider, j.packageId) === key &&
          (j.status === 'failed' || j.status === 'cancelled'),
      );
      if (job) {
        void window.getbox.retryQueueJob(job.id);
        setQueueOpen(true);
        return;
      }
      void handleInstall(app);
    },
    [queueJobs, handleInstall],
  );

  const handleToggleFavorite = useCallback(async (app: MergedApp) => {
    try {
      const isFav = await window.getbox.toggleFavorite(app.provider, app.id);
      setApps((prev) =>
        prev.map((a) =>
          a.provider === app.provider && a.id === app.id ? { ...a, isFavorite: isFav } : a,
        ),
      );
      if (selectedApp?.provider === app.provider && selectedApp.id === app.id) {
        setSelectedApp((s) => s ? { ...s, isFavorite: isFav } : null);
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : t.toast.favoriteError, 'error');
    }
  }, [selectedApp, addToast, t]);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      setSearchBadge(undefined);
      setView('home');
      return;
    }
    try {
      const result = await window.getbox.search(query);
      setSearchResults(result);
      setView('search');
      if (result.fromCache && result.stale) {
        setSearchBadge(t.search.stale);
      } else if (result.fromCache) {
        setSearchBadge(t.search.fromCache);
      } else {
        setSearchBadge(undefined);
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : t.toast.searchError, 'error');
    }
  }, [addToast, t]);

  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => handleSearch(q), 400);
  }, [handleSearch]);

  const handleNavigate = useCallback((v: ViewMode, category?: string) => {
    setView(v);
    setSelectedCategory(category);
    if (v !== 'search') {
      setSearchQuery('');
      setSearchResults(null);
      setSearchBadge(undefined);
    }
  }, []);

  const handleRebuildIndex = useCallback(async () => {
    setIndexBuilding(true);
    try {
      const r = await window.getbox.rebuildIndex();
      addToast(r.message ?? `${tRef.current.nav.packages}: ${r.count}`);
      await loadCatalog();
    } catch (err) {
      addToast(err instanceof Error ? err.message : tRef.current.toast.catalogError, 'error');
    } finally {
      setIndexBuilding(false);
      setIndexStatus(undefined);
    }
  }, [addToast, loadCatalog]);

  const handleRefresh = useCallback(async () => {
    await loadCatalog();
    await loadProviders();
    addToast(t.toast.updated);
  }, [loadCatalog, loadProviders, addToast, t]);

  const handleDisableProvider = useCallback(async (providerId: string) => {
    if (!settings) return;
    const next = settings.enabledProviders.filter((p) => p !== providerId);
    const s = await window.getbox.updateSettings({ enabledProviders: next });
    setSettings(s);
    await loadProviders();
    addToast(`${providerId === 'scoop' ? 'Scoop' : providerId} ${t.toast.disabled}`, 'info');
  }, [settings, addToast, loadProviders, t]);

  const handleRetryBootstrap = useCallback(async () => {
    try {
      setBootstrapRunning(true);
      setBootstrapVisible(true);
      await window.getbox.retryBootstrap();
      await loadProviders();
      await loadBootstrap();
      addToast(t.toast.bootstrapRetry, 'info');
    } catch (err) {
      addToast(err instanceof Error ? err.message : t.toast.bootstrapError, 'error');
    }
  }, [addToast, loadProviders, loadBootstrap, t]);

  const handleInstallProfile = useCallback(async (profileId: string) => {
    try {
      const result = await window.getbox.installProfile(profileId);
      addToast(result.message, result.ok ? 'info' : 'error');
      setQueueOpen(true);
    } catch (err) {
      addToast(err instanceof Error ? err.message : t.toast.profileError, 'error');
    }
  }, [addToast, t]);

  const handleLanguageChange = useCallback(async (lang: Locale) => {
    if (settings?.language === lang) return;
    const s = await window.getbox.updateSettings({ language: lang });
    setSettings(s);
    await loadCatalog();
  }, [settings, loadCatalog]);

  const recommender = useMemo(() => buildRecommender(apps, related, profiles), [apps, related, profiles]);
  const recommendations = useMemo(() => recommender.forYou(60), [recommender]);
  const reasonByKey = useMemo(
    () => new Map(recommendations.map((r) => [packageKey(r.app.provider, r.app.id), reasonLabel(t, r.reason, categories)])),
    [recommendations, t, categories],
  );

  const getFilteredApps = (): MergedApp[] => {
    switch (view) {
      case 'catalog':
        return selectedCategory
          ? storeApps.filter((a) => a.category === selectedCategory)
          : storeApps;
      case 'packages': {
        const q = packageFilter.trim().toLowerCase();
        const list = q
          ? indexApps.filter((a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
          : indexApps;
        return [...list].sort((a, b) => a.name.localeCompare(b.name));
      }
      case 'recommended':
        return recommendations.map((r) => r.app);
      case 'favorites':
        return apps.filter((a) => a.isFavorite);
      case 'installed':
        return apps.filter((a) => a.isInstalled);
      case 'search':
        if (!searchResults) return [];
        return searchResults.results.map((r) => {
          const existing = apps.find((a) => a.provider === r.provider && a.id === r.id);
          return existing ?? { ...r, isInstalled: false, isFavorite: false } as MergedApp;
        });
      default:
        return storeApps;
    }
  };

  const filteredApps = getFilteredApps();
  const forYouTitle = recommender.personalized ? t.recommend.forYou : t.recommend.startHere;
  const forYouHint = recommender.personalized ? t.recommend.forYouHint : t.recommend.startHereHint;
  const heroPool = storeApps.filter((a) => a.pickTag || a.recommended).slice(0, 5);
  const featured = heroPool.find((a) => a.id === featuredId) ?? heroPool[0] ?? storeApps[0];
  const activeQueueJobs = queueJobs.filter((j) => j.status === 'pending' || j.status === 'running');
  const activeQueueCount = activeQueueJobs.length;
  // Latest job per package for surface UI (includes failed so Retry is visible on cards).
  const activeJobs = new Map<string, QueueJob>();
  for (const j of queueJobs) {
    if (j.status === 'pending' || j.status === 'running' || j.status === 'failed') {
      activeJobs.set(packageKey(j.provider, j.packageId), j);
    }
  }
  const runningPercent = activeQueueJobs.find((j) => j.status === 'running')?.progress?.percent;
  const categoryCounts = storeApps.reduce<Record<string, number>>((acc, app) => {
    if (app.category) acc[app.category] = (acc[app.category] ?? 0) + 1;
    return acc;
  }, {});
  const shelfCategories = Object.keys(categories).filter((id) => (categoryCounts[id] ?? 0) > 0);

  const tabs: TabDescriptor[] = [
    { id: 'home', label: t.nav.home },
    { id: 'catalog', label: t.nav.catalog, count: storeApps.length },
    { id: 'packages', label: t.nav.packages, count: indexApps.length },
    { id: 'recommended', label: t.nav.recommended },
    { id: 'favorites', label: t.nav.favorites, count: apps.filter((a) => a.isFavorite).length },
    { id: 'installed', label: t.nav.installed, count: apps.filter((a) => a.isInstalled).length },
    { id: 'updates', label: t.nav.updates, count: updatesState.items.length, highlight: true },
  ];

  return (
    <I18nProvider locale={locale}>
    <div className="app-shell">
      <Sidebar
        view={view}
        categories={categories}
        categoryCounts={categoryCounts}
        providers={providers}
        enabledProviderIds={settings?.enabledProviders ?? ['catalog']}
        bootstrapRunning={bootstrapRunning}
        onNavigate={handleNavigate}
        onRefresh={handleRefresh}
        selectedCategory={selectedCategory}
      />
      <div className={`main-area${queueOpen ? ' with-queue' : ''}`}>
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onSearchSubmit={() => handleSearch(searchQuery)}
          searchBadge={searchBadge}
          queueCount={activeQueueCount}
          queueOpen={queueOpen}
          queuePercent={queueOpen ? undefined : runningPercent}
          onToggleQueue={() => setQueueOpen((o) => !o)}
          language={locale}
          onLanguageChange={handleLanguageChange}
        />
        <TabBar tabs={tabs} active={view} onSelect={(v) => handleNavigate(v)} />
        <main className="content-area">
          {loading ? (
            <div className="content-skeleton">
              <div className="skeleton-hero" />
              <div className="skeleton-row">
                {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton-card" />)}
              </div>
            </div>
          ) : (
            <>
              <ProviderBanner
                providers={providers}
                enabledIds={settings?.enabledProviders ?? ['catalog']}
                bootstrapRunning={bootstrapRunning}
                onDisableProvider={handleDisableProvider}
                onRetryBootstrap={handleRetryBootstrap}
              />

              <MetaLoadingBar progress={metaProgress} />

              {view === 'home' && (
                <>
                  {featured ? (
                    <HeroBanner
                      featured={featured}
                      related={heroPool}
                      job={activeJobs.get(packageKey(featured.provider, featured.id))}
                      onInstall={handleInstall}
                      onRetry={handleRetryJob}
                      onCancel={handleCancelJob}
                      onOpen={setSelectedApp}
                      onSelect={(app) => setFeaturedId(app.id)}
                    />
                  ) : (
                    <EmptyState view="home" />
                  )}
                  <ShelfRow
                    title={forYouTitle}
                    hint={forYouHint}
                    apps={recommendations.slice(0, 12).map((r) => r.app)}
                    reasons={reasonByKey}
                    categories={categories}
                    activeJobs={activeJobs}
                    onInstall={handleInstall}
                    onRetry={handleRetryJob}
                    onCancel={handleCancelJob}
                    onOpen={setSelectedApp}
                    onToggleFavorite={handleToggleFavorite}
                    onSeeAll={() => handleNavigate('recommended')}
                  />
                  {profiles.length > 0 && (
                    <section className="profiles-section">
                      <h3 className="section-title">{t.hero.profiles}</h3>
                      <div className="profiles-grid">
                        {profiles.map((p) => (
                          <div key={p.id} className="profile-card">
                            <h4>{profileLabel(t, p.id, 'name', p.name)}</h4>
                            <p>{profileLabel(t, p.id, 'description', p.description)}</p>
                            <button className="btn btn-primary btn-sm" onClick={() => handleInstallProfile(p.id)}>
                              {t.hero.installSet} ({p.packages.length})
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                  {shelfCategories.map((catId) => (
                    <ShelfRow
                      key={catId}
                      title={categoryLabel(t, catId, categories[catId])}
                      apps={storeApps.filter((a) => a.category === catId)}
                      categories={categories}
                      activeJobs={activeJobs}
                      onInstall={handleInstall}
                      onRetry={handleRetryJob}
                      onCancel={handleCancelJob}
                      onOpen={setSelectedApp}
                      onToggleFavorite={handleToggleFavorite}
                      onSeeAll={() => handleNavigate('catalog', catId)}
                    />
                  ))}
                </>
              )}

              {view === 'settings' && settings && (
                <div className="settings-section">
                  <AppearanceSettings settings={settings} onChange={patchSettings} />
                  <AppUpdateSettings settings={settings} state={selfUpdate} onChange={patchSettings} onShowWhatsNew={showWhatsNew} />
                  <h2 className="page-title">{t.settings.title}</h2>
                  <div className="setting-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.quietInstall}
                        onChange={async (e) => {
                          const s = await window.getbox.updateSettings({ quietInstall: e.target.checked });
                          setSettings(s);
                        }}
                      />
                      {t.settings.quietInstall}
                    </label>
                  </div>
                  <div className="setting-row setting-row--lang">
                    <span>{t.settings.language}</span>
                    <div className="lang-switch lang-switch--settings">
                      {(['ru', 'en'] as const).map((lang) => (
                        <button
                          key={lang}
                          type="button"
                          className={`lang-btn${settings.language === lang ? ' active' : ''}`}
                          onClick={() => handleLanguageChange(lang)}
                        >
                          {lang === 'ru' ? t.lang.ru : t.lang.en}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(['catalog', 'scoop', 'winget', 'chocolatey'] as const).map((pid) => (
                    <div key={pid} className="setting-row">
                      <label>
                        <input
                          type="checkbox"
                          checked={settings.enabledProviders.includes(pid)}
                          onChange={async (e) => {
                            const next = e.target.checked
                              ? [...settings.enabledProviders, pid]
                              : settings.enabledProviders.filter((p) => p !== pid);
                            const s = await window.getbox.updateSettings({ enabledProviders: next });
                            setSettings(s);
                          }}
                        />
                        <span className="mono">{pid}</span>
                      </label>
                    </div>
                  ))}
                  <div className="setting-row">
                    <span>{t.settings.remoteCatalog}</span>
                    <input
                      type="text"
                      className="mono"
                      placeholder="https://…"
                      defaultValue={settings.remoteCatalogUrl ?? ''}
                      onBlur={async (e) => {
                        const s = await window.getbox.updateSettings({ remoteCatalogUrl: e.target.value || undefined });
                        setSettings(s);
                      }}
                    />
                  </div>
                  <div className="settings-actions">
                    <button
                      className="btn btn-secondary"
                      onClick={async () => {
                        const r = await window.getbox.rebuildIndex();
                        addToast(r.message ?? `Индекс: ${r.count} пакетов`);
                        await loadCatalog();
                      }}
                    >
                      {t.settings.rebuildIndex}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={async () => {
                        const r = await window.getbox.prewarmMeta();
                        addToast(r.message ?? `Meta: ${r.count}`);
                        const mp = await window.getbox.getMetaProgress();
                        setMetaProgress(mp);
                        await loadCatalog();
                      }}
                    >
                      {t.settings.prewarmMeta}
                    </button>
                  </div>
                </div>
              )}

              {view === 'updates' && settings && (
                <UpdatesView
                  state={updatesState}
                  apps={apps}
                  jobs={queueJobs}
                  settings={settings}
                  onCheck={() => void window.getbox.checkUpdates().catch(() => addToast(t.toast.updatesError, 'error'))}
                  onUpgrade={(keys) => {
                    void window.getbox.upgradePackages(keys.map(({ provider, packageId }) => ({ provider, packageId })));
                    setQueueOpen(true);
                  }}
                  onRollback={(id) => {
                    void window.getbox.rollbackUpdate(id);
                    setQueueOpen(true);
                  }}
                  onClearHistory={() => void window.getbox.clearUpdateHistory()}
                  onOpen={setSelectedApp}
                  onSettingsChange={(partial) => void patchSettings(partial)}
                />
              )}

              {view !== 'home' && view !== 'settings' && view !== 'updates' && (
                <>
                  {view === 'catalog' && (
                    <h2 className="page-title">
                      {selectedCategory ? categoryLabel(t, selectedCategory, categories[selectedCategory]) : t.nav.catalog}
                      <span className="page-count mono">{filteredApps.length} {t.app.programs}</span>
                    </h2>
                  )}
                  {view === 'packages' && (
                    <div className="packages-header">
                      <h2 className="page-title">
                        {t.nav.packages}
                        <span className="page-count mono">{filteredApps.length} {t.packages.count}</span>
                      </h2>
                      <p className="packages-hint">{t.packages.hint}</p>
                      <div className="packages-toolbar">
                        <input
                          type="search"
                          className="packages-filter"
                          placeholder={t.packages.filter}
                          value={packageFilter}
                          onChange={(e) => setPackageFilter(e.target.value)}
                        />
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={handleRebuildIndex}
                          disabled={indexBuilding}
                        >
                          {indexBuilding ? t.packages.building : t.packages.rebuild}
                        </button>
                      </div>
                      {indexBuilding && indexStatus && (
                        <div className="packages-status">
                          <span className="desc-spinner" aria-hidden />
                          {indexStatus}
                        </div>
                      )}
                    </div>
                  )}
                  {view === 'recommended' && (
                    <>
                      <h2 className="page-title">{forYouTitle}</h2>
                      <p className="page-hint">{forYouHint}</p>
                    </>
                  )}
                  {view === 'favorites' && <h2 className="page-title">{t.nav.favorites}</h2>}
                  {view === 'installed' && <h2 className="page-title">{t.nav.installed}</h2>}
                  {view === 'search' && <h2 className="page-title">{t.search.results}</h2>}

                  {filteredApps.length > 0 && (
                    <div className="list-toolbar">
                      <ViewSwitcher value={listView} onChange={(v) => void patchSettings({ listView: v })} />
                    </div>
                  )}

                  {filteredApps.length === 0 ? (
                    view === 'packages' && packageFilter.trim() ? (
                      <div className="empty-state empty-state--compact">
                        <p>{t.packages.nothingFound}</p>
                      </div>
                    ) : (
                      <EmptyState view={view} />
                    )
                  ) : (
                    <PagedGrid
                      apps={filteredApps}
                      categories={categories}
                      activeJobs={activeJobs}
                      onInstall={handleInstall}
                      onRetry={handleRetryJob}
                      onCancel={handleCancelJob}
                      onOpen={setSelectedApp}
                      onToggleFavorite={handleToggleFavorite}
                      onVisibleChange={enrichVisible}
                      reasons={view === 'recommended' ? reasonByKey : undefined}
                      layout={listView}
                    />
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>

      <QueuePanel
        open={queueOpen}
        jobs={queueJobs}
        onClose={() => setQueueOpen(false)}
        onClearDone={() => window.getbox.clearDoneQueue()}
        onClearAll={() => window.getbox.clearAllQueue()}
        onRetryFailed={() => window.getbox.retryFailedQueue()}
        onCancel={handleCancelJob}
        onRetry={(jobId) => void window.getbox.retryQueueJob(jobId)}
        onDismiss={(jobId) => void window.getbox.dismissQueueJob(jobId)}
      />

      {selectedApp && (
        <AppModal
          app={selectedApp}
          job={activeJobs.get(packageKey(selectedApp.provider, selectedApp.id))}
          onClose={() => setSelectedApp(null)}
          onInstall={handleInstall}
          onRetry={handleRetryJob}
          onCancel={handleCancelJob}
          onToggleFavorite={handleToggleFavorite}
          pairs={recommender.pairsWith(selectedApp)}
          alternatives={recommender.alternativesTo(selectedApp)}
          onOpen={setSelectedApp}
        />
      )}

      <BootstrapOverlay
        visible={bootstrapVisible}
        running={bootstrapRunning}
        progressMessage={bootstrapProgress}
        tools={bootstrapTools}
        onApproveChoco={async () => {
          setBootstrapRunning(true);
          await window.getbox.approveChocolatey();
          await loadBootstrap();
          await loadProviders();
        }}
        onSkipChoco={async () => {
          await window.getbox.skipChocolatey();
          await loadBootstrap();
        }}
        onDismiss={() => setBootstrapVisible(false)}
      />

      {titleSlot && selfUpdate && createPortal(<SelfUpdateButton state={selfUpdate} onShowWhatsNew={showWhatsNew} />, titleSlot)}
      {whatsNew && (
        <WhatsNew version={whatsNew.version} previous={whatsNew.previous} onClose={closeWhatsNew} onNavigate={(v) => handleNavigate(v)} />
      )}

      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
    </I18nProvider>
  );
}
