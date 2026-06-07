# Site Product-Scale Stats & Markdown News Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-dimension product-scale counter to the homepage hero (Stored & indexed N / Streamed on demand ∞) and convert news (updates) bodies from hardcoded paragraph arrays to Markdown files with image support.

**Architecture:** Feature A adds a client-side lazy-aggregation hook that fans out over catalogs discovered by the existing `useDirectory`, fetches each catalog manifest (reusing the existing manifest cache), and splits totals by presence of `data_profile`. Feature B migrates news bodies to `.md` files loaded via `import.meta.glob` (mirroring the docs `loader.ts` pattern) and renders them with a shared `react-markdown` component subset extracted from `PageView.tsx`. All testable logic is factored into pure functions so the repo's `bun test` runner can cover it without a DOM.

**Tech Stack:** React 19, react-router-dom 7, react-markdown 10, TypeScript, Vite, Bun (`bun test`), Turbo.

---

## Pre-work: enable testing in site-web

The `apps/ocp-site-web` package currently has **no `test` script** and no test runner. The monorepo standard is Bun's built-in runner (`bun test`, imports from `bun:test`). This task wires it up so `turbo test` discovers the new tests.

### Task 0: Add a test script to site-web

**Files:**
- Modify: `apps/ocp-site-web/package.json:6-13`

- [ ] **Step 1: Add the test script**

In `apps/ocp-site-web/package.json`, add a `test` entry to `scripts` (matching how `packages/ocp-schema/package.json` does it):

```json
  "scripts": {
    "dev": "bunx vite",
    "start": "bun src/server.ts",
    "typecheck": "tsc -b",
    "build": "tsc -b && bunx vite build",
    "lint": "eslint .",
    "preview": "bunx vite preview",
    "test": "bun test --pass-with-no-tests"
  },
```

- [ ] **Step 2: Verify the runner works with no tests yet**

Run: `bun run --cwd apps/ocp-site-web test`
Expected: exits 0 with a "no tests" / pass-with-no-tests message.

- [ ] **Step 3: Commit**

```bash
git add apps/ocp-site-web/package.json
git commit -m "chore(site): add bun test script to site-web"
```

---

## Feature A: Homepage product-scale stats

### Task A1: `formatCompactCount` helper + tests

A pure function that turns a count into a compact label (`12_480_000 → "12.4M"`). Locale-independent.

**Files:**
- Create: `apps/ocp-site-web/src/lib/formatScale.ts`
- Test: `apps/ocp-site-web/src/lib/formatScale.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/ocp-site-web/src/lib/formatScale.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { formatCompactCount } from './formatScale';

describe('formatCompactCount', () => {
  test('returns plain number below 1000', () => {
    expect(formatCompactCount(0)).toBe('0');
    expect(formatCompactCount(42)).toBe('42');
    expect(formatCompactCount(999)).toBe('999');
  });

  test('formats thousands with K', () => {
    expect(formatCompactCount(1000)).toBe('1K');
    expect(formatCompactCount(9500)).toBe('9.5K');
    expect(formatCompactCount(12_300)).toBe('12.3K');
  });

  test('formats millions with M', () => {
    expect(formatCompactCount(1_000_000)).toBe('1M');
    expect(formatCompactCount(12_480_000)).toBe('12.5M');
    expect(formatCompactCount(999_000_000)).toBe('999M');
  });

  test('formats billions with B', () => {
    expect(formatCompactCount(1_000_000_000)).toBe('1B');
    expect(formatCompactCount(2_500_000_000)).toBe('2.5B');
  });

  test('drops trailing .0', () => {
    expect(formatCompactCount(2_000_000)).toBe('2M');
  });

  test('guards against negatives and non-finite', () => {
    expect(formatCompactCount(-5)).toBe('0');
    expect(formatCompactCount(Number.NaN)).toBe('0');
  });
});
```

> Note: `12_480_000` rounds to `12.5M` (one decimal, rounded). The spec's "12.4M" was illustrative; the test pins the actual rounding behavior.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/ocp-site-web/src/lib/formatScale.test.ts`
Expected: FAIL — `Cannot find module './formatScale'` / `formatCompactCount is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/ocp-site-web/src/lib/formatScale.ts`:

```ts
/**
 * Compact, locale-independent count label: 12_480_000 -> "12.5M".
 * One decimal place, trailing ".0" dropped. Non-finite/negative -> "0".
 */
export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';

  const units: Array<{ threshold: number; suffix: string }> = [
    { threshold: 1_000_000_000, suffix: 'B' },
    { threshold: 1_000_000, suffix: 'M' },
    { threshold: 1_000, suffix: 'K' },
  ];

  for (const { threshold, suffix } of units) {
    if (value >= threshold) {
      const scaled = value / threshold;
      const rounded = Math.round(scaled * 10) / 10;
      const text = rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
      return `${text}${suffix}`;
    }
  }

  return String(Math.round(value));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/ocp-site-web/src/lib/formatScale.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/ocp-site-web/src/lib/formatScale.ts apps/ocp-site-web/src/lib/formatScale.test.ts
git commit -m "feat(site): add formatCompactCount helper"
```

---

### Task A2: Pure scale-aggregation reducer + tests

Factor the "split manifests into stored-total vs streamed-count" logic into a pure function so it's testable without React. The hook (Task A4) is a thin wrapper around it.

