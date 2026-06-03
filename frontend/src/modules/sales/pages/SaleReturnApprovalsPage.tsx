/**
 * SaleReturnApprovalsPage - Sale Return Approvals
 * Shows sale returns for approval/rejection with filters
 * Refactored to use common tijaero components to match Purchase Return Approvals
 */

import { useMemo, useCallback, useState, useEffect } from "react";
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
    Tooltip,
    Chip,
} from "@mui/material";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import PrintIcon from "@mui/icons-material/Print";
import ReceiptIcon from "@mui/icons-material/Receipt";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";

// Import tijaero components
import {
    MasterDetailLayout,
    SearchableList,
    SelectableListItem,
    DetailPanelHeader,
    fmtLKR,
    FormSection,
    EmptyState,
    RETURN_STATUS_FILTER_OPTIONS,
    getStatusProps,
    handleApiError,
    SortOption,
    TConfirmDialog,
    TDetailSkeleton,
    TPrintPreviewDialog,
    showSuccessToast,
    showErrorToast,
    modernTableStyles,
    useCrudMutation,
    useTConfirmDialog,
} from "@/components/tijaero";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";

import { saleReturnsApi, salesApi } from "@/modules/sales/api";
import { useReferenceData, ProductRef } from "@/hooks";
import { SaleReturn, SaleReturnWithItems } from "@/modules/sales/types";

const SORT_OPTIONS: SortOption[] = [
    { value: "added_date", label: "Date" },
    { value: "sale_return_no", label: "Return Number" },
];

