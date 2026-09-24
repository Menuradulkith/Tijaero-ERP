/**
 * Card Payments Page - Master-Detail Layout
 * Follows the Purchasing/Sales UI pattern with Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Autocomplete,
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
  CreditCard as CardIcon,
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
  CARD_TYPE,
  fmtLKR,
  TActivityHistoryPanel,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";

import { cardPaymentsApi } from "@/modules/finance/api";
import { CardPayment, CardPaymentCreate } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";

interface Branch {
  branch_code: string;
  branch_name: string;
}

const INITIAL_FORM_DATA: Partial<CardPaymentCreate> = {
  card_type: "",
  amount: 0,
  remark: "",
  ref_number: "",
  invoice_no: "",
  deposited: false,
};

const resetFormFromItem = (item: CardPayment): Partial<CardPaymentCreate> => ({
  card_type: item.card_type || "",
  amount: Number(item.amount) || 0,
  remark: item.remark || "",
  ref_number: item.ref_number || "",
  invoice_no: item.invoice_no || "",
  deposited: item.deposited ?? false,
});

const getCardColor = (type: string): "primary" | "secondary" | "info" | "default" => {
  switch ((type || "").toUpperCase()) {
    case "VISA": return "primary";
    case "MASTERCARD": return "secondary";
    case "AMEX": return "info";
    default: return "default";
  }
};

export default function CardPaymentsPage() {
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
  } = useMasterDetailState<CardPayment, Partial<CardPaymentCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    favoritesKey: "card_payments_favorites",
    defaultSortField: "date_time",
  });

  // Activity History is opened on demand from a detail icon next to the
  // Date section title, rather than shown inline.
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
    queryKey: ["card-payments", filterBranch],
    queryFn: () =>
      cardPaymentsApi.getAll({
        branch_code: filterBranch || undefined,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const filteredPayments = useMemo(() => {
    if (!payments) return [];
    let filtered = payments.filter(
      (p) =>
        (p.card_type || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.ref_number || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.invoice_no || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(p.id).includes(searchQuery)
    );
    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there).
    filtered.sort((a, b) => {
      const diff = new Date(b.date_time || "").getTime() - new Date(a.date_time || "").getTime();
      return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
    });
    return filtered;
  }, [payments, searchQuery]);

  const handleSelectWithCheck = useCallback(
    async (item: CardPayment) => {
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

  type CardPaymentRow = CardPayment;

  const paymentColumns: TDataGridColumn<CardPaymentRow>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<CardPaymentRow>) => (
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
        field: "ref_number",
        header: "Payment No",
        flex: 1,
        minWidth: 150,
        renderCell: (params: GridRenderCellParams<CardPaymentRow>) => params.row.ref_number || `Card #${params.row.id}`,
      },
      {
        field: "card_type",
        header: "Card Type",
        width: 130,
        renderCell: (params: GridRenderCellParams<CardPaymentRow>) => (
          <Chip label={params.row.card_type || "N/A"} size="small" color={getCardColor(params.row.card_type)} />
        ),
      },
      {
        field: "date_time",
        header: "Date",
        width: 160,
        renderCell: (params: GridRenderCellParams<CardPaymentRow>) =>
          params.row.date_time ? new Date(params.row.date_time).toLocaleDateString() : "-",
      },
      {
        field: "amount",
        header: "Amount",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<CardPaymentRow>) => `Rs. ${fmtLKR(Number(params.row.amount || 0))}`,
      },
      {
        field: "deposited",
        header: "Status",
        width: 120,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<CardPaymentRow>) =>
          params.row.deposited ? <Chip label="Deposited" size="small" color="success" /> : null,
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<CardPaymentRow>) => (
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
        <TDataGrid<CardPaymentRow>
          rows={filteredPayments}
          columns={paymentColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectWithCheck(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No card payments found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current card payment,
  // plus a "Back to Card Payments" link that returns to the table.
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
          Back to Card Payments
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
                <CardIcon fontSize="small" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{selectedItem.ref_number || `Payment #${selectedItem.id}`}</span>
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
          { label: "Card Payments", href: "/finance/customer-payment-methods/card-payments" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Payment" : `Payment #${selectedItem?.id}` }] : []),
        ]}
        title={selectedItem ? (selectedItem.ref_number || `Payment #${selectedItem.id}`) : ""}
        titleIcon={<CardIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Card Payment"
        noSelectionTitle="Select a Payment"
        isFavorite={selectedItem ? favorites.includes(selectedItem.id) : false}
        onToggleFavorite={selectedItem ? (e) => toggleFavorite(selectedItem.id, e) : undefined}
      />

      {/* Actions disabled - read-only mode */}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a card payment from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Card Information" columns={3}>
              <Autocomplete
                size="small"
                options={CARD_TYPE.map((ct) => ct.value)}
                getOptionLabel={(option) => CARD_TYPE.find((ct) => ct.value === option)?.label || option}
                value={formData.card_type || null}
                disabled
                readOnly
                renderInput={(params) => (
                  <TextField {...params} label="Card Type" InputProps={{ ...params.InputProps, readOnly: true }} />
                )}
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
                label="Reference Number"
                size="small"
                value={formData.ref_number || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            <FormSection title="Reference Details" columns={2}>
              <TextField
                label="Invoice Number"
                size="small"
                value={formData.invoice_no || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2" color="text.secondary">Deposited:</Typography>
                <Chip
                  label={formData.deposited ? "Yes" : "No"}
                  size="small"
                  color={formData.deposited ? "success" : "default"}
                />
              </Box>
            </FormSection>

            {selectedItem && !isCreating && (
              <FormSection
                title="Date"
                columns={1}
                titleAction={
                  <Tooltip title="View activity history">
                    <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <TextField
                  label="Payment Date"
                  size="small"
                  value={selectedItem.date_time ? new Date(selectedItem.date_time).toLocaleString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
              </FormSection>
            )}

            <FormSection title="Remarks" columns={1}>
              <TextField
                label="Remark"
                size="small"
                value={formData.remark || ""}
                disabled
                InputProps={{ readOnly: true }}
                multiline
                rows={2}
              />
            </FormSection>
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
    <MasterDetailLayout
      title="Card Payments"
      titleSlot={
        isPaymentDetailMode ? undefined : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search card payments..."
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
            filename={`card_payments_${new Date().toISOString().split("T")[0]}`}
            headers={["ID", "Ref Number", "Card Type", "Amount", "Invoice No", "Deposited", "Date", "Remark"]}
            rows={() =>
              filteredPayments.map((p) => [
                p.id,
                p.ref_number || "",
                p.card_type || "",
                Number(p.amount || 0),
                p.invoice_no || "",
                p.deposited ? "Yes" : "No",
                p.date_time ? new Date(p.date_time).toLocaleString() : "",
                p.remark || "",
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
      entityType="card_payment"
      entityId={selectedItem?.id}
      actionLabels={{
        create: "Card payment created",
      }}
    />
    </>
  );
}
