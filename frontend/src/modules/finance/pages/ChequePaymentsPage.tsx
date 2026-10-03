/**
 * Cheque Payments Page - Master-Detail Layout
 * Follows the Purchasing/Sales UI pattern with Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Autocomplete,
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
} from "@mui/material";
import {
  History as HistoryIcon,
  Receipt as ChequeIcon,
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
  TDatePicker,
  TDataGrid,
  type TDataGridColumn,
  fmtLKR,
  TActivityHistoryPanel,
  TRemarkField,
} from "@/components/tijaero";

import { chequePaymentsApi } from "@/modules/finance/api";
import { ChequePayment, ChequePaymentCreate } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";
import { useCurrencyStore } from "@/state/currencyStore";

interface Branch {
  branch_code: string;
  branch_name: string;
}

// A cheque payment row as shown in the browse table, with the branch name
// looked up and attached directly so the table's own column-header sort
// orders by the displayed name rather than the raw branch_code.
type ChequePaymentRow = ChequePayment & { branch_name: string };

const INITIAL_FORM_DATA: Partial<ChequePaymentCreate> = {
  cheque_number: 0,
  branch_code: 0,
  from_party: "",
  bank: "",
  amount: 0,
  cheque_date: "",
  deposit_date: "",
  remark: "",
  payment_for: "",
  invoice_no: "",
};

const resetFormFromItem = (item: ChequePayment): Partial<ChequePaymentCreate> => ({
  cheque_number: item.cheque_number || 0,
  branch_code: item.branch_code || 0,
  from_party: item.from_party || "",
  bank: item.bank || "",
  amount: Number(item.amount) || 0,
  cheque_date: item.cheque_date || "",
  deposit_date: item.deposit_date || "",
  remark: item.remark || "",
  payment_for: item.payment_for || "",
  invoice_no: item.invoice_no || "",
});

export default function ChequePaymentsPage() {
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
  } = useMasterDetailState<ChequePayment, Partial<ChequePaymentCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    defaultSortField: "cheque_date",
  });

  // Activity History is opened on demand from a detail icon next to the
  // Additional Info section title, rather than shown inline.
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

  const { data: cheques = [], isLoading, refetch } = useQuery({
    queryKey: ["cheque-payments", filterBranch],
    queryFn: () =>
      chequePaymentsApi.getAll({
        branch_code: filterBranch || undefined,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const filteredCheques = useMemo(() => {
    if (!cheques) return [];
    let filtered = cheques.filter(
      (c) =>
        (c.from_party || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.bank || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.invoice_no || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(c.cheque_number || "").includes(searchQuery) ||
        String(c.id).includes(searchQuery)
    );
    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there).
    filtered.sort((a, b) => {
      const diff = new Date(b.cheque_date || "").getTime() - new Date(a.cheque_date || "").getTime();
      return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
    });
    return filtered;
  }, [cheques, searchQuery]);

  const handleSelectWithCheck = useCallback(
    async (item: ChequePayment) => {
      await handleSelectItem(item);
    },
    [handleSelectItem]
  );

  // Whether we're showing a single cheque payment's detail view instead of
  // the browse table. This page is read-only, so there's no "creating" state
  // to account for beyond what the hook exposes.
  const isChequeDetailMode = !!selectedItem || isCreating;

  // Returns to the browse table from the detail view.
  const handleBackToCheques = useCallback(() => {
    setSelectedItem(null);
  }, [setSelectedItem]);

  // The table sorts by whichever column the user clicks; the Branch column
  // displays a looked-up name rather than the raw branch_code, so it needs
  // that name as its own field for the grid to sort on correctly.
  const chequeRows: ChequePaymentRow[] = useMemo(
    () =>
      filteredCheques.map((chq) => ({
        ...chq,
        branch_name: branches.find((b) => String(b.branch_code) === String(chq.branch_code))?.branch_name || String(chq.branch_code ?? "-"),
      })),
    [filteredCheques, branches]
  );

  const chequeColumns: TDataGridColumn<ChequePaymentRow>[] = useMemo(
    () => [
      {
        field: "cheque_number",
        header: "Cheque No",
        width: 140,
        renderCell: (params: GridRenderCellParams<ChequePaymentRow>) => `CHQ-${params.row.cheque_number || params.row.id}`,
      },
      { field: "from_party", header: "Payee", flex: 1, minWidth: 160 },
      { field: "branch_name", header: "Branch", width: 150 },
      { field: "bank", header: "Bank", flex: 1, minWidth: 130 },
      {
        field: "cheque_date",
        header: "Date",
        width: 130,
        renderCell: (params: GridRenderCellParams<ChequePaymentRow>) =>
          params.row.cheque_date ? new Date(params.row.cheque_date).toLocaleDateString() : "-",
      },
      {
        field: "amount",
        header: "Amount",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<ChequePaymentRow>) => `${currencySymbol} ${fmtLKR(Number(params.row.amount || 0))}`,
      },
      {
        field: "deposit_date",
        header: "Clearance Date",
        width: 150,
        renderCell: (params: GridRenderCellParams<ChequePaymentRow>) =>
          params.row.deposit_date ? new Date(params.row.deposit_date).toLocaleDateString() : "-",
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<ChequePaymentRow>) => (
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

  // Browse mode: a full-width table of every cheque payment (shown when
  // nothing is selected). Sorting is done per-column via the grid's own
  // column header menu, not a separate "Sort by" control.
  const chequeTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<ChequePaymentRow>
          rows={chequeRows}
          columns={chequeColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectWithCheck(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No cheque payments found"
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
          { label: "Cheque Payments", href: "/finance/customer-payment-methods/cheque-payments" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Cheque" : `CHQ-${selectedItem?.cheque_number || selectedItem?.id}` }] : []),
        ]}
        title={selectedItem ? `CHQ-${selectedItem.cheque_number || selectedItem.id}` : ""}
        titleIcon={<ChequeIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Cheque Payment"
        noSelectionTitle="Select a Cheque"
      />

      {/* Actions disabled - read-only mode */}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a cheque payment from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Cheque Information" columns={3}>
              <TextField
                label="Cheque Number"
                size="small"
                type="number"
                value={formData.cheque_number || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="From Party"
                size="small"
                value={formData.from_party || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Bank"
                size="small"
                value={formData.bank || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            <FormSection title="Payment Details" columns={3}>
              <TextField
                label="Amount"
                size="small"
                type="number"
                value={Number(formData.amount) || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(option: Branch) => `${option.branch_code} - ${option.branch_name}`}
                value={branches.find((b) => String(b.branch_code) === String(formData.branch_code)) || null}
                disabled
                readOnly
                renderInput={(params) => <TextField {...params} label="Branch" InputProps={{ ...params.InputProps, readOnly: true }} />}
              />
              <TextField
                label="Invoice Number"
                size="small"
                value={formData.invoice_no || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            <FormSection title="Dates" columns={2}>
              <TDatePicker
                label="Cheque Date"
                value={formData.cheque_date || ""}
                onChange={() => {}}
                disabled
                size="small"
              />
              <TDatePicker
                label="Deposit Date"
                value={formData.deposit_date || ""}
                onChange={() => {}}
                disabled
                size="small"
              />
            </FormSection>

            <FormSection
              title="Additional Info"
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
                label="Payment For"
                size="small"
                value={formData.payment_for || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TRemarkField
                label="Remark"
                size="small"
                value={formData.remark || ""}
                onChange={() => {}}
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
      title="Cheque Payments"
      titleSlot={
        isChequeDetailMode ? (
          <Button
            size="small"
            startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={handleBackToCheques}
            sx={{ textTransform: "none" }}
          >
            Back to Cheque Payments
          </Button>
          ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search cheques..."
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
      {...(isChequeDetailMode
        ? { children: detailPanel }
        : { children: chequeTablePanel })}
    />

    <TActivityHistoryPanel
      open={activityHistoryOpen}
      onClose={() => setActivityHistoryOpen(false)}
      entityType="cheque_payment"
      entityId={selectedItem?.id}
      actionLabels={{
        create: "Cheque payment created",
      }}
    />
    </>
  );
}
