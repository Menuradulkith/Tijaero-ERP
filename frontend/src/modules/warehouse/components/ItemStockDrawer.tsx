/**
 * "Item stock" drawer: one item at one branch / location, with its lots &
 * serials and its stock movements. A lot row opens the unit details panel
 * (tracking timeline, Move to Company Assets).
 */
import { usePermission } from "@/auth/permissions";
import { TDataGrid, TDataGridColumn, TStatusChip } from "@/components/tijaero";
import { salesStockApi } from "@/modules/inventory/api";
import type { SalesStock } from "@/modules/inventory/types";
import { useCurrencyStore } from "@/state/currencyStore";
import { todayISO } from "@/utils/formatters";
import { Close as CloseIcon, OpenInNew as OpenIcon } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  MenuItem,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { warehouseStockApi, type OnHandRow } from "../stockApi";
import { buildMovementColumns } from "./movementColumns";
import StockUnitDetailsPanel from "./StockUnitDetailsPanel";

// Statuses a lot can be in while still in the warehouse, plus the common exits.
const LOT_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All in warehouse" },
  { value: "available", label: "Available" },
  { value: "reserved", label: "Reserved" },
  { value: "transfer_pending", label: "Transfer Pending" },
  { value: "in_transit", label: "In Transit" },
  { value: "damaged", label: "Damaged" },
  { value: "frozen", label: "Frozen / QC Hold" },
  { value: "sold", label: "Sold" },
  { value: "returned_to_supplier", label: "Returned to Supplier" },
];

interface Props {
  row: OnHandRow | null;
  open: boolean;
  onClose: () => void;
}

export default function ItemStockDrawer({ row, open, onClose }: Props) {
  const [tab, setTab] = useState(0);
  // Reset to the first tab whenever a different item is opened.
  useEffect(() => {
    if (open) setTab(0);
  }, [open, row]);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", md: 920 }, maxWidth: "100%", p: { xs: 1.5, sm: 2.5 }, display: "flex", flexDirection: "column", gap: 1.5 } }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6">Item stock</Typography>
          {row && (
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
              {[row.item_code, row.item_name].filter(Boolean).join(" · ")}
              {" — "}
              {row.branch_code}
              {row.location_name ? ` / ${row.location_name}` : ""}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} size="small" aria-label="Close">
          <CloseIcon />
        </IconButton>
      </Box>

      {row && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: { xs: 1.5, sm: 3 } }}>
          {(
            [
              ["On Hand", row.on_hand],
              ["Reserved", row.reserved],
              ["Available", row.available],
              ["In Transit", row.in_transit],
              ["Damaged", row.damaged],
              ["Frozen", row.frozen],
            ] as const
          ).map(([label, v]) => (
            <Box key={label}>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
              <Typography variant="body1" fontWeight={600}>
                {Number(v || 0).toLocaleString()}
                {label === "On Hand" && row.unit_of_measure ? (
                  <Typography component="span" variant="caption" color="text.secondary"> {row.unit_of_measure}</Typography>
                ) : null}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: "divider", minHeight: 40 }}>
        <Tab label="Lots & Serials" sx={{ minHeight: 40 }} />
        <Tab label="Movements" sx={{ minHeight: 40 }} />
      </Tabs>

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {row && tab === 0 && <LotsTab row={row} />}
        {row && tab === 1 && <MovementsTab row={row} />}
      </Box>
    </Drawer>
  );
}

