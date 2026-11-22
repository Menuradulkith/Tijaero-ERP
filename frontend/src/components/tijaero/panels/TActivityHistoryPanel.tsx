/**
 * TActivityHistoryPanel - "Activity History" detail panel for an Activity
 * History section.
 *
 * Opened from a small history icon placed on the Activity History title
 * line (via FormSection's `titleAction` prop). Fetches and renders the
 * modification history for one entity (supplier, purchase order, purchase
 * return, ...) from the shared audit_logs table.
 *
 * @example
 * ```tsx
 * const [historyOpen, setHistoryOpen] = useState(false);
 * <FormSection
 *   title="Activity History"
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
import ArrowRightAltIcon from "@mui/icons-material/ArrowRightAlt";
import { useActivityLog } from "@/hooks/useActivityLog";
import { formatDateTimeReadable } from "@/utils/formatters";
import { TSidePanel } from "./TSidePanel";
import { TButton } from "../base/TButton";
import type { ActivityLogFieldChange, ActivityLogItemChange } from "@/api/activityLog";

export interface TActivityHistoryPanelProps {
  open: boolean;
  onClose: () => void;
  /** entity_type as recorded via log_audit() on the backend, e.g. "supplier", "purchase_order" */
  entityType: string;
  /** The record's id. The panel stays closed (no fetch) while this is undefined. */
  entityId: number | undefined;
  /** Optional per-action display labels, e.g. { create: "Supplier created" }. Override the defaults below. */
  actionLabels?: Record<string, string>;
}

const DEFAULT_ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  confirm: "Confirmed",
  reject: "Rejected",
  contact_added: "Contact person added",
  contact_updated: "Contact person updated",
  payment_method_added: "Payment method added",
  payment_method_updated: "Payment method updated",
  product_link_added: "Product linked",
  product_link_updated: "Product link updated",
  item_link_added: "Item linked",
  item_link_updated: "Item link updated",
  supplier_link_added: "Supplier linked",
  supplier_link_updated: "Supplier link updated",
  minimum_price_set: "Minimum price set",
  minimum_price_removed: "Minimum price removed",
  price_tier_added: "Price tier added",
  price_tier_updated: "Price tier updated",
  price_tier_removed: "Price tier removed",
};

function formatAction(action: string, labels: Record<string, string>): string {
  return labels[action] || DEFAULT_ACTION_LABELS[action] || formatFieldLabel(action);
}

// "billing_address_line1" -> "Billing Address Line1"
function formatFieldLabel(field: string): string {
  return field
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatFieldValue(value: ActivityLogFieldChange["old"]): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "(none)";
  return String(value);
}

const ITEM_ACTION_LABEL: Record<ActivityLogItemChange["action"], string> = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
};

// One product line within an "items" change — "Widget A: Added (qty 5)",
// "Widget B: Removed", or "Widget C: Quantity 2 -> 5, Unit Price 10 -> 12".
function ItemChangeRow({ item }: { item: ActivityLogItemChange }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5, flexWrap: "wrap" }}>
        <Typography variant="caption" fontWeight={600}>
          {item.product_name || `Product #${item.key}`}:
        </Typography>
        <Typography
          variant="caption"
          color={item.action === "removed" ? "error.main" : item.action === "added" ? "success.main" : "text.secondary"}
        >
          {ITEM_ACTION_LABEL[item.action]}
        </Typography>
        {item.item &&
          Object.entries(item.item).map(([field, value]) => (
            <Typography key={field} variant="caption" color="text.secondary">
              ({formatFieldLabel(field)}: {formatFieldValue(value as ActivityLogFieldChange["old"])})
            </Typography>
          ))}
      </Box>
      {item.changes && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, pl: 1.5 }}>
          {Object.entries(item.changes).map(([field, change]) => (
            <Box key={field} sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
              <Typography variant="caption" color="text.secondary">
                {formatFieldLabel(field)}:
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textDecoration: "line-through" }}>
                {formatFieldValue(change.old)}
              </Typography>
              <ArrowRightAltIcon sx={{ fontSize: "0.9rem", color: "text.disabled" }} />
              <Typography variant="caption" color="text.primary" fontWeight={500}>
                {formatFieldValue(change.new)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
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
          {activityLog.map((entry) => {
            const fields = Array.isArray(entry.changes?.fields) ? entry.changes.fields : [];
            const values = entry.changes?.values || {};
            const summary = typeof entry.changes?.summary === "string" ? entry.changes.summary : "";
            const itemsLabel = typeof entry.changes?.items_label === "string" ? entry.changes.items_label : "Items";
            return (
              <Box
                key={entry.id}
                sx={{
                  py: 1,
                  borderBottom: 1,
                  borderColor: "divider",
                  "&:last-of-type": { borderBottom: 0 },
                }}
              >
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 2 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {formatAction(entry.action, actionLabels)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                    {formatDateTimeReadable(entry.timestamp)}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {entry.user_name || "Unknown user"}
                </Typography>
                {summary && (
                  <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                    {summary}
                  </Typography>
                )}

                {fields.length > 0 && (
                  <Box
                    sx={{
                      mt: 0.75,
                      display: "flex",
                      flexDirection: "column",
                      gap: 0.5,
                      pl: 1.25,
                      borderLeft: 2,
                      borderColor: "divider",
                    }}
                  >
                    {fields.map((field) => {
                      if (field === "items") {
                        const itemChanges = entry.changes?.item_changes;
                        return (
                          <Box key={field} sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                            <Typography variant="caption" fontWeight={600}>
                              {itemsLabel}:
                            </Typography>
                            {itemChanges && itemChanges.length > 0 ? (
                              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, pl: 1.25 }}>
                                {itemChanges.map((item, idx) => (
                                  <ItemChangeRow key={`${item.key}-${idx}`} item={item} />
                                ))}
                              </Box>
                            ) : (
                              <Typography variant="caption" color="text.secondary" sx={{ pl: 1.25 }}>
                                changed
                              </Typography>
                            )}
                          </Box>
                        );
                      }
                      const change = values[field];
                      return (
                        <Box key={field} sx={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 0.5 }}>
                          <Typography variant="caption" fontWeight={600} sx={{ minWidth: 0 }}>
                            {formatFieldLabel(field)}:
                          </Typography>
                          {change ? (
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ textDecoration: "line-through" }}
                              >
                                {formatFieldValue(change.old)}
                              </Typography>
                              <ArrowRightAltIcon sx={{ fontSize: "0.9rem", color: "text.disabled" }} />
                              <Typography variant="caption" color="text.primary" fontWeight={500}>
                                {formatFieldValue(change.new)}
                              </Typography>
                            </Box>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              changed
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </TSidePanel>
  );
}

export default TActivityHistoryPanel;
