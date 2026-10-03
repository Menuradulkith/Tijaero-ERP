/**
 * Cash Payments Page - Master-Detail Layout
 * Follows the standard ERP master-detail pattern using Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
} from "@mui/material";
import {
  History as HistoryIcon,
  LocalAtm as CashIcon,
  Search as SearchIcon,
  ArrowBack as ArrowBackIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import type { GridRenderCellParams } from "@mui/x-data-grid";

import {
  MasterDetailLayout,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  useMasterDetailState,
  TDetailSkeleton,
  TBranchFilter,
  TDataGrid,
  type TDataGridColumn,
  fmtLKR,
  TActivityHistoryPanel,
  TRemarkField,
} from "@/components/tijaero";

import { cashPaymentsApi } from "@/modules/finance/api";
import { CashPayment } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";
import { useCurrencyStore } from "@/state/currencyStore";

interface Branch {
  branch_code: string;
  branch_name: string;
}

// A cash payment row as shown in the browse table, with the branch name
// looked up and attached directly so the table's own column-header sort
// orders by the displayed name rather than the raw branch_code.
type CashPaymentRow = CashPayment & { branch_name: string };

const INITIAL_FORM_DATA: Partial<CashPayment> = {
  customer_name: "",
  invoice_no: "",
  amount: 0,
  remarks: "",
  branch_code: "",
  created_date: "",
};

const resetFormFromItem = (item: CashPayment): Partial<CashPayment> => ({
  customer_name: item.customer_name || "",
  invoice_no: item.invoice_no || "",
  amount: Number(item.amount) || 0,
  remarks: item.remarks || "",
  branch_code: item.branch_code || "",
  created_date: item.created_date || "",
});

export default function CashPaymentsPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    selectedItem,
    setSelectedItem,
    isCreating,
    formData,
    handleSelectItem,
  } = useMasterDetailState<CashPayment, Partial<CashPayment>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    defaultSortField: "created_date_time",
  });

  // Activity History is opened on demand from a detail icon next to the
  // Metadata & Audit section title, rather than shown inline. The cash
  // payment row is a read projection of the underlying sales invoice, so
  // its history is the invoice's (sales_order) audit trail.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches: Branch[] = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterBranch(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: payments = [], isLoading, refetch } = useQuery({
    queryKey: ["cash-payments", filterBranch],
    queryFn: () =>
      cashPaymentsApi.getAll({
        branch_code: filterBranch || undefined,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const filteredPayments = useMemo(() => {
    if (!payments) return [];
    let filtered = payments.filter(
      (p) =>
        (p.customer_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.invoice_no || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.remarks || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(p.id).includes(searchQuery)
    );
    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there).
    filtered.sort((a, b) => {
      const diff = new Date(b.created_date_time || "").getTime() - new Date(a.created_date_time || "").getTime();
      return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
    });
    return filtered;
  }, [payments, searchQuery]);

  const handleSelectWithCheck = useCallback(
    async (item: CashPayment) => {
      await handleSelectItem(item);
    },
    [handleSelectItem]
  );

  // Whether we're showing a single cash payment's detail view instead of the
  // browse table. This page is read-only (a projection of sales invoices), so
  // there's no "creating" state to account for beyond what the hook exposes.
  const isPaymentDetailMode = !!selectedItem || isCreating;

  // Returns to the browse table from the detail view.
  const handleBackToCashPayments = useCallback(() => {
    setSelectedItem(null);
  }, [setSelectedItem]);

  // The table sorts by whichever column the user clicks; the Branch column
  // displays a looked-up name rather than the raw branch_code, so it needs
  // that name as its own field for the grid to sort on correctly.
  const paymentRows: CashPaymentRow[] = useMemo(
    () =>
      filteredPayments.map((pmt) => ({
        ...pmt,
        branch_name: branches.find((b) => b.branch_code === pmt.branch_code)?.branch_name || pmt.branch_code || "-",
      })),
    [filteredPayments, branches]
  );

  const paymentColumns: TDataGridColumn<CashPaymentRow>[] = useMemo(
    () => [
      {
        field: "id",
        header: "Payment No",
        width: 120,
        renderCell: (params: GridRenderCellParams<CashPaymentRow>) => `#${params.row.id}`,
      },
      {
        field: "customer_name",
        header: "Payee",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<CashPaymentRow>) =>
          params.row.customer_name || `Customer #${params.row.customer_id}`,
      },
      { field: "branch_name", header: "Branch", width: 150 },
      {
        field: "created_date_time",
        header: "Date",
        width: 170,
        renderCell: (params: GridRenderCellParams<CashPaymentRow>) =>
          params.row.created_date_time ? new Date(params.row.created_date_time).toLocaleString() : "-",
      },
      {
        field: "amount",
        header: "Amount",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<CashPaymentRow>) => `${currencySymbol} ${fmtLKR(Number(params.row.amount || 0))}`,
      },
      {
        field: "invoice_no",
        header: "Reference",
        width: 150,
        renderCell: (params: GridRenderCellParams<CashPaymentRow>) => params.row.invoice_no || "-",
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<CashPaymentRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectWithCheck(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectWithCheck, currencySymbol]
  );

  // Browse mode: a full-width table of every cash payment (shown when
  // nothing is selected). Sorting is done per-column via the grid's own
  // column header menu, not a separate "Sort by" control.
  const paymentTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<CashPaymentRow>
          rows={paymentRows}
          columns={paymentColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectWithCheck(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No cash payments found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Customer Payment Methods", href: "/finance/customer-payment-methods" },
          { label: "Cash Payments", href: "/finance/customer-payment-methods/cash-payments" },
          ...(selectedItem || isCreating ? [{ label: `Cash Payment #${selectedItem?.id}` }] : []),
        ]}
        title={selectedItem ? (selectedItem.customer_name || `Payment #${selectedItem.id}`) : ""}
        titleIcon={<CashIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Cash Payment"
        noSelectionTitle="Select a Cash Payment"
      />

      {/* Actions disabled - read-only mode */}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a customer cash payment from the list to view its details" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Customer & Financial Details" columns={3}>
              <TextField
                label="Customer Name"
                size="small"
                value={formData.customer_name || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Amount"
                size="small"
                type="number"
                value={Number(formData.amount) || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Invoice Number"
                size="small"
                value={formData.invoice_no || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            <FormSection title="Transaction Information" columns={3}>
              <TextField
                label="Branch Code"
                size="small"
                value={formData.branch_code || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Date & Time"
                size="small"
                value={selectedItem?.created_date_time ? new Date(selectedItem.created_date_time).toLocaleString() : "-"}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TRemarkField
                label="Remarks"
                size="small"
                value={formData.remarks || "-"}
                onChange={() => {}}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            {selectedItem && !isCreating && (
              <FormSection
                title="Metadata & Audit"
                columns={2}
                titleAction={
                  <Tooltip title="View activity history">
                    <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <TextField
                  label="Date Created (Date)"
                  size="small"
                  value={selectedItem.created_date ? new Date(selectedItem.created_date).toLocaleDateString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Created By User ID"
                  size="small"
                  value={selectedItem.created_by || "System"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
              </FormSection>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
    <MasterDetailLayout
      title="Cash Payments"
      titleSlot={
        isPaymentDetailMode ? (
          <Button
            size="small"
            startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={handleBackToCashPayments}
            sx={{ textTransform: "none" }}
          >
            Back to Cash Payments
          </Button>
          ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search cash payments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 190, flexShrink: 0 }}
            />
            <Box sx={{ width: 170, flexShrink: 0 }}>
              <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
            </Box>
            {(searchQuery || filterBranch) && (
              <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                Clear
              </Button>
            )}
          </Box>
        )
      }
      onRefresh={refetch}
      isLoading={isLoading}
      {...(isPaymentDetailMode
        ? { children: detailPanel }
        : { children: paymentTablePanel })}
    />

    <TActivityHistoryPanel
      open={activityHistoryOpen}
      onClose={() => setActivityHistoryOpen(false)}
      entityType="sales_order"
      entityId={selectedItem?.id}
      actionLabels={{
        create: "Invoice created",
        update: "Invoice updated",
      }}
    />
    </>
  );
}
