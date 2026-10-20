import { useEffect, useState } from "react";

/**
 * useState backed by localStorage. Used for UI state that must be
 * available synchronously on first render (theme, panel visibility)
 * so the window never flashes an intermediate layout.
 */
export function usePersistedState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // fall through to initial
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable — state stays in-memory only
    }
  }, [key, value]);

  return [value, setValue] as const;
}
