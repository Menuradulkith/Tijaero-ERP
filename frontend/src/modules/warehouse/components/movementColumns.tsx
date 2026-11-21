/**
 * Grid columns for stock movement rows, shared by the Stock Movements page
 * and the Movements tab of the Item stock drawer.
 */
import { TChip, TDataGridColumn, TStatusChip } from "@/components/tijaero";
import { Box, Link as MuiLink, Typography } from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { format, parseISO } from "date-fns";
import { Link as RouterLink } from "react-router-dom";
import {
  movementDirection,
  movementTypeLabel,
  referenceLink,
  referenceTypeLabel,
  type StockMovement,
} from "../stockApi";

type P = GridRenderCellParams<StockMovement>;

const DIRECTION_COLOR = { in: "success", out: "error", internal: "default" } as const;

const fmtDateTime = (v: string | null | undefined) => {
  if (!v) return "-";
  try {
    return format(parseISO(v), "dd MMM yyyy HH:mm");
  } catch {
    return v;
  }
};

const arrow = (a: string | null | undefined, b: string | null | undefined) =>
  a || b ? `${a || "-"} → ${b || "-"}` : "-";

function renderReference(row: StockMovement) {
  const label = [referenceTypeLabel(row.reference_type), row.reference_no || (row.reference_id ? `#${row.reference_id}` : "")]
    .filter(Boolean)
    .join(" ");
  if (!label) return <span>-</span>;
  const to = referenceLink(row.reference_type, row.reference_id);
  if (!to) return <span>{label}</span>;
  return (
    <MuiLink component={RouterLink} to={to} underline="hover" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
      {label}
    </MuiLink>
  );
}

export function buildMovementColumns(opts: {
  currencySymbol: string;
  canViewCost: boolean;
  /** Hide the item columns (when the grid is already scoped to one item). */
  hideItem?: boolean;
}): TDataGridColumn<StockMovement>[] {
  const { currencySymbol, canViewCost, hideItem } = opts;
  const cols: TDataGridColumn<StockMovement>[] = [
    {
      field: "created_at",
      header: "Date / Time",
      width: 150,
      sortable: false,
      renderCell: (p: P) => fmtDateTime(p.row.created_at),
    },
    {
      field: "movement_type",
      header: "Type",
      width: 190,
      sortable: false,
      hideOnMobile: false,
      renderCell: (p: P) => (
        <TChip
          size="small"
          label={movementTypeLabel(p.row.movement_type)}
          color={DIRECTION_COLOR[movementDirection(p.row.movement_type, p.row.on_hand_change)]}
          sx={{ fontWeight: 500 }}
        />
      ),
    },
  ];
  if (!hideItem) {
    cols.push(
      { field: "item_code", header: "Item Code", width: 120, sortable: false, renderCell: (p: P) => p.row.item_code || "-" },
      { field: "item_name", header: "Item", flex: 1, minWidth: 180, sortable: false, renderCell: (p: P) => p.row.item_name || "-" },
    );
  }
  cols.push(
    { field: "quantity", header: "Qty", width: 80, type: "number", sortable: false },
    {
      field: "on_hand_change",
      header: "On-hand Change",
      width: 130,
      align: "right",
      headerAlign: "right",
      sortable: false,
      hideOnMobile: false,
      renderCell: (p: P) => {
        const v = Number(p.row.on_hand_change || 0);
        if (!v) return <Typography variant="body2" color="text.secondary">0</Typography>;
        return (
          <Typography variant="body2" fontWeight={600} color={v > 0 ? "success.main" : "error.main"}>
            {v > 0 ? `+${v.toLocaleString()}` : `−${Math.abs(v).toLocaleString()}`}
          </Typography>
        );
      },
    },
    {
      field: "status_change",
      header: "From → To Status",
      width: 230,
      sortable: false,
      renderCell: (p: P) =>
        p.row.from_status || p.row.to_status ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {p.row.from_status ? <TStatusChip status={p.row.from_status} statusMap="salesStockStatus" /> : <span>-</span>}
            <span>→</span>
            {p.row.to_status ? <TStatusChip status={p.row.to_status} statusMap="salesStockStatus" /> : <span>-</span>}
          </Box>
        ) : (
          "-"
        ),
    },
    { field: "branch_code", header: "Branch", width: 100, sortable: false, renderCell: (p: P) => p.row.branch_code || "-" },
    {
      field: "location_change",
      header: "From → To Location",
      width: 200,
      sortable: false,
      renderCell: (p: P) => arrow(p.row.from_location_name, p.row.to_location_name),
    },
    {
      field: "batch_serial",
      header: "Batch / Serial",
      width: 160,
      sortable: false,
      renderCell: (p: P) => (
        <span style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
          {p.row.barcode || (p.row.batch_no ? `Batch ${p.row.batch_no}` : "-")}
        </span>
      ),
    },
  );
  if (canViewCost) {
    cols.push(
      { field: "unit_cost", header: `Unit Cost (${currencySymbol})`, width: 130, type: "currency", sortable: false },
      { field: "value", header: `Value (${currencySymbol})`, width: 130, type: "currency", sortable: false },
    );
  }
  cols.push(
    {
      field: "reference",
      header: "Reference",
      width: 200,
      sortable: false,
      renderCell: (p: P) => renderReference(p.row),
    },
    { field: "user_name", header: "User", width: 130, sortable: false, renderCell: (p: P) => p.row.user_name || "-" },
  );
  return cols;
}