function LotsTab({ row }: { row: OnHandRow }) {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const canViewCost = usePermission("cost_price", "view");
  const [status, setStatus] = useState("");
  const [paging, setPaging] = useState({ page: 0, pageSize: 20 });
  const [selected, setSelected] = useState<SalesStock | null>(null);

  useEffect(() => setPaging((m) => ({ ...m, page: 0 })), [status, row]);

  // Stock is keyed by item: filter by the row's item, falling back to its product.
  const byItem = row.material_id != null;
  const params = (skip: number, limit: number) => ({
    material_id: byItem ? row.material_id ?? undefined : undefined,
    product_id: byItem ? undefined : row.product_id ?? undefined,
    branch_code: row.branch_code,
    location_id: row.location_id ?? undefined,
    status: status || undefined,
    // Default view: only what is still in the warehouse or in transit.
    on_hand: status ? undefined : true,
    skip,
    limit,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["salesStock", "item-lots", row.material_id, row.product_id, row.branch_code, row.location_id, status, paging.page, paging.pageSize],
    queryFn: () => salesStockApi.getPaginated(params(paging.page * paging.pageSize, paging.pageSize)),
    enabled: row.material_id != null || row.product_id != null,
    placeholderData: (prev) => prev,
  });

  const columns: TDataGridColumn<SalesStock>[] = useMemo(() => {
    const cols: TDataGridColumn<SalesStock>[] = [
      {
        field: "barcode",
        header: "Serial / Lot",
        width: 190,
        renderCell: (p: GridRenderCellParams<SalesStock>) => (
          <span style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
            {p.row.barcode || `${p.row.batch_no ? `Batch ${p.row.batch_no}` : "Lot"} × ${p.row.quantity}`}
          </span>
        ),
      },
      {
        field: "expiry_date",
        header: "Expiry",
        width: 140,
        renderCell: (p: GridRenderCellParams<SalesStock>) => {
          const d = p.row.expiry_date;
          if (!d) return <span>-</span>;
          const expired = d < todayISO();
          return (
            <Box component="span" sx={{ color: expired ? "error.main" : undefined, fontWeight: expired ? 600 : 400 }}>
              {d}
              {expired ? " (expired)" : ""}
            </Box>
          );
        },
      },
      {
        field: "status",
        header: "Status",
        width: 160,
        sortable: false,
        renderCell: (p: GridRenderCellParams<SalesStock>) => <TStatusChip status={p.row.status} statusMap="salesStockStatus" />,
      },
      { field: "added_date", header: "Received", width: 120, type: "date" },
      { field: "grn_no", header: "GRN No", width: 140, renderCell: (p: GridRenderCellParams<SalesStock>) => p.row.grn_no || "-" },
    ];
    if (canViewCost) {
      cols.push({ field: "cost_price", header: `Cost (${currencySymbol})`, width: 120, type: "currency" });
    }
    return cols;
  }, [canViewCost, currencySymbol]);

  return (
    <>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
        <Typography variant="body2" color="text.secondary">
          Click a row for its tracking timeline and actions.
        </Typography>
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          sx={{ width: { xs: "100%", sm: 200 } }}
        >
          {LOT_STATUS_OPTIONS.map((o) => (
            <MenuItem key={o.value || "all"} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <TDataGrid<SalesStock>
        rows={data?.items || []}
        columns={columns}
        loading={isLoading}
        getRowId={(r) => r.id}
        onRowClick={(r) => setSelected(r)}
        emptyMessage={status ? "No lots or serials with this status" : "No lots or serials here"}
        autoHeight={false}
        height={460}
        exportFileName={`item_lots_${row.item_code || row.material_id || row.product_id}_${row.branch_code}`}
        serverPagination={{
          rowCount: data?.total || 0,
          paginationModel: paging,
          onPaginationModelChange: setPaging,
        }}
        pageSizeOptions={[10, 20, 50, 100]}
      />
      <StockUnitDetailsPanel stock={selected} isOpen={!!selected} onClose={() => setSelected(null)} />
    </>
  );
}

function MovementsTab({ row }: { row: OnHandRow }) {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const canViewCost = usePermission("cost_price", "view");
  const [paging, setPaging] = useState({ page: 0, pageSize: 20 });

  useEffect(() => setPaging((m) => ({ ...m, page: 0 })), [row]);

  // Movements of the row's item, falling back to its product for rows without one.
  const filter = {
    material_id: row.material_id ?? undefined,
    product_id: row.material_id == null ? row.product_id ?? undefined : undefined,
    branch_code: row.branch_code,
    location_id: row.location_id ?? undefined,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["warehouseStock", "movements", "item", filter, paging.page, paging.pageSize],
    queryFn: () => warehouseStockApi.getMovements({ ...filter, page: paging.page + 1, size: paging.pageSize }),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo(
    () => buildMovementColumns({ currencySymbol, canViewCost, hideItem: true }),
    [currencySymbol, canViewCost],
  );

  const link = new URLSearchParams();
  if (filter.product_id != null) link.set("product_id", String(filter.product_id));
  if (filter.material_id != null) link.set("material_id", String(filter.material_id));
  link.set("branch_code", row.branch_code);
  if (filter.location_id != null) link.set("location_id", String(filter.location_id));

  return (
    <>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
        <Typography variant="body2" color="text.secondary">
          Newest first.
        </Typography>
        <Button
          size="small"
          component={RouterLink}
          to={`/warehouse/movements?${link.toString()}`}
          endIcon={<OpenIcon fontSize="small" />}
        >
          Open in Stock Movements
        </Button>
      </Box>
      {isError && <Alert severity="error" sx={{ mb: 1 }}>Could not load the movements.</Alert>}
      <TDataGrid
        rows={data?.items || []}
        columns={columns}
        loading={isLoading}
        getRowId={(r) => r.id}
        emptyMessage="No stock movements recorded for this item here"
        autoHeight={false}
        height={460}
        serverPagination={{
          rowCount: data?.total || 0,
          paginationModel: paging,
          onPaginationModelChange: setPaging,
        }}
        pageSizeOptions={[10, 20, 50, 100]}
      />
    </>
  );
}
