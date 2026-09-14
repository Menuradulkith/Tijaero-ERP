/**
 * TActivityHistoryPanel - "Activity History" detail panel for a Record
 * Information section.
 *
 * Opened from a small history icon placed on the Record Information title
 * line (via FormSection's `titleAction` prop). Fetches and renders the
 * modification history for one entity (supplier, purchase order, purchase
 * return, ...) from the shared audit_logs table.
 *
 * @example
 * ```tsx
 * const [historyOpen, setHistoryOpen] = useState(false);
 * <FormSection
 *   title="Record Information"
 *   titleAction={
 *     <Tooltip title="View activity history">
 *       <IconButton size="small" onClick={() => setHistoryOpen(true)}>
 *         <HistoryIcon fontSize="small" />
 *       </IconButton>
 *     </Tooltip>
 *   }
 * >
 *   ...fields...
 * </FormSection>
 * <TActivityHistoryPanel
 *   open={historyOpen}
 *   onClose={() => setHistoryOpen(false)}
 *   entityType="purchase_order"
 *   entityId={selectedOrder?.id}
 *   actionLabels={{ create: "Order created", approve: "Order approved" }}
 * />
 * ```
 */
import { Box, Typography } from "@mui/material";
import { useActivityLog } from "@/hooks/useActivityLog";
import { formatDateTimeReadable } from "@/utils/formatters";
import { TSidePanel } from "./TSidePanel";
import { TButton } from "../base/TButton";

export interface TActivityHistoryPanelProps {
  open: boolean;
  onClose: () => void;
  /** entity_type as recorded via log_audit() on the backend, e.g. "supplier", "purchase_order" */
  entityType: string;
  /** The record's id. The panel stays closed (no fetch) while this is undefined. */
  entityId: number | undefined;
  /** Optional per-action display labels, e.g. { create: "Supplier created" }. Falls back to the raw action string. */
  actionLabels?: Record<string, string>;
}

export function TActivityHistoryPanel({
  open,
  onClose,
  entityType,
  entityId,
  actionLabels = {},
}: TActivityHistoryPanelProps) {
  const { data: activityLog = [] } = useActivityLog(entityType, entityId, open);

  return (
    <TSidePanel
      open={open}
      onClose={onClose}
      title="Activity History"
      actions={
        <TButton variant="secondary" onClick={onClose}>
          Close
        </TButton>
      }
    >
      {activityLog.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No activity recorded yet.
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {activityLog.map((entry) => (
            <Box
              key={entry.id}
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 2,
                py: 1,
                borderBottom: 1,
                borderColor: "divider",
                "&:last-of-type": { borderBottom: 0 },
              }}
            >
              <Box>
                <Typography variant="body2">
                  {actionLabels[entry.action] || entry.action}
                  {entry.action === "update" &&
                    Array.isArray(entry.changes?.fields) &&
                    (entry.changes!.fields as string[]).length > 0 && (
                      <Typography component="span" variant="body2" color="text.secondary">
                        {" "}— {(entry.changes!.fields as string[]).join(", ")}
                      </Typography>
                    )}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {entry.user_name || "Unknown user"}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                {formatDateTimeReadable(entry.timestamp)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </TSidePanel>
  );
}

export default TActivityHistoryPanel;
