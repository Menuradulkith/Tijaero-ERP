/**
 * Generic activity-log (modification history) API — backs the "Activity
 * History" detail panel shown from a Record Information section, across
 * every module. Reads from the shared audit_logs table via
 * GET /common/activity-log; see app/modules/common/api.py's
 * ACTIVITY_LOG_ENTITY_TYPES for which entity_type values are supported.
 */
import apiClient from "./client";

export interface ActivityLogEntry {
  id: number;
  action: string;
  changes?: Record<string, unknown> | null;
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