export default function SaleReturnApprovalsPage() {
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState("");
    const [sortField, setSortField] = useState("added_date");
    const [selectedReturn, setSelectedReturn] = useState<SaleReturnWithItems | null>(null);

    // Filter states
    const [filterStatus, setFilterStatus] = useState<string | null>("pending"); // Default to pending
    const [filterBranch, setFilterBranch] = useState<string | null>(null);

    // Dialogs
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
    const [rejectReason, setRejectReason] = useState("");
    const [remarksDialogOpen, setRemarksDialogOpen] = useState(false);

    // Confirm dialogs
    const approveConfirm = useTConfirmDialog();
    const processConfirm = useTConfirmDialog();

    // Print Dialog State
    const [printDialogOpen, setPrintDialogOpen] = useState(false);
    const [selectedReturnForPrint, setSelectedReturnForPrint] = useState<SaleReturn | null>(null);

    // Fetch returns
    const { data: returns = [], isLoading, refetch } = useQuery({
        queryKey: ["sale-returns"],
        queryFn: () => saleReturnsApi.getAll(),
    });

    // OPTIMIZED: Single API call for products and branches
    const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["products", "branches"]);
    const products = refData?.products || [];
    const branches = filteredBranches || [];

    // Auto-default branch filter for non-superuser users
    useEffect(() => {
      if (defaultBranchCode && filterBranch === null) {
        setFilterBranch(defaultBranchCode);
      }
    }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

    // Create lookup maps
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
            return (
                ret.sale_return_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                ret.invoice_no?.toLowerCase().includes(searchQuery.toLowerCase())
            );
        });

        filtered.sort((a, b) => {
            if (sortField === "sale_return_no") {
                return (a.sale_return_no || "").localeCompare(b.sale_return_no || "");
            }
            return new Date(b.added_date).getTime() - new Date(a.added_date).getTime();
        });

        return filtered;
    }, [returns, searchQuery, sortField, filterStatus, filterBranch]);

    // Handle selection
    const handleSelectReturn = useCallback(async (ret: SaleReturn) => {
        try {
            const fullReturn = await saleReturnsApi.getById(ret.id);
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
    const approveMutation = useCrudMutation({
        mutationFn: (id: number) => saleReturnsApi.approve(id),
        invalidateQueryKeys: [["sale-returns"], ["sales-stock"]],
        successMessage: "Sale return approved successfully",
        errorMessage: "Failed to approve return",
        onSuccess: (_data, id) => {
            queryClient.setQueryData<SaleReturn[]>(["sale-returns"], (prev) =>
                (prev || []).map((r) => (r.id === id ? { ...r, status: "approved" as const } : r))
            );
            setSelectedReturn((prev) => (prev && prev.id === id ? { ...prev, status: "approved" as const } : prev));
        },
    });

    // Reject mutation
    const rejectMutation = useCrudMutation({
        mutationFn: ({ id, remarks }: { id: number; remarks: string }) =>
            saleReturnsApi.reject(id, remarks),
        invalidateQueryKeys: [["sale-returns"]],
        successMessage: "Sale return rejected",
        errorMessage: "Failed to reject return",
        onSuccess: (_data, variables) => {
            queryClient.setQueryData<SaleReturn[]>(["sale-returns"], (prev) =>
                (prev || []).map((r) => (r.id === variables.id ? { ...r, status: "rejected" as const } : r))
            );
            setSelectedReturn((prev) =>
                prev && prev.id === variables.id ? { ...prev, status: "rejected" as const } : prev
            );
            setRejectDialogOpen(false);
            setRejectReason("");
        },
    });

    // Process mutation (for approved returns)
    const processMutation = useCrudMutation({
        mutationFn: (id: number) => saleReturnsApi.process(id),
        invalidateQueryKeys: [["sale-returns"], ["sales-stock"]],
        getSuccessMessage: (data) => `Sale return processed. ${data.items_restocked} items restocked.`,
        errorMessage: "Failed to process return",
        onSuccess: (data, id) => {
            queryClient.setQueryData<SaleReturn[]>(["sale-returns"], (prev) =>
                (prev || []).map((r) => (r.id === id ? { ...r, status: "processed" as const } : r))
            );
            setSelectedReturn((prev) => (prev && prev.id === id ? { ...prev, status: "processed" as const } : prev));
        },
    });

    const handleApprove = () => {
        if (selectedReturn) {
            approveConfirm.open(
                "Approve Sale Return",
                `Are you sure you want to approve return ${selectedReturn.sale_return_no || `SR-${selectedReturn.id}`}? This action cannot be undone.`,
                () => approveMutation.mutate(selectedReturn.id)
            );
        }
    };

    const handleReject = () => {
        if (selectedReturn && rejectReason.trim()) {
            rejectMutation.mutate({ id: selectedReturn.id, remarks: rejectReason });
        }
    };

    const handleProcess = () => {
        if (selectedReturn) {
            processConfirm.open(
                "Process Sale Return",
                `Are you sure you want to process return ${selectedReturn.sale_return_no || `SR-${selectedReturn.id}`}? This will restock returned items and cannot be reversed.`,
                () => processMutation.mutate(selectedReturn.id)
            );
        }
    };

    const { data: invoice } = useQuery({
        queryKey: ["sales-invoice", selectedReturn?.invoice_id],
        queryFn: () => salesApi.getById(selectedReturn!.invoice_id),
        enabled: !!selectedReturn?.invoice_id,
    });
    const selectedIsPending = (selectedReturn?.status || "").toLowerCase() === "pending";
    const selectedIsApproved = (selectedReturn?.status || "").toLowerCase() === "approved";

    const getInvoiceNumber = (ret: SaleReturn) => {
        return ret.invoice_no || `INV-${ret.invoice_id}`;
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
                <SalesFilterPanel
                    statusOptions={RETURN_STATUS_FILTER_OPTIONS}
                    statusValue={filterStatus}
                    onStatusChange={setFilterStatus}
                    branches={branches}
                    branchValue={filterBranch}
                    onBranchChange={setFilterBranch}
                />
            }
            renderItem={(ret, isSelected) => {
                const statusChip = getStatusProps(ret.status || "pending", "salesReturn");
                return (
                    <SelectableListItem
                        key={ret.id}
                        id={ret.id}
                        isSelected={isSelected}
                        onClick={() => handleSelectReturn(ret)}
                        primaryText={
                            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span>{ret.sale_return_no || `SR-${ret.id}`}</span>
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
                                                {ret.invoice_no || "Unknown Invoice"}
                                            </Typography>
                                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                                                (Invoice)
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
                                                Rs. {fmtLKR(ret.total_refund || 0)}
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
                                ? `${getInvoiceNumber(ret)} - ${new Date(ret.added_date || "").toLocaleDateString()}`
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
                    { label: "Sales" },
                    { label: "Return Approvals", href: "/sales/return-approvals" },
                    ...(selectedReturn ? [{ label: selectedReturn.sale_return_no || `SR-${selectedReturn.id}` }] : []),
                ]}
                title={selectedReturn?.sale_return_no || ""}
                titleIcon={<AssignmentReturnIcon color="primary" />}
                noSelectionTitle="Select a Return to Review"
                chips={
                    selectedReturn
                        ? (() => {
                            const s = getStatusProps(selectedReturn.status || "pending", "salesReturn");
                            return [{ label: s.label, color: s.color }];
                        })()
                        : []
                }
            />

            {/* Approval Actions */}
            {selectedReturn && (selectedIsPending || selectedIsApproved) && (
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
                    {selectedIsPending && (
                        <>
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
                        </>
                    )}
                    {selectedIsApproved && (
                        <Button
                            variant="contained"
                            color="success"
                            startIcon={<LocalShippingIcon />}
                            onClick={handleProcess}
                            disabled={processMutation.isPending}
                        >
                            Process Return
                        </Button>
                    )}
                </Box>
            )}

            {/* Credit Note Print Button - Show for processed returns */}
            {selectedReturn && selectedReturn.status === 'processed' && (
                <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
                    <Button
                        variant="contained"
                        color="primary"
                        startIcon={<PrintIcon />}
                        onClick={() => {
                            setSelectedReturnForPrint(selectedReturn);
                            setPrintDialogOpen(true);
                        }}
                        fullWidth
                    >
                        <ReceiptIcon sx={{ mr: 1 }} />
                        View & Print Credit Note
                    </Button>
                </Box>
            )}

            <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
                {!selectedReturn ? (
                    <EmptyState message="Select a sale return from the list to review" />
                ) : isLoading ? (
                    <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} showTable />
                ) : (
                    <>
                        {/* Return Information */}
                        <FormSection title="Return Information" columns={3}>
                            <TextField label="Return Number" size="small" value={selectedReturn.sale_return_no || ""} disabled />
                            <TextField label="Invoice Number" size="small" value={invoice?.invoice_no || ""} disabled />
                            <TextField
                                label="Return Date"
                                size="small"
                                value={new Date(selectedReturn.added_date).toLocaleDateString()}
                                disabled
                            />
                            <TextField label="Branch" size="small" value={getBranchDisplay(selectedReturn.branch_code)} disabled />
                            <TextField label="Status" size="small" value={selectedReturn.status} disabled />
                            <TextField label="Payment Method" size="small" value={selectedReturn.payment_method} disabled />
                        </FormSection>

                        {/* Invoice Information */}
                        {invoice && (
                            <FormSection title="Invoice Information" columns={2}>
                                <TextField label="Invoice Number" size="small" value={invoice.invoice_no} disabled />
                                <TextField
                                    label="Invoice Date"
                                    size="small"
                                    value={new Date(invoice.created_date).toLocaleDateString()}
                                    disabled
                                />
                                <TextField label="Branch" size="small" value={getBranchDisplay(invoice.branch_code)} disabled />
                                <TextField label="Payment Method" size="small" value={invoice.payment_method} disabled />
                            </FormSection>
                        )}

                        {/* Refund Summary */}
                        <FormSection title="Refund Summary" columns={3}>
                            <TextField
                                label="Subtotal"
                                size="small"
                                value={`Rs. ${fmtLKR(selectedReturn.subtotal || 0)}`}
                                disabled
                            />
                            <TextField
                                label="Tax Refund"
                                size="small"
                                value={`Rs. ${fmtLKR(selectedReturn.tax_refund || 0)}`}
                                disabled
                            />
                            <TextField
                                label="Total Refund"
                                size="small"
                                value={`Rs. ${fmtLKR(selectedReturn.total_refund || 0)}`}
                                disabled
                            />
                        </FormSection>

                        {/* Return Items */}
                        <FormSection title="Return Items" columns={1}>
                            <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                                <Table size="small">
                                    <TableHead>
                                        <TableRow sx={modernTableStyles.headerRow}>
                                            <TableCell>Barcode</TableCell>
                                            <TableCell>Product</TableCell>
                                            <TableCell align="right">Qty</TableCell>
                                            <TableCell align="right">Sold Price (Rs.)</TableCell>
                                            <TableCell align="right">Return Price (Rs.)</TableCell>
                                            <TableCell>Condition</TableCell>
                                            <TableCell>Restockable</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {selectedReturn.items?.map((item, index) => {
                                            const product = productMap.get(item.product_id || 0);
                                            return (
                                                <TableRow key={index} sx={{
                                                    ...modernTableStyles.bodyRow,
                                                    ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                                                }}>
                                                    <TableCell>{item.barcode}</TableCell>
                                                    <TableCell>{product?.name || `Product #${item.product_id}`}</TableCell>
                                                    <TableCell align="right">{item.quantity || 1}</TableCell>
                                                    <TableCell align="right">{fmtLKR(item.sold_price)}</TableCell>
                                                    <TableCell align="right">{fmtLKR(item.return_price)}</TableCell>
                                                    <TableCell>
                                                        <Chip
                                                            label={item.condition || "good"}
                                                            size="small"
                                                            color={item.condition === "good" ? "success" : item.condition === "damaged" ? "error" : "warning"}
                                                            sx={{ height: 20, fontSize: "0.7rem" }}
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        {item.restockable !== false ? (
                                                            <Chip label={item.restocked ? "Restocked" : "Yes"} size="small" color="success" sx={{ height: 20, fontSize: "0.7rem" }} />
                                                        ) : (
                                                            <Chip label="No" size="small" color="error" sx={{ height: 20, fontSize: "0.7rem" }} />
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                        <TableRow sx={modernTableStyles.footerRow}>
                                            <TableCell colSpan={4} align="right">
                                                <strong>Total Return Amount:</strong>
                                            </TableCell>
                                            <TableCell align="right">
                                                <strong>
                                                    {fmtLKR(selectedReturn.items?.reduce((sum, item) => sum + Number(item.return_price) * (item.quantity || 1), 0) || 0)}
                                                </strong>
                                            </TableCell>
                                            <TableCell colSpan={2}></TableCell>
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
                <DialogTitle>Reject Sale Return</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Please provide a reason for rejecting this sale return.
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
        <>
            <MasterDetailLayout
                title="Sale Return Approvals"
                icon={<FactCheckIcon color="primary" />}
                onRefresh={() => refetch()}
                isLoading={isLoading}
                masterPanel={masterPanel}
                detailPanel={detailPanel}
            />
            
            {/* Print Preview Dialog */}
            {selectedReturnForPrint && (
                <TPrintPreviewDialog
                    open={printDialogOpen}
                    onClose={() => {
                        setPrintDialogOpen(false);
                        setSelectedReturnForPrint(null);
                    }}
                    documentType="credit-note"
                    documentId={selectedReturnForPrint.id}
                    title={`Print Credit Note: ${selectedReturnForPrint.sale_return_no}`}
                />
            )}
            <TConfirmDialog {...approveConfirm.dialogProps} />
            <TConfirmDialog {...processConfirm.dialogProps} />
        </>
    );
}
