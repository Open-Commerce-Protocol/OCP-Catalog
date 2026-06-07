import { useEffect, useState } from 'react';
import { useDirectory } from './useDirectory';
import { fetchManifestOnce } from './useCatalogManifest';
import {
  aggregateCatalogScale,
  type CatalogScale,
  type ManifestProbe,
} from './catalogScale';

/**
 * Aggregates a network-wide product-scale snapshot by fanning out manifest
 * fetches over every catalog the directory discovered, then splitting totals
 * by presence of data_profile. Lazy: never blocks first paint.
 */
export function useCatalogScale(): CatalogScale {
  const { catalogs } = useDirectory({ pollMs: 60_000, searchLimit: 50 });
  // Only resolved probes live in state; URLs not yet present are treated as pending.
  const [resolved, setResolved] = useState<Map<string, ManifestProbe>>(new Map());

  const manifestUrls = catalogs
    .map((c) => c.manifest_url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
  const urlKey = manifestUrls.join('|');

  useEffect(() => {
    if (manifestUrls.length === 0) return;
    let cancelled = false;

    for (const url of manifestUrls) {
      void fetchManifestOnce(url).then((entry) => {
        if (cancelled) return;
        const probe: ManifestProbe =
          entry.status === 'ready'
            ? {
                status: 'ready',
                dataProfileCount: entry.manifest.data_profile?.catalog_entry_count ?? null,
              }
            : { status: 'error', dataProfileCount: null };
        setResolved((prev) => {
          const next = new Map(prev);
          next.set(url, probe);
          return next;
        });
      });
    }

    return () => {
      cancelled = true;
    };
    // urlKey captures the set of URLs; manifestUrls is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  // Derive the full probe set during render: a discovered URL with no resolved
  // entry yet counts as pending. No setState in the effect body.
  const probes: ManifestProbe[] = manifestUrls.map(
    (url) => resolved.get(url) ?? { status: 'pending', dataProfileCount: null },
  );

  return aggregateCatalogScale(probes);
}
