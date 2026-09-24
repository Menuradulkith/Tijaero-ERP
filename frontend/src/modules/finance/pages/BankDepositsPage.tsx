/**
 * Bank Deposits Page - Master-Detail Layout
 * Follows the Purchasing/Sales UI pattern with Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { exportToCSV } from "@/utils/csvExport";
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
import { Download as DownloadIcon } from "@mui/icons-material";
import {
  AccountBalance as BankIcon,
  History as HistoryIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  ArrowBack as ArrowBackIcon,
  Star as StarIcon,
  StarBorder as StarOutlineIcon,
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
  TStatusFilter,
  TDataGrid,
  type TDataGridColumn,
  fmtLKR,
  TActivityHistoryPanel,
} from "@/components/tijaero";

import { bankDepositsApi } from "@/modules/finance/api";
import { BankDeposit, BankDepositCreate } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";

interface Branch {
  branch_code: string;
  branch_name: string;
}

// A bank deposit row as shown in the browse table, with the branch name
// looked up and attached directly so the table's own column-header sort
// orders by the displayed name rather than the raw branch_code.
type BankDepositRow = BankDeposit & { branch_name: string };

const INITIAL_FORM_DATA: Partial<BankDepositCreate> = {
  deposits_amount: 0,
  branch_code: "",
  bank_name: "",
  remarks: "",
  payment_for: "",
  invoice_no: "",
};

const resetFormFromItem = (item: BankDeposit): Partial<BankDepositCreate> => ({
  deposits_amount: Number(item.deposits_amount) || 0,
  branch_code: item.branch_code || "",
  bank_name: item.bank_name || "",
  remarks: item.remarks || "",
  payment_for: item.payment_for || "",
  invoice_no: item.invoice_no || "",
});

export default function BankDepositsPage() {
  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterVerified, setFilterVerified] = useState<string | null>(null);

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
  } = useMasterDetailState<BankDeposit, Partial<BankDepositCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    favoritesKey: "bank_deposits_favorites",
    defaultSortField: "created_date",
  });

  // Activity History is opened on demand from a detail icon next to the
  // Status section title, rather than shown inline.
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
    setFilterVerified(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: deposits = [], isLoading, refetch } = useQuery({
    queryKey: ["bank-deposits", filterBranch, filterVerified],
    queryFn: () =>
      bankDepositsApi.getAll({
        branch_code: filterBranch || undefined,
        verified: filterVerified === null ? undefined : filterVerified === "verified",
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const filteredDeposits = useMemo(() => {
    if (!deposits) return [];
    let filtered = deposits.filter(
      (d) =>
        (d.bank_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (d.invoice_no || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (d.payment_for || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(d.id).includes(searchQuery)
    );
    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there).
    filtered.sort((a, b) => {
      const timeDiff = new Date(b.created_date || "").getTime() - new Date(a.created_date || "").getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id - a.id;
    });
    return filtered;
  }, [deposits, searchQuery]);

  const handleSelectWithCheck = useCallback(
    async (item: BankDeposit) => {
      await handleSelectItem(item);
    },
    [handleSelectItem]
  );

  // Whether we're showing a single bank deposit's detail view instead of the
  // browse table. This page is read-only, so there's no "creating" state to
  // account for beyond what the hook exposes.
  const isDepositDetailMode = !!selectedItem || isCreating;

  // Returns to the browse table from the detail view.
  const handleBackToDeposits = useCallback(() => {
    setSelectedItem(null);
  }, [setSelectedItem]);

  // The table sorts by whichever column the user clicks; the Branch column
  // displays a looked-up name rather than the raw branch_code, so it needs
  // that name as its own field for the grid to sort on correctly.
  const depositRows: BankDepositRow[] = useMemo(
    () =>
      filteredDeposits.map((dep) => ({
        ...dep,
        branch_name: branches.find((b) => b.branch_code === dep.branch_code)?.branch_name || dep.branch_code || "-",
      })),
    [filteredDeposits, branches]
  );

  const depositColumns: TDataGridColumn<BankDepositRow>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<BankDepositRow>) => (
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
        header: "Deposit No",
        width: 130,
        renderCell: (params: GridRenderCellParams<BankDepositRow>) => `#${params.row.id}`,
      },
      { field: "bank_name", header: "Bank", flex: 1, minWidth: 150 },
      { field: "branch_name", header: "Branch", width: 150 },
      {
        field: "created_date",
        header: "Date",
        width: 140,
        renderCell: (params: GridRenderCellParams<BankDepositRow>) =>
          params.row.created_date ? new Date(params.row.created_date).toLocaleDateString() : "-",
      },
      {
        field: "deposits_amount",
        header: "Amount",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<BankDepositRow>) => `Rs. ${fmtLKR(Number(params.row.deposits_amount || 0))}`,
      },
      {
        field: "invoice_no",
        header: "Reference",
        width: 150,
        renderCell: (params: GridRenderCellParams<BankDepositRow>) => params.row.invoice_no || "-",
      },
      {
        field: "verified",
        header: "Status",
        width: 120,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<BankDepositRow>) => (
          <Chip
            label={params.row.verified ? "Verified" : "Pending"}
            size="small"
            color={params.row.verified ? "success" : "warning"}
          />
        ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<BankDepositRow>) => (
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

  // Browse mode: a full-width table of every bank deposit (shown when
  // nothing is selected). Sorting is done per-column via the grid's own
  // column header menu, not a separate "Sort by" control.
  const depositTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<BankDepositRow>
          rows={depositRows}
          columns={depositColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectWithCheck(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No bank deposits found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current bank deposit.
  // A "Back to Bank Deposits" link returns to the table.
  const singleDepositPanel = (
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
          onClick={handleBackToDeposits}
          sx={{ textTransform: "none" }}
        >
          Back to Bank Deposits
        </Button>
      </Box>
      {selectedItem && (
        <SelectableListItem
          id={selectedItem.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ bgcolor: "action.disabledBackground", color: "text.secondary" }}>
                <BankIcon />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>{selectedItem.bank_name || `Deposit #${selectedItem.id}`}</span>
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
          { label: "Bank Deposits", href: "/finance/customer-payment-methods/bank-deposits" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Deposit" : `Deposit #${selectedItem?.id}` }] : []),
        ]}
        title={selectedItem ? (selectedItem.bank_name || `Deposit #${selectedItem.id}`) : ""}
        titleIcon={<BankIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Bank Deposit"
        noSelectionTitle="Select a Deposit"
        isFavorite={selectedItem ? favorites.includes(selectedItem.id) : false}
        onToggleFavorite={selectedItem ? (e) => toggleFavorite(selectedItem.id, e) : undefined}
      />

      {/* Actions disabled - read-only mode */}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a bank deposit from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Deposit Information" columns={3}>
              <TextField
                label="Deposit Amount"
                size="small"
                type="number"
                value={Number(formData.deposits_amount) || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(option: Branch) => `${option.branch_code} - ${option.branch_name}`}
                value={branches.find((b) => b.branch_code === formData.branch_code) || null}
                disabled
                readOnly
                renderInput={(params) => (
                  <TextField {...params} label="Branch" InputProps={{ ...params.InputProps, readOnly: true }} />
                )}
              />
              <TextField
                label="Bank Name"
                size="small"
                value={formData.bank_name || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            <FormSection title="Reference Details" columns={2}>
              <TextField
                label="Payment For"
                size="small"
                value={formData.payment_for || ""}
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

            {selectedItem && !isCreating && (
              <FormSection
                title="Status"
                columns={3}
                titleAction={
                  <Tooltip title="View activity history">
                    <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                      <HistoryIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">Verification:</Typography>
                  <Chip label={selectedItem.verified ? "Verified" : "Pending"} size="small" color={selectedItem.verified ? "success" : "warning"} />
                </Box>
                <TextField
                  label="Created Date"
                  size="small"
                  value={selectedItem.created_date ? new Date(selectedItem.created_date).toLocaleString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                {selectedItem.returned !== undefined && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">Returned:</Typography>
                    <Chip label={selectedItem.returned ? "Yes" : "No"} size="small" color={selectedItem.returned ? "error" : "default"} />
                  </Box>
                )}
              </FormSection>
            )}

            <FormSection title="Remarks" columns={1}>
              <TextField
                label="Remarks"
                size="small"
                value={formData.remarks || ""}
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
      title="Bank Deposits"
      titleSlot={
        isDepositDetailMode ? undefined : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search deposits..."
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
            <Box sx={{ width: 150, flexShrink: 0 }}>
              <TStatusFilter
                options={[
                  { value: null, label: "All" },
                  { value: "verified", label: "Verified" },
                  { value: "pending", label: "Pending" },
                ]}
                value={filterVerified}
                onChange={setFilterVerified}
                label=""
                placeholder="All"
                size="small"
              />
            </Box>
            {(searchQuery || filterBranch || filterVerified) && (
              <Tooltip title="Clear filters">
                <IconButton size="small" onClick={handleClearFilters}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )
      }
      headerActions={
        isDepositDetailMode ? undefined : (
          <Button
            size="small"
            startIcon={<DownloadIcon />}
            onClick={() => {
              if (!filteredDeposits.length) return;
              const headers = ["Date", "Bank", "Branch", "Amount", "Status", "Remarks"];
              const rows = filteredDeposits.map((d: BankDeposit) => [
                d.created_date ?? "",
                d.bank_name ?? "",
                d.branch_code ?? "",
                d.deposits_amount ?? "",
                d.verified ? "Verified" : "Pending",
                d.remarks ?? "",
              ]);
              exportToCSV({ filename: "bank_deposits", headers, rows });
            }}
          >
            Export CSV
          </Button>
        )
      }
      onRefresh={refetch}
      isLoading={isLoading}
      {...(isDepositDetailMode
        ? { masterPanel: singleDepositPanel, detailPanel }
        : { children: depositTablePanel })}
    />

    <TActivityHistoryPanel
      open={activityHistoryOpen}
      onClose={() => setActivityHistoryOpen(false)}
      entityType="bank_deposit"
      entityId={selectedItem?.id}
      actionLabels={{
        create: "Deposit created",
        verify: "Deposit verified",
      }}
    />
    </>
  );
}