**Files:**
- Create: `apps/ocp-site-web/src/lib/catalogScale.ts`
- Test: `apps/ocp-site-web/src/lib/catalogScale.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/ocp-site-web/src/lib/catalogScale.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { aggregateCatalogScale, type ManifestProbe } from './catalogScale';

describe('aggregateCatalogScale', () => {
  test('sums catalog_entry_count for stored catalogs', () => {
    const probes: ManifestProbe[] = [
      { status: 'ready', dataProfileCount: 1000 },
      { status: 'ready', dataProfileCount: 500 },
    ];
    const result = aggregateCatalogScale(probes);
    expect(result.storedTotal).toBe(1500);
    expect(result.storedCatalogCount).toBe(2);
    expect(result.streamedCatalogCount).toBe(0);
  });

  test('counts manifests without a data profile as streamed', () => {
    const probes: ManifestProbe[] = [
      { status: 'ready', dataProfileCount: 2000 },
      { status: 'ready', dataProfileCount: null },
      { status: 'ready', dataProfileCount: null },
    ];
    const result = aggregateCatalogScale(probes);
    expect(result.storedTotal).toBe(2000);
    expect(result.storedCatalogCount).toBe(1);
    expect(result.streamedCatalogCount).toBe(2);
  });

  test('ignores errored and pending probes in totals', () => {
    const probes: ManifestProbe[] = [
      { status: 'ready', dataProfileCount: 100 },
      { status: 'error', dataProfileCount: null },
      { status: 'pending', dataProfileCount: null },
    ];
    const result = aggregateCatalogScale(probes);
    expect(result.storedTotal).toBe(100);
    expect(result.storedCatalogCount).toBe(1);
    expect(result.streamedCatalogCount).toBe(0);
  });

  test('status is unavailable when no probe ever succeeded', () => {
    expect(aggregateCatalogScale([]).status).toBe('unavailable');
    expect(
      aggregateCatalogScale([{ status: 'error', dataProfileCount: null }]).status,
    ).toBe('unavailable');
  });

  test('status is loading while probes are still pending and none failed-to-empty', () => {
    const result = aggregateCatalogScale([
      { status: 'ready', dataProfileCount: 100 },
      { status: 'pending', dataProfileCount: null },
    ]);
    expect(result.status).toBe('loading');
  });

  test('status is ready when all probes settled and at least one succeeded', () => {
    const result = aggregateCatalogScale([
      { status: 'ready', dataProfileCount: 100 },
      { status: 'error', dataProfileCount: null },
    ]);
    expect(result.status).toBe('ready');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/ocp-site-web/src/lib/catalogScale.test.ts`
Expected: FAIL — `Cannot find module './catalogScale'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/ocp-site-web/src/lib/catalogScale.ts`:

```ts
export type ManifestProbeStatus = 'pending' | 'ready' | 'error';

/** One catalog's manifest probe, reduced to just what scale needs. */
export type ManifestProbe = {
  status: ManifestProbeStatus;
  /** catalog_entry_count if the manifest has a data_profile, else null. */
  dataProfileCount: number | null;
};

export type CatalogScaleStatus = 'loading' | 'ready' | 'unavailable';

export type CatalogScale = {
  status: CatalogScaleStatus;
  storedTotal: number;
  storedCatalogCount: number;
  streamedCatalogCount: number;
};

/**
 * Reduce a set of per-catalog manifest probes into the two scale dimensions.
 * - stored: manifests that expose data_profile.catalog_entry_count (summed)
 * - streamed: ready manifests with no data_profile (bridge / live forwarding)
 * Errored and pending probes never contribute to totals.
 */
export function aggregateCatalogScale(probes: ManifestProbe[]): CatalogScale {
  let storedTotal = 0;
  let storedCatalogCount = 0;
  let streamedCatalogCount = 0;
  let readyCount = 0;
  let pendingCount = 0;

  for (const probe of probes) {
    if (probe.status === 'pending') {
      pendingCount += 1;
      continue;
    }
    if (probe.status === 'error') {
      continue;
    }
    // status === 'ready'
    readyCount += 1;
    if (probe.dataProfileCount != null) {
      storedTotal += probe.dataProfileCount;
      storedCatalogCount += 1;
    } else {
      streamedCatalogCount += 1;
    }
  }

  let status: CatalogScaleStatus;
  if (readyCount === 0 && pendingCount === 0) {
    status = 'unavailable';
  } else if (pendingCount > 0) {
    status = 'loading';
  } else {
    status = readyCount > 0 ? 'ready' : 'unavailable';
  }

  return { status, storedTotal, storedCatalogCount, streamedCatalogCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/ocp-site-web/src/lib/catalogScale.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/ocp-site-web/src/lib/catalogScale.ts apps/ocp-site-web/src/lib/catalogScale.test.ts
git commit -m "feat(site): add catalog-scale aggregation reducer"
```

---

### Task A3: Share the manifest fetch/cache from `useCatalogManifest`

Export the existing `fetchOnce` so the scale hook reuses the same per-URL manifest cache as `CatalogDrawer`. Behavior of `useCatalogManifest` is unchanged.

**Files:**
- Modify: `apps/ocp-site-web/src/lib/useCatalogManifest.ts:51-86`

- [ ] **Step 1: Rename and export the shared fetcher + entry type**

In `apps/ocp-site-web/src/lib/useCatalogManifest.ts`, change the `FetchEntry` type and `fetchOnce` function to be exported, and rename `fetchOnce` to `fetchManifestOnce` for a clearer public name. Update the one internal caller (line ~102).

Replace lines 51–86:

```ts
export type ManifestFetchEntry =
  | { status: 'ready'; manifest: CatalogManifest }
  | { status: 'error'; error: string };

const cache = new Map<string, ManifestFetchEntry>();
const inflight = new Map<string, Promise<ManifestFetchEntry>>();

export function fetchManifestOnce(url: string): Promise<ManifestFetchEntry> {
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = fetch(url, { headers: { accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as CatalogManifest;
      const entry: ManifestFetchEntry = { status: 'ready', manifest: json };
      cache.set(url, entry);
      return entry;
    })
    .catch((err): ManifestFetchEntry => {
      const entry: ManifestFetchEntry = {
        status: 'error',
        error: err instanceof Error ? err.message : 'fetch failed',
      };
      cache.set(url, entry);
      return entry;
    })
    .finally(() => {
      inflight.delete(url);
    });

  inflight.set(url, promise);
  return promise;
}
```

Then in `useCatalogManifest` (the effect body, ~line 102) change `void fetchOnce(manifestUrl)` to `void fetchManifestOnce(manifestUrl)`. The `FetchEntry` type alias references inside `useCatalogManifest` (the `entry.status` checks at ~lines 111-114) keep working unchanged since they read `.status` / `.manifest` / `.error`.

- [ ] **Step 2: Verify no other references to the old name**

