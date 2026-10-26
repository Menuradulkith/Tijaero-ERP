/**
 * ItemTransferNoteApprovalsPage - Item Transfer Note Approvals
 * Shows transfer notes pending approval with ability to approve/reject
 * Following PO Approvals page pattern for consistency
 */

import { useMemo, useCallback, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Tooltip,
  InputAdornment,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import SearchIcon from "@mui/icons-material/Search";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";

// Import tijaero components
import {
  TChip,
  MasterDetailLayout,
  ActionToolbar,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  TBranchFilter,
  TStatusFilter,
  getStatusProps,
  TDataGrid,
  type TDataGridColumn,
  TDetailSkeleton,
  showSuccessToast,
  showErrorToast,
  handleApiError,
  modernTableStyles,
  TConfirmDialog,
  useTConfirmDialog,
} from "@/components/tijaero";

import { transferNotesApi } from "@/modules/warehouse/api";
import { approvalsApi, locationsApi, Location } from "@/modules/common/api";
import ApproverAuthDialog from "../../purchasing/components/ApproverAuthDialog";
import { useReferenceData, ProductRef } from "@/hooks";
// OPTIMIZED: Removed branchApi, productsApi imports - using aggregated endpoint
import {
  ItemTransferNote, 
  ItemTransferNoteItem,
  ItemTransferNoteWithItems,
} from "@/modules/warehouse/types";

const STATUS_FILTER_OPTIONS = [
  { value: null, label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export default function ItemTransferNoteApprovalsPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedITN, setSelectedITN] = useState<ItemTransferNoteWithItems | null>(null);
  const [selectedItems, setSelectedItems] = useState<ItemTransferNoteItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Confirm dialog for warnings
  const confirmDialog = useTConfirmDialog();

  // Filter states - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterStatus, setFilterStatus] = useState<string | null>("pending");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [remarksDialogOpen, setRemarksDialogOpen] = useState(false);

  // OPTIMIZED: Single API call for branches and products (was 2 separate calls)
  const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["branches", "products"]);
  const branches = filteredBranches || [];
  const products = refData?.products || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // branchResolved: true once we've either confirmed no default branch exists, or the filter has been set
  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterBranch(null);
  }, []);

  // Fetch transfer notes with approval status
  const { data: transferNotes = [], isLoading, refetch } = useQuery({
    queryKey: ["transfer-notes", filterBranch, filterStatus],
    queryFn: () => {
      // "All Branches" (no filter) lists every note the user may see; the server limits it to their branches.
      const params: Record<string, any> = { limit: 5000 };
      if (filterBranch) params.branch_code = filterBranch;
      // Filter by approval status by checking the ITN status field
      return transferNotesApi.getAll(params);
    },
    enabled: branchResolved,
  });

  // Fetch locations
  const { data: locationsData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => locationsApi.getAll(),
  });
  const locations = locationsData || [];

  // Create lookup maps
  const locationMap = useMemo(() => {
    const map = new Map<number, Location>();
    locations.forEach((l) => map.set(l.id, l));
    return map;
  }, [locations]);

  const productMap = useMemo(() => {
    const map = new Map<number, ProductRef>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  // Fetch full ITN details with items and approval
  const fetchITNDetails = useCallback(async (itnId: number): Promise<ItemTransferNoteWithItems> => {
    const itn = await transferNotesApi.getById(itnId);
    return itn;
  }, []);

  // Filter and sort transfer notes
  const filteredITNs = useMemo(() => {
    let filtered = transferNotes;

    // Filter by approval status
    if (filterStatus) {
      filtered = filtered.filter(itn => (itn.status || "pending") === filterStatus);
    }
    
    // Filter by branch
    if (filterBranch) {
      filtered = filtered.filter(itn => itn.branch_code === filterBranch);
    }

    // Search filter
    filtered = filtered.filter(
      (itn) =>
        itn.item_transfer_note.toLowerCase().includes(searchQuery.toLowerCase()) ||
        locationMap.get(itn.from_location_id)?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        locationMap.get(itn.to_location_id)?.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Sort
    // Default order before the user sorts a column in the table itself.
    filtered.sort((a, b) => {
      const timeA = a.added_date ? new Date(a.added_date).getTime() : new Date(a.created_date).getTime();
      const timeB = b.added_date ? new Date(b.added_date).getTime() : new Date(b.created_date).getTime();
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      return b.id - a.id;
    });

    return filtered;
  }, [transferNotes, searchQuery, filterBranch, filterStatus, locationMap]);

  // Handle selection
  const handleSelectITN = useCallback(async (itn: ItemTransferNote) => {
    try {
      setLoadingItems(true);
      const fullITN = await fetchITNDetails(itn.id);
      
      setSelectedITN(fullITN);
      setSelectedItems(fullITN.items || []);
    } catch {
      showErrorToast("Failed to load transfer note details");
    } finally {
      setLoadingItems(false);
    }
  }, [fetchITNDetails]);


  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async ({ approvalId, itnId, credentials }: { approvalId: number; itnId: number; credentials?: any }) => approvalsApi.approve(approvalId, undefined, credentials),
    onSuccess: async (_data, { itnId }) => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      showSuccessToast("Transfer note approved successfully");
      setAuthDialogOpen(false);
      // Refresh the selected ITN
      const updatedITN = await fetchITNDetails(itnId);
      setSelectedITN(updatedITN);
    },
    // show the server's reason (wrong approver password, a unit no longer free, ...), not a bare "Failed"
    onError: (error: unknown) => showErrorToast(handleApiError(error, "Failed to approve transfer note")),
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ approvalId, id, reason, credentials }: { approvalId: number; id: number; reason: string; credentials?: any }) =>
      approvalsApi.reject(approvalId, reason, credentials),
    onSuccess: async (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      showSuccessToast("Transfer note rejected");
      setRejectDialogOpen(false);
      setRejectReason("");
      setAuthDialogOpen(false);
      // Refresh the selected ITN
      const updatedITN = await fetchITNDetails(variables.id);
      setSelectedITN(updatedITN);
    },
    onError: (error: unknown) => showErrorToast(handleApiError(error, "Failed to reject transfer note")),
  });

  const handleApprove = async () => {
    if (!selectedITN) return;
    if (!selectedITN.approval_id) {
      showErrorToast("Approval record missing for this transfer note");
      return;
    }
    
    // Check if it's after 6pm
    const currentHour = new Date().getHours();
    const isAfterHours = currentHour >= 18;
    
    if (isAfterHours) {
      const confirmed = await confirmDialog.confirm({
        title: "After-Hours Approval Warning",
        message: `It is currently after 6:00 PM (now: ${new Date().toLocaleTimeString()}). Approving transfers after business hours is not recommended. Do you want to approve anyway?`,
        confirmText: "Approve Anyway",
        cancelText: "Cancel",
        confirmColor: "warning",
      });
      
      if (!confirmed) return;
    }
    
    setAuthDialogOpen(true);
  };

  const handleReject = () => {
    if (selectedITN && rejectReason.trim()) {
      if (!selectedITN.approval_id) {
        showErrorToast("Approval record missing for this transfer note");
        return;
      }
      setAuthDialogOpen(true);
    }
  };

  const getLocationName = (locationId: number) => {
    return locationMap.get(locationId)?.name || `Location #${locationId}`;
  };

  const getProductName = (productId: number) => {
    return productMap.get(productId)?.name || `Product #${productId}`;
  };

  // Returns to the browse table from the detail view.
  const handleBackToApprovals = useCallback(() => {
    setSelectedITN(null);
    setSelectedItems([]);
  }, []);

  const selectedIsPending = selectedITN ? (selectedITN.status || "pending") === "pending" : false;

  // The table shows the looked-up location names, so the grid sorts on them.
  const itnColumns: TDataGridColumn<ItemTransferNote>[] = useMemo(
    () => [
      { field: "item_transfer_note", header: "ITN No", flex: 1, minWidth: 160 },
      {
        field: "from_location_name",
        header: "From Location",
        flex: 1,
        minWidth: 150,
        renderCell: (params: GridRenderCellParams<ItemTransferNote>) =>
          params.row.from_location_name || getLocationName(params.row.from_location_id),
      },
      {
        field: "to_location_name",
        header: "To Location",
        flex: 1,
        minWidth: 150,
        renderCell: (params: GridRenderCellParams<ItemTransferNote>) =>
          params.row.to_location_name || getLocationName(params.row.to_location_id),
      },
      { field: "branch_code", header: "Branch", width: 110 },
      { field: "total_units", header: "Units", width: 90, type: "number" },
      { field: "created_by_name", header: "Created By", width: 150, valueGetter: (_v: unknown, row: ItemTransferNote) => row.created_by_name || "-" },
      { field: "created_date", header: "Date", width: 130, type: "date" },
      { field: "status", header: "Status", width: 140, align: "center", headerAlign: "center", type: "status", statusMap: "orderStatus" },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<ItemTransferNote>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectITN(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectITN, locationMap] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Browse mode: a full-width table of every note matching the current filters.
  const itnTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<ItemTransferNote>
          rows={filteredITNs}
          columns={itnColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectITN(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No transfer notes found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Whether a single note's detail view is showing instead of the browse table.
  const isApprovalDetailMode = !!selectedITN || loadingItems;

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Warehouse" },
          { label: "ITN Approvals", href: "/warehouse/itn-approvals" },
          ...(selectedITN ? [{ label: selectedITN.item_transfer_note }] : []),
        ]}
        title={selectedITN?.item_transfer_note || ""}
        titleIcon={<FactCheckIcon color="primary" />}
        noSelectionTitle="Select a Transfer Note to Review"
        chips={
          selectedITN
            ? (() => {
                const status = selectedITN.status || "pending";
                const s = getStatusProps(status, "orderStatus");
                return [{ label: s.label, color: s.color }];
              })()
            : []
        }
      />

      {/* Approve/Reject, grouped on the right like the other approval pages. */}
      {selectedITN && selectedIsPending && (
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
        {loadingItems ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} showTable />
        ) : !selectedITN ? (
          <EmptyState message="Select a transfer note from the list to review" />
        ) : (
          <>
            {/* Transfer Information */}
            <FormSection title="Transfer Information" columns={3}>
              <TextField label="ITN Number" size="small" value={selectedITN.item_transfer_note} disabled />
              <TextField
                label="Transfer Date"
                size="small"
                value={new Date(selectedITN.created_date).toLocaleDateString()}
                disabled
              />
              <TextField label="Branch" size="small" value={selectedITN.branch_code} disabled />
              <TextField
                label="From Location"
                size="small"
                value={getLocationName(selectedITN.from_location_id)}
                disabled
              />
              <TextField
                label="To Location"
                size="small"
                value={getLocationName(selectedITN.to_location_id)}
                disabled
              />
              <TextField
                label="Status"
                size="small"
                value={selectedITN.status || "pending"}
                disabled
              />
            </FormSection>

            {/* Transfer Items */}
            <FormSection title="Transfer Items" columns={1}>
              <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Product</TableCell>
                      <TableCell>Serial / Batch</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell>Remark</TableCell>
                      <TableCell align="center">Received</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} align="center">
                          <Typography color="text.secondary">No items in this transfer</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      selectedItems.map((item, index) => (
                        <TableRow key={item.id || index} sx={{ 
                          ...modernTableStyles.bodyRow,
                          ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                        }}>
                          <TableCell>{item.product_name || getProductName(item.product_id)}</TableCell>
                          <TableCell>
                            {item.barcode ||
                              (item.batch_no
                                ? `Batch ${item.batch_no}${item.expiry_date ? ` (exp ${item.expiry_date})` : ""}`
                                : "Quantity only")}
                          </TableCell>
                          <TableCell align="right">{item.quantity ?? 1}</TableCell>
                          <TableCell>{item.remark || "-"}</TableCell>
                          <TableCell align="center">
                            {item.item_recieved ? (
                              <TChip label="Yes" size="small" color="success" />
                            ) : (
                              <TChip label="No" size="small" color="warning" />
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                    <TableRow sx={modernTableStyles.footerRow}>
                      <TableCell colSpan={2} align="right">
                        <strong>Total Units:</strong>
                      </TableCell>
                      <TableCell align="right">
                        <strong>{selectedItems.reduce((n, i) => n + (i.quantity ?? 1), 0)}</strong>
                      </TableCell>
                      <TableCell colSpan={2} />
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
                  value={selectedITN.remark || "No remarks"}
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

          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="ITN Approvals"
        icon={<FactCheckIcon color="primary" />}
        titleSlot={
          isApprovalDetailMode ? (
            <Button
              size="small"
              startIcon={<ArrowBackIcon fontSize="small" />}
              onClick={handleBackToApprovals}
              sx={{ textTransform: "none" }}
            >
              Back to ITN Approvals
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search transfer notes..."
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
              <Box sx={{ width: 160, flexShrink: 0 }}>
                <TStatusFilter
                  options={STATUS_FILTER_OPTIONS}
                  value={filterStatus}
                  onChange={setFilterStatus}
                  label=""
                  placeholder="All Statuses"
                  size="small"
                />
              </Box>
              <Box sx={{ width: 160, flexShrink: 0 }}>
                <TBranchFilter
                  branches={branches}
                  value={filterBranch}
                  onChange={setFilterBranch}
                  label=""
                  placeholder="All Branches"
                  size="small"
                />
              </Box>
              {(searchQuery || filterStatus || filterBranch) && (
                <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        onRefresh={() => refetch()}
        isLoading={isLoading}
        {...(isApprovalDetailMode ? { children: detailPanel } : { children: itnTablePanel })}
      />

      {/* Reject Dialog */}
      <Dialog
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reject Transfer Note</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Please provide a reason for rejecting this transfer note.
          </Typography>
          <TextField
            autoFocus
            label="Rejection Reason"
            fullWidth
            multiline
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            required
          />
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" startIcon={<CancelIcon />} onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleReject}
            color="error"
            variant="contained"
            disabled={!rejectReason.trim() || rejectMutation.isPending}
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>

      {/* Remarks Dialog */}
      <Dialog
        open={remarksDialogOpen}
        onClose={() => setRemarksDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Transfer Note Remarks</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
            {selectedITN?.remark || "No remarks provided"}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemarksDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      
      <TConfirmDialog {...confirmDialog.dialogProps} />

      <ApproverAuthDialog
        open={authDialogOpen}
        onClose={() => setAuthDialogOpen(false)}
        onSubmit={(username, password) => {
          const credentials = { approver_username: username, approver_password: password };
          if (rejectDialogOpen && rejectReason.trim()) {
            rejectMutation.mutate({
              approvalId: selectedITN!.approval_id!,
              id: selectedITN!.id,
              reason: rejectReason,
              credentials,
            });
          } else {
            approveMutation.mutate({
              approvalId: selectedITN!.approval_id!,
              itnId: selectedITN!.id,
              credentials,
            });
          }
        }}
        loading={approveMutation.isPending || rejectMutation.isPending}
        title={rejectDialogOpen ? "Authenticate to Reject" : "Authenticate to Approve"}
      />
    </>
  );
}
