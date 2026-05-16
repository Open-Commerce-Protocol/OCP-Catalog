import { Activity, BadgeCheck, Clock3, FileClock, Globe2, Radar, RefreshCw, ScanSearch, ShieldEllipsis, ShieldCheck, KeyRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchRegistrationAdminCatalogs,
  fetchRegistrationAdminOverview,
  fetchRegistrationAdminRegistrations,
  fetchRegistrationAdminSearchAudits,
  fetchRegistrationCatalog,
  fetchRegistrationHealth,
  fetchRegistrationManifestSnapshot,
  fetchRegistrationVerification,
  refreshRegistrationCatalog,
  rotateRegistrationCatalogToken,
  type RegistrationCatalogListItem,
  type RegistrationCatalogRecord,
  type RegistrationHealthRecord,
  type RegistrationManifestSnapshot,
  type RegistrationOverview,
  type RegistrationRecord,
  type RegistrationSearchAudit,
  type RegistrationVerificationRecord,
  verifyRegistrationCatalog,
} from './api';

type ToastState = { tone: 'success' | 'danger'; message: string } | null;

type DetailState = {
  catalog: RegistrationCatalogRecord | null;
  health: RegistrationHealthRecord[];
  verification: RegistrationVerificationRecord[];
  manifestSnapshot: RegistrationManifestSnapshot | null;
  registrations: RegistrationRecord[];
};

const emptyDetail: DetailState = {
  catalog: null,
  health: [],
  verification: [],
  manifestSnapshot: null,
  registrations: [],
};