Run: `grep -rn "fetchOnce" apps/ocp-site-web/src`
Expected: no matches (all renamed to `fetchManifestOnce`).

- [ ] **Step 3: Typecheck**

Run: `bun run --cwd apps/ocp-site-web typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add apps/ocp-site-web/src/lib/useCatalogManifest.ts
git commit -m "refactor(site): export shared manifest fetcher for reuse"
```

---

### Task A4: `useCatalogScale` hook

Thin React wrapper: discover catalogs via `useDirectory`, fan out manifest fetches via `fetchManifestOnce`, reduce with `aggregateCatalogScale`. No new test (logic is covered in A2; hook wiring is verified by typecheck + build + manual).

**Files:**
- Create: `apps/ocp-site-web/src/lib/useCatalogScale.ts`

- [ ] **Step 1: Write the hook**

Create `apps/ocp-site-web/src/lib/useCatalogScale.ts`:

```ts
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
  const [probes, setProbes] = useState<Map<string, ManifestProbe>>(new Map());

  // Stable key list of manifest URLs to depend on.
  const manifestUrls = catalogs
    .map((c) => c.manifest_url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
  const urlKey = manifestUrls.join('|');

  useEffect(() => {
    if (manifestUrls.length === 0) return;
    let cancelled = false;

    // Seed every URL as pending so status reflects in-flight work.
    setProbes((prev) => {
      const next = new Map(prev);
      for (const url of manifestUrls) {
        if (!next.has(url)) next.set(url, { status: 'pending', dataProfileCount: null });
      }
      return next;
    });

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
        setProbes((prev) => {
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

  return aggregateCatalogScale([...probes.values()]);
}
```

> `entry.manifest.data_profile?.catalog_entry_count` relies on the `CatalogDataProfile` / `CatalogManifest` types already declared in `useCatalogManifest.ts` (lines 24-47).

- [ ] **Step 2: Typecheck**

Run: `bun run --cwd apps/ocp-site-web typecheck`
Expected: PASS.

- [ ] **Step 3: Lint (hook deps + rules)**

Run: `bun run --cwd apps/ocp-site-web lint`
Expected: PASS (the single `exhaustive-deps` disable is intentional and scoped).

- [ ] **Step 4: Commit**

```bash
git add apps/ocp-site-web/src/lib/useCatalogScale.ts
git commit -m "feat(site): add useCatalogScale lazy aggregation hook"
```

---

### Task A5: Render the scale cards in the hero (replace decorative stats)

Replace the `heroStats` (01/02/03) block in `HomePage.tsx` with two data cards driven by `useCatalogScale`.

**Files:**
- Modify: `apps/ocp-site-web/src/pages/HomePage.tsx` (imports ~line 1-14; remove `heroStats` const ~line 32-36; replace the stats grid ~line 248-255)

- [ ] **Step 1: Add imports and remove the decorative const**

At the top of `apps/ocp-site-web/src/pages/HomePage.tsx`, add to the existing imports:

```ts
import { useCatalogScale } from '../lib/useCatalogScale';
import { formatCompactCount } from '../lib/formatScale';
```

Delete the `heroStats` constant (lines ~32-36):

```ts
// DELETE this block:
const heroStats = [
  { value: '01', label: { en: 'Discover', zh: '发现' } },
  { value: '02', label: { en: 'Resolve', zh: '解析' } },
  { value: '03', label: { en: 'Confirm', zh: '确认' } },
];
```

- [ ] **Step 2: Call the hook in the component**

Inside `export function HomePage()` (just after `const latestUpdate = updates[0];`, ~line 76), add:

```ts
  const scale = useCatalogScale();
```

- [ ] **Step 3: Replace the stats grid markup**

Replace the decorative three-column grid (lines ~248-255):

```tsx
            <div className="reveal-item mt-10 grid max-w-xl grid-cols-3 gap-2">
              {heroStats.map((item) => (
                <div key={item.value} className="rounded-md border border-black/10 bg-white/60 p-3 shadow-sm backdrop-blur">
                  <div className="font-mono text-xs font-semibold text-[var(--ocp-vermilion)]">{item.value}</div>
                  <div className="mt-1 text-sm font-semibold text-black/74">{label(item.label, locale)}</div>
                </div>
              ))}
            </div>
```

with two scale cards (hidden entirely when unavailable):

```tsx
            {scale.status !== 'unavailable' && (
              <div className="reveal-item mt-10 grid max-w-xl grid-cols-2 gap-3">
                <div className="rounded-md border border-black/10 bg-white/60 p-4 shadow-sm backdrop-blur">
                  <div className="text-xs font-semibold uppercase tracking-wide text-black/52">
                    {locale === 'zh' ? '存储索引' : 'Stored & indexed'}
                  </div>
                  <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-[var(--ocp-ink)]">
                    {scale.status === 'loading' ? '—' : formatCompactCount(scale.storedTotal)}
                  </div>
                </div>
                <div className="rounded-md border border-black/10 bg-white/60 p-4 shadow-sm backdrop-blur">
                  <div className="text-xs font-semibold uppercase tracking-wide text-black/52">
                    {locale === 'zh' ? '按需流转' : 'Streamed on demand'}
                  </div>
                  <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-[var(--ocp-cyan)]">
                    ∞
                  </div>
                </div>
              </div>
            )}
```

- [ ] **Step 4: Verify no dangling references to `heroStats`**

Run: `grep -n "heroStats" apps/ocp-site-web/src/pages/HomePage.tsx`
Expected: no matches.

- [ ] **Step 5: Typecheck + build**

