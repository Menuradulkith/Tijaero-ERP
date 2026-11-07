/**
 * useRecordParam - keeps the open record of a list -> detail page in the URL.
 *
 * The URL carries `?id=<recordId>` while a record is open and `?new=1` while
 * creating one, so the browser Back button returns to the list, Forward
 * reopens the record, and a record can be shared as a link.
 *
 * The page keeps its own selection state. The hook syncs both ways:
 * - page -> URL: when `current` / `creating` change, the URL follows.
 *   Opening from the list PUSHES a history entry; switching record while one
 *   is open (or new -> saved record) REPLACES it, so there is only ever one
 *   history entry above the list. Closing goes back over the entry we pushed
 *   (or pushes the list URL when the record was opened from a link).
 * - URL -> page: on load / Back / Forward the hook calls `onOpen(row)`
 *   (row from `items`, else `fetchById`), `onNew()` or `onClose()`. An id
 *   that cannot be found (deleted, no access) is dropped from the URL.
 *
 * Unsaved changes: if the form guard (formGuardStore) is dirty when Back /
 * Forward would change the record, the discard question is asked first; on
 * "Keep Editing" the URL is put back and nothing is lost.
 */

import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useFormGuardStore } from "@/state/formGuardStore";

export type RecordKey = string | number;

/** history.state marker for the record entry this hook pushed. */
const PUSHED_KEY = "__recordParam";

export interface UseRecordParamOptions<T> {
  /** Search param holding the record id. Default "id". */
  param?: string;
  /** Search param set to "1" while creating. Default "new". */
  newParam?: string;
  /** Id of the record the page is showing (null when showing the list). */
  current: RecordKey | null | undefined;
  /** Whether the page is in create mode. */
  creating?: boolean;
  /** Rows already loaded by the page, used before `fetchById`. */
  items?: readonly T[] | null;
  /** True while `items` is still loading (the hook waits for it). */
  loading?: boolean;
  /** Row id. Default `row.id`. */
  getId?: (row: T) => RecordKey;
  /** Load a record that is not in `items` (shared link, filtered list). */
  fetchById?: (id: string) => Promise<T | null | undefined>;
  /** Show this record (no unsaved-changes prompt: the hook already asked). */
  onOpen: (row: T) => void;
  /** Show the list. */
  onClose: () => void;
  /** Enter create mode (when the URL has `?new=1`). Omit to ignore new=1. */
  onNew?: () => void;
  /** Custom discard prompt. Default window.confirm. */
  confirmDiscard?: () => Promise<boolean> | boolean;
  /**
   * "push" (default): opening from the list adds a history entry, so Back
   * returns to the list. "replace": the URL only mirrors the selection (for
   * pages that always show a record, e.g. a customer picked in a side list).
   */
  history?: "push" | "replace";
  /** Set false to switch the hook off (e.g. the tab is not active). */
  enabled?: boolean;
}

export interface UseRecordParamReturn {
  /** Record id in the URL, or null. */
  id: string | null;
  /** Whether the URL says create mode. */
  isNew: boolean;
  /** Put a record id in the URL. */
  open: (id: RecordKey) => void;
  /** Remove the record from the URL (back to the list). */
  close: () => void;
  /** Put `new=1` in the URL. */
  startNew: () => void;
}

const norm = (v: RecordKey | null | undefined): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

const defaultGetId = (row: unknown): RecordKey => (row as { id: RecordKey }).id;