export default function App() {
  const [apiKey, setApiKey] = useState(() => window.localStorage.getItem('registration-admin-api-key') || 'dev-api-key');
  const [overview, setOverview] = useState<RegistrationOverview | null>(null);
  const [catalogs, setCatalogs] = useState<RegistrationCatalogListItem[]>([]);
  const [audits, setAudits] = useState<RegistrationSearchAudit[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState>(emptyDetail);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [verificationFilter, setVerificationFilter] = useState<'all' | string>('all');
  const [healthFilter, setHealthFilter] = useState<'all' | string>('all');
  const [trustFilter, setTrustFilter] = useState<'all' | string>('all');
  const [catalogToken, setCatalogToken] = useState('');
  const [toast, setToast] = useState<ToastState>(null);
  const safeCatalogs = Array.isArray(catalogs) ? catalogs : [];

  useEffect(() => {
    window.localStorage.setItem('registration-admin-api-key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    void reloadAll();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!selectedCatalogId && safeCatalogs[0]) {
      setSelectedCatalogId(safeCatalogs[0].catalog_id);
    }
  }, [safeCatalogs, selectedCatalogId]);

  useEffect(() => {
    if (!selectedCatalogId) return;
    void loadDetail(selectedCatalogId);
  }, [selectedCatalogId]);

  const filteredCatalogs = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return safeCatalogs.filter((catalog) => {
      if (verificationFilter !== 'all' && catalog.verification_status !== verificationFilter) return false;
      if (healthFilter !== 'all' && catalog.health_status !== healthFilter) return false;
      if (trustFilter !== 'all' && catalog.trust_tier !== trustFilter) return false;
      if (!query) return true;
      const haystack = [
        catalog.catalog_id,
        catalog.homepage,
        catalog.well_known_url,
        ...catalog.claimed_domains,
        catalog.verification_status,
        catalog.health_status,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [safeCatalogs, filter, verificationFilter, healthFilter, trustFilter]);

  async function reloadAll() {
    try {
      setLoading(true);
      const [nextOverview, nextCatalogs, nextAudits] = await Promise.all([
        fetchRegistrationAdminOverview(apiKey),
        fetchRegistrationAdminCatalogs(apiKey),
        fetchRegistrationAdminSearchAudits(apiKey),
      ]);
      setOverview(nextOverview);
      setCatalogs(nextCatalogs);
      setAudits(nextAudits);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(catalogId: string) {
    try {
      setDetailLoading(true);
      const [catalog, health, verification, registrations, manifestSnapshot] = await Promise.all([
        fetchRegistrationCatalog(catalogId),
        fetchRegistrationHealth(catalogId),
        fetchRegistrationVerification(catalogId),
        fetchRegistrationAdminRegistrations(apiKey, catalogId),
        fetchRegistrationManifestSnapshot(catalogId).catch(() => null),
      ]);

      setDetail({
        catalog,
        health,
        verification,
        manifestSnapshot,
        registrations,
      });
    } catch (error) {
      showError(error);
      setDetail(emptyDetail);
    } finally {
      setDetailLoading(false);
    }
  }

  function showError(error: unknown) {
    setToast({
      tone: 'danger',
      message: error instanceof Error ? error.message : 'Unexpected error',
    });
  }

  async function runCatalogAction(actionKey: string, fn: () => Promise<unknown>) {
    if (!selectedCatalogId) return;
    try {
      setActionBusy(actionKey);
      const result = await fn();
      setToast({
        tone: 'success',
        message: extractActionMessage(result) ?? `${actionKey} completed`,
      });
      await reloadAll();
      await loadDetail(selectedCatalogId);
    } catch (error) {
      showError(error);
    } finally {
      setActionBusy(null);
    }
  }

  const metrics = overview?.metrics;
  const verificationOptions = ['all', ...unique(safeCatalogs.map((catalog) => catalog.verification_status))];
  const healthOptions = ['all', ...unique(safeCatalogs.map((catalog) => catalog.health_status))];
  const trustOptions = ['all', ...unique(safeCatalogs.map((catalog) => catalog.trust_tier))];

  return (
    <div className="min-h-screen registration-grid">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <header className="registration-panel overflow-hidden rounded-3xl">
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.24em] text-[var(--color-registration-muted)] registration-mono">
                <span className="rounded-full border border-[var(--color-registration-border)] px-3 py-1 text-[var(--color-registration-cyan)]">Registration node</span>
                <span>{overview?.registration_id ?? 'loading-registration-id'}</span>
              </div>
              <div className="max-w-[11ch] text-5xl font-semibold leading-[0.88] tracking-[-0.04em] sm:text-6xl">
                OCP Registration Control Room
              </div>
              <p className="max-w-2xl text-sm leading-6 text-[var(--color-registration-muted)]">
                Observe registration intake, verification pressure, health activity, and registration-side search traffic from one operator surface.
              </p>
            </div>
            <div className="grid gap-4 rounded-3xl border border-[var(--color-registration-border)] bg-black/16 p-5">
              <label className="space-y-2">
                <span className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--color-registration-muted)] registration-mono">
                  <KeyRound size={14} />
                  Admin key
                </span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  className="w-full rounded-2xl border border-[var(--color-registration-border)] bg-[var(--color-registration-surface)] px-4 py-3 text-sm outline-none"
                  placeholder="dev-api-key"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <SignalCard label="Scheduler" value={overview?.refresh_scheduler_enabled ? 'ON' : 'OFF'} note={overview ? `${overview.refresh_interval_seconds}s cadence` : 'loading'} tone="cyan" />
                <SignalCard label="Latest audit" value={overview?.latest_search_audit ? formatTimestamp(overview.latest_search_audit.created_at) : 'none'} note={overview?.latest_search_audit ? `${overview.latest_search_audit.result_count} result(s)` : 'No search audits yet'} tone="amber" />
              </div>
              <button
                onClick={() => void reloadAll()}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--color-registration-border)] bg-[var(--color-registration-panel)] px-4 py-3 text-sm font-medium transition hover:border-[var(--color-registration-cyan)]/40 hover:text-[var(--color-registration-cyan)] disabled:opacity-60"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                {loading ? 'Refreshing state' : 'Refresh registration state'}
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Globe2} label="Registered catalogs" value={metrics?.registered_catalog_count ?? 0} tone="cyan" />
          <MetricCard icon={ShieldCheck} label="Trusted catalogs" value={metrics?.verified_catalog_count ?? 0} tone="lime" />
          <MetricCard icon={Activity} label="Healthy catalogs" value={metrics?.healthy_catalog_count ?? 0} tone="amber" />
          <MetricCard icon={ScanSearch} label="Search audits" value={metrics?.search_audit_count ?? 0} tone="rose" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <div className="registration-panel rounded-3xl p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-[var(--color-registration-muted)] registration-mono">Catalog registry</div>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Live catalog roster</h2>
              </div>
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by id, domain, status"
                className="w-full max-w-[260px] rounded-2xl border border-[var(--color-registration-border)] bg-[var(--color-registration-surface)] px-4 py-2.5 text-sm outline-none"
              />
            </div>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <FilterSelect label="Verification" value={verificationFilter} onChange={setVerificationFilter} options={verificationOptions} />
              <FilterSelect label="Health" value={healthFilter} onChange={setHealthFilter} options={healthOptions} />
              <FilterSelect label="Trust" value={trustFilter} onChange={setTrustFilter} options={trustOptions} />
            </div>

            <div className="space-y-3">
              {filteredCatalogs.map((catalog) => (
                <button
                  key={catalog.catalog_id}
                  onClick={() => setSelectedCatalogId(catalog.catalog_id)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${selectedCatalogId === catalog.catalog_id ? 'border-[var(--color-registration-cyan)] bg-[rgba(118,228,213,0.08)]' : 'border-[var(--color-registration-border)] bg-[var(--color-registration-surface)] hover:border-[var(--color-registration-cyan)]/40'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{catalog.catalog_id}</div>
                      <div className="mt-1 break-all text-xs text-[var(--color-registration-muted)] registration-mono">{catalog.homepage}</div>
                    </div>
                    <StatusPill tone={toneForStatus(catalog.verification_status)} label={catalog.verification_status} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--color-registration-muted)] registration-mono">
                    <span>health: {catalog.health_status}</span>
                    <span>trust: {catalog.trust_tier}</span>
                    <span>version: {catalog.active_registration_version ?? 'none'}</span>
                    <span>registrations: {catalog.registration_count}</span>
                  </div>
                </button>
              ))}

              {filteredCatalogs.length === 0 ? (
                <EmptyBlock title="No matching catalogs" body="Adjust the filter or refresh the registration roster." />
              ) : null}
            </div>
          </div>

          <div className="space-y-6">
            <div className="registration-panel rounded-3xl p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-[var(--color-registration-muted)] registration-mono">Selected catalog</div>
                  <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{selectedCatalogId ?? 'No catalog selected'}</h2>
                </div>
                {detailLoading ? <div className="text-xs text-[var(--color-registration-muted)] registration-mono">Loading detail...</div> : null}
              </div>

              {detail.catalog ? (
                <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-4">
                    <DetailPanel title="Actions">
                      <label className="block space-y-2">
                        <span className="text-xs uppercase tracking-[0.14em] text-[var(--color-registration-muted)] registration-mono">Catalog token</span>
                        <input
                          type="password"
                          value={catalogToken}
                          onChange={(event) => setCatalogToken(event.target.value)}
                          className="w-full rounded-2xl border border-[var(--color-registration-border)] bg-black/12 px-4 py-3 text-sm outline-none"
                          placeholder="Required for refresh and rotate"
                        />
                      </label>
                      <div className="grid gap-2 md:grid-cols-3">
                        <ActionButton
                          label="Verify"
                          busy={actionBusy === 'verify'}
                          onClick={() => void runCatalogAction('verify', () => verifyRegistrationCatalog(detail.catalog!.catalogId))}
                        />
                        <ActionButton
                          label="Refresh"
                          busy={actionBusy === 'refresh'}
                          onClick={() => void runCatalogAction('refresh', () => refreshRegistrationCatalog(detail.catalog!.catalogId, catalogToken))}
                        />
                        <ActionButton
                          label="Rotate Token"
                          busy={actionBusy === 'rotate token'}
                          onClick={() => void runCatalogAction('rotate token', () => rotateRegistrationCatalogToken(detail.catalog!.catalogId, catalogToken))}
                        />
                      </div>
                    </DetailPanel>
                    <DetailPanel title="Profile">
                      <InfoRow label="Homepage" value={detail.catalog.homepage} mono />
                      <InfoRow label="Well-known" value={detail.catalog.wellKnownUrl} mono />
                      <InfoRow label="Verification" value={detail.catalog.verificationStatus} />
                      <InfoRow label="Health" value={detail.catalog.healthStatus} />
                      <InfoRow label="Trust tier" value={detail.catalog.trustTier} />
                      <InfoRow label="Updated" value={formatTimestamp(detail.catalog.updatedAt)} />
                    </DetailPanel>
                    <DetailPanel title="Health timeline">
                      {detail.health.length > 0 ? detail.health.slice(0, 5).map((item) => (
                        <EventRow
                          key={item.id}
                          icon={Radar}
                          title={item.status}
                          subtitle={item.checkedUrl}
                          meta={`${formatTimestamp(item.createdAt)} · ${item.latencyMs ?? '-'}ms${item.error ? ` · ${item.error}` : ''}`}
                        />
                      )) : <EmptyInline label="No health checks yet" />}
                    </DetailPanel>
                  </div>

                  <div className="space-y-4">
                    <DetailPanel title="Verification records">
                      {detail.verification.length > 0 ? detail.verification.slice(0, 6).map((item) => (
                        <EventRow
                          key={item.id}
                          icon={item.status === 'verified' ? ShieldCheck : ShieldEllipsis}
                          title={`${item.challengeType} · ${item.status}`}
                          subtitle={item.verifiedDomain ?? 'No verified domain yet'}
                          meta={`created ${formatTimestamp(item.createdAt)}${item.verifiedAt ? ` · verified ${formatTimestamp(item.verifiedAt)}` : ''}`}
                        />
                      )) : <EmptyInline label="No verification records for this catalog" />}
                    </DetailPanel>
                    <DetailPanel title="Registration history">
                      {detail.registrations.length > 0 ? detail.registrations.slice(0, 6).map((item) => (
                        <EventRow
                          key={item.id}
                          icon={BadgeCheck}
                          title={`v${item.registration_version} · ${item.status}`}
                          subtitle={item.source_ip ?? 'No source ip'}
                          meta={formatTimestamp(item.created_at)}
                        />
                      )) : <EmptyInline label="No registration records yet" />}
                    </DetailPanel>
                  </div>
                </div>
              ) : (
                <EmptyBlock title="No detail available" body="Select a catalog from the registry roster to inspect registration-side state." />
              )}
            </div>

            <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
              <div className="registration-panel rounded-3xl p-5">
                <div className="mb-4 flex items-center gap-3">
                  <FileClock size={16} className="text-[var(--color-registration-cyan)]" />
                  <h3 className="text-lg font-semibold">Active snapshot</h3>
                </div>
                {detail.manifestSnapshot ? (
                  <JsonBlock
                    value={{
                      snapshot_id: detail.manifestSnapshot.id,
                      manifest_url: detail.manifestSnapshot.manifestUrl,
                      manifest_hash: detail.manifestSnapshot.manifestHash,
                      created_at: detail.manifestSnapshot.createdAt,
                      query_capabilities: detail.manifestSnapshot.queryCapabilities,
                    }}
                  />
                ) : (
                  <EmptyBlock title="No active snapshot" body="This catalog has not produced an active manifest snapshot in the registration node yet." />
                )}
              </div>

              <div className="registration-panel rounded-3xl p-5">
                <div className="mb-4 flex items-center gap-3">
                  <Clock3 size={16} className="text-[var(--color-registration-amber)]" />
                  <h3 className="text-lg font-semibold">Recent search audits</h3>
                </div>
                <div className="space-y-3">
                  {audits.slice(0, 8).map((audit) => (
                    <div key={audit.id} className="rounded-2xl border border-[var(--color-registration-border)] bg-[var(--color-registration-surface)] p-3">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium">{stringValue(audit.request_payload.query) || '(empty query)'}</span>
                        <span className="text-[var(--color-registration-muted)] registration-mono">{audit.result_count} result(s)</span>
                      </div>
                      <div className="mt-2 text-xs text-[var(--color-registration-muted)] registration-mono">{formatTimestamp(audit.created_at)}</div>
                    </div>
                  ))}
                  {audits.length === 0 ? <EmptyInline label="No search audits yet" /> : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {toast ? (
        <div className={`fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-full border px-5 py-3 text-sm font-medium shadow-2xl ${toast.tone === 'danger' ? 'border-[var(--color-registration-rose)]/35 bg-[var(--color-registration-rose)] text-black' : 'border-[var(--color-registration-cyan)]/35 bg-[var(--color-registration-cyan)] text-black'}`}>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  tone: 'cyan' | 'amber' | 'rose' | 'lime';
}) {
  const color = tone === 'cyan'
    ? 'var(--color-registration-cyan)'
    : tone === 'amber'
      ? 'var(--color-registration-amber)'
      : tone === 'lime'
        ? 'var(--color-registration-lime)'
        : 'var(--color-registration-rose)';

  return (
    <div className="registration-panel rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-[var(--color-registration-muted)] registration-mono">{label}</div>
          <div className="mt-3 text-4xl font-semibold tracking-[-0.04em]">{value}</div>
        </div>
        <div className="rounded-2xl border border-[var(--color-registration-border)] p-3" style={{ color }}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function SignalCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: 'cyan' | 'amber' }) {
  const color = tone === 'cyan' ? 'text-[var(--color-registration-cyan)]' : 'text-[var(--color-registration-amber)]';
  return (
    <div className="rounded-2xl border border-[var(--color-registration-border)] bg-[var(--color-registration-surface)] p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-[var(--color-registration-muted)] registration-mono">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${color}`}>{value}</div>
      <div className="mt-1 text-xs text-[var(--color-registration-muted)] registration-mono">{note}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs uppercase tracking-[0.14em] text-[var(--color-registration-muted)] registration-mono">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-[var(--color-registration-border)] bg-[var(--color-registration-surface)] px-4 py-2.5 text-sm outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function ActionButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded-2xl border border-[var(--color-registration-border)] bg-black/12 px-4 py-3 text-sm font-medium transition hover:border-[var(--color-registration-cyan)]/40 hover:text-[var(--color-registration-cyan)] disabled:opacity-60"
    >
      {busy ? `${label}...` : label}
    </button>
  );
}

function DetailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-registration-border)] bg-[var(--color-registration-surface)] p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--color-registration-muted)] registration-mono">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-[0.14em] text-[var(--color-registration-muted)]">{label}</div>
      <div className={`mt-1 break-all text-sm ${mono ? 'registration-mono' : ''}`}>{value || '-'}</div>
    </div>
  );
}

function EventRow({ icon: Icon, title, subtitle, meta }: { icon: typeof Activity; title: string; subtitle: string; meta: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-[var(--color-registration-border)] bg-black/10 p-3">
      <div className="mt-0.5 rounded-xl border border-[var(--color-registration-border)] p-2 text-[var(--color-registration-cyan)]">
        <Icon size={14} />
      </div>
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <div className="mt-1 break-all text-xs text-[var(--color-registration-muted)]">{subtitle}</div>
        <div className="mt-1 text-xs text-[var(--color-registration-muted)] registration-mono">{meta}</div>
      </div>
    </div>
  );
}

function StatusPill({ tone, label }: { tone: 'good' | 'warn' | 'bad'; label: string }) {
  const className = tone === 'good'
    ? 'border-[var(--color-registration-lime)]/30 bg-[var(--color-registration-lime)]/10 text-[var(--color-registration-lime)]'
    : tone === 'warn'
      ? 'border-[var(--color-registration-amber)]/30 bg-[var(--color-registration-amber)]/10 text-[var(--color-registration-amber)]'
      : 'border-[var(--color-registration-rose)]/30 bg-[var(--color-registration-rose)]/10 text-[var(--color-registration-rose)]';
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] registration-mono ${className}`}>{label}</span>;
}

function EmptyBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--color-registration-border)] bg-[var(--color-registration-surface)] p-6 text-center">
      <div className="font-medium">{title}</div>
      <div className="mt-2 text-sm text-[var(--color-registration-muted)]">{body}</div>
    </div>
  );
}

function EmptyInline({ label }: { label: string }) {
  return <div className="rounded-2xl border border-dashed border-[var(--color-registration-border)] p-4 text-sm text-[var(--color-registration-muted)]">{label}</div>;
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[420px] overflow-auto rounded-2xl border border-[var(--color-registration-border)] bg-black/18 p-4 text-xs leading-6 text-[var(--color-registration-text)] registration-mono">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
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

function toneForStatus(status: string): 'good' | 'warn' | 'bad' {
  if (status === 'verified' || status === 'not_required' || status === 'healthy' || status === 'accepted_indexed') return 'good';
  if (status === 'challenge_required' || status === 'pending' || status === 'accepted_pending_verification') return 'warn';
  return 'bad';
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function unique<T>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}

function extractActionMessage(result: unknown) {
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  const message = record.message;
  return typeof message === 'string' ? message : null;
}
