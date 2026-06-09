import { useEffect, useRef, useState } from 'react';

/**
 * Animate a number from 0 up to `target` once `active` is true.
 *
 * Returns the current animated value. Re-runs when `target` changes (so a later,
 * larger real value will tick up from the previous one rather than resetting to 0).
 * Respects prefers-reduced-motion: jumps straight to the target.
 */
export function useCountUp(target: number, active: boolean, durationMs = 1600): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || target <= 0) {
      setValue(target);
      return;
    }

    const from = fromRef.current;
    const delta = target - from;
    let startTs = 0;

    const tick = (ts: number) => {
      if (startTs === 0) startTs = ts;
      const elapsed = ts - startTs;
      const t = Math.min(elapsed / durationMs, 1);
      // easeOutExpo: fast start, gentle settle
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const current = from + delta * eased;
      setValue(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, active, durationMs]);

  return value;
}
