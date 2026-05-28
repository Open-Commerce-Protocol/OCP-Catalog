import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Clock, DatabaseZap, Radio } from 'lucide-react';
import { useDocsLocale } from '../content/i18n';

type PublicActivityEvent = {
  public_event_id: string;
  occurred_at: string;
  event_type: string;
  source_kind: string;
  client_kind: string;
  protocol_family: string;
  catalog_id: string | null;
  provider_id: string | null;
  object_type: string | null;
  status_class: string;
  duration_bucket: string;
  result_count_bucket: string;
  public_summary: string;
  correlation_id_hash: string | null;
};

type Rollups = {
  window_hours: number;
  event_count: number;
  by_event_type: Record<string, number>;
  by_protocol_family: Record<string, number>;
  by_status_class: Record<string, number>;
};

const activityApiUrl = (import.meta.env.VITE_OCP_ACTIVITY_API_URL ?? 'http://localhost:4400').replace(/\/+$/, '');

export function ActivityPage() {
  const { locale } = useDocsLocale();
  const [events, setEvents] = useState<PublicActivityEvent[]>([]);
  const [rollups, setRollups] = useState<Rollups | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [recentResponse, rollupResponse] = await Promise.all([
          fetch(`${activityApiUrl}/api/activity/recent?limit=40`),
          fetch(`${activityApiUrl}/api/activity/rollups?hours=24`),
        ]);

        if (!recentResponse.ok || !rollupResponse.ok) throw new Error('Activity API unavailable');
        const recentPayload = await recentResponse.json();
        const rollupPayload = await rollupResponse.json();
        if (cancelled) return;

        setEvents(Array.isArray(recentPayload.events) ? recentPayload.events : []);
        setRollups(rollupPayload);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const topTypes = useMemo(() => Object.entries(rollups?.by_event_type ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5), [rollups]);
  const copy = locale === 'zh'
    ? {
        title: 'OCP 活动流',
        eyebrow: '公开投影',
        description: '官网只读取脱敏后的 OCP activity public projection，用来展示真实协议行为、调用类型和健康趋势。',
        events: '最近事件',
        rollups: '24 小时聚合',
        empty: '还没有公开活动事件。',
        unavailable: 'Activity API 暂不可用。启动 `bun run activity:api` 并执行迁移后刷新。',
      }
    : {
        title: 'OCP Activity Stream',
        eyebrow: 'Public projection',
        description: 'The site reads only redacted OCP activity projections to show real protocol behavior, call types, and health signals.',
        events: 'Recent Events',
        rollups: '24h Rollup',
        empty: 'No public activity events yet.',
        unavailable: 'Activity API is unavailable. Start `bun run activity:api`, run migrations, then refresh.',
      };

  return (
    <main className="bg-[var(--ocp-paper)]">
      <section className="border-b border-black/10 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-black/10 bg-white/70 px-3 py-1.5 text-sm font-semibold text-black/64">
                <Radio className="h-4 w-4 text-emerald-700" />
                {copy.eyebrow}
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-[var(--ocp-ink)] sm:text-6xl">
                {copy.title}
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-black/64">{copy.description}</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Metric label="Events" value={rollups?.event_count ?? 0} icon={Activity} />
              <Metric label="Protocols" value={Object.keys(rollups?.by_protocol_family ?? {}).length} icon={DatabaseZap} />
              <Metric label="Window" value={`${rollups?.window_hours ?? 24}h`} icon={Clock} />
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[18rem_1fr]">
          <aside className="space-y-4">
            <h2 className="text-sm font-semibold uppercase text-black/50">{copy.rollups}</h2>
            <div className="rounded-md border border-black/10 bg-white/75 p-4 shadow-sm">
              {topTypes.length > 0 ? topTypes.map(([eventType, count]) => (
                <div key={eventType} className="flex items-center justify-between border-b border-black/10 py-3 last:border-0">
                  <span className="min-w-0 truncate text-sm font-medium text-black/70">{eventType}</span>
                  <span className="ml-3 rounded bg-black px-2 py-1 text-xs font-semibold text-white">{count}</span>
                </div>
              )) : <p className="text-sm text-black/50">{copy.empty}</p>}
            </div>
          </aside>

          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-black/50">{copy.events}</h2>
              {status === 'error' ? (
                <span className="inline-flex items-center gap-2 rounded-md bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700">
                  <AlertTriangle className="h-4 w-4" />
                  Offline
                </span>
              ) : null}
            </div>

            {status === 'error' ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-5 text-sm text-red-800">{copy.unavailable}</div>
            ) : events.length === 0 ? (
              <div className="rounded-md border border-black/10 bg-white/75 p-8 text-center text-black/52">{copy.empty}</div>
            ) : (
              <div className="overflow-hidden rounded-md border border-black/10 bg-white/80 shadow-sm">
                {events.map((event) => (
                  <article key={event.public_event_id} className="grid gap-3 border-b border-black/10 p-4 last:border-0 md:grid-cols-[10rem_1fr_8rem]">
                    <time className="text-xs font-semibold uppercase text-black/42">{formatTime(event.occurred_at)}</time>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-[var(--ocp-ink)] px-2 py-1 text-xs font-semibold text-[var(--ocp-paper)]">{event.event_type}</span>
                        <span className="rounded border border-black/10 px-2 py-1 text-xs font-medium text-black/54">{event.protocol_family}</span>
                        <span className="rounded border border-black/10 px-2 py-1 text-xs font-medium text-black/54">{event.source_kind}</span>
                      </div>
                      <p className="mt-2 truncate text-sm text-black/72">{event.public_summary}</p>
                    </div>
                    <div className="text-left md:text-right">
                      <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-bold ${statusTone(event.status_class)}`}>{event.status_class}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Activity }) {
  return (
    <div className="rounded-md border border-black/10 bg-white/75 p-4 shadow-sm">
      <Icon className="mb-3 h-5 w-5 text-emerald-700" />
      <div className="text-2xl font-semibold text-[var(--ocp-ink)]">{value}</div>
      <div className="mt-1 text-xs font-semibold uppercase text-black/44">{label}</div>
    </div>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusTone(statusClass: string) {
  if (statusClass === 'success') return 'bg-emerald-50 text-emerald-800';
  if (statusClass === 'client_error' || statusClass === 'policy_denied') return 'bg-amber-50 text-amber-800';
  if (statusClass === 'server_error') return 'bg-red-50 text-red-800';
  return 'bg-black/5 text-black/58';
}