Run: `bun run --cwd apps/ocp-site-web typecheck && bun run --cwd apps/ocp-site-web build`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/ocp-site-web/src/pages/HomePage.tsx
git commit -m "feat(site): show product-scale cards in homepage hero"
```

---

### Task A6: Manual verification of Feature A

**Files:** none (manual).

- [ ] **Step 1: Run the dev server and the demo backends**

Run: `bun run dev:demo` (from repo root) — this starts the registration API, catalog APIs, and site-web together.
Expected: site-web serves on its dev port; backends respond.

- [ ] **Step 2: Open the homepage and observe the hero**

Visit the site root. Confirm:
- The hero left column shows two cards ("Stored & indexed" with a number, "Streamed on demand" with ∞) instead of 01/02/03.
- On first paint the stored number shows `—`, then settles to a real compact number once manifests load.
- Switch to `/zh` and confirm labels read 存储索引 / 按需流转.

- [ ] **Step 3: Verify the unavailable path**

Stop the backend APIs and hard-reload. Confirm the two-card block does **not** render (no `0`, no broken card) — the rest of the hero is intact.

- [ ] **Step 4: Note results** (no commit — verification only)

---

## Feature B: Markdown news

### Task B1: Extract a shared `stripFrontmatter` utility

Both the docs loader and the new updates loader need frontmatter stripping. DRY it into one module.

**Files:**
- Create: `apps/ocp-site-web/src/content/markdown-frontmatter.ts`
- Test: `apps/ocp-site-web/src/content/markdown-frontmatter.test.ts`
- Modify: `apps/ocp-site-web/src/content/loader.ts:8-10`

- [ ] **Step 1: Write the failing test**

Create `apps/ocp-site-web/src/content/markdown-frontmatter.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { stripFrontmatter } from './markdown-frontmatter';

