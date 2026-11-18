/**
 * Supplier > PO History tab: every purchase order raised against this supplier,
 * newest first, with a status filter. Paged on the server
 * (GET /purchasing/orders/paged?supplier_id=...). Clicking a row opens the PO.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { Box, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { TDataGrid, TDataGridColumn, TStatusChip, fmtLKR } from "@/components/tijaero";
import { useCurrencyStore } from "@/state/currencyStore";
import { purchaseOrdersApi } from "@/modules/purchasing/api";
import type { PurchasingOrder } from "@/modules/purchasing/types";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "partially_completed", label: "Partially Received" },
  { value: "completed", label: "Completed" },
  { value: "short_closed", label: "Short Closed" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "-");

export default function SupplierPoHistory({ supplierId }: { supplierId: number }) {
  const navigate = useNavigate();
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-po-history", supplierId, status, page, size],
    queryFn: () =>
      purchaseOrdersApi.getPage({
        page,
        size,
        supplier_id: supplierId,
        status: status || undefined,
        sort_by: "purchasing_order_date",
        order: "desc",
      }),
    placeholderData: keepPreviousData,
  });
  const rows = data?.items ?? [];

  const columns = useMemo<TDataGridColumn<PurchasingOrder>[]>(
    () => [
      { field: "purchasing_order_no", header: "PO No", flex: 1, minWidth: 130 },
      {
        field: "purchasing_order_date",
        header: "PO Date",
        width: 110,
        renderCell: (p: GridRenderCellParams<PurchasingOrder>) => fmtDate(p.row.purchasing_order_date),
      },
      {
        field: "required_date",
        header: "Required By",
        width: 110,
        renderCell: (p: GridRenderCellParams<PurchasingOrder>) => fmtDate(p.row.required_date),
      },
      { field: "branch_code", header: "Branch", width: 110 },
      {
        field: "status",
        header: "Status",
        width: 150,
        renderCell: (p: GridRenderCellParams<PurchasingOrder>) => (
          <TStatusChip status={p.row.status} statusMap="purchaseOrder" />
        ),
      },
      { field: "total_quantity", header: "Qty", width: 80, align: "right", headerAlign: "right" },
      {
        field: "total_amount",
        header: `Total (${currencySymbol})`,
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (p: GridRenderCellParams<PurchasingOrder>) => fmtLKR(p.row.total_amount || 0),
      },
      {
        field: "paid_amount",
        header: `Paid (${currencySymbol})`,
        width: 120,
        align: "right",
        headerAlign: "right",
        renderCell: (p: GridRenderCellParams<PurchasingOrder>) => fmtLKR(p.row.paid_amount || 0),
      },
      {
        field: "balance",
        header: `Balance (${currencySymbol})`,
        width: 130,
        align: "right",
        headerAlign: "right",
        sortable: false,
        renderCell: (p: GridRenderCellParams<PurchasingOrder>) =>
          fmtLKR(Math.max(0, (p.row.total_amount || 0) - (p.row.paid_amount || 0))),
      },
    ],
    [currencySymbol],
  );

  // Totals of the orders on this page (the grid footer shows the full count).
  const pageTotal = rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 200 }}
        >
          {STATUS_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="body2" color="text.secondary">
          {data?.total ?? 0} purchase order{data?.total === 1 ? "" : "s"}
          {rows.length > 0 && ` · this page: ${currencySymbol} ${fmtLKR(pageTotal)}`}
        </Typography>
      </Stack>
      <TDataGrid<PurchasingOrder>
        rows={rows}
        columns={columns}
        loading={isLoading}
        getRowId={(row) => row.id}
        onRowClick={(row) => navigate(`/purchasing/orders?focus=${row.id}`)}
        emptyMessage={status ? "No purchase orders with this status" : "No purchase orders for this supplier yet"}
        height={480}
        autoHeight={false}
        exportFileName={`supplier_${supplierId}_po_history`}
        serverPagination={{
          rowCount: data?.total ?? 0,
          paginationModel: { page, pageSize: size },
          onPaginationModelChange: (m) => {
            setPage(m.page);
            setSize(m.pageSize);
          },
        }}
        pageSizeOptions={[10, 20, 50, 100]}
      />
    </Box>
  );
}
