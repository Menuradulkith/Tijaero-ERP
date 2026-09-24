/**
 * Generic activity-log (modification history) API — backs the "Activity
 * History" detail panel shown from a Activity History section, across
 * every module. Reads from the shared audit_logs table via
 * GET /common/activity-log; see app/modules/common/api.py's
 * ACTIVITY_LOG_ENTITY_TYPES for which entity_type values are supported.
 */
import apiClient from "./client";

/** A single field's before/after value, JSON-primitive on both sides
 * (backend coerces Decimal/date/Enum to string/number before storing). */
export interface ActivityLogFieldChange {
  old: string | number | boolean | string[] | null;
  new: string | number | boolean | string[] | null;
}

export interface ActivityLogChanges {
  /** Names of every field that changed in this entry. Always present on
   * "update" entries; older log rows may have only this (no `values`). */
  fields?: string[];
  /** Old/new value per changed field. Only present on entries logged after
   * the old/new diff feature shipped — absent on older rows and on fields
   * that were fully replaced (e.g. a line-item list) rather than diffed. */
  values?: Record<string, ActivityLogFieldChange>;
  /** "create"/"delete" entries instead log a handful of ad-hoc identifying
   * fields (e.g. { po_no: "PO-123" }) rather than a fields/values diff. */
  [key: string]: unknown;
}

export interface ActivityLogEntry {
  id: number;
  action: string;
  changes?: ActivityLogChanges | null;
  timestamp: string;
  user_id: number;
  user_name?: string;
}

export const activityLogApi = {
  get: async (entityType: string, entityId: number) => {
    const response = await apiClient.get<ActivityLogEntry[]>("/common/activity-log", {
      params: { entity_type: entityType, entity_id: entityId },
    });
    return response.data;
  },
};
