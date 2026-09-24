/**
 * Credit Payments Page - Master-Detail Layout
 * Follows the standard ERP master-detail pattern using Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Avatar,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  CreditScore as CreditIcon,
  History as HistoryIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Star as StarIcon,
  StarBorder as StarOutlineIcon,
  ArrowBack as ArrowBackIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import type { GridRenderCellParams } from "@mui/x-data-grid";

import {
  MasterDetailLayout,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  SelectableListItem,
  useMasterDetailState,
  TDetailSkeleton,
  TBranchFilter,
  TExportButton,
  fmtLKR,
  TActivityHistoryPanel,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";

import { creditPaymentsApi } from "@/modules/finance/api";
import { CreditPayment } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";

interface Branch {
  branch_code: string;
  branch_name: string;
}

const INITIAL_FORM_DATA: Partial<CreditPayment> = {
  customer_name: "",
  invoice_no: "",
  amount: 0,
  credit_terms: "",
  due_date: "",
  status: "pending",
};

const resetFormFromItem = (item: CreditPayment): Partial<CreditPayment> => ({
  customer_name: item.customer_name || "",
  invoice_no: item.invoice_no || "",
  amount: Number(item.amount) || 0,
  credit_terms: item.credit_terms || "",
  due_date: item.due_date || "",
  status: item.status || "pending",
});

const getStatusColor = (status: string): "warning" | "success" | "error" | "default" => {
  switch ((status || "").toLowerCase()) {
    case "pending": return "warning";
    case "settled":
    case "active":
    case "paid":
      return "success";
    case "overdue": return "error";
    default: return "default";
  }
};

export default function CreditPaymentsPage() {
  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    selectedItem,
    setSelectedItem,
    isCreating,
    favorites,
    toggleFavorite,
    formData,
    handleSelectItem,
  } = useMasterDetailState<CreditPayment, Partial<CreditPayment>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    favoritesKey: "credit_payments_favorites",
    defaultSortField: "created_date",
  });

  // Activity History is opened on demand from a detail icon next to the
  // Metadata & Audit section title, rather than shown inline.
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
    queryKey: ["credit-payments", filterBranch],
    queryFn: () =>
      creditPaymentsApi.getAll({
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
        (p.status || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(p.id).includes(searchQuery)
    );
    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there).
    filtered.sort((a, b) => {
      const diff = new Date(b.created_date || "").getTime() - new Date(a.created_date || "").getTime();
      return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
    });
    return filtered;
  }, [payments, searchQuery]);

  const handleSelectWithCheck = useCallback(
    async (item: CreditPayment) => {
      await handleSelectItem(item);
    },
    [handleSelectItem]
  );

  // Returns to the browse table from the detail view.
  const handleBackToPayments = useCallback(() => {
    setSelectedItem(null);
  }, [setSelectedItem]);

  // Whether we're showing a single payment's detail view instead of the
  // browse table. This page has no creation flow (read-only), so isCreating
  // is always false here, but the check is kept for consistency.
  const isPaymentDetailMode = !!selectedItem || isCreating;

  // ─── Browse Table ──────────────────────────────────────────────────────────

  type CreditPaymentRow = CreditPayment;

  const paymentColumns: TDataGridColumn<CreditPaymentRow>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<CreditPaymentRow>) => (
          <IconButton size="small" onClick={(e) => toggleFavorite(params.row.id, e)}>
            {favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
      {
        field: "id",
        header: "Payment No",
        width: 140,
        renderCell: (params: GridRenderCellParams<CreditPaymentRow>) => `Payment #${params.row.id}`,
      },
      {
        field: "customer_name",
        header: "Payee",
        flex: 1,
        minWidth: 170,
        renderCell: (params: GridRenderCellParams<CreditPaymentRow>) =>
          params.row.customer_name || `Customer #${params.row.customer_id}`,
      },
      {
        field: "created_date",
        header: "Date",
        width: 150,
        renderCell: (params: GridRenderCellParams<CreditPaymentRow>) =>
          params.row.created_date ? new Date(params.row.created_date).toLocaleDateString() : "-",
      },
      {
        field: "amount",
        header: "Amount",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<CreditPaymentRow>) => `Rs. ${fmtLKR(Number(params.row.amount || 0))}`,
      },
      {
        field: "status",
        header: "Status",
        width: 120,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<CreditPaymentRow>) => (
          <Chip label={params.row.status || "pending"} size="small" color={getStatusColor(params.row.status)} />
        ),
      },
      {
        field: "invoice_no",
        header: "Reference",
        width: 140,
        renderCell: (params: GridRenderCellParams<CreditPaymentRow>) => params.row.invoice_no || "-",
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<CreditPaymentRow>) => (
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
    [favorites, toggleFavorite, handleSelectWithCheck]
  );

  const paymentTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<CreditPaymentRow>
          rows={filteredPayments}
          columns={paymentColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectWithCheck(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No credit payments found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current credit payment,
  // plus a "Back to Credit Payments" link that returns to the table.
  const singlePaymentPanel = (
    <Paper
      elevation={0}
      sx={{
        width: 280,
        minWidth: 240,
        maxWidth: 300,
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon fontSize="small" />}
          onClick={handleBackToPayments}
          sx={{ textTransform: "none" }}
        >
          Back to Credit Payments
        </Button>
      </Box>
      {selectedItem && (
        <SelectableListItem
          id={selectedItem.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ width: 36, height: 36 }}>
                <CreditIcon fontSize="small" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{selectedItem.customer_name || `Payment #${selectedItem.id}`}</span>
                </Box>
              </Box>
            </Box>
          }
          isFavorite={favorites.includes(selectedItem.id)}
          onToggleFavorite={(e) => toggleFavorite(selectedItem.id, e)}
        />
      )}
    </Paper>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Customer Payment Methods", href: "/finance/customer-payment-methods" },
          { label: "Credit Payments", href: "/finance/customer-payment-methods/credit-payments" },
          ...(selectedItem || isCreating ? [{ label: `Credit Payment #${selectedItem?.id}` }] : []),
        ]}
        title={selectedItem ? (selectedItem.customer_name || `Payment #${selectedItem.id}`) : ""}
        titleIcon={<CreditIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Credit Payment"
        noSelectionTitle="Select a Credit Payment"
        isFavorite={selectedItem ? favorites.includes(selectedItem.id) : false}
        onToggleFavorite={selectedItem ? (e) => toggleFavorite(selectedItem.id, e) : undefined}
      />

      {/* Actions disabled - read-only mode */}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a customer credit payment from the list to view its details" />
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

            <FormSection title="Credit Terms & Schedule" columns={3}>
              <TextField
                label="Credit Terms"
                size="small"
                value={formData.credit_terms || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Due Date"
                size="small"
                value={formData.due_date ? new Date(formData.due_date).toLocaleDateString() : "-"}
                disabled
                InputProps={{ readOnly: true }}
              />
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2" color="text.secondary">Status:</Typography>
                <Chip
                  label={formData.status ? (formData.status.charAt(0).toUpperCase() + formData.status.slice(1)) : "Pending"}
                  size="small"
                  color={getStatusColor(formData.status || "")}
                />
              </Box>
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
                  label="Date Created"
                  size="small"
                  value={selectedItem.created_date ? new Date(selectedItem.created_date).toLocaleString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Status Update"
                  size="small"
                  value={selectedItem.status ? `Payment is currently ${selectedItem.status}` : "-"}
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
      title="Credit Payments"
      titleSlot={
        isPaymentDetailMode ? undefined : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search credit payments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 220, flexShrink: 0 }}
            />
            <Box sx={{ width: 170, flexShrink: 0 }}>
              <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
            </Box>
            {(searchQuery || filterBranch) && (
              <Tooltip title="Clear filters">
                <IconButton size="small" onClick={handleClearFilters}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )
      }
      onRefresh={refetch}
      isLoading={isLoading}
      headerActions={
        isPaymentDetailMode ? undefined : (
          <TExportButton
            filename={`credit_payments_${new Date().toISOString().split("T")[0]}`}
            headers={["ID", "Customer", "Invoice No", "Amount", "Credit Terms", "Due Date", "Status", "Created Date"]}
            rows={() =>
              filteredPayments.map((p) => [
                p.id,
                p.customer_name || `Customer #${p.customer_id ?? ""}`,
                p.invoice_no || "",
                Number(p.amount || 0),
                p.credit_terms || "",
                p.due_date || "",
                p.status || "",
                p.created_date || "",
              ])
            }
            disabled={filteredPayments.length === 0}
          />
        )
      }
      {...(isPaymentDetailMode
        ? { masterPanel: singlePaymentPanel, detailPanel }
        : { children: paymentTablePanel })}
    />

    <TActivityHistoryPanel
      open={activityHistoryOpen}
      onClose={() => setActivityHistoryOpen(false)}
      entityType="credit_payment"
      entityId={selectedItem?.id}
      actionLabels={{
        create: "Credit payment created",
        approve: "Credit payment approved",
        cancel: "Credit payment cancelled",
      }}
    />
    </>
  );
}
