/**
 * useRowSelection - Shared "select rows, export just those" state for a
 * TDataGrid list page (replaces the old per-row favorite/star toggle).
 *
 * Rule used everywhere in the ERP: if the user has ticked one or more rows,
 * Export acts on only those rows; with nothing ticked, Export acts on every
 * row currently shown (i.e. the filtered list, same as before selection
 * existed).
 *
 * @example
 * ```tsx
 * const rowSelection = useRowSelection();
 * <TDataGrid
 *   selectionMode="multiple"
 *   selectedRows={rowSelection.selectedRows}
 *   onSelectionChange={rowSelection.setSelectedRows}
 *   rows={filteredSuppliers}
 *   getRowId={(r) => r.id}
 *   columns={columns}
 * />
 * <TExportButton
 *   rows={() => rowSelection.pick(filteredSuppliers).map(toRow)}
 * />
 * ```
 *
 * Not generic over the hook instance on purpose — `pick` takes its own type
 * parameter per call (see below), so the same instance can filter both the
 * grid's display rows and a differently-shaped array used for export.
 */
import { useCallback, useMemo, useState } from "react";
import type { GridRowSelectionModel } from "@mui/x-data-grid";

export interface UseRowSelectionReturn {
  /** Pass straight through to TDataGrid's `selectedRows` prop. */
  selectedRows: GridRowSelectionModel;
  /** Pass straight through to TDataGrid's `onSelectionChange` prop. */
  setSelectedRows: (model: GridRowSelectionModel) => void;
  /** True once at least one row is ticked. */
  hasSelection: boolean;
  /** How many rows are ticked. */
  selectedCount: number;
  /** Clears the current selection (e.g. after a bulk action completes). */
  clearSelection: () => void;
  /**
   * Given the full (filtered) list a page would otherwise export, returns
   * just the ticked rows when any are ticked, or the whole list otherwise.
   * `getId` defaults to `row.id` — pass one when the row's key field differs.
   *
   * Generic per call (not fixed to one row shape at the hook instance level):
   * the grid is usually fed a display row (e.g. with a joined branch_name),
   * while the CSV export often maps over the plain API entity instead — both
   * just need an `id` field, so one selection works for either array.
   */
  pick: <T,>(rows: T[], getId?: (row: T) => number | string) => T[];
}

const defaultGetId = (row: unknown): number | string =>
  (row as { id: number | string }).id;

export function useRowSelection(): UseRowSelectionReturn {
  const [model, setModel] = useState<GridRowSelectionModel>({ type: "include", ids: new Set() });

  const idSet = useMemo(() => {
    // GridRowSelectionModel is `{ type: "include" | "exclude", ids: Set }` in
    // MUI X v8. This hook only ever produces "include" models (see
    // clearSelection/setSelectedRows below), but a page could in principle
    // pass through whatever the grid reports, so handle "exclude" defensively
    // by treating it as "no simple included set" (falls back to export-all).
    return model.type === "include" ? model.ids : null;
  }, [model]);

  const selectedCount = idSet?.size ?? 0;
  const hasSelection = selectedCount > 0;

  const setSelectedRows = useCallback((next: GridRowSelectionModel) => {
    setModel(next);
  }, []);

  const clearSelection = useCallback(() => {
    setModel({ type: "include", ids: new Set() });
  }, []);

  const pick = useCallback(
    <T,>(rows: T[], getId: (row: T) => number | string = defaultGetId as (row: T) => number | string): T[] => {
      if (!idSet || idSet.size === 0) return rows;
      return rows.filter((row) => idSet.has(getId(row)));
    },
    [idSet]
  );

  return { selectedRows: model, setSelectedRows, hasSelection, selectedCount, clearSelection, pick };
}

export default useRowSelection;
