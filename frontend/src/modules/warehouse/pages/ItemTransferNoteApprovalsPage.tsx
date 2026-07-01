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
  Chip,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import FactCheckIcon from "@mui/icons-material/FactCheck";

// Import tijaero components
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  TFilterPanel,
  TBranchFilter,
  TStatusFilter,
  getStatusProps,
  SortOption,
  TDetailSkeleton,
  showSuccessToast,
  showErrorToast,
  modernTableStyles,
  TConfirmDialog,
  useTConfirmDialog,
} from "@/components/tijaero";

import { transferNotesApi } from "@/modules/warehouse/api";
import { approvalsApi, locationsApi, Location } from "@/modules/common/api";
import { useReferenceData, ProductRef } from "@/hooks";
// OPTIMIZED: Removed branchApi, productsApi imports - using aggregated endpoint
import {
  ItemTransferNote, 
  ItemTransferNoteItem,
  ItemTransferNoteWithItems,
} from "@/modules/warehouse/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date" },
  { value: "item_transfer_note", label: "ITN Number" },
];

const STATUS_FILTER_OPTIONS = [
  { value: null, label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export default function ItemTransferNoteApprovalsPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("created_date");
  const [selectedITN, setSelectedITN] = useState<ItemTransferNoteWithItems | null>(null);
  const [selectedItems, setSelectedItems] = useState<ItemTransferNoteItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Confirm dialog for warnings
  const confirmDialog = useTConfirmDialog();

  // Filter states
  const [filterStatus, setFilterStatus] = useState<string | null>("pending");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
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

  // Fetch transfer notes with approval status
  const { data: transferNotes = [], isLoading, refetch } = useQuery({
    queryKey: ["transfer-notes", filterBranch, filterStatus],
    queryFn: () => {
      if (!filterBranch) return Promise.resolve([]);
      const params: Record<string, any> = { branch_code: filterBranch };
      // Filter by approval status by checking the ITN status field
      return transferNotesApi.getAll(params);
    },
    enabled: branchResolved && filterBranch !== null,
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
    filtered.sort((a, b) => {
      if (sortField === "item_transfer_note") {
        return a.item_transfer_note.localeCompare(b.item_transfer_note);
      }
      const timeA = a.added_date ? new Date(a.added_date).getTime() : new Date(a.created_date).getTime();
      const timeB = b.added_date ? new Date(b.added_date).getTime() : new Date(b.created_date).getTime();
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      return b.id - a.id;
    });

    return filtered;
  }, [transferNotes, searchQuery, sortField, filterBranch, filterStatus, locationMap]);

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

  // Auto-select first ITN
  useEffect(() => {
    if (filteredITNs.length > 0 && !selectedITN) {
      handleSelectITN(filteredITNs[0]);
    }
  }, [filteredITNs, selectedITN, handleSelectITN]);

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async ({ approvalId }: { approvalId: number; itnId: number }) => approvalsApi.approve(approvalId),
    onSuccess: async (_data, { itnId }) => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      showSuccessToast("Transfer note approved successfully");
      // Refresh the selected ITN
      const updatedITN = await fetchITNDetails(itnId);
      setSelectedITN(updatedITN);
    },
    onError: () => showErrorToast("Failed to approve transfer note"),
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ approvalId, reason }: { approvalId: number; id: number; reason: string }) =>
      approvalsApi.reject(approvalId, reason),
    onSuccess: async (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      showSuccessToast("Transfer note rejected");
      setRejectDialogOpen(false);
      setRejectReason("");
      // Refresh the selected ITN
      const updatedITN = await fetchITNDetails(variables.id);
      setSelectedITN(updatedITN);
    },
    onError: () => showErrorToast("Failed to reject transfer note"),
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
    
    approveMutation.mutate({ approvalId: selectedITN.approval_id, itnId: selectedITN.id });
  };

  const handleReject = () => {
    if (selectedITN && rejectReason.trim()) {
      if (!selectedITN.approval_id) {
        showErrorToast("Approval record missing for this transfer note");
        return;
      }
      rejectMutation.mutate({ approvalId: selectedITN.approval_id, id: selectedITN.id, reason: rejectReason });
    }
  };

  const getLocationName = (locationId: number) => {
    return locationMap.get(locationId)?.name || `Location #${locationId}`;
  };

  const getProductName = (productId: number) => {
    return productMap.get(productId)?.name || `Product #${productId}`;
  };

  const selectedIsPending = selectedITN ? (selectedITN.status || "pending") === "pending" : false;

  // Master Panel
  const masterPanel = (
    <SearchableList
      items={filteredITNs}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search transfer notes..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedITN}
      emptyMessage="No transfer notes found"
      listHeader={
        <TFilterPanel>
          <TStatusFilter
            options={STATUS_FILTER_OPTIONS}
            value={filterStatus}
            onChange={setFilterStatus}
          />
          <TBranchFilter
            branches={branches}
            value={filterBranch}
            onChange={setFilterBranch}
          />
        </TFilterPanel>
      }
      renderItem={(itn, isSelected) => {
        const status = itn.status || "pending";
        const statusProps = getStatusProps(status, "orderStatus");
        
        return (
          <SelectableListItem
            key={itn.id}
            id={itn.id}
            isSelected={isSelected}
            onClick={() => handleSelectITN(itn)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{itn.item_transfer_note}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (ITN No)
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {getLocationName(itn.from_location_id)}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (From)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {getLocationName(itn.to_location_id)}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (To)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {new Date(itn.created_date).toLocaleDateString()}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Date)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                      <Chip
                        label={statusProps.label}
                        size="small"
                        color={statusProps.color}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected
                ? `${getLocationName(itn.from_location_id)} → ${getLocationName(itn.to_location_id)} • ${new Date(itn.created_date).toLocaleDateString()}`
                : undefined
            }
            statusChip={!isSelected ? statusProps : undefined}
          />
        );
      }}
    />
  );

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

      {/* Approval Actions */}
      {selectedITN && selectedIsPending && (
        <Box
          sx={{
            display: "flex",
            gap: 1,
            p: 1,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          <Button
            variant="contained"
            color="primary"
            startIcon={<CheckCircleIcon />}
            onClick={handleApprove}
            disabled={approveMutation.isPending}
          >
            Approve
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<CancelIcon />}
            onClick={() => setRejectDialogOpen(true)}
            disabled={rejectMutation.isPending}
          >
            Reject
          </Button>
        </Box>
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
              <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Product</TableCell>
                      <TableCell>Barcode</TableCell>
                      <TableCell>Remark</TableCell>
                      <TableCell align="center">Received</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} align="center">
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
                          <TableCell>{item.barcode || "-"}</TableCell>
                          <TableCell>{item.remark || "-"}</TableCell>
                          <TableCell align="center">
                            {item.item_recieved ? (
                              <Chip label="Yes" size="small" color="success" />
                            ) : (
                              <Chip label="No" size="small" color="warning" />
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                    <TableRow sx={modernTableStyles.footerRow}>
                      <TableCell colSpan={3} align="right">
                        <strong>Total Items:</strong>
                      </TableCell>
                      <TableCell align="center">
                        <strong>{selectedItems.length}</strong>
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
        masterPanel={masterPanel}
        detailPanel={detailPanel}
        onRefresh={() => refetch()}
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
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
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
    </>
  );
}