describe('stripFrontmatter', () => {
  test('removes a leading frontmatter block', () => {
    const input = '---\ntitle: Hi\n---\n# Body\n\ntext';
    expect(stripFrontmatter(input)).toBe('# Body\n\ntext');
  });

  test('handles CRLF line endings', () => {
    const input = '---\r\ntitle: Hi\r\n---\r\n# Body';
    expect(stripFrontmatter(input)).toBe('# Body');
  });

  test('leaves content without frontmatter untouched', () => {
    const input = '# Body\n\ntext';
    expect(stripFrontmatter(input)).toBe('# Body\n\ntext');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/ocp-site-web/src/content/markdown-frontmatter.test.ts`
Expected: FAIL — `Cannot find module './markdown-frontmatter'`.

- [ ] **Step 3: Write the implementation**

Create `apps/ocp-site-web/src/content/markdown-frontmatter.ts`:

```ts
/** Strip a leading YAML frontmatter block (--- ... ---) from markdown. */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/ocp-site-web/src/content/markdown-frontmatter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Update `loader.ts` to reuse it**

In `apps/ocp-site-web/src/content/loader.ts`, remove the local `stripFrontmatter` (lines 8-10) and import the shared one. Top of file becomes:

```ts
import { docsPublicPathToContentModule } from './routing';
import { stripFrontmatter } from './markdown-frontmatter';
```

(Delete the local `function stripFrontmatter(...) { ... }`. The two call sites `stripFrontmatter(await loader())` stay unchanged.)

- [ ] **Step 6: Typecheck**

Run: `bun run --cwd apps/ocp-site-web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/ocp-site-web/src/content/markdown-frontmatter.ts apps/ocp-site-web/src/content/markdown-frontmatter.test.ts apps/ocp-site-web/src/content/loader.ts
git commit -m "refactor(site): extract shared stripFrontmatter utility"
```

---

### Task B2: Updates content loader (pure resolver + glob wrapper) + tests

Mirror `loader.ts`. Split the path-resolution logic into a pure function so it's testable without `import.meta.glob`.

**Files:**
- Create: `apps/ocp-site-web/src/content/updates-loader.ts`
- Test: `apps/ocp-site-web/src/content/updates-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/ocp-site-web/src/content/updates-loader.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { resolveUpdateContent } from './updates-loader';

const modules: Record<string, string> = {
  './updates/demo.md': '# English body',
  './updates/locales/zh/demo.md': '# 中文正文',
  './updates/en-only.md': '# Only english',
};

describe('resolveUpdateContent', () => {
  test('returns english content for en locale', () => {
    expect(resolveUpdateContent('demo', 'en', modules)).toBe('# English body');
  });

  test('returns localized content for zh when present', () => {
    expect(resolveUpdateContent('demo', 'zh', modules)).toBe('# 中文正文');
  });

  test('falls back to english when zh missing', () => {
    expect(resolveUpdateContent('en-only', 'zh', modules)).toBe('# Only english');
  });

  test('returns null when the slug does not exist', () => {
    expect(resolveUpdateContent('missing', 'en', modules)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/ocp-site-web/src/content/updates-loader.test.ts`
Expected: FAIL — `Cannot find module './updates-loader'`.

- [ ] **Step 3: Write the implementation**

Create `apps/ocp-site-web/src/content/updates-loader.ts`:

```ts
import type { DocsLocale } from './i18n';
import { stripFrontmatter } from './markdown-frontmatter';

const rawModules = import.meta.glob('./updates/**/*.md', {
  query: '?raw',
  import: 'default',
});

/**
 * Pure resolver: given a map of module-path -> raw string, return the best
 * raw markdown for (slug, locale), or null if the slug has no english source.
 * Exported for testing; production passes pre-resolved strings via loadUpdateContent.
 */
export function resolveUpdateContent(
  slug: string,
  locale: DocsLocale,
  resolved: Record<string, string>,
): string | null {
  const en = `./updates/${slug}.md`;
  const localized = `./updates/locales/${locale}/${slug}.md`;
  const candidates = locale === 'en' ? [en] : [localized, en];

  for (const candidate of candidates) {
    if (candidate in resolved) return resolved[candidate];
  }
  return null;
}

/**
 * Load + strip frontmatter for a news article. Returns a fallback markdown
 * string if the slug has no content file.
 */
export async function loadUpdateContent(slug: string, locale: DocsLocale = 'en'): Promise<string> {
  const en = `./updates/${slug}.md`;
  const localized = `./updates/locales/${locale}/${slug}.md`;
  const candidates = locale === 'en' ? [en] : [localized, en];

  for (const candidate of candidates) {
    const loader = rawModules[candidate] as (() => Promise<string>) | undefined;
    if (loader) {
      return stripFrontmatter(await loader());
    }
  }

  return `# Not available\n\nThis news article has no content file yet (expected \`src/content/updates/${slug}.md\`).`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/ocp-site-web/src/content/updates-loader.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/ocp-site-web/src/content/updates-loader.ts apps/ocp-site-web/src/content/updates-loader.test.ts
git commit -m "feat(site): add markdown updates content loader"
```

---

### Task B3: Extract shared markdown render helpers from `PageView`

Pull the reusable, navigation-free pieces out of `PageView.tsx` into a shared module so the news renderer reuses the same table/code/image/text behavior. TOC/heading-id logic stays in `PageView`.

**Files:**
- Create: `apps/ocp-site-web/src/lib/markdown-render.tsx`
- Modify: `apps/ocp-site-web/src/pages/PageView.tsx` (import the moved helpers; delete their local copies)

- [ ] **Step 1: Create the shared render module**

Create `apps/ocp-site-web/src/lib/markdown-render.tsx` by moving these functions verbatim out of `PageView.tsx`: `extractTextFromNode`, `splitTableRow`, `isTableSeparator`, `parsePipeTable`, `renderTableCellContent`. Also add the standalone `img` renderer used by both. Add the imports they need.

```tsx
import { Children, isValidElement, type ReactNode } from 'react';

export function extractTextFromNode(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => extractTextFromNode(child)).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractTextFromNode(node.props.children);
  }
  return Children.toArray(node).map((child) => extractTextFromNode(child)).join('');
}

export function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function parsePipeTable(value: string): string[][] | null {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3 || !lines.every((line) => line.startsWith('|') && line.endsWith('|'))) {
    return null;
  }
  if (!isTableSeparator(lines[1])) {
    return null;
  }

  const rows = lines.filter((_, index) => index !== 1).map(splitTableRow);
  const columnCount = rows[0]?.length ?? 0;

  if (columnCount < 2 || rows.some((row) => row.length !== columnCount)) {
    return null;
  }
  return rows;
}

export function renderTableCellContent(value: string): ReactNode {
  return value
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={index}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
}

/** Resolve markdown image src under public/images and render with site styling. */
export function renderMarkdownImage(src: string | undefined, alt: string | undefined) {
  const imageSrc = src?.startsWith('images/') ? `/${src}` : src;
  return <img src={imageSrc} alt={alt ?? ''} className="rounded-lg border border-black/10" />;
}
```

- [ ] **Step 2: Update `PageView.tsx` to import the moved helpers**

In `apps/ocp-site-web/src/pages/PageView.tsx`:
- Delete the local definitions of `extractTextFromNode`, `splitTableRow`, `isTableSeparator`, `parsePipeTable`, `renderTableCellContent` (lines ~51-145).
- Add an import:

```ts
import {
  extractTextFromNode,
  parsePipeTable,
  renderTableCellContent,
  renderMarkdownImage,
} from '../lib/markdown-render';
```

- Replace the inline `img` component (lines ~243-246) with:

```tsx
    img: ({ src, alt }) => renderMarkdownImage(src, alt),
```

- The `Children, isValidElement` imports from `'react'` at line 1 are now only needed if still used elsewhere in `PageView`; if unused after the move, remove them from the line-1 import to satisfy lint. (`useEffect, useMemo, useState, type ReactNode` are still used.)

- [ ] **Step 3: Typecheck**

Run: `bun run --cwd apps/ocp-site-web typecheck`
Expected: PASS.

- [ ] **Step 4: Lint (catch unused imports)**

Run: `bun run --cwd apps/ocp-site-web lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ocp-site-web/src/lib/markdown-render.tsx apps/ocp-site-web/src/pages/PageView.tsx
git commit -m "refactor(site): extract shared markdown render helpers"
```

---

### Task B4: `MarkdownArticle` component for news bodies

A self-contained renderer: external links open directly, internal `/`-links navigate via router, images and tables reuse the shared helpers. No TOC, no docs-route rewriting.

**Files:**
- Create: `apps/ocp-site-web/src/components/site/MarkdownArticle.tsx`

- [ ] **Step 1: Write the component**

Create `apps/ocp-site-web/src/components/site/MarkdownArticle.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import {
  extractTextFromNode,
  parsePipeTable,
  renderTableCellContent,
  renderMarkdownImage,
} from '../../lib/markdown-render';

function buildComponents(navigate: ReturnType<typeof useNavigate>): Components {
  return {
    p: ({ children }) => {
      const tableRows = parsePipeTable(extractTextFromNode(children));
      if (!tableRows) {
        return <p>{children}</p>;
      }
      const [headers, ...bodyRows] = tableRows;
      return (
        <div className="docs-table-shell not-prose">
          <table className="docs-table">
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th key={index}>{renderTableCellContent(header)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{renderTableCellContent(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    },
    a: ({ href, children }) => {
      if (!href) return <span>{children}</span>;
      const isExternal = /^[a-z]+:/i.test(href) || href.startsWith('//');
      if (isExternal) {
        return (
          <a href={href} target="_blank" rel="noreferrer" className="text-[var(--ocp-cyan)] hover:text-[var(--ocp-ink)]">
            {children}
          </a>
        );
      }
      const target = href.startsWith('/') ? href : `/${href.replace(/^\/+/, '')}`;
      return (
        <a
          href={target}
          onClick={(event) => {
            event.preventDefault();
            navigate(target);
          }}
          className="text-[var(--ocp-cyan)] hover:text-[var(--ocp-ink)]"
        >
          {children}
        </a>
      );
    },
    pre: ({ children }) => (
      <div className="docs-code-shell not-prose">
        <pre className="docs-code-block">{children}</pre>
      </div>
    ),
    img: ({ src, alt }) => renderMarkdownImage(src, alt),
  };
}

export function MarkdownArticle({ content }: { content: string }) {
  const navigate = useNavigate();
  const components = buildComponents(navigate);
  return (
    <article className="docs-prose prose prose-slate max-w-none prose-headings:font-bold prose-a:text-[var(--ocp-cyan)] hover:prose-a:text-[var(--ocp-ink)]">
      <Markdown components={components}>{content}</Markdown>
    </article>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --cwd apps/ocp-site-web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/ocp-site-web/src/components/site/MarkdownArticle.tsx
git commit -m "feat(site): add MarkdownArticle renderer for news bodies"
```

---

### Task B5: Migrate the `SiteUpdate` type and the 7 update bodies to `.md`

Drop `body` from the type, add optional `cover`, and write 14 markdown files (7 slugs × en/zh) carrying the existing paragraph text verbatim.

**Files:**
- Modify: `apps/ocp-site-web/src/content/updates.ts` (type at lines 5-15; remove every `body: [...]` entry)
- Create: `apps/ocp-site-web/src/content/updates/<slug>.md` (7 files)
- Create: `apps/ocp-site-web/src/content/updates/locales/zh/<slug>.md` (7 files)

- [ ] **Step 1: Update the `SiteUpdate` type**

In `apps/ocp-site-web/src/content/updates.ts`, change the type (lines 5-15):

```ts
export type SiteUpdate = {
  slug: string;
  publishedAt: string;
  category: UpdateCategory;
  version?: string;
  breaking: boolean;
  tags: string[];
  title: LocalizedText;
  summary: LocalizedText;
  /** Optional cover image, relative path under public/ (e.g. images/site/x.png). */
  cover?: string;
};
```

Then remove the `body: [ ... ]` property from all 7 entries in the `updates` array (keep every other field intact).

- [ ] **Step 2: Create the 7 English markdown files**

Create each file with the paragraph text from the corresponding old `body[].en`, paragraphs separated by a blank line.

`apps/ocp-site-web/src/content/updates/ocp-catalog-integrates-agent-platforms.md`:

```markdown
Work is currently in progress to bring the OCP Catalog plugin to agent platforms including Coze and QClaw. The goal is that an agent on those platforms can discover and compare catalog objects through the standard OCP workflow.

The boundary stays the same as every other OCP integration: catalogs help with discovery, search, and resolve, but checkout and the final commercial relationship return to the merchant. Platform availability will be rolled out gradually.
```

`apps/ocp-site-web/src/content/updates/ocp-cli-and-skill-coming-soon.md`:

```markdown
The CLI turns the standard OCP workflow into commands — discover, search, inspect, query, resolve — and returns structured JSON for both help and results, so agents can act on output without parsing terminal prose.

The most useful piece is manifest-based request validation: before a query is sent, the CLI checks it against the Catalog manifest and rejects an unsupported query pack, an unknown filter field, invalid pagination, or a missing query string — keeping agent parameters clean and moving errors earlier.

It is not published to npm yet, so it is marked as coming soon. To try it now, clone github.com/Open-Commerce-Protocol/OCP-Catalog and run the bundled CLI, or install the standalone skill into your agent. See the docs page CLI & Skill (/docs/cli-and-skill) for the full guide.
```

`apps/ocp-site-web/src/content/updates/shopify-provider-app-syncs-merchant-products.md`:

```markdown
The app connects to Shopify Admin GraphQL, builds a ProviderRegistration for the merchant, maps Shopify products into OCP CommercialObjects, and pushes them through /ocp/providers/register and /ocp/objects/sync.

Full sync, delta sync, one-product sync, signed product webhooks, tombstones for deleted products, and an admin status endpoint are implemented in the example app. Mock fixtures are enabled by default so the flow can be validated without real merchant credentials.

The value is practical distribution: a merchant does not need to build a catalog or rewrite agent-side integrations. Once the app is installed and connected, its products become searchable in a compatible OCP catalog, while checkout and the final commercial relationship remain on the original Shopify storefront.
```

`apps/ocp-site-web/src/content/updates/woocommerce-provider-app-opens-wordpress-commerce-to-ocp.md`:

```markdown
The app reads products from /wp-json/wc/v3/products, maps WooCommerce fields into OCP product, price, and inventory packs, and registers the merchant as a Provider with ocp.push.batch sync capability.

It supports full sync, modified-after delta sync, single-product sync, variable-product variation embedding, HMAC-signed WooCommerce webhooks, and inactive tombstones for deleted products.

This makes WordPress commerce inventory available to OCP-compatible catalogs without forcing merchants into a new storefront. Catalogs can promote and resolve the merchant products, but the final product page and transaction remain under the merchant site.
```

`apps/ocp-site-web/src/content/updates/unified-public-site.md`:

```markdown
Visitors now land on a visual overview first: what OCP connects, how agents use catalogs, and where action boundaries stay under user control. Detailed protocol material remains available under /docs.

Existing schema references, examples, and implementation notes are still available for builders who want to go deeper.
```

`apps/ocp-site-web/src/content/updates/catalog-handshake-and-registration-v1.md`:

```markdown
Handshake pages describe CatalogManifest, ObjectContract, SyncCapabilities, ProviderRegistration, CommercialObject, and RegistrationResult.

Registration pages cover discovery, catalog registration, catalog search, route hints, verification, and refresh behavior.
```

`apps/ocp-site-web/src/content/updates/commerce-examples-expanded.md`:

```markdown
These examples are meant to show the practical boundary between data sourcing, catalog search, resolve, and action execution.
```

- [ ] **Step 3: Create the 7 Chinese markdown files**

Create each under `apps/ocp-site-web/src/content/updates/locales/zh/<slug>.md` with the text from the old `body[].zh`.

`.../locales/zh/ocp-catalog-integrates-agent-platforms.md`:

```markdown
我们正在推进将 OCP Catalog 插件接入 Coze、QClaw 等智能体平台。目标是让这些平台上的 Agent 能够通过标准 OCP 工作流，发现并比较 Catalog 对象。

边界与其他 OCP 集成保持一致：Catalog 负责发现、搜索与 resolve，但结账与最终商业关系仍回到商家。各平台的支持会逐步上线。
```

`.../locales/zh/ocp-cli-and-skill-coming-soon.md`:

```markdown
CLI 把标准 OCP 工作流变成命令——发现、搜索、查看、查询、resolve——并且 help 和结果都返回结构化 JSON，因此 Agent 无需解析终端文本即可基于输出行动。

最有用的能力是基于 manifest 的请求校验：在查询发送前，CLI 会用 Catalog manifest 校验请求，拒绝不支持的 query pack、未知 filter 字段、非法分页或缺失的查询文本——让 Agent 传参更规范，把错误前移。

它还没有发布到 npm，因此标注为即将推出。想现在尝鲜，可以克隆 github.com/Open-Commerce-Protocol/OCP-Catalog 运行内置 CLI，或把独立 skill 安装到你的 Agent。完整引导见文档「CLI 与 Skill」页面（/docs/cli-and-skill）。
```

`.../locales/zh/shopify-provider-app-syncs-merchant-products.md`:

```markdown
这个 app 会连接 Shopify Admin GraphQL，为商家生成 ProviderRegistration，把 Shopify 商品映射成 OCP CommercialObject，并通过 /ocp/providers/register 与 /ocp/objects/sync 推送到 Catalog。

示例 app 已实现全量同步、增量同步、单商品同步、带签名校验的商品 webhook、删除商品 tombstone，以及 admin status 端点。默认启用 mock fixtures，因此不需要真实商家凭证也能验证完整流程。

它的价值是实际分发：商家不需要自己搭建 Catalog，也不需要改造 Agent 侧集成。安装并连接 app 之后，商品就可以出现在兼容的 OCP Catalog 中被搜索和推荐；结账与最终商业关系仍然回到原始 Shopify 店铺。
```

`.../locales/zh/woocommerce-provider-app-opens-wordpress-commerce-to-ocp.md`:

```markdown
这个 app 会从 /wp-json/wc/v3/products 读取商品，把 WooCommerce 字段映射到 OCP 的 product、price、inventory packs，并以带 ocp.push.batch 同步能力的 Provider 形式注册商家。

它支持全量同步、基于 modified_after 的增量同步、单商品同步、可变商品变体嵌入、WooCommerce HMAC webhook 校验，以及删除商品的 inactive tombstone。

这让 WordPress 电商库存可以进入 OCP 兼容 Catalog，而不要求商家迁移到新的店铺系统。Catalog 可以负责推广、搜索和 resolve 商品，但最终商品页与交易仍保留在商家自己的站点。
```

`.../locales/zh/unified-public-site.md`:

```markdown
访客现在会先看到可视化概览：OCP 连接了什么、Agent 如何使用 Catalog、动作边界如何保持在用户控制之下。更详细的协议资料继续保留在 /docs。

已有 schema 参考、示例和实现说明仍然保留，方便开发者继续深入。
```

`.../locales/zh/catalog-handshake-and-registration-v1.md`:

```markdown
Handshake 页面覆盖 CatalogManifest、ObjectContract、SyncCapabilities、ProviderRegistration、CommercialObject 和 RegistrationResult。

Registration 页面覆盖发现、目录注册、目录搜索、路由提示、验证和刷新行为。
```

`.../locales/zh/commerce-examples-expanded.md`:

```markdown
这些示例用于说明数据接入、Catalog 搜索、resolve 和动作执行之间的实际边界。
```

- [ ] **Step 4: Verify all 14 files exist**

Run: `ls apps/ocp-site-web/src/content/updates/*.md apps/ocp-site-web/src/content/updates/locales/zh/*.md | wc -l`
Expected: `14`.

- [ ] **Step 5: Typecheck (confirms no code still references `update.body`)**

Run: `bun run --cwd apps/ocp-site-web typecheck`
Expected: FAIL at `UpdateDetailPage.tsx` (`update.body` no longer exists) and possibly `HomePage.tsx` if it referenced body. This is expected — fixed in Task B6. (If it unexpectedly passes, grep for `\.body` to confirm.)

- [ ] **Step 6: Commit**

```bash
git add apps/ocp-site-web/src/content/updates.ts apps/ocp-site-web/src/content/updates/
git commit -m "feat(site): migrate news bodies to markdown files"
```

---

### Task B6: Render markdown body in `UpdateDetailPage`

Replace the `body.map` paragraphs with async-loaded markdown via `MarkdownArticle`, and show the optional cover.

**Files:**
- Modify: `apps/ocp-site-web/src/pages/UpdateDetailPage.tsx`

- [ ] **Step 1: Rewrite the page**

Replace the full contents of `apps/ocp-site-web/src/pages/UpdateDetailPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { breakingChangeLabel, getUpdateBySlug, updateCategoryLabels } from '../content/updates';
import { resolveLocalizedText, useDocsLocale } from '../content/i18n';
import { loadUpdateContent } from '../content/updates-loader';
import { MarkdownArticle } from '../components/site/MarkdownArticle';

export function UpdateDetailPage() {
  const { slug } = useParams();
  const update = getUpdateBySlug(slug);
  const { locale, localizePath } = useDocsLocale();
  const [content, setContent] = useState<string>('# Loading...');

  useEffect(() => {
    if (!update) return;
    let cancelled = false;
    setContent('# Loading...');
    void loadUpdateContent(update.slug, locale).then((md) => {
      if (!cancelled) setContent(md);
    });
    return () => {
      cancelled = true;
    };
  }, [update, locale]);

  if (!update) {
    return (
      <main className="site-section">
        <div className="site-container">
          <h1 className="text-4xl font-semibold">{locale === 'zh' ? '动态不存在' : 'Update not found'}</h1>
          <Link to={localizePath('/updates')} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--ocp-cyan)]">
            <ArrowLeft className="h-4 w-4" />
            {locale === 'zh' ? '返回最新动态' : 'Back to updates'}
          </Link>
        </div>
      </main>
    );
  }

  const coverSrc = update.cover?.startsWith('images/') ? `/${update.cover}` : update.cover;

  return (
    <main className="site-band">
      <article className="site-section">
        <div className="site-container max-w-4xl">
          <Link to={localizePath('/updates')} className="inline-flex items-center gap-2 text-sm font-semibold text-black/64 hover:text-black">
            <ArrowLeft className="h-4 w-4" />
            {locale === 'zh' ? '最新动态' : 'Updates'}
          </Link>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-black/[0.06] px-2 py-1 text-xs font-semibold text-black/60">
              {resolveLocalizedText(updateCategoryLabels[update.category], locale)}
            </span>
            {update.version && <span className="rounded-md bg-[rgba(0,167,165,0.12)] px-2 py-1 text-xs font-semibold text-[var(--ocp-cyan)]">{update.version}</span>}
            {update.breaking && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[rgba(217,84,54,0.12)] px-2 py-1 text-xs font-semibold text-[var(--ocp-vermilion)]">
                <CircleAlert className="h-3.5 w-3.5" />
                {resolveLocalizedText(breakingChangeLabel, locale)}
              </span>
            )}
          </div>
          <h1 className="mt-5 text-5xl font-semibold leading-tight">{resolveLocalizedText(update.title, locale)}</h1>
          {coverSrc && (
            <img
              src={coverSrc}
              alt=""
              className="mt-6 aspect-[16/7] w-full rounded-lg border border-black/10 object-cover shadow-lg shadow-black/10"
            />
          )}
          <p className="mt-5 text-lg leading-8 text-black/65">{resolveLocalizedText(update.summary, locale)}</p>
          <div className="mt-4 text-sm font-semibold text-black/50">{update.publishedAt}</div>

          <div className="mt-10 border-t border-black/10 pt-8">
            <MarkdownArticle content={content} />
          </div>

          <div className="mt-10 flex flex-wrap gap-2">
            {update.tags.map((tag) => (
              <span key={tag} className="rounded-md border border-black/10 bg-white px-2.5 py-1 text-xs font-semibold text-black/58">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </article>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run --cwd apps/ocp-site-web typecheck`
Expected: PASS (the `update.body` reference is gone).

- [ ] **Step 3: Build**

Run: `bun run --cwd apps/ocp-site-web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/ocp-site-web/src/pages/UpdateDetailPage.tsx
git commit -m "feat(site): render markdown news body with cover image"
```

---

### Task B7: Optional cover thumbnail on the updates list

Show `cover` as a thumbnail on list cards when present; leave card layout untouched otherwise.

**Files:**
- Modify: `apps/ocp-site-web/src/pages/UpdatesPage.tsx` (the `<Link>` card, lines ~34-63)

- [ ] **Step 1: Add the thumbnail to the middle column**

In `apps/ocp-site-web/src/pages/UpdatesPage.tsx`, inside the middle `<div>` of the card (the one containing the badges + `<h2>` + summary, starting ~line 46), add a cover image at the top of that div, before the badges row:

```tsx
                <div>
                  {update.cover && (
                    <img
                      src={update.cover.startsWith('images/') ? `/${update.cover}` : update.cover}
                      alt=""
                      className="mb-3 aspect-[16/7] w-full rounded-md border border-black/10 object-cover"
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-2">
```

(The rest of the middle column — badges, `<h2>`, summary — stays exactly as is.)

- [ ] **Step 2: Typecheck + build**

Run: `bun run --cwd apps/ocp-site-web typecheck && bun run --cwd apps/ocp-site-web build`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/ocp-site-web/src/pages/UpdatesPage.tsx
git commit -m "feat(site): show optional cover thumbnail on updates list"
```

---

### Task B8: Manual verification of Feature B

**Files:** none (manual).

- [ ] **Step 1: Run the site**

Run: `bun run --cwd apps/ocp-site-web dev`
Expected: site serves.

- [ ] **Step 2: Verify every migrated article renders**

Visit `/updates`, open each of the 7 articles. Confirm:
- Body text matches the previous content (paragraphs intact).
- Switch to `/zh/updates/<slug>` and confirm Chinese body loads (falls back to English only if a zh file is missing — all 7 have zh).
- No `# Loading...` stuck state, no "Not available" fallback.

- [ ] **Step 3: Verify markdown image support end-to-end**

Temporarily add an image line to one article's `.md`, e.g. in `unified-public-site.md` add:

```markdown
![Site overview](images/site/updates-release-ledger.png)
```

Reload that article and confirm the image renders (rounded border, resolved to `/images/site/...`). Then revert the temporary edit.

- [ ] **Step 4: Note results** (no commit — verification only)

---

## Final verification

### Task F1: Full test + typecheck + lint + build sweep

- [ ] **Step 1: Run the site-web test suite**

Run: `bun run --cwd apps/ocp-site-web test`
Expected: PASS — formatScale (6), catalogScale (6), markdown-frontmatter (3), updates-loader (4).

- [ ] **Step 2: Typecheck, lint, build**

Run: `bun run --cwd apps/ocp-site-web typecheck && bun run --cwd apps/ocp-site-web lint && bun run --cwd apps/ocp-site-web build`
Expected: all PASS.

- [ ] **Step 3: Confirm turbo picks up the new tests**

Run: `bun run test --filter=@ocp-catalog/site-web` (from repo root)
Expected: turbo runs site-web's `test` script and it passes.

- [ ] **Step 4: Final commit if anything was adjusted**

```bash
git status
# commit any stragglers with an appropriate message
```

---

## Notes for the implementer

- **Test runner:** This repo uses Bun's built-in runner. Import test APIs from `bun:test` (`import { describe, expect, test } from 'bun:test'`). Run a single file with `bun test <path>`.
- **No DOM in unit tests:** Don't try to render React hooks/components under `bun test`. All logic worth testing is already factored into pure functions (`formatCompactCount`, `aggregateCatalogScale`, `resolveUpdateContent`, `stripFrontmatter`). Hook/component wiring is verified by `typecheck` + `build` + the manual steps.
- **Image convention:** Markdown image `src` starting with `images/` is resolved to `/images/...` (served from `apps/ocp-site-web/public/images/`). This matches the existing docs renderer.
- **i18n:** `locale` is `'en' | 'zh'`, derived from the URL prefix (`/zh`). Chinese content files live under `locales/zh/`; missing zh falls back to en.
- **Don't** reintroduce a `body` field on `SiteUpdate` or a second rendering path — all news bodies are markdown now.
- **useCatalogScale stale entries:** the probe map only ever adds URLs; if the discovered catalog set shrinks between polls, old probes linger in the map. For a homepage counter this is acceptable (the manifest cache dedupes fetches and a removed catalog is rare mid-session). Do not add pruning logic unless a real bug surfaces — YAGNI.
```