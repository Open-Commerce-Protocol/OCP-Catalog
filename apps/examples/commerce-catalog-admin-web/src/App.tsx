import { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, Users, Database, Network, FileJson, Activity, Search, RefreshCw, Layers, ShieldCheck, FileSearch, KeyRound } from 'lucide-react';
import {
  fetchCatalogAdminEntries,
  fetchCatalogAdminOverview,
  fetchCatalogAdminProviders,
  fetchCatalogContracts,
  fetchCatalogHealth,
  fetchCatalogManifest,
  fetchCatalogWellKnown,
  fetchRegistrationCatalog,
  fetchRegistrationHealth,
  fetchRegistrationManifestSnapshot,
  fetchRegistrationVerification,
  refreshCatalogInRegistration,
  registerCatalogToRegistration,
  resolveCatalogEntry,
  rotateCatalogRegistrationToken,
  runCatalogQuery,
  verifyCatalogInRegistration,
  type CatalogAdminEntry,
  type CatalogAdminOverview,
  type CatalogAdminProvider,
  type CatalogContracts,
  type CatalogHealth,
  type CatalogManifest,
  type CatalogQueryResult,
  type CatalogWellKnown,
  type RegistrationCatalogRecord,
  type RegistrationHealthRecord,
  type RegistrationManifestSnapshot,
  type RegistrationVerificationRecord,
  type ResolvedEntry,
} from './api';

type WorkspaceTab = 'overview' | 'providers' | 'objects' | 'query_lab' | 'registration_ops' | 'manifest';
type ToastState = { tone: 'success' | 'danger'; message: string } | null;

type ConsoleState = {
  overview: CatalogAdminOverview | null;
  providers: CatalogAdminProvider[];
  health: CatalogHealth | null;
  wellKnown: CatalogWellKnown | null;
  manifest: CatalogManifest | null;
  contracts: CatalogContracts | null;
  registrationCatalog: RegistrationCatalogRecord | null;
  registrationHealthChecks: RegistrationHealthRecord[];
  registrationVerificationRecords: RegistrationVerificationRecord[];
  registrationManifestSnapshot: RegistrationManifestSnapshot | null;
};

const emptyState: ConsoleState = {
  overview: null,
  providers: [],
  health: null,
  wellKnown: null,
  manifest: null,
  contracts: null,
  registrationCatalog: null,
  registrationHealthChecks: [],
  registrationVerificationRecords: [],
  registrationManifestSnapshot: null,
};

function TopBand({
  apiKey,
  onApiKeyChange,
  systemHealthy,
  catalogId,
  loading,
  onRefresh,
}: {
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  systemHealthy: boolean;
  catalogId: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-operator-border bg-operator-surface px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-operator-text font-bold text-operator-surface">
          C
        </div>
        <div>
          <h1 className="operator-heading text-lg leading-tight">Catalog Operations Console</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-operator-muted operator-mono">
            <span className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${systemHealthy ? 'bg-accent-teal' : 'bg-accent-rust'}`} />
              {systemHealthy ? 'SYSTEM HEALTHY' : 'ATTENTION REQUIRED'}
            </span>
            <span>ID: {catalogId}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="flex items-center gap-2 rounded-sm border border-operator-border bg-operator-bg px-3 py-2 text-sm">
          <KeyRound size={14} className="text-operator-muted" />
          <input
            type="password"
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder="dev-api-key"
            className="min-w-[180px] bg-transparent outline-none placeholder:text-operator-muted"
          />
        </label>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center justify-center gap-2 rounded-sm border border-operator-border px-3 py-2 text-sm transition-colors hover:bg-operator-border disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? 'Refreshing' : 'Refresh State'}</span>
        </button>
      </div>
    </header>
  );
}

function Sidebar({ activeTab, setActiveTab }: { activeTab: WorkspaceTab; setActiveTab: (t: WorkspaceTab) => void }) {
  const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'providers', label: 'Providers', icon: Users },
    { id: 'objects', label: 'Objects & Entries', icon: Database },
    { id: 'query_lab', label: 'Query Lab', icon: Search },
    { id: 'registration_ops', label: 'Registration Ops', icon: Network },
    { id: 'manifest', label: 'Manifest & Contracts', icon: FileJson },
  ];

  return (
    <aside className="w-56 border-r border-operator-border bg-operator-surface flex flex-col h-[calc(100vh-64px)]">
      <div className="p-4 border-b border-operator-border">
        <div className="text-xs font-semibold text-operator-muted uppercase tracking-wider operator-mono">Workspaces</div>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id as WorkspaceTab)}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left rounded-sm transition-colors cursor-pointer ${
              activeTab === item.id
                ? 'bg-operator-text text-operator-surface font-medium'
                : 'text-operator-text hover:bg-operator-border hover:text-operator-text'
            }`}
          >
            <item.icon size={16} className={activeTab === item.id ? 'opacity-100' : 'opacity-70'} />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-operator-border operator-mono text-[10px] text-operator-muted">
        live api mode
      </div>
    </aside>
  );
}

