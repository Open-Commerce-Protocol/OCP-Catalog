import { useMemo, type CSSProperties } from 'react';
import { Activity, AlertTriangle, Clock, DatabaseZap, Radio } from 'lucide-react';
import { useLiveActivity, type PublicActivityEvent } from '../../lib/useLiveActivity';
import { useDocsLocale } from '../../content/i18n';

const familyTone: Record<string, string> = {
  ocp: 'var(--ocp-cyan)',
  webmcp: 'var(--ocp-green)',
  agent_card: 'var(--ocp-gold)',
  feed: 'var(--ocp-vermilion)',
};

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
  return 'bg-[var(--surface-1)] text-[var(--text-muted)]';
}

export function LiveActivitySection() {
  const { locale } = useDocsLocale();
  const { events, rollups, status } = useLiveActivity({ limit: 12, windowHours: 24, pollMs: 15_000 });

  const topTypes = useMemo(
    () =>
      Object.entries(rollups?.by_event_type ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [rollups],
  );

  const copy =
    locale === 'zh'
      ? {
          kicker: '实时协议活动',
          headline: '协议正在跑，不只是文档。',
          description:
            '官网读取脱敏后的 OCP activity 公开投影，展示真实调用类型、协议族分布与健康趋势 — 让你直观看到 OCP 在生产环境的形态。',
          events: '最近事件',
          rollups: '24 小时聚合 · 事件类型',
          empty: '还没有公开活动事件。',
          unavailable: 'Activity API 暂不可用。启动 `bun run activity:api` 并执行迁移后刷新。',
          metricEvents: '事件总数',
          metricProtocols: '协议族',
          metricWindow: '观测窗口',
          offline: '离线',
        }
      : {
          kicker: 'Live protocol activity',
          headline: 'The protocol is running, not just documented.',
          description:
            'The site reads only redacted OCP activity projections — real call types, protocol family distribution, and health signals.',
          events: 'Recent events',
          rollups: '24h rollup · event types',
          empty: 'No public activity events yet.',
          unavailable: 'Activity API is unavailable. Start `bun run activity:api`, run migrations, then refresh.',
          metricEvents: 'Events',
          metricProtocols: 'Protocols',
          metricWindow: 'Window',
          offline: 'Offline',
        };

  const protocolCount = Object.keys(rollups?.by_protocol_family ?? {}).length;

  return (
    <div className="site-container">
      <div className="reveal-on-scroll grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
        <div>
          <div className="section-kicker inline-flex items-center gap-2">
            <Radio className="h-3.5 w-3.5 text-[var(--ocp-cyan)]" />
            {copy.kicker}
          </div>
          <h2 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight">{copy.headline}</h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-[var(--text-muted)]">{copy.description}</p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Metric label={copy.metricEvents} value={rollups?.event_count ?? 0} icon={Activity} />
          <Metric label={copy.metricProtocols} value={protocolCount} icon={DatabaseZap} />
          <Metric label={copy.metricWindow} value={`${rollups?.window_hours ?? 24}h`} icon={Clock} />
        </div>
      </div>

      <div className="reveal-on-scroll mt-10 grid gap-6 lg:grid-cols-[18rem_1fr]" style={{ '--reveal-delay': '120ms' } as CSSProperties}>
        <aside className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-faint)]">{copy.rollups}</h3>
          <div className="rounded-md border border-[var(--border-soft)] bg-[var(--ocp-porcelain)] p-4 shadow-sm">
            {topTypes.length > 0 ? (
              topTypes.map(([eventType, count], idx) => {
                const max = topTypes[0][1] || 1;
                const ratio = count / max;
                return (
                  <div key={eventType} className={`py-2.5 ${idx > 0 ? 'border-t border-[var(--border-soft)]' : ''}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-medium text-[var(--text-muted)]">{eventType}</span>
                      <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-muted)]">{count}</span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded bg-[var(--surface-1)]">
                      <div
                        className="h-full bg-[var(--ocp-ink)] transition-all duration-700"
                        style={{ width: `${Math.max(6, ratio * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-[var(--text-faint)]">{copy.empty}</p>
            )}
          </div>
        </aside>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-faint)]">{copy.events}</h3>
            {status === 'error' ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                {copy.offline}
              </span>
            ) : null}
          </div>

          {status === 'error' ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-5 text-sm text-red-800">{copy.unavailable}</div>
          ) : events.length === 0 ? (
            <div className="rounded-md border border-[var(--border-soft)] bg-[var(--ocp-porcelain)] p-8 text-center text-sm text-[var(--text-faint)]">
              {copy.empty}
            </div>
          ) : (
            <ul className="overflow-hidden rounded-md border border-[var(--border-soft)] bg-[var(--ocp-porcelain)] shadow-sm">
              {events.slice(0, 8).map((event) => (
                <EventRow key={event.public_event_id} event={event} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Activity }) {
  return (
    <div className="rounded-md border border-[var(--border-soft)] bg-[var(--ocp-porcelain)] p-4 shadow-sm">
      <Icon className="mb-3 h-5 w-5 text-[var(--ocp-cyan)]" />
      <div className="font-mono text-2xl font-semibold tabular-nums text-[var(--ocp-ink)]">{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">{label}</div>
    </div>
  );
}

function EventRow({ event }: { event: PublicActivityEvent }) {
  const tone = familyTone[event.protocol_family] ?? 'var(--ocp-ink)';
  return (
    <li className="grid gap-3 border-b border-[var(--border-soft)] p-4 last:border-0 md:grid-cols-[9rem_1fr_7rem]">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} />
        <time className="font-mono text-xs tabular-nums text-[var(--text-faint)]">{formatTime(event.occurred_at)}</time>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-[var(--ocp-ink)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ocp-paper)]">
            {event.event_type}
          </span>
          <span className="rounded border border-[var(--border-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
            {event.protocol_family}
          </span>
          <span className="rounded border border-[var(--border-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
            {event.source_kind}
          </span>
        </div>
        <p className="mt-1.5 truncate text-sm text-[var(--text-muted)]">{event.public_summary}</p>
      </div>
      <div className="text-left md:text-right">
        <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ${statusTone(event.status_class)}`}>
          {event.status_class}
        </span>
      </div>
    </li>
  );
}
