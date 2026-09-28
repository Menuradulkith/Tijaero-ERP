/**
 * PurchaseReturnApprovalsPage - Purchase Return Approvals
 * Shows purchase returns for approval/rejection with filters
 * Refactored to use common purchasing components for better code reuse
 */

import { useMemo, useCallback, useState, useEffect } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";
import { useCurrencyStore } from "@/state/currencyStore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  TextField,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  InputAdornment,
  Tooltip,
} from "@mui/material";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import HistoryIcon from "@mui/icons-material/History";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import type { GridRenderCellParams } from "@mui/x-data-grid";

// Import tijaero components
import {
  MasterDetailLayout,
  ActionToolbar,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  fmtLKR,
  TBranchFilter,
  TStatusFilter,
  RETURN_STATUS_FILTER_OPTIONS,
  getStatusProps,
  TDetailSkeleton,
  showErrorToast,
  modernTableStyles,
  useCrudMutation,
  useRowSelection,
  TActivityHistoryPanel,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";

import { purchaseReturnsApi, goodReceivedNotesApi } from "@/modules/purchasing/api";
import { useReferenceData, ProductRef } from "@/hooks";
import ApproverAuthDialog from "../../purchasing/components/ApproverAuthDialog";
// OPTIMIZED: Removed productsApi, branchApi imports - using aggregated endpoint
import { PurchasingReturn, PurchasingReturnWithItems, GoodReceivedNote } from "@/modules/purchasing/types";

// A return row as shown in the browse table, with the GRN number looked up
// and attached directly so the table's own column-header sort orders by
// the displayed number rather than the raw GRN id.
type ReturnApprovalRow = PurchasingReturn & { grn_display_no: string };

export default function PurchaseReturnApprovalsPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedReturn, setSelectedReturn] = useState<PurchasingReturnWithItems | null>(null);
  const rowSelection = useRowSelection();

  // Activity History is opened on demand from a detail icon next to the
  // Activity History section title, rather than shown inline.
  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  // Filter states (applied - drives the actual list filtering)
  const [filterStatus, setFilterStatus] = useState<string | null>("pending"); // Default to pending
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [remarksDialogOpen, setRemarksDialogOpen] = useState(false);

  // OPTIMIZED: Single API call for products and branches (was 2 calls)
  const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["products", "branches"]);
  const products = refData?.products || [];
  const branches = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterBranch(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // branchResolved: true once we've either confirmed no default branch exists, or the filter has been set
  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Fetch returns
  const { data: returns = [], isLoading, refetch } = useQuery({
    queryKey: ["purchaseReturns"],
    queryFn: () => purchaseReturnsApi.getAll(),
    enabled: branchResolved,
  });

  // Fetch GRNs
  const { data: grns = [] } = useQuery({
    queryKey: ["good-received-notes"],
    queryFn: () => goodReceivedNotesApi.getAll(),
  });

  // Create lookup maps
  const grnMap = useMemo(() => {
    const map = new Map<number, GoodReceivedNote>();
    grns.forEach((g) => map.set(g.id, g));
    return map;
  }, [grns]);

  const productMap = useMemo(() => {
    const map = new Map<number, ProductRef>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  // Filter and sort returns
  const filteredReturns = useMemo(() => {
    let filtered = returns.filter((ret) => {
      // Status filter
      if (filterStatus && ret.status?.toLowerCase() !== filterStatus.toLowerCase()) {
        return false;
      }
      // Branch filter
      if (filterBranch && ret.branch_code !== filterBranch) {
        return false;
      }
      // Search filter
      const grn = grnMap.get(ret.goodreceivednote_id);
      return (
        ret.purchasing_return_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        grn?.good_received_no?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });

    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => {
      const timeDiff = new Date(b.added_date).getTime() - new Date(a.added_date).getTime();
      return timeDiff !== 0 ? timeDiff : (b.id || 0) - (a.id || 0);
    });

    return filtered;
  }, [returns, searchQuery, grnMap, filterStatus, filterBranch]);

  // Handle selection
  const handleSelectReturn = useCallback(async (ret: PurchasingReturn) => {
    try {
      const fullReturn = await purchaseReturnsApi.getById(ret.id);
      setSelectedReturn(fullReturn);
    } catch {
      showErrorToast("Failed to load return details");
    }
  }, []);

  // Returns to the browse table from the detail view.
  const handleBackToReturnApprovals = useCallback(() => {
    setSelectedReturn(null);
  }, []);

  // Approve mutation
  const approveMutation = useCrudMutation({
    mutationFn: ({ id, credentials }: { id: number; credentials?: any }) => purchaseReturnsApi.approve(id, { approve: true, credentials }),
    invalidateQueryKeys: [["purchaseReturns"], ["salesStock"]],
    successMessage: "Purchase return approved successfully",
    errorMessage: "Failed to approve return",
    onSuccess: (_data, { id }) => {
      queryClient.setQueryData<PurchasingReturn[]>(["purchaseReturns"], (prev) =>
        (prev || []).map((r) => (r.id === id ? { ...r, status: "approved" as const } : r))
      );
      setSelectedReturn((prev) => (prev && prev.id === id ? { ...prev, status: "approved" as const } : prev));
      setAuthDialogOpen(false);
    },
  });

  // Reject mutation
  const rejectMutation = useCrudMutation({
    mutationFn: ({ id, remarks, credentials }: { id: number; remarks: string; credentials?: any }) =>
      purchaseReturnsApi.approve(id, { approve: false, remarks, credentials }),
    invalidateQueryKeys: [["purchaseReturns"], ["salesStock"]],
    successMessage: "Purchase return rejected",
    errorMessage: "Failed to reject return",
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<PurchasingReturn[]>(["purchaseReturns"], (prev) =>
        (prev || []).map((r) => (r.id === variables.id ? { ...r, status: "rejected" as const } : r))
      );
      setSelectedReturn((prev) =>
        prev && prev.id === variables.id ? { ...prev, status: "rejected" as const } : prev
      );
      setRejectDialogOpen(false);
      setRejectReason("");
      setAuthDialogOpen(false);
    },
  });

  const handleApprove = () => {
    if (selectedReturn) {
      setAuthDialogOpen(true);
    }
  };

  const handleReject = () => {
    if (selectedReturn && rejectReason.trim()) {
      setAuthDialogOpen(true);
    }
  };

  const grn = selectedReturn ? grnMap.get(selectedReturn.goodreceivednote_id) : null;
  const selectedIsPending = (selectedReturn?.status || "").toLowerCase() === "pending";

  const getGRNNumber = (grnId: number) => {
    const g = grnMap.get(grnId);
    return g ? g.good_received_no : `GRN-${grnId}`;
  };

  const getBranchDisplay = (branchCode: string) => {
    const branch = branches.find((b) => b.branch_code === branchCode);
    return branch ? `${branch.branch_code} - ${branch.branch_name}` : branchCode;
  };

  // The table sorts by whichever column the user clicks; the GRN column
  // displays a looked-up number rather than the raw GRN id, so it needs
  // that number as its own field for the grid to sort on correctly.
  const returnRows = useMemo(
    () =>
      filteredReturns.map((ret) => ({
        ...ret,
        grn_display_no: getGRNNumber(ret.goodreceivednote_id),
      })),
    [filteredReturns, grnMap] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const returnColumns: TDataGridColumn<ReturnApprovalRow>[] = useMemo(
    () => [
      {
        field: "purchasing_return_no",
        header: "Return Number",
        flex: 1,
        minWidth: 170,
        renderCell: (params: GridRenderCellParams<ReturnApprovalRow>) => (
          <Typography variant="body2" fontWeight={600}>
            {params.row.purchasing_return_no || `PR-${params.row.id}`}
          </Typography>
        ),
      },
      {
        field: "grn_display_no",
        header: "GRN",
        flex: 1,
        minWidth: 150,
      },
      {
        field: "supplier_name",
        header: "Supplier",
        flex: 1,
        minWidth: 180,
      },
      {
        field: "branch_code",
        header: "Branch",
        width: 110,
      },
      {
        field: "added_date",
        header: "Return Date",
        type: "date",
        width: 130,
      },
      {
        field: "status",
        header: "Status",
        type: "status",
        statusMap: "purchaseReturn",
        width: 150,
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<ReturnApprovalRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectReturn(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectReturn]
  );

  // Browse mode: a full-width table of every return matching the current
  // filters (default view when nothing is selected).
  const returnTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<ReturnApprovalRow>
          rows={returnRows}
          columns={returnColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectReturn(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No returns found"
          autoHeight={false}
          height="100%"
          selectionMode="multiple"
          selectedRows={rowSelection.selectedRows}
          onSelectionChange={rowSelection.setSelectedRows}
        />
      </Box>
    </Box>
  );

  // Whether we're showing a single return's detail view instead of the
  // browse table.
  const isReturnApprovalDetailMode = !!selectedReturn;

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchasing" },
          { label: "Return Approvals", href: "/purchasing/return-approvals" },
          ...(selectedReturn ? [{ label: selectedReturn.purchasing_return_no || `PR-${selectedReturn.id}` }] : []),
        ]}
        title={selectedReturn?.purchasing_return_no || ""}
        titleIcon={<AssignmentReturnIcon color="primary" />}
        noSelectionTitle="Select a Return to Review"
        chips={
          selectedReturn
            ? (() => {
                const s = getStatusProps(selectedReturn.status || "draft", "purchaseReturn");
                return [{ label: s.label, color: s.color }];
              })()
            : []
        }
      />

      {/* Approve/Reject, grouped together on the right like the
          Cancel New / Next pairing on the PO creation wizard's toolbar. */}
      {selectedReturn && selectedIsPending && (
        <ActionToolbar
          hasSelectedItem
          isCreating={false}
          isEditing={false}
          canCreate={false}
          canDuplicate={false}
          canDelete={false}
          endActions={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<CheckCircleIcon />}
                onClick={handleApprove}
                disabled={approveMutation.isPending}
              >
                Approve
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<CancelIcon />}
                onClick={() => setRejectDialogOpen(true)}
                disabled={rejectMutation.isPending}
              >
                Reject
              </Button>
            </Box>
          }
        />
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedReturn ? (
          <EmptyState message="Select a purchase return from the list to review" />
        ) : isLoading ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} showTable />
        ) : (
          <>
            {/* Return Information */}
            <FormSection title="Return Information" columns={3}>
              <TextField label="Return Number" size="small" value={selectedReturn.purchasing_return_no || ""} disabled />
              <TextField label="GRN Number" size="small" value={grn?.good_received_no || ""} disabled />
              <TextField
                label="Return Date"
                size="small"
                value={new Date(selectedReturn.added_date).toLocaleDateString()}
                disabled
              />
              <TextField label="Branch" size="small" value={getBranchDisplay(selectedReturn.branch_code)} disabled />
              <TextField label="Status" size="small" value={selectedReturn.status} disabled />
              {selectedReturn.approved_date && (
                <TextField
                  label="Approved/Rejected Date"
                  size="small"
                  value={new Date(selectedReturn.approved_date).toLocaleDateString()}
                  disabled
                />
              )}
            </FormSection>

            {/* GRN Information */}
            {grn && (
              <FormSection title="GRN Information" columns={2}>
                <TextField label="GRN Number" size="small" value={grn.good_received_no} disabled />
                <TextField label="Supplier Invoice" size="small" value={grn.supplier_invoice_no || "N/A"} disabled />
                <TextField
                  label="GRN Date"
                  size="small"
                  value={new Date(grn.good_received_date).toLocaleDateString()}
                  disabled
                />
                <TextField label="Branch" size="small" value={getBranchDisplay(grn.branch_code)} disabled />
              </FormSection>
            )}

            {/* Return Items */}
            <FormSection title="Return Items" columns={1}>
              <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Barcode</TableCell>
                      <TableCell>Product</TableCell>
                      <TableCell align="right">{`Purchase Price (${currencySymbol})`}</TableCell>
                      <TableCell align="right">{`Return Price (${currencySymbol})`}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedReturn.items?.map((item, index) => {
                      const product = productMap.get(item.product_id);
                      return (
                        <TableRow key={index} sx={{ 
                          ...modernTableStyles.bodyRow,
                          ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                        }}>
                          <TableCell>{item.barcode}</TableCell>
                          <TableCell>{product?.name || `Product #${item.product_id}`}</TableCell>
                          <TableCell align="right">{fmtLKR(Number(item.purchasing_price))}</TableCell>
                          <TableCell align="right">{fmtLKR(Number(item.return_price))}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow sx={modernTableStyles.footerRow}>
                      <TableCell colSpan={3} align="right">
                        <strong>Total Return Amount:</strong>
                      </TableCell>
                      <TableCell align="right">
                        <strong>
                          {fmtLKR(selectedReturn.items?.reduce((sum, item) => sum + Number(item.return_price), 0) || 0)}
                        </strong>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </FormSection>

            {/* Remarks Section */}
            <FormSection title="Remarks" columns={1}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                <TextField
                  multiline
                  rows={2}
                  fullWidth
                  value={selectedReturn.remark || "No remarks"}
                  disabled
                  size="small"
                />
                <Tooltip title="View Remarks">
                  <IconButton size="small" onClick={() => setRemarksDialogOpen(true)}>
                    <MenuBookIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </FormSection>

            {/* Activity History */}
            <FormSection
              title="Activity History"
              columns={2}
              titleAction={
                <Tooltip title="View activity history">
                  <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                    <HistoryIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              }
            >
              <Box>
                <Typography variant="caption" color="text.secondary">Created</Typography>
                <Typography variant="body2">{formatDateTimeReadable(selectedReturn.added_date) || "-"}</Typography>
              </Box>
            </FormSection>
          </>
        )}
      </Box>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject Purchase Return</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Please provide a reason for rejecting this purchase return.
          </Typography>
          <TextField
            autoFocus
            label="Rejection Reason"
            multiline
            rows={4}
            fullWidth
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleReject}
            disabled={!rejectReason.trim() || rejectMutation.isPending}
          >
            Reject Return
          </Button>
        </DialogActions>
      </Dialog>

      {/* Remarks Modal */}
      <Dialog open={remarksDialogOpen} onClose={() => setRemarksDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Remarks</DialogTitle>
        <DialogContent>
          <TextField
            multiline
            rows={8}
            fullWidth
            placeholder="No remarks..."
            value={selectedReturn?.remark || ""}
            InputProps={{ readOnly: true }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemarksDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <ApproverAuthDialog
        open={authDialogOpen}
        onClose={() => setAuthDialogOpen(false)}
        onSubmit={(username, password) => {
          const credentials = { approver_username: username, approver_password: password };
          if (rejectDialogOpen && rejectReason.trim()) {
            rejectMutation.mutate({
              id: selectedReturn!.id,
              remarks: rejectReason,
              credentials,
            });
          } else {
            approveMutation.mutate({
              id: selectedReturn!.id,
              credentials,
            });
          }
        }}
        loading={approveMutation.isPending || rejectMutation.isPending}
        title={rejectDialogOpen ? "Authenticate to Reject" : "Authenticate to Approve"}
      />

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="purchase_return"
        entityId={selectedReturn?.id}
        actionLabels={{
          create: "Return created",
          approve: "Return approved",
          reject: "Return rejected",
        }}
      />
    </Box>
  );

  return (
    <MasterDetailLayout
      title="Purchase Return Approvals"
      icon={<FactCheckIcon color="primary" />}
      titleSlot={
        isReturnApprovalDetailMode ? (
          <Button
            size="small"
            startIcon={<ArrowBackIcon fontSize="small" />}
            onClick={handleBackToReturnApprovals}
            sx={{ textTransform: "none" }}
          >
            Back to Return Approvals
          </Button>
        ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search returns..."
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
            <Box sx={{ width: 160, flexShrink: 0 }}>
              <TStatusFilter options={RETURN_STATUS_FILTER_OPTIONS} value={filterStatus} onChange={setFilterStatus} label="" placeholder="All Statuses" size="small" />
            </Box>
            <Box sx={{ width: 160, flexShrink: 0 }}>
              <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
            </Box>
            {(searchQuery || filterStatus || filterBranch) && (
              <Tooltip title="Clear filters">
                <IconButton size="small" onClick={handleClearFilters}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )
      }
      onRefresh={() => refetch()}
      isLoading={isLoading}
      {...(isReturnApprovalDetailMode
        ? { children: detailPanel }
        : { children: returnTablePanel })}
    />
  );
}