function Overview({
  overview,
  health,
  registrationCatalog,
}: {
  overview: CatalogAdminOverview;
  health: CatalogHealth | null;
  registrationCatalog: RegistrationCatalogRecord | null;
}) {
  const stats = [
    { label: 'Total Providers', value: overview.metrics.provider_count, note: 'Active provider contract states' },
    { label: 'Synced Objects', value: overview.metrics.object_count, note: 'Commercial objects stored by catalog' },
    { label: 'Queryable Entries', value: overview.metrics.active_entry_count, note: 'Active projected search entries' },
    { label: 'Query Audits', value: overview.metrics.query_audit_count, note: 'Recorded query operations' },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header className="mb-8">
        <h2 className="text-3xl operator-heading mb-2">Platform Overview</h2>
        <p className="text-operator-muted operator-mono text-sm max-w-2xl">
          Observe provider intake, object projection, query behavior, and center readiness from one operator surface.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="operator-panel p-5 shadow-sm">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-operator-muted">{stat.label}</div>
            <div className="mb-1 text-3xl operator-heading">{formatCompactNumber(stat.value)}</div>
            <div className="text-xs text-accent-teal operator-mono">{stat.note}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <div className="operator-panel min-h-[400px] p-6 flex flex-col">
          <h3 className="operator-heading text-lg mb-6 flex justify-between items-center border-b border-operator-border pb-4">
            <span>Ingestion Pipeline</span>
            <Layers size={18} className="text-operator-muted" />
          </h3>
          <div className="flex-1 flex flex-col justify-center gap-4 relative">
             <div className="absolute left-1/2 top-4 bottom-4 w-px bg-operator-border -translate-x-1/2 z-0"></div>
             
             <div className="relative z-10 flex justify-between items-center">
                <div className="w-1/3 text-right pr-6">
                  <div className="font-medium text-sm">Provider Contracts</div>
                  <div className="text-xs text-operator-muted operator-mono">{overview.metrics.provider_count} active states</div>
                </div>
                <div className="w-4 h-4 rounded-full border-2 border-operator-text bg-operator-surface"></div>
                <div className="w-1/3 pl-6">
                  <div className="text-xs bg-operator-bg border border-operator-border px-2 py-1 inline-block rounded-sm operator-mono">Accepting Registrations</div>
                </div>
             </div>

             <div className="relative z-10 flex justify-between items-center opacity-70">
                <div className="w-1/3 text-right pr-6">
                  <div className="font-medium text-sm">Validation & Schema Check</div>
                </div>
                <div className="w-3 h-3 rounded-full bg-operator-border"></div>
                <div className="w-1/3 pl-6"></div>
             </div>
             
             <div className="relative z-10 flex justify-between items-center">
                <div className="w-1/3 text-right pr-6">
                  <div className="text-xs bg-operator-bg border border-accent-brass px-2 py-1 inline-block rounded-sm operator-mono text-accent-brass">
                    {overview.latest_sync_batch ? `Latest ${overview.latest_sync_batch.status}` : 'No sync batch yet'}
                  </div>
                </div>
                <div className="w-4 h-4 rounded-full border-2 border-accent-brass bg-operator-surface"></div>
                <div className="w-1/3 pl-6">
                   <div className="font-medium text-sm">Quality Projection</div>
                   <div className="text-xs text-operator-muted operator-mono">
                     {overview.metrics.rich_entry_count} rich / {overview.metrics.standard_entry_count} standard / {overview.metrics.basic_entry_count} basic
                   </div>
                </div>
             </div>

             <div className="relative z-10 flex justify-between items-center opacity-70">
                <div className="w-1/3 text-right pr-6">
                </div>
                <div className="w-3 h-3 rounded-full bg-operator-border"></div>
                <div className="w-1/3 pl-6">
                  <div className="font-medium text-sm">Index Updating</div>
                </div>
             </div>

             <div className="relative z-10 flex justify-between items-center">
                <div className="w-1/3 text-right pr-6">
                   <div className="font-medium text-sm">Search Surface</div>
                   <div className="text-xs text-operator-muted operator-mono">{overview.metrics.active_entry_count} active entries hot</div>
                </div>
                <div className="w-4 h-4 rounded-full border-2 border-accent-teal bg-accent-teal"></div>
                <div className="w-1/3 pl-6">
                  <div className="text-xs bg-accent-teal text-white px-2 py-1 inline-block rounded-sm operator-mono shadow-sm">Ready to Serve</div>
                </div>
             </div>
          </div>
        </div>

        <div className="operator-panel p-6 flex flex-col">
          <h3 className="operator-heading text-lg mb-6 border-b border-operator-border pb-4">Runtime Signals</h3>
          <div className="flex-1 space-y-4">
            <div className={`border-l-2 pl-3 ${health?.ok ? 'border-accent-teal' : 'border-accent-rust'}`}>
              <div className="text-xs font-semibold">CATALOG_HEALTH</div>
              <div className="text-sm text-operator-muted">{health?.service ?? 'Catalog API'} {health?.ok ? 'is reachable.' : 'did not respond healthy.'}</div>
              <div className="mt-1 text-[10px] text-operator-muted operator-mono">{health?.protocol ?? 'protocol unknown'}</div>
            </div>
            <div className={`border-l-2 pl-3 ${registrationCatalog ? 'border-operator-text' : 'border-accent-brass'}`}>
              <div className="text-xs font-semibold">REGISTRATION_INDEX</div>
              <div className="text-sm text-operator-muted">
                {registrationCatalog
                  ? `${registrationCatalog.verificationStatus} / ${registrationCatalog.healthStatus} / ${registrationCatalog.trustTier}`
                  : 'Catalog is not indexed in Registration yet.'}
              </div>
              <div className="mt-1 text-[10px] text-operator-muted operator-mono">
                {registrationCatalog?.activeSnapshotId ?? 'no active center snapshot'}
              </div>
            </div>
            <div className="border-l-2 border-operator-text pl-3">
              <div className="text-xs font-semibold">EMBEDDING_MODE</div>
              <div className="text-sm text-operator-muted">
                {overview.semantic_search_enabled ? 'Semantic retrieval is enabled.' : 'Catalog is currently running without semantic retrieval.'}
              </div>
              <div className="mt-1 text-[10px] text-operator-muted operator-mono">
                {overview.query_packs.join(', ') || 'no query packs'}
              </div>
            </div>
            <div className={`border-l-2 pl-3 ${overview.search_index.failed_job_count > 0 ? 'border-accent-rust' : overview.search_index.pending_job_count > 0 ? 'border-accent-brass' : 'border-accent-teal'}`}>
              <div className="text-xs font-semibold">SEARCH_INDEX</div>
              <div className="text-sm text-operator-muted">
                {overview.search_index.active_document_count} document(s), {overview.search_index.ready_embedding_count} embedding(s) ready.
              </div>
              <div className="mt-1 text-[10px] text-operator-muted operator-mono">
                readiness {(overview.search_index.embedding_readiness_ratio * 100).toFixed(1)}% · pending {overview.search_index.pending_job_count} · running {overview.search_index.running_job_count} · failed {overview.search_index.failed_job_count}
              </div>
              {overview.search_index.latest_failed_embedding_error ? (
                <div className="mt-1 text-[10px] text-accent-rust operator-mono">
                  embedding error: {overview.search_index.latest_failed_embedding_error.slice(0, 120)}
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-4 rounded-sm border border-operator-border bg-operator-bg px-3 py-3 text-xs text-operator-muted operator-mono">
            Missing image entries: {overview.metrics.missing_image_count}<br />
            Missing product URL entries: {overview.metrics.missing_product_url_count}<br />
            Out of stock entries: {overview.metrics.out_of_stock_count}<br />
            Active search documents: {overview.metrics.active_search_document_count}<br />
            Failed embeddings: {overview.metrics.failed_embedding_count}<br />
            Pending index jobs: {overview.metrics.pending_index_job_count}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProvidersPage({ providers }: { providers: CatalogAdminProvider[] }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <header>
        <h2 className="mb-2 text-3xl operator-heading">Providers</h2>
        <p className="max-w-2xl text-sm text-operator-muted operator-mono">
          Active provider contract states and their latest indexed quality inside this catalog.
        </p>
      </header>

      {providers.length === 0 ? (
        <EmptyState title="No providers connected yet." body="Once providers register and push object sync batches into this catalog, they will appear here." />
      ) : (
        <div className="space-y-4">
          {providers.map((provider) => (
            <article key={provider.provider_id} className="operator-panel grid gap-4 p-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-operator-muted operator-mono">provider</div>
                    <h3 className="text-xl operator-heading">{provider.provider_id}</h3>
                  </div>
                  <StatusBadge tone={provider.status === 'active' ? 'success' : 'warning'} label={provider.status} />
                </div>
                <dl className="grid gap-3 text-sm md:grid-cols-2">
                  <InfoPair label="Active registration" value={provider.active_registration_version?.toString() ?? 'none'} />
                  <InfoPair label="Latest registration" value={provider.latest_registration?.status ?? 'none'} />
                  <InfoPair label="Latest batch" value={provider.latest_sync_batch?.status ?? 'none'} />
                  <InfoPair label="Updated" value={formatTimestamp(provider.updated_at)} />
                </dl>
                <div className="rounded-sm border border-operator-border bg-operator-bg p-3">
                  <div className="mb-2 text-xs uppercase tracking-wider text-operator-muted operator-mono">Guaranteed fields</div>
                  <div className="flex flex-wrap gap-2">
                    {provider.guaranteed_fields.slice(0, 10).map((field) => (
                      <span key={field} className="rounded-sm border border-operator-border px-2 py-1 text-[11px] operator-mono">
                        {field}
                      </span>
                    ))}
                    {provider.guaranteed_fields.length === 0 ? <span className="text-sm text-operator-muted">No guaranteed fields reported.</span> : null}
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <MiniMetric label="Objects" value={provider.catalog_quality?.object_count ?? 0} />
                  <MiniMetric label="Active entries" value={provider.catalog_quality?.active_entry_count ?? 0} />
                  <MiniMetric label="Rich" value={provider.catalog_quality?.rich_entry_count ?? 0} />
                  <MiniMetric label="Basic" value={provider.catalog_quality?.basic_entry_count ?? 0} />
                </div>
                <div className="rounded-sm border border-operator-border bg-operator-bg p-3 text-xs text-operator-muted operator-mono">
                  Missing images: {provider.catalog_quality?.missing_image_count ?? 0}<br />
                  Missing product URLs: {provider.catalog_quality?.missing_product_url_count ?? 0}<br />
                  Out of stock: {provider.catalog_quality?.out_of_stock_count ?? 0}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectsEntriesPage({
  apiKey,
  onError,
}: {
  apiKey: string;
  onError: (message: string) => void;
}) {
  const [providerFilter, setProviderFilter] = useState('all');
  const [qualityFilter, setQualityFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [entries, setEntries] = useState<CatalogAdminEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const next = await fetchCatalogAdminEntries(apiKey, {
          ...(providerFilter !== 'all' ? { providerId: providerFilter } : {}),
          ...(qualityFilter !== 'all' ? { qualityTier: qualityFilter } : {}),
          ...(searchText.trim() ? { search: searchText.trim() } : {}),
        });
        if (!cancelled) setEntries(next);
      } catch (error) {
        if (!cancelled) onError(error instanceof Error ? error.message : 'Failed to load entries');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiKey, onError, providerFilter, qualityFilter, searchText]);

  const providerOptions = useMemo(
    () => ['all', ...new Set(entries.map((entry) => entry.provider_id).filter(Boolean))],
    [entries],
  );

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const selectedEntry = entries.find((entry) => entry.entry_id === selectedEntryId)
    ?? entries[0]
    ?? null;

  useEffect(() => {
    if (selectedEntry?.entry_id !== selectedEntryId) {
      setSelectedEntryId(selectedEntry?.entry_id ?? null);
    }
  }, [selectedEntry?.entry_id, selectedEntryId]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <header>
        <h2 className="mb-2 text-3xl operator-heading">Objects & Entries</h2>
        <p className="max-w-2xl text-sm text-operator-muted operator-mono">
          Compare raw synced objects with the active projected search entries the catalog is serving.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-2 text-sm">
          <span className="text-xs uppercase tracking-wider text-operator-muted">Provider</span>
          <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} className="w-full rounded-sm border border-operator-border bg-operator-surface px-3 py-2">
            {providerOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-xs uppercase tracking-wider text-operator-muted">Quality</span>
          <select value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value)} className="w-full rounded-sm border border-operator-border bg-operator-surface px-3 py-2">
            <option value="all">all</option>
            <option value="rich">rich</option>
            <option value="standard">standard</option>
            <option value="basic">basic</option>
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-xs uppercase tracking-wider text-operator-muted">Search</span>
          <input value={searchText} onChange={(event) => setSearchText(event.target.value)} className="w-full rounded-sm border border-operator-border bg-operator-surface px-3 py-2" placeholder="title, object id, provider..." />
        </label>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="operator-panel max-h-[780px] overflow-auto p-4">
          <div className="mb-3 text-xs uppercase tracking-wider text-operator-muted operator-mono">
            {loading ? 'loading entries...' : `${entries.length} entry candidates`}
          </div>
          <div className="space-y-3">
            {!loading && entries.length === 0 ? (
              <EmptyState title="No entries matched." body="Adjust the provider, quality, or search filters to inspect a different set of objects." compact />
            ) : (
              entries.map((entry) => {
                const qualityTier = typeof entry.search_projection.quality_tier === 'string' ? entry.search_projection.quality_tier : 'basic';
                return (
                  <button
                    key={entry.entry_id}
                    onClick={() => setSelectedEntryId(entry.entry_id)}
                    className={`w-full rounded-sm border p-4 text-left transition-colors ${
                      selectedEntry?.entry_id === entry.entry_id
                        ? 'border-operator-text bg-operator-surface'
                        : 'border-operator-border bg-operator-bg hover:bg-operator-surface'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-wider text-operator-muted operator-mono">{entry.provider_id}</div>
                        <div className="mt-1 font-medium">{entry.title}</div>
                      </div>
                      <StatusBadge tone={qualityTier === 'rich' ? 'success' : qualityTier === 'standard' ? 'warning' : 'danger'} label={qualityTier} />
                    </div>
                    <div className="mt-3 text-xs text-operator-muted operator-mono">
                      {entry.object_id} · {entry.entry_status} · {entry.availability_status ?? 'unknown'}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="space-y-6">
          {selectedEntry ? (
            <>
              <div className="operator-panel p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-operator-muted operator-mono">Entry detail</div>
                    <h3 className="text-2xl operator-heading">{selectedEntry.title}</h3>
                  </div>
                  <div className="flex gap-2">
                    <StatusBadge tone={selectedEntry.entry_status === 'active' ? 'success' : 'warning'} label={selectedEntry.entry_status} />
                    <StatusBadge tone="warning" label={selectedEntry.contract_match_status} />
                  </div>
                </div>
                <dl className="grid gap-3 text-sm md:grid-cols-2">
                  <InfoPair label="Provider" value={selectedEntry.provider_id} />
                  <InfoPair label="Object id" value={selectedEntry.object_id} />
                  <InfoPair label="Object type" value={selectedEntry.object_type} />
                  <InfoPair label="Updated" value={formatTimestamp(selectedEntry.updated_at)} />
                </dl>
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <section className="operator-panel p-5">
                  <h3 className="mb-3 text-lg operator-heading">Projected Entry</h3>
                  <JsonBlock value={selectedEntry.search_projection} />
                </section>
                <section className="operator-panel p-5">
                  <h3 className="mb-3 text-lg operator-heading">Raw Object</h3>
                  {selectedEntry.raw_object ? <JsonBlock value={selectedEntry.raw_object} /> : <EmptyState title="Raw object unavailable." body="This entry does not currently resolve back to a stored commercial object payload." compact />}
                </section>
              </div>
            </>
          ) : (
            <EmptyState title="No entry selected." body="Choose an entry from the list to inspect its projection and raw object payload." />
          )}
        </section>
      </div>
    </div>
  );
}

function QueryLabPage({
  catalogId,
  apiKey,
  providers,
  queryPacks,
  onError,
}: {
  catalogId: string;
  apiKey: string;
  providers: CatalogAdminProvider[];
  queryPacks: string[];
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState('travel headphones');
  const [queryPack, setQueryPack] = useState('');
  const [providerId, setProviderId] = useState('');
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CatalogQueryResult | null>(null);
  const [resolved, setResolved] = useState<ResolvedEntry | null>(null);

  async function handleRunQuery(nextOffset = 0) {
    try {
      setBusy(true);
      setResolved(null);
      const next = await runCatalogQuery({
        catalogId,
        query,
        queryPack: queryPack || undefined,
        apiKey,
        filters: {
          ...(providerId ? { provider_id: providerId } : {}),
          ...(category ? { category } : {}),
        },
        offset: nextOffset,
      });
      setOffset(nextOffset);
      setResult(next);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Query failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleResolve(entryId: string) {
    try {
      setBusy(true);
      const next = await resolveCatalogEntry({ catalogId, entryId });
      setResolved(next);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Resolve failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <header>
        <h2 className="mb-2 text-3xl operator-heading">Query Lab</h2>
        <p className="max-w-2xl text-sm text-operator-muted operator-mono">
          Run live catalog queries against the active node and resolve entries into user-facing references.
        </p>
      </header>

      <div className="operator-panel grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5">
        <label className="space-y-2 text-sm xl:col-span-2">
          <span className="text-xs uppercase tracking-wider text-operator-muted">Query</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-sm border border-operator-border bg-operator-bg px-3 py-2" />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-xs uppercase tracking-wider text-operator-muted">Query pack</span>
          <select value={queryPack} onChange={(event) => setQueryPack(event.target.value)} className="w-full rounded-sm border border-operator-border bg-operator-bg px-3 py-2">
            <option value="">default</option>
            {queryPacks.map((pack) => <option key={pack} value={pack}>{pack}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-xs uppercase tracking-wider text-operator-muted">Provider filter</span>
          <select value={providerId} onChange={(event) => setProviderId(event.target.value)} className="w-full rounded-sm border border-operator-border bg-operator-bg px-3 py-2">
            <option value="">all</option>
            {providers.map((provider) => <option key={provider.provider_id} value={provider.provider_id}>{provider.provider_id}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-xs uppercase tracking-wider text-operator-muted">Category filter</span>
          <input value={category} onChange={(event) => setCategory(event.target.value)} className="w-full rounded-sm border border-operator-border bg-operator-bg px-3 py-2" />
        </label>
        <div className="flex items-end">
          <button onClick={() => void handleRunQuery(0)} disabled={busy} className="w-full rounded-sm border border-operator-text bg-operator-text px-4 py-2 text-sm text-operator-surface transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? 'Running...' : 'Run Query'}
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section className="operator-panel p-5">
          <h3 className="mb-3 text-lg operator-heading">Query Results</h3>
          {!result ? (
            <EmptyState title="No query executed yet." body="Run a live query to inspect ranking, explain output, and resolvable entries." compact />
          ) : (
            <div className="space-y-4">
              <div className="rounded-sm border border-operator-border bg-operator-bg p-3 text-xs text-operator-muted operator-mono">
                results: {result.result_count} · offset: {result.page.offset} · limit: {result.page.limit} · has_more: {String(result.page.has_more)} · pack: {queryPack || 'default'}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleRunQuery(Math.max(offset - (result.page.limit || 12), 0))}
                  disabled={busy || result.page.offset === 0}
                  className="rounded-sm border border-operator-border px-3 py-1 text-xs transition-colors hover:bg-operator-surface disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous Page
                </button>
                <button
                  onClick={() => void handleRunQuery(result.page.next_offset ?? result.page.offset + result.page.limit)}
                  disabled={busy || !result.page.has_more}
                  className="rounded-sm border border-operator-border px-3 py-1 text-xs transition-colors hover:bg-operator-surface disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next Page
                </button>
              </div>
              {result.explain.length > 0 ? (
                <div className="rounded-sm border border-operator-border bg-operator-bg p-3">
                  <div className="mb-2 text-xs uppercase tracking-wider text-operator-muted">Explain</div>
                  <ul className="space-y-1 text-sm text-operator-muted">
                    {result.explain.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </div>
              ) : null}
              <div className="space-y-3">
                {result.items.map((item) => (
                  <article key={item.entry_id} className="rounded-sm border border-operator-border bg-operator-bg p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{item.title}</div>
                        <div className="mt-1 text-xs text-operator-muted operator-mono">{item.provider_id} · score {item.score}</div>
                      </div>
                      <button onClick={() => void handleResolve(item.entry_id)} className="rounded-sm border border-operator-border px-3 py-1 text-xs transition-colors hover:bg-operator-surface">
                        Resolve
                      </button>
                    </div>
                    {item.explain.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-xs text-operator-muted">
                        {item.explain.map((line) => <li key={line}>{line}</li>)}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="operator-panel p-5">
          <h3 className="mb-3 text-lg operator-heading">Resolved Entry</h3>
          {resolved ? (
            <div className="space-y-4">
              <div className="rounded-sm border border-operator-border bg-operator-bg p-3 text-sm">
                <div className="font-medium">{resolved.title}</div>
                <div className="mt-1 text-xs text-operator-muted operator-mono">{resolved.provider_id} · {resolved.object_id}</div>
              </div>
              <JsonBlock value={resolved} />
            </div>
          ) : (
            <EmptyState title="No entry resolved yet." body="Resolve a query result to inspect visible attributes and action bindings." compact />
          )}
        </section>
      </div>
    </div>
  );
}

function RegistrationOpsPage({
  overview,
  registrationCatalog,
  healthChecks,
  verificationRecords,
  manifestSnapshot,
  apiKey,
  onError,
  onSuccess,
  onRefresh,
}: {
  overview: CatalogAdminOverview;
  registrationCatalog: RegistrationCatalogRecord | null;
  healthChecks: RegistrationHealthRecord[];
  verificationRecords: RegistrationVerificationRecord[];
  manifestSnapshot: RegistrationManifestSnapshot | null;
  apiKey: string;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [catalogToken, setCatalogToken] = useState(() => window.localStorage.getItem('catalog-registration-token') || '');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastActionResult, setLastActionResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    window.localStorage.setItem('catalog-registration-token', catalogToken);
  }, [catalogToken]);

  async function runAction(action: string, fn: () => Promise<Record<string, unknown>>) {
    try {
      setBusyAction(action);
      const result = await fn();
      setLastActionResult(result);
      if (typeof result.catalog_access_token === 'string') {
        setCatalogToken(result.catalog_access_token);
      }
      await onRefresh();
      onSuccess(`${action} completed`);
    } catch (error) {
      onError(error instanceof Error ? error.message : `${action} failed`);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <header>
        <h2 className="mb-2 text-3xl operator-heading">Registration Ops</h2>
        <p className="max-w-2xl text-sm text-operator-muted operator-mono">
          Current registration-side state, health checks, verification records, and active manifest snapshot for {overview.catalog_id}.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="operator-panel p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck size={16} className="text-accent-teal" />
            <h3 className="text-lg operator-heading">Registration Intake</h3>
          </div>
          <div className="mb-4 space-y-3">
            <label className="block space-y-2 text-sm">
              <span className="text-xs uppercase tracking-wider text-operator-muted">Catalog token</span>
              <input
                type="password"
                value={catalogToken}
                onChange={(event) => setCatalogToken(event.target.value)}
                className="w-full rounded-sm border border-operator-border bg-operator-bg px-3 py-2"
                placeholder="Token required for refresh and rotate"
              />
            </label>
            <div className="grid gap-2 md:grid-cols-2">
              <button onClick={() => void runAction('registration register', () => registerCatalogToRegistration(apiKey))} disabled={Boolean(busyAction)} className="rounded-sm border border-operator-border px-3 py-2 text-sm hover:bg-operator-bg disabled:opacity-50">
                {busyAction === 'registration register' ? 'Registering...' : 'Register to Registration'}
              </button>
              <button onClick={() => void runAction('registration verify', () => verifyCatalogInRegistration(apiKey))} disabled={Boolean(busyAction)} className="rounded-sm border border-operator-border px-3 py-2 text-sm hover:bg-operator-bg disabled:opacity-50">
                {busyAction === 'registration verify' ? 'Verifying...' : 'Verify'}
              </button>
              <button onClick={() => void runAction('registration refresh', () => refreshCatalogInRegistration(apiKey, catalogToken))} disabled={Boolean(busyAction)} className="rounded-sm border border-operator-border px-3 py-2 text-sm hover:bg-operator-bg disabled:opacity-50">
                {busyAction === 'registration refresh' ? 'Refreshing...' : 'Refresh'}
              </button>
              <button onClick={() => void runAction('registration rotate token', () => rotateCatalogRegistrationToken(apiKey, catalogToken))} disabled={Boolean(busyAction)} className="rounded-sm border border-operator-border px-3 py-2 text-sm hover:bg-operator-bg disabled:opacity-50">
                {busyAction === 'registration rotate token' ? 'Rotating...' : 'Rotate Token'}
              </button>
            </div>
          </div>
          {lastActionResult ? (
            <div className="mb-4 rounded-sm border border-operator-border bg-operator-bg p-4">
              <div className="mb-2 text-xs uppercase tracking-wider text-operator-muted operator-mono">Last action result</div>
              <JsonBlock value={lastActionResult} />
            </div>
          ) : null}
          {registrationCatalog ? (
            <dl className="grid gap-3 text-sm">
              <InfoPair label="Verification" value={registrationCatalog.verificationStatus} />
              <InfoPair label="Health" value={registrationCatalog.healthStatus} />
              <InfoPair label="Trust tier" value={registrationCatalog.trustTier} />
              <InfoPair label="Snapshot" value={registrationCatalog.activeSnapshotId ?? 'none'} />
              <InfoPair label="Registration version" value={registrationCatalog.activeRegistrationVersion?.toString() ?? 'none'} />
              <InfoPair label="Updated" value={formatTimestamp(registrationCatalog.updatedAt)} />
            </dl>
          ) : (
            <EmptyState title="Catalog not registered in Registration." body="The registration lookup returned no active record for this catalog id." compact />
          )}
        </section>

        <section className="operator-panel p-5">
          <div className="mb-4 flex items-center gap-2">
            <Activity size={16} className="text-accent-brass" />
            <h3 className="text-lg operator-heading">Health Checks</h3>
          </div>
          <div className="space-y-3">
            {healthChecks.length === 0 ? (
              <EmptyState title="No center health checks found." body="Health checks will appear once the center has fetched and evaluated this catalog." compact />
            ) : (
              healthChecks.slice(0, 6).map((check) => (
                <div key={check.id} className="rounded-sm border border-operator-border bg-operator-bg p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <StatusBadge tone={check.status === 'healthy' ? 'success' : 'danger'} label={check.status} />
                    <span className="text-xs text-operator-muted operator-mono">{formatTimestamp(check.createdAt)}</span>
                  </div>
                  <div className="mt-2 text-xs text-operator-muted operator-mono break-all">{check.checkedUrl}</div>
                  <div className="mt-2 text-xs text-operator-muted operator-mono">
                    latency: {check.latencyMs ?? '-'} ms {check.error ? `· ${check.error}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <section className="operator-panel p-5">
          <div className="mb-4 flex items-center gap-2">
            <FileSearch size={16} className="text-operator-muted" />
            <h3 className="text-lg operator-heading">Verification Timeline</h3>
          </div>
          <div className="space-y-3">
            {verificationRecords.length === 0 ? (
              <EmptyState title="No verification records." body="This demo Registration node does not require extra domain verification, so this timeline is usually empty." compact />
            ) : (
              verificationRecords.slice(0, 6).map((record) => (
                <div key={record.id} className="rounded-sm border border-operator-border bg-operator-bg p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{record.challengeType}</span>
                    <StatusBadge
                      tone={record.status === 'verified' ? 'success' : record.status === 'pending' ? 'warning' : 'danger'}
                      label={record.status}
                    />
                  </div>
                  <div className="mt-2 text-xs text-operator-muted operator-mono">
                    created: {formatTimestamp(record.createdAt)}
                    {record.verifiedAt ? ` · verified: ${formatTimestamp(record.verifiedAt)}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="operator-panel p-5">
          <div className="mb-4 flex items-center gap-2">
            <FileJson size={16} className="text-operator-muted" />
            <h3 className="text-lg operator-heading">Active Snapshot</h3>
          </div>
          {manifestSnapshot ? (
            <JsonBlock value={{
              snapshot_id: manifestSnapshot.id,
              manifest_url: manifestSnapshot.manifestUrl,
              manifest_hash: manifestSnapshot.manifestHash,
              created_at: manifestSnapshot.createdAt,
              query_capabilities: manifestSnapshot.queryCapabilities,
            }} />
          ) : (
            <EmptyState title="No center snapshot available." body="The center has not stored an active manifest snapshot for this catalog yet." compact />
          )}
        </section>
      </div>
    </div>
  );
}

function ManifestPage({
  wellKnown,
  manifest,
  contracts,
}: {
  wellKnown: CatalogWellKnown | null;
  manifest: CatalogManifest | null;
  contracts: CatalogContracts | null;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <header>
        <h2 className="mb-2 text-3xl operator-heading">Manifest & Contracts</h2>
        <p className="max-w-2xl text-sm text-operator-muted operator-mono">
          Live protocol surfaces exposed by the catalog node.
        </p>
      </header>
      <div className="grid gap-6 xl:grid-cols-3">
        <section className="operator-panel p-5">
          <h3 className="mb-3 text-lg operator-heading">Well-known</h3>
          {wellKnown ? <JsonBlock value={wellKnown} /> : <EmptyState title="No data loaded." body="Well-known discovery document is unavailable." compact />}
        </section>
        <section className="operator-panel p-5">
          <h3 className="mb-3 text-lg operator-heading">Manifest</h3>
          {manifest ? <JsonBlock value={manifest} /> : <EmptyState title="No data loaded." body="Manifest endpoint did not return a payload." compact />}
        </section>
        <section className="operator-panel p-5">
          <h3 className="mb-3 text-lg operator-heading">Contracts</h3>
          {contracts ? <JsonBlock value={contracts} /> : <EmptyState title="No data loaded." body="Object contracts endpoint did not return a payload." compact />}
        </section>
      </div>
    </div>
  );
}

function EmptyState({ title, body, compact = false }: { title: string; body: string; compact?: boolean }) {
  return (
    <div className={`rounded-sm border border-dashed border-operator-border bg-operator-bg text-center ${compact ? 'p-4' : 'p-8'}`}>
      <div className="mb-2 font-medium">{title}</div>
      <p className="mx-auto max-w-[40ch] text-sm text-operator-muted">{body}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm border border-operator-border bg-operator-bg p-3">
      <div className="text-xs uppercase tracking-wider text-operator-muted">{label}</div>
      <div className="mt-1 text-xl operator-heading">{formatCompactNumber(value)}</div>
    </div>
  );
}

function StatusBadge({ tone, label }: { tone: 'success' | 'warning' | 'danger'; label: string }) {
  const toneClass = tone === 'success'
    ? 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal'
    : tone === 'warning'
      ? 'border-accent-brass/30 bg-accent-brass/10 text-accent-brass'
      : 'border-accent-rust/30 bg-accent-rust/10 text-accent-rust';

  return (
    <span className={`inline-flex rounded-sm border px-2 py-1 text-[11px] uppercase tracking-wider operator-mono ${toneClass}`}>
      {label}
    </span>
  );
}

function InfoPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-operator-muted">{label}</dt>
      <dd className="mt-1 font-medium break-all">{value}</dd>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[520px] overflow-auto rounded-sm border border-operator-border bg-operator-bg p-4 text-xs leading-6 text-operator-text operator-mono">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [apiKey, setApiKey] = useState(() => window.localStorage.getItem('catalog-admin-api-key') || 'dev-api-key');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);
  const [state, setState] = useState<ConsoleState>(emptyState);

  useEffect(() => {
    window.localStorage.setItem('catalog-admin-api-key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    void reloadAll();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const systemHealthy = useMemo(() => {
    const catalogHealthy = state.health?.ok === true;
    const centerHealthy = !state.registrationCatalog || state.registrationCatalog.healthStatus === 'healthy';
    return catalogHealthy && centerHealthy;
  }, [state.health, state.registrationCatalog]);

  async function reloadAll() {
    try {
      setLoading(true);
      const overview = await fetchCatalogAdminOverview(apiKey);
      const [providers, health, wellKnown, manifest, contracts] = await Promise.all([
        fetchCatalogAdminProviders(apiKey),
        fetchCatalogHealth(),
        fetchCatalogWellKnown(),
        fetchCatalogManifest(),
        fetchCatalogContracts(),
      ]);

      const centerResults = await Promise.allSettled([
        fetchRegistrationCatalog(overview.catalog_id),
        fetchRegistrationHealth(overview.catalog_id),
        fetchRegistrationVerification(overview.catalog_id),
        fetchRegistrationManifestSnapshot(overview.catalog_id),
      ]);

      setState({
        overview,
        providers,
        health,
        wellKnown,
        manifest,
        contracts,
        registrationCatalog: centerResults[0].status === 'fulfilled' ? centerResults[0].value : null,
        registrationHealthChecks: centerResults[1].status === 'fulfilled' ? centerResults[1].value.checks : [],
        registrationVerificationRecords: centerResults[2].status === 'fulfilled' ? centerResults[2].value.records : [],
        registrationManifestSnapshot: centerResults[3].status === 'fulfilled' ? centerResults[3].value : null,
      });
    } catch (error) {
      setToast({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Unexpected error',
      });
    } finally {
      setLoading(false);
    }
  }

  const catalogId = state.overview?.catalog_id ?? 'catalog-unavailable';

  return (
    <div className="min-h-screen flex flex-col overflow-hidden text-sm">
      <TopBand
        apiKey={apiKey}
        onApiKeyChange={setApiKey}
        systemHealthy={systemHealthy}
        catalogId={catalogId}
        loading={loading}
        onRefresh={() => void reloadAll()}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        <main className="flex-1 overflow-y-auto bg-operator-bg h-[calc(100vh-64px)]">
          {!state.overview && !loading ? (
            <div className="p-8">
              <EmptyState title="Unable to load catalog admin data." body="Check catalog API availability and the admin key, then refresh." />
            </div>
          ) : null}
          {activeTab === 'overview' && state.overview ? <Overview overview={state.overview} health={state.health} registrationCatalog={state.registrationCatalog} /> : null}
          {activeTab === 'providers' && <ProvidersPage providers={state.providers} />}
          {activeTab === 'objects' && (
            <ObjectsEntriesPage
              apiKey={apiKey}
              onError={(message) => setToast({ tone: 'danger', message })}
            />
          )}
          {activeTab === 'query_lab' && state.overview ? (
            <QueryLabPage
              catalogId={state.overview.catalog_id}
              apiKey={apiKey}
              providers={state.providers}
              queryPacks={state.overview.query_packs}
              onError={(message) => setToast({ tone: 'danger', message })}
            />
          ) : null}
          {activeTab === 'registration_ops' && state.overview ? (
            <RegistrationOpsPage
              overview={state.overview}
              registrationCatalog={state.registrationCatalog}
              healthChecks={state.registrationHealthChecks}
              verificationRecords={state.registrationVerificationRecords}
              manifestSnapshot={state.registrationManifestSnapshot}
              apiKey={apiKey}
              onError={(message) => setToast({ tone: 'danger', message })}
              onSuccess={(message) => setToast({ tone: 'success', message })}
              onRefresh={reloadAll}
            />
          ) : null}
          {activeTab === 'manifest' && <ManifestPage wellKnown={state.wellKnown} manifest={state.manifest} contracts={state.contracts} />}
        </main>
      </div>
      {toast ? (
        <div className={`fixed bottom-5 right-5 z-50 rounded-sm border px-4 py-3 text-sm shadow-sm ${
          toast.tone === 'success'
            ? 'border-accent-teal/30 bg-accent-teal text-white'
            : 'border-accent-rust/30 bg-accent-rust text-white'
        }`}>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
