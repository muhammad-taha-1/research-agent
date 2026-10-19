"use client";

import { useCallback, useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * Current time, re-rendering every `intervalMs` while `ticking`.
 * Null during SSR and hydration, so server and client render the same markup.
 */
export function useNow(ticking: boolean, intervalMs = 1000): number | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const id = setInterval(onChange, intervalMs);
      return () => clearInterval(id);
    },
    [intervalMs],
  );
  // Bucketed so consecutive reads within one tick return the same snapshot
  const getSnapshot = () => Math.floor(Date.now() / intervalMs) * intervalMs;

  return useSyncExternalStore(ticking ? subscribe : noop, getSnapshot, () => null);
}
