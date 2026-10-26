/** Report Center API: catalogue, run, export, saved reports and recent runs. */
import apiClient from "@/api/client";

export type ParamType =
  | "date" | "int" | "year" | "text" | "select" | "bool" | "branch"
  | "customer" | "supplier" | "product" | "account";
export type LookupKind = "customer" | "supplier" | "product" | "account";
export type ColumnType = "text" | "int" | "number" | "money" | "percent" | "date" | "datetime" | "bool";
export type ParamValues = Record<string, string | number | boolean | null>;

export interface ReportParam {
  key: string;
  label: string;
  type: ParamType;
  required: boolean;
  default: string | number | boolean | null;
  options: { value: string; label: string }[];
  min: number | null;
  max: number | null;
  help: string | null;
}

export interface ReportDefinition {
  key: string;
  title: string;
  module: string;
  description: string;
  params: ReportParam[];
  company_wide: boolean;
  tags: string[];
}

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  total: boolean;
}

export interface ReportTable {
  key: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals: Record<string, number> | null;
  truncated: boolean;
}

export interface ReportMetric {
  label: string;
  value: unknown;
  type: ColumnType;
}

export interface ReportRunResult {
  report: ReportDefinition;
  params: ParamValues;
  metrics: ReportMetric[];
  tables: ReportTable[];
  notes: string[];
}

/** Per-table display choices a saved report keeps. */
export interface ReportView {
  tables?: Record<string, { hidden?: string[]; sort?: { key: string; dir: "asc" | "desc" } | null }>;
}

export interface SavedReport {
  id: number;
  report_key: string;
  name: string;
  description: string | null;
  params: ParamValues;
  view: ReportView | null;
  is_shared: boolean;
  is_mine: boolean;
  can_edit: boolean;
  created_by: number | null;
  last_run: string | null;
  updated_at: string | null;
}

export interface ReportCatalog {
  reports: ReportDefinition[];
  saved: SavedReport[];
  can_share: boolean;
}

export interface RecentRun {
  report_key: string;
  title: string;
  params: ParamValues;
  run_at: string;
  saved_report_id: number | null;
}

export interface Option<T = string> {
  value: T;
  label: string;
}

export type ExportFormat = "csv" | "xlsx" | "pdf" | "html";

const BASE = "/reporting/center";

export const reportCenterApi = {
  catalog: async () => (await apiClient.get<ReportCatalog>(`${BASE}/catalog`)).data,

  recent: async () => (await apiClient.get<RecentRun[]>(`${BASE}/recent`)).data,

  branches: async () => (await apiClient.get<Option[]>(`${BASE}/branches`)).data,

  lookup: async (kind: LookupKind, q: string, ids?: (number | string)[]) =>
    (
      await apiClient.get<Option<number | string>[]>(`${BASE}/lookup/${kind}`, {
        params: ids?.length ? { ids: ids.join(",") } : { q },
      })
    ).data,

  run: async (key: string, params: ParamValues, savedReportId?: number | null, signal?: AbortSignal) =>
    (
      await apiClient.post<ReportRunResult>(
        `${BASE}/reports/${key}/run`,
        { params, saved_report_id: savedReportId ?? null },
        { signal },
      )
    ).data,

  /** Download (or, for html, return) an export of the report as currently viewed. */
  export: async (
    key: string,
    body: { params: ParamValues; view?: ReportView; format: ExportFormat; table?: string; title?: string },
  ) => {
    const response = await apiClient.post<Blob>(`${BASE}/reports/${key}/export`, body, { responseType: "blob" });
    const disposition = (response.headers["content-disposition"] as string | undefined) ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${key}.${body.format}`;
    return { blob: response.data, filename };
  },

  createSaved: async (body: {
    report_key: string;
    name: string;
    description?: string | null;
    params: ParamValues;
    view?: ReportView;
    is_shared: boolean;
  }) => (await apiClient.post<SavedReport>(`${BASE}/saved`, body)).data,

  updateSaved: async (
    id: number,
    body: { name: string; description?: string | null; params: ParamValues; view?: ReportView; is_shared: boolean },
  ) => (await apiClient.put<SavedReport>(`${BASE}/saved/${id}`, body)).data,

  deleteSaved: async (id: number) => {
    await apiClient.delete(`${BASE}/saved/${id}`);
  },
};
