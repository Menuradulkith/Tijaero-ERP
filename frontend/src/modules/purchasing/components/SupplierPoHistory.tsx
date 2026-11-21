/**
 * Supplier > PO History tab: this supplier's completed purchase orders, newest
 * first. Paged on the server (GET /purchasing/orders/paged?supplier_id=...&status=completed).
 * Clicking a row opens the PO.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { Box, Typography } from "@mui/material";
import { TDataGrid, TDataGridColumn, TStatusChip, fmtLKR } from "@/components/tijaero";
import { useCurrencyStore } from "@/state/currencyStore";
import { purchaseOrdersApi } from "@/modules/purchasing/api";
import type { PurchasingOrder } from "@/modules/purchasing/types";

// PO history lists completed orders only.
const HISTORY_STATUS = "completed";

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "-");

export default function SupplierPoHistory({ supplierId }: { supplierId: number }) {
  const navigate = useNavigate();
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ["supplier-po-history", supplierId, page, size],
    queryFn: () =>
      purchaseOrdersApi.getPage({
        page,
        size,
        supplier_id: supplierId,
        status: HISTORY_STATUS,
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
      <Typography variant="body2" color="text.secondary">
        {data?.total ?? 0} completed purchase order{data?.total === 1 ? "" : "s"}
        {rows.length > 0 && ` · this page: ${currencySymbol} ${fmtLKR(pageTotal)}`}
      </Typography>
      <TDataGrid<PurchasingOrder>
        rows={rows}
        columns={columns}
        loading={isLoading}
        getRowId={(row) => row.id}
        onRowClick={(row) => navigate(`/purchasing/orders?focus=${row.id}`)}
        emptyMessage="No completed purchase orders for this supplier yet"
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