export function useRecordParam<T>(options: UseRecordParamOptions<T>): UseRecordParamReturn {
  const {
    param = "id",
    newParam = "new",
    current,
    creating = false,
    items,
    loading = false,
    getId = defaultGetId,
    fetchById,
    onOpen,
    onClose,
    onNew,
    confirmDiscard,
    enabled = true,
    history = "push",
  } = options;

  const location = useLocation();
  const navigate = useNavigate();

  const search = new URLSearchParams(location.search);
  const urlId = search.get(param);
  const urlNew = !urlId && search.get(newParam) === "1";
  const urlKey = `${urlId ?? ""}|${urlNew ? 1 : 0}`;

  // Latest values for callbacks and async work.
  const latest = useRef({ current: norm(current), creating, items, getId, fetchById, onOpen, onClose, onNew, confirmDiscard });
  latest.current = { current: norm(current), creating, items, getId, fetchById, onOpen, onClose, onNew, confirmDiscard };
  const locationRef = useRef(location);
  locationRef.current = location;

  // ─── URL writing ──────────────────────────────────────────────────────────

  const readUrl = useCallback(() => {
    // window.location is always the newest URL, even between renders.
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get(param);
    return { sp, id, isNew: !id && sp.get(newParam) === "1" };
  }, [param, newParam]);

  const write = useCallback(
    (next: { id: string | null; isNew: boolean }, mode: "push" | "replace", pushedMark: boolean) => {
      const { sp } = readUrl();
      sp.delete(param);
      sp.delete(newParam);
      if (next.id) sp.set(param, next.id);
      else if (next.isNew) sp.set(newParam, "1");
      const qs = sp.toString();
      const prevState = (locationRef.current.state ?? {}) as Record<string, unknown>;
      const state = pushedMark ? { ...prevState, [PUSHED_KEY]: param } : prevState;
      navigate(
        { pathname: locationRef.current.pathname, search: qs ? `?${qs}` : "" },
        { replace: mode === "replace", state }
      );
    },
    [navigate, param, newParam, readUrl]
  );

  const setOpen = useCallback(
    (next: { id: string | null; isNew: boolean }) => {
      const url = readUrl();
      const wasOpen = !!url.id || url.isNew;
      if (url.id === next.id && url.isNew === next.isNew) return;
      if (wasOpen || history === "replace") {
        // record -> record, new -> saved record: keep one entry above the list
        write(next, "replace", false);
      } else {
        write(next, "push", true);
      }
    },
    [readUrl, write, history]
  );

  const open = useCallback((id: RecordKey) => setOpen({ id: String(id), isNew: false }), [setOpen]);
  const startNew = useCallback(() => setOpen({ id: null, isNew: true }), [setOpen]);

  const close = useCallback(() => {
    const url = readUrl();
    if (!url.id && !url.isNew) return;
    if (history === "replace") {
      write({ id: null, isNew: false }, "replace", false);
      return;
    }
    const state = locationRef.current.state as Record<string, unknown> | null;
    if (state && state[PUSHED_KEY] === param) {
      // We pushed this entry from the list: step back over it so the history
      // has no duplicate list entry (Forward still reopens the record).
      navigate(-1);
    } else {
      // Opened from a link or a reload: add the list as a new entry.
      write({ id: null, isNew: false }, "push", false);
    }
  }, [readUrl, navigate, param, write, history]);

  // ─── page -> URL ──────────────────────────────────────────────────────────

  const curKey = norm(current);
  const prevPage = useRef({ current: curKey, creating });
  useEffect(() => {
    if (!enabled) return;
    const prev = prevPage.current;
    if (prev.current === curKey && prev.creating === creating) return;
    prevPage.current = { current: curKey, creating };
    if (curKey) open(curKey);
    else if (creating) startNew();
    else close();
  }, [curKey, creating, enabled, open, startNew, close]);

  // ─── URL -> page ──────────────────────────────────────────────────────────

  const handledRef = useRef<string | null>(null);
  const fetchingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (handledRef.current === urlKey) return;
    const L = latest.current;

    // Already in sync (usually: the page itself just moved the URL).
    const inSync = urlId
      ? L.current === urlId
      : urlNew
        ? !L.current && L.creating
        : !L.current && !L.creating;
    if (inSync) {
      handledRef.current = urlKey;
      prevPage.current = { current: L.current, creating: L.creating };
      return;
    }

    const drop = () => {
      handledRef.current = null;
      write({ id: null, isNew: false }, "replace", false);
    };

    // Ask before throwing away unsaved edits; "Keep Editing" restores the URL.
    const apply = async (fn: () => void) => {
      handledRef.current = urlKey;
      const guard = useFormGuardStore.getState();
      if (guard.isDirty) {
        const ask = latest.current.confirmDiscard;
        const ok = ask ? await ask() : window.confirm("You have unsaved changes. Discard them?");
        if (!ok) {
          const P = latest.current;
          write({ id: P.current, isNew: !P.current && P.creating }, "push", true);
          return;
        }
        guard.executeDiscard();
      }
      fn();
    };

    if (urlId) {
      const row = L.items?.find((r) => String(L.getId(r)) === urlId);
      if (row) {
        void apply(() => latest.current.onOpen(row));
        return;
      }
      if (loading) return; // wait for the list
      if (!L.fetchById) {
        if (L.items) drop();
        return;
      }
      if (fetchingRef.current === urlId) return;
      fetchingRef.current = urlId;
      const wanted = urlId;
      L.fetchById(wanted)
        .then((r) => {
          if (readUrl().id !== wanted) return; // URL moved on meanwhile
          if (r) void apply(() => latest.current.onOpen(r));
          else drop();
        })
        .catch(() => {
          if (readUrl().id === wanted) drop();
        })
        .finally(() => {
          fetchingRef.current = null;
        });
      return;
    }

    if (urlNew) {
      if (L.onNew) void apply(() => latest.current.onNew?.());
      else drop();
      return;
    }

    void apply(() => latest.current.onClose());
  }, [urlKey, urlId, urlNew, items, loading, enabled, readUrl, write]);

  return { id: urlId, isNew: urlNew, open, close, startNew };
}

/**
 * useTabParam - keeps a page's active tab in `?tab=` (replace, no history
 * entry). Changing tab drops the record params (`id`, `new`) of the old tab.
 */
export function useTabParam<V extends string>(
  defaultTab: V,
  allowed?: readonly V[],
  options: { param?: string; clear?: readonly string[] } = {}
): [V, (tab: V) => void] {
  const { param = "tab", clear = ["id", "new"] } = options;
  const location = useLocation();
  const navigate = useNavigate();
  const raw = new URLSearchParams(location.search).get(param) as V | null;
  const tab = raw && (!allowed || allowed.includes(raw)) ? raw : defaultTab;

  const setTab = useCallback(
    (next: V) => {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get(param) === next || (!sp.get(param) && next === defaultTab)) return;
      clear.forEach((k) => sp.delete(k));
      if (next === defaultTab) sp.delete(param);
      else sp.set(param, next);
      const qs = sp.toString();
      navigate({ pathname: location.pathname, search: qs ? `?${qs}` : "" }, { replace: true });
    },
    [param, clear, defaultTab, navigate, location.pathname]
  );

  return [tab, setTab];
}

export default useRecordParam;
