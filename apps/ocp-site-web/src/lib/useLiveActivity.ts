import { useEffect, useState } from 'react';

export type PublicActivityEvent = {
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

export type ActivityRollups = {
  window_hours: number;
  event_count: number;
  by_event_type: Record<string, number>;
  by_protocol_family: Record<string, number>;
  by_status_class: Record<string, number>;
};

export type LiveActivityStatus = 'loading' | 'ready' | 'error';

const activityApiUrl = (
  import.meta.env.VITE_OCP_ACTIVITY_API_URL ?? 'http://localhost:4400'
).replace(/\/+$/, '');

type Options = {
  limit?: number;
  windowHours?: number;
  pollMs?: number;
};

export function useLiveActivity({ limit = 40, windowHours = 24, pollMs = 15_000 }: Options = {}) {
  const [events, setEvents] = useState<PublicActivityEvent[]>([]);
  const [rollups, setRollups] = useState<ActivityRollups | null>(null);
  const [status, setStatus] = useState<LiveActivityStatus>('loading');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [recentResponse, rollupResponse] = await Promise.all([
          fetch(`${activityApiUrl}/api/activity/recent?limit=${limit}`),
          fetch(`${activityApiUrl}/api/activity/rollups?hours=${windowHours}`),
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
    const timer = setInterval(load, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [limit, windowHours, pollMs]);

  return { events, rollups, status };
}
