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
  CircularProgress,
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
  showSuccessToast,
  showErrorToast,
  modernTableStyles,
  TConfirmDialog,
  useTConfirmDialog,
} from "@/components/tijaero";

import { transferNotesApi, transferNoteApprovalsApi } from "@/modules/warehouse/api";
import { locationsApi, Location } from "@/modules/common/api";
import { branchApi } from "@/modules/branches/api";
import { productsApi } from "@/modules/inventory/api";
import { Product } from "@/modules/inventory/types";
import {
  ItemTransferNote, 
  ItemTransferNoteItem,
  ItemTransferNoteWithItems,
  ItemTransferNoteApproved,
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

// Get status from approval records
const getITNApprovalStatus = (itn: ItemTransferNoteWithItems): { status: string; approvalRecord?: ItemTransferNoteApproved } => {
  if (itn.approved_records && itn.approved_records.length > 0) {
    const latestApproval = itn.approved_records[itn.approved_records.length - 1];
    switch (latestApproval.approved_status) {
      case 1: return { status: "approved", approvalRecord: latestApproval };
      case 2: return { status: "rejected", approvalRecord: latestApproval };
      default: return { status: "pending", approvalRecord: latestApproval };
    }
  }
  return { status: "pending" };
};

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
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [remarksDialogOpen, setRemarksDialogOpen] = useState(false);

  // Fetch transfer notes with approval status
  const { data: transferNotes = [], isLoading, refetch } = useQuery({
    queryKey: ["transfer-notes"],
    queryFn: () => transferNotesApi.getAll(),
  });

  // Fetch approval status for all ITNs
  const [itnStatusMap, setItnStatusMap] = useState<Map<number, string>>(new Map());
  
  useEffect(() => {
    const fetchAllStatuses = async () => {
      const statusMap = new Map<number, string>();
      for (const itn of transferNotes) {
        try {
          const fullITN = await transferNotesApi.getById(itn.id);
          const { status } = getITNApprovalStatus(fullITN);
          statusMap.set(itn.id, status);
        } catch {
          statusMap.set(itn.id, "pending");
        }
      }
      setItnStatusMap(statusMap);
    };
    
    if (transferNotes.length > 0) {
      fetchAllStatuses();
    }
  }, [transferNotes]);

  // Fetch locations
  const { data: locationsData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => locationsApi.getAll(),
  });
  const locations = locationsData || [];

  // Fetch branches
  const { data: branchesData } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(),
  });
  const branches = branchesData?.items || [];

  // Fetch products
  const { data: productsData } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(),
  });
  const products = productsData || [];

  // Create lookup maps
  const locationMap = useMemo(() => {
    const map = new Map<number, Location>();
    locations.forEach((l) => map.set(l.id, l));
    return map;
  }, [locations]);

  const productMap = useMemo(() => {
    const map = new Map<number, Product>();
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
      filtered = filtered.filter(itn => itnStatusMap.get(itn.id) === filterStatus);
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
      return new Date(b.created_date).getTime() - new Date(a.created_date).getTime();
    });

    return filtered;
  }, [transferNotes, searchQuery, sortField, filterBranch, filterStatus, locationMap, itnStatusMap]);

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
    mutationFn: async (id: number) => {
      // Get existing approval record or create new one
      const itn = await fetchITNDetails(id);
      const existingApproval = itn.approved_records?.[0];
      
      if (existingApproval) {
        return transferNoteApprovalsApi.update(existingApproval.id, {
          item_transfer_note_id: id,
          approved_status: 1, // Approved
          approval_note: "Transfer approved",
        });
      } else {
        return transferNoteApprovalsApi.create({
          item_transfer_note_id: id,
          approved_status: 1, // Approved
          approval_note: "Transfer approved",
        });
      }
    },
    onSuccess: async (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      showSuccessToast("Transfer note approved successfully");
      // Refresh the selected ITN
      const updatedITN = await fetchITNDetails(id);
      setSelectedITN(updatedITN);
    },
    onError: () => showErrorToast("Failed to approve transfer note"),
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      const itn = await fetchITNDetails(id);
      const existingApproval = itn.approved_records?.[0];
      
      if (existingApproval) {
        return transferNoteApprovalsApi.update(existingApproval.id, {
          item_transfer_note_id: id,
          approved_status: 2, // Rejected
          approval_note: reason,
        });
      } else {
        return transferNoteApprovalsApi.create({
          item_transfer_note_id: id,
          approved_status: 2, // Rejected
          approval_note: reason,
        });
      }
    },
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
    
    approveMutation.mutate(selectedITN.id);
  };

  const handleReject = () => {
    if (selectedITN && rejectReason.trim()) {
      rejectMutation.mutate({ id: selectedITN.id, reason: rejectReason });
    }
  };

  const getLocationName = (locationId: number) => {
    return locationMap.get(locationId)?.name || `Location #${locationId}`;
  };

  const getProductName = (productId: number) => {
    return productMap.get(productId)?.name || `Product #${productId}`;
  };

  const selectedIsPending = selectedITN ? getITNApprovalStatus(selectedITN).status === "pending" : false;

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
        // Get status from cached map
        const status = itnStatusMap.get(itn.id) || "pending";
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
                const { status } = getITNApprovalStatus(selectedITN);
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
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
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
                value={getITNApprovalStatus(selectedITN).status}
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

            {/* Approval History */}
            {selectedITN.approved_records && selectedITN.approved_records.length > 0 && (
              <FormSection title="Approval History" columns={1}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  {selectedITN.approved_records.map((record, index) => {
                    const { status } = getITNApprovalStatus({ ...selectedITN, approved_records: [record] });
                    const statusProps = getStatusProps(status, "orderStatus");
                    return (
                      <Box key={record.id || index} sx={{ mb: index < selectedITN.approved_records!.length - 1 ? 2 : 0 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Chip
                            label={statusProps.label}
                            size="small"
                            color={statusProps.color}
                          />
                          {record.approved_date && (
                            <Typography variant="caption" color="text.secondary">
                              {new Date(record.approved_date).toLocaleString()}
                            </Typography>
                          )}
                        </Box>
                        {record.approval_note && (
                          <Typography variant="body2" sx={{ mt: 0.5, ml: 1 }}>
                            {record.approval_note}
                          </Typography>
                        )}
                      </Box>
                    );
                  })}
                </Paper>
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