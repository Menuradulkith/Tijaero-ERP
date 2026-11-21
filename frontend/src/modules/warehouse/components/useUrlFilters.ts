import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Page filters kept in the URL query (so links can land on a filtered page
 * and a reload keeps the filters). Empty values are removed from the URL.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = {} as Record<K, string>;
  keys.forEach((k) => {
    filters[k] = searchParams.get(k) || "";
  });

  const setFilters = useCallback(
    (patch: Partial<Record<K, string>>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          (Object.keys(patch) as K[]).forEach((k) => {
            const v = patch[k];
            if (v) next.set(k, v);
            else next.delete(k);
          });
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { filters, setFilters, hasParam: (k: K) => searchParams.has(k) };
}

/**
 * Free-text search box bound to a URL param: typing is local and the URL
 * (and so the server query) updates after a short pause.
 */
export function useDebouncedUrlText(value: string, onCommit: (v: string) => void, delay = 350) {
  const [text, setText] = useState(value);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // URL changed from outside (e.g. Clear filters): follow it.
  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => commitRef.current(text), delay);
    return () => clearTimeout(t);
  }, [text, value, delay]);

  return [text, setText] as const;
}

/** Number from a URL param, or undefined. */
export const numParam = (v: string) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
