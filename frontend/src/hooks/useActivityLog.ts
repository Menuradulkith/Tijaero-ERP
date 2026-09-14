import { useQuery } from "@tanstack/react-query";
import { activityLogApi } from "@/api/activityLog";

/**
 * Fetches the modification history for one entity (e.g. a supplier, purchase
 * order, purchase return) to back an "Activity History" detail panel.
 * Disabled until a real entityId is selected, mirroring the pattern used for
 * per-record child data elsewhere in the app.
 */
export function useActivityLog(entityType: string, entityId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ["activityLog", entityType, entityId],
    queryFn: () => activityLogApi.get(entityType, entityId!),
    enabled: enabled && entityId !== undefined,
  });
}
