/**
 * PurchaseReturnApprovalsPage - Purchase Return Approvals
 * Shows purchase returns for approval/rejection with filters
 * Refactored to use common purchasing components for better code reuse
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
import FactCheckIcon from "@mui/icons-material/FactCheck";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";

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
  RETURN_STATUS_FILTER_OPTIONS,
  getStatusProps,
  SortOption,
  showSuccessToast,
  showErrorToast,
  modernTableStyles,
} from "@/components/tijaero";

import { purchaseReturnsApi, goodReceivedNotesApi } from "@/modules/purchasing/api";
import { productsApi } from "@/modules/inventory/api";
import { branchApi } from "@/modules/branches/api";
import { PurchasingReturn, PurchasingReturnWithItems, GoodReceivedNote } from "@/modules/purchasing/types";
import { Product } from "@/modules/inventory/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "added_date", label: "Date" },
  { value: "purchasing_return_no", label: "Return Number" },
];

// Status options are now imported from common components (RETURN_STATUS_OPTIONS)
// getStatusChipProps is now imported from common components

export default function PurchaseReturnApprovalsPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("added_date");
  const [selectedReturn, setSelectedReturn] = useState<PurchasingReturnWithItems | null>(null);

  // Filter states
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Dialogs
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [remarksDialogOpen, setRemarksDialogOpen] = useState(false);

  // Fetch returns
  const { data: returns = [], isLoading, refetch } = useQuery({
    queryKey: ["purchase-returns"],
    queryFn: () => purchaseReturnsApi.getAll(),
  });

  // Fetch GRNs
  const { data: grns = [] } = useQuery({
    queryKey: ["good-received-notes"],
    queryFn: () => goodReceivedNotesApi.getAll(),
  });

  // Fetch products
  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(),
  });

  // Fetch branches
  const { data: branchesData } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(),
  });
  const branches = branchesData?.items || [];

  // Create lookup maps
  const grnMap = useMemo(() => {
    const map = new Map<number, GoodReceivedNote>();
    grns.forEach((g) => map.set(g.id, g));
    return map;
  }, [grns]);

  const productMap = useMemo(() => {
    const map = new Map<number, Product>();
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

    filtered.sort((a, b) => {
      if (sortField === "purchasing_return_no") {
        return (a.purchasing_return_no || "").localeCompare(b.purchasing_return_no || "");
      }
      return new Date(b.added_date).getTime() - new Date(a.added_date).getTime();
    });

    return filtered;
  }, [returns, searchQuery, sortField, grnMap, filterStatus, filterBranch]);

  // Handle selection
  const handleSelectReturn = useCallback(async (ret: PurchasingReturn) => {
    try {
      const fullReturn = await purchaseReturnsApi.getById(ret.id);
      setSelectedReturn(fullReturn);
    } catch {
      showErrorToast("Failed to load return details");
    }
  }, []);

  // Auto-select first return
  useEffect(() => {
    if (filteredReturns.length > 0 && !selectedReturn) {
      handleSelectReturn(filteredReturns[0]);
    }
  }, [filteredReturns, selectedReturn, handleSelectReturn]);

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: (id: number) => purchaseReturnsApi.approve(id, { approve: true }),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<PurchasingReturn[]>(["purchase-returns"], (prev) =>
        (prev || []).map((r) => (r.id === id ? { ...r, status: "approved" as const } : r))
      );
      setSelectedReturn((prev) => (prev && prev.id === id ? { ...prev, status: "approved" as const } : prev));
      queryClient.invalidateQueries({ queryKey: ["purchaseReturns"] });
      queryClient.invalidateQueries({ queryKey: ["sales-stock"] });
      showSuccessToast("Purchase return approved successfully");
    },
    onError: (error: any) => showErrorToast(error.response?.data?.detail || "Failed to approve return"),
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }: { id: number; remarks: string }) =>
      purchaseReturnsApi.approve(id, { approve: false, remarks }),
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<PurchasingReturn[]>(["purchase-returns"], (prev) =>
        (prev || []).map((r) => (r.id === variables.id ? { ...r, status: "rejected" as const } : r))
      );
      setSelectedReturn((prev) =>
        prev && prev.id === variables.id ? { ...prev, status: "rejected" as const } : prev
      );
      queryClient.invalidateQueries({ queryKey: ["purchaseReturns"] });
      queryClient.invalidateQueries({ queryKey: ["sales-stock"] });
      showSuccessToast("Purchase return rejected");
      setRejectDialogOpen(false);
      setRejectReason("");
    },
    onError: (error: any) => showErrorToast(error.response?.data?.detail || "Failed to reject return"),
  });

  const handleApprove = () => {
    if (selectedReturn) {
      approveMutation.mutate(selectedReturn.id);
    }
  };

  const handleReject = () => {
    if (selectedReturn && rejectReason.trim()) {
      rejectMutation.mutate({ id: selectedReturn.id, remarks: rejectReason });
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

  // Master Panel
  const masterPanel = (
    <SearchableList
      items={filteredReturns}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search returns..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedReturn}
      emptyMessage="No returns found"
      listHeader={
        <TFilterPanel>
          <TStatusFilter
            options={RETURN_STATUS_FILTER_OPTIONS}
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
      renderItem={(ret, isSelected) => {
        const returnGrn = grnMap.get(ret.goodreceivednote_id);
        const statusChip = getStatusProps(ret.status || "draft", "purchaseReturn");
        return (
          <SelectableListItem
            key={ret.id}
            id={ret.id}
            isSelected={isSelected}
            onClick={() => handleSelectReturn(ret)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{ret.purchasing_return_no || `PR-${ret.id}`}</span>
                  {isSelected && (
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Return No)
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {returnGrn?.good_received_no || "Unknown GRN"}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (GRN)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        {new Date(ret.added_date).toLocaleDateString()}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Date)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">
                        Rs. {selectedReturn?.items?.reduce((sum, item) => sum + Number(item.return_price), 0).toLocaleString() || "0"}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Amount)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                      <Chip
                        label={statusChip.label}
                        size="small"
                        color={statusChip.color}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected
                ? `${getGRNNumber(ret.goodreceivednote_id)} - ${new Date(ret.added_date || "").toLocaleDateString()}`
                : undefined
            }
            statusChip={!isSelected ? statusChip : undefined}
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

      {/* Approval Actions */}
      {selectedReturn && selectedIsPending && (
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
        {!selectedReturn ? (
          <EmptyState message="Select a purchase return from the list to review" />
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
              <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Barcode</TableCell>
                      <TableCell>Product</TableCell>
                      <TableCell align="right">Purchase Price</TableCell>
                      <TableCell align="right">Return Price</TableCell>
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
                          <TableCell align="right">Rs. {Number(item.purchasing_price).toLocaleString()}</TableCell>
                          <TableCell align="right">Rs. {Number(item.return_price).toLocaleString()}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow sx={modernTableStyles.footerRow}>
                      <TableCell colSpan={3} align="right">
                        <strong>Total Return Amount:</strong>
                      </TableCell>
                      <TableCell align="right">
                        <strong>
                          Rs. {selectedReturn.items?.reduce((sum, item) => sum + Number(item.return_price), 0).toLocaleString() || "0"}
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
    </Box>
  );

  return (
    <MasterDetailLayout
      title="Purchase Return Approvals"
      icon={<FactCheckIcon color="primary" />}
      onRefresh={() => refetch()}
      isLoading={isLoading}
      masterPanel={masterPanel}
      detailPanel={detailPanel}
    />
  );
}
