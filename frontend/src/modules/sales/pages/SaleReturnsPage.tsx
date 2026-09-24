/**
 * SaleReturnsPage - Complete Sale Returns Management with Workflow
 * Features:
 * - Create sale returns from completed invoices
 * - Approve/Reject/Process returns workflow
 * - Stock restoration for returned items
 * - Credit note generation or cash/bank refund
 */

import { usePermission } from "@/auth/permissions";
import { exportToCSV } from "@/utils/csvExport";
import DownloadIcon from "@mui/icons-material/FileDownload";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import EmailIcon from "@mui/icons-material/Email";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import DeleteIcon from "@mui/icons-material/Delete";
import HistoryIcon from "@mui/icons-material/History";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import {
    Alert,
    Autocomplete,
    Avatar,
    Box,
    Button,
    Checkbox,
    Chip,
    Divider,
    IconButton,
    InputAdornment,
    MenuItem,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Import tijaero components
import {
    ActionToolbar,
    DetailPanelHeader,
    EmptyState,
    fmtLKR,
    FormSection,
    MasterDetailLayout,
    RETURN_STATUS_FILTER_OPTIONS,
    showErrorToast,
    showSuccessToast,
    TBranchFilter,
    TConfirmDialog,
    TDataGrid,
    type TDataGridColumn,
    TPrintButton,
    TPrintPreviewDialog,
    TEmailDialog,
    TStatusChip,
    TStatusFilter,
    TSteps,
    canPrintDocument,
    modernTableStyles,
    useCrudMutation,
    useMasterDetailState,
    useTConfirmDialog,
    TActivityHistoryPanel,
    SelectableListItem,
} from "@/components/tijaero";
import { formatDateTimeReadable } from "@/utils/formatters";

import { useReferenceData } from "@/hooks";
import { saleReturnsApi, salesApi } from "../api";
import {
    Invoice,
    InvoiceWithItems,
    SaleReturn,
    SaleReturnCreate,
    SaleReturnItemCreate,
    SaleReturnWithItems,
} from "../types";

const getNextNumber = (prefix: string, existing: { no: string }[], branchCode?: string): string => {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const actualBranch = branchCode || "MAIN";
  const fullPrefix = `${prefix}-${actualBranch}-${yy}`;
  let maxSeq = 0;
  for (const item of existing) {
    if (item.no?.startsWith(fullPrefix)) {
      const lastPart = item.no.split("-").pop() || "";
      if (lastPart.length > 2) {
        const seq = parseInt(lastPart.slice(2), 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    }
  }
  return `${fullPrefix}${String(maxSeq + 1).padStart(6, '0')}`;
};

// Return reason options
const RETURN_REASON_OPTIONS = [
    { value: "defective", label: "Defective Product" },
    { value: "wrong_item", label: "Wrong Item Delivered" },
    { value: "customer_changed_mind", label: "Customer Changed Mind" },
    { value: "damaged", label: "Damaged in Transit" },
    { value: "other", label: "Other" },
];

const FORM_STEPS = ["Return Information", "Return Items"];

const INITIAL_FORM_DATA: SaleReturnCreate = {
    sale_return_no: "",
    branch_code: "MAIN",
    invoice_id: 0,
    good_received_locations_id: 1,
    payment_method: "credit_note",
    remark: "",
    return_reason: "",
    items: [],
};

interface ReturnLineItem extends SaleReturnItemCreate {
    _id: string;
    added_date?: string;
    product_name?: string;
}

const PAYMENT_OPTIONS = [
    { value: "credit_note", label: "Store Credit (Credit Note)" },
    { value: "cash", label: "Cash Refund" },
    { value: "bank_transfer", label: "Bank Transfer" },
    { value: "cheque", label: "Cheque" },
];

const ITEM_CONDITION_OPTIONS = [
    { value: "good", label: "Good" },
    { value: "damaged", label: "Damaged" },
    { value: "defective", label: "Defective" },
    { value: "opened", label: "Opened" },
];

const resetFormFromReturn = (ret: SaleReturn | SaleReturnWithItems): SaleReturnCreate => ({
    sale_return_no: ret.sale_return_no,
    branch_code: ret.branch_code,
    invoice_id: ret.invoice_id,
    good_received_locations_id: ret.good_received_locations_id,
    payment_method: ret.payment_method,
    remark: ret.remark || "",
    return_reason: ret.return_reason || "",
    items: "items" in ret && ret.items ? ret.items.map(item => ({
        barcode: item.barcode,
        return_price: item.return_price,
        sold_price: item.sold_price,
        branch_code: item.branch_code,
        invoice_item_id: item.invoice_item_id,
        quantity: item.quantity || 1,
        condition: item.condition || "good",
        restockable: item.restockable !== false,
    })) : [],
});

export default function SaleReturnsPage() {
    const queryClient = useQueryClient();
    const [lineItems, setLineItems] = useState<ReturnLineItem[]>([]);
    const [formStep, setFormStep] = useState(0);

    // Confirm dialog for unsaved changes
    const confirmDialog = useTConfirmDialog();

    // Validation state
    const [touched, setTouched] = useState<Record<string, boolean>>({});

    const handleBlur = (fieldName: string) => {
        setTouched(prev => ({ ...prev, [fieldName]: true }));
    };

    // Filter state - all filters apply live as the user types/selects, no
    // separate "Search" step needed.
    const [filterBranch, setFilterBranch] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<string | null>(null);

    // Barcode input state
    const [barcodeInput, setBarcodeInput] = useState("");
    const barcodeInputRef = useRef<HTMLInputElement>(null);
    const [invoiceItems, setInvoiceItems] = useState<InvoiceWithItems["items"] | null>(null);
    const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());

    // Print/Email Dialog State
    const [printDialogOpen, setPrintDialogOpen] = useState(false);
    const [emailDialogOpen, setEmailDialogOpen] = useState(false);
    const [selectedReturnForPrint, setSelectedReturnForPrint] = useState<SaleReturn | undefined>(undefined);

    const {
        searchQuery,
        setSearchQuery,
        selectedItem: selectedReturn,
        isEditing,
        setIsEditing,
        isCreating,
        setIsCreating,
        favorites,
        toggleFavorite,
        formData,
        setFormData,
        handleSelectItem: handleSelectReturn,
        handleNew: handleNewReturnBase,
        handleCancel: handleCancelBase,
        handleStartEdit: handleStartEditBase,
    } = useMasterDetailState<SaleReturn, SaleReturnCreate>({
        initialFormData: INITIAL_FORM_DATA,
        resetFormFromItem: resetFormFromReturn,
        favoritesKey: "sale_returns_favorites",
        defaultSortField: "added_date",
        confirmUnsavedChanges: () => confirmDialog.confirm({
            title: "Discard Changes",
            message: "You have unsaved changes. Discard them?",
            confirmText: "Discard",
            cancelText: "Keep Editing",
            confirmColor: "warning",
        }),
        extraDirty: lineItems.length > 0,
        onDiscard: () => { setLineItems([]); setFormStep(0); },
    });

    // Activity History is opened on demand from a detail icon next to the
    // Status & Dates section title, rather than shown inline.
    const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

    // Use aggregated endpoint for branches/products (placed before handlers that need defaultBranchCode)
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
        setFilterBranch(null);
        setFilterStatus(null);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleNewReturn = useCallback(() => {
        handleNewReturnBase();
        setFormData(prev => ({
            ...prev,
            sale_return_no: "",
            branch_code: defaultBranchCode || prev.branch_code,
            payment_method: "credit_note",
        }));
        setLineItems([]);
        setFormStep(0);
        setBarcodeInput("");
        setTouched({});
        setSelectedCandidates(new Set());
    }, [handleNewReturnBase, setFormData, defaultBranchCode]);

    const handleStartEdit = useCallback(() => {
        handleStartEditBase();
        setFormStep(0);
        setBarcodeInput("");
        setTouched({});
        // @ts-ignore
        if (selectedReturn?.items) {
            // @ts-ignore
            setLineItems(selectedReturn.items.map((item: any, idx: number) => ({
                _id: `existing-${idx}`,
                barcode: item.barcode,
                return_price: item.return_price,
                sold_price: item.sold_price,
                branch_code: item.branch_code,
                invoice_item_id: item.invoice_item_id,
                quantity: item.quantity || 1,
                condition: item.condition || "good",
                restockable: item.restockable !== false,
            })));
        }
    }, [handleStartEditBase, selectedReturn]);

    // Tracks the most recently requested return so a slower, stale response
    // (e.g. switching from A to B before A's request resolves) can't overwrite
    // the currently-selected return's line items with a different return's data.
    const latestReturnRequestRef = useRef<number | null>(null);

    const handleSelectReturnWithItems = useCallback(async (ret: SaleReturn) => {
        const selected = await handleSelectReturn(ret);
        if (!selected) return;

        latestReturnRequestRef.current = ret.id;
        setTouched({});
        setBarcodeInput("");
        try {
            const detailedReturn = await saleReturnsApi.getById(ret.id);
            if (latestReturnRequestRef.current !== ret.id) return;
            if (detailedReturn.items) {
                setLineItems(detailedReturn.items.map((item: any, idx: number) => ({
                    _id: `existing-${idx}`,
                    barcode: item.barcode,
                    return_price: item.return_price,
                    sold_price: item.sold_price,
                    branch_code: item.branch_code,
                    invoice_item_id: item.invoice_item_id,
                    added_date: item.added_date,
                    quantity: item.quantity || 1,
                    condition: item.condition || "good",
                    restockable: item.restockable !== false,
                })));
            } else {
                setLineItems([]);
            }
        } catch {
            if (latestReturnRequestRef.current !== ret.id) return;
            setLineItems([]);
        }
    }, [handleSelectReturn]);

    const { data: returns, isLoading } = useQuery({
        queryKey: ["sale-returns"],
        queryFn: () => saleReturnsApi.getAll(),
        enabled: branchResolved,
    });

    const nextSRNumber = useMemo(() =>
        getNextNumber('SRN', (returns || []).map((r: any) => ({ no: r.sale_return_no })), formData.branch_code),
        [returns, formData.branch_code]);

    // Only fetch invoices when user is creating/editing (for the Autocomplete dropdown)
    const { data: invoices } = useQuery({
        queryKey: ["sales"],
        queryFn: () => salesApi.getAll(),
        enabled: isCreating || isEditing,
    });

    const getProductName = useCallback((productId?: number) => {
        if (!productId) return "";
        const product = products.find((p) => p.id === productId);
        return product?.name || "";
    }, [products]);

    const { data: selectedInvoice } = useQuery({
        queryKey: ["sales", formData.invoice_id],
        queryFn: () => salesApi.getById(formData.invoice_id),
        enabled: formData.invoice_id > 0,
    });

    useEffect(() => {
        if (selectedInvoice?.items) {
            setInvoiceItems(selectedInvoice.items);
        } else {
            setInvoiceItems(null);
        }
    }, [selectedInvoice]);

    // Helper functions (moved above filteredReturns, which calls getInvoiceNo
    // while filtering — these must already be defined by then).
    const getInvoiceNo = useCallback((ret: SaleReturn) => {
        return ret.invoice_no || `INV-${ret.invoice_id}`;
    }, []);

    const getStatus = useCallback((ret: SaleReturn) => {
        return ret.status || (ret.approval_id ? "approved" : "pending");
    }, []);

    const getBranchDisplay = (branchCode: string) => {
        const branch = branches.find((b) => b.branch_code === branchCode);
        return branch ? `${branch.branch_code} - ${branch.branch_name}` : branchCode;
    };

    const filteredReturns = useMemo(() => {
        if (!returns) return [];

        let filtered = returns.filter(
            (ret) =>
                ret.sale_return_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                String(ret.id).includes(searchQuery) ||
                getInvoiceNo(ret).toLowerCase().includes(searchQuery.toLowerCase())
        );

        // Apply branch filter
        if (filterBranch) {
            filtered = filtered.filter(ret => ret.branch_code === filterBranch);
        }

        // Apply status filter
        if (filterStatus) {
            filtered = filtered.filter(ret => ret.status === filterStatus);
        }

        // Default order before the user sorts a column in the table itself
        // (the table's own column-header sort takes over from there).
        filtered.sort((a, b) => new Date(b.added_date || "").getTime() - new Date(a.added_date || "").getTime());

        return filtered;
    }, [returns, searchQuery, filterBranch, filterStatus]);

    // The table sorts by whichever column the user clicks; Invoice, Branch,
    // Reason and Status all display a looked-up or derived value rather than
    // a raw field, so each needs its own value on the row for the grid to
    // sort/display correctly.
    type SaleReturnRow = SaleReturn & {
        invoice_display: string;
        branch_display: string;
        reason_label: string;
        return_status: string;
    };

    const saleReturnRows: SaleReturnRow[] = useMemo(
        () =>
            filteredReturns.map((ret) => ({
                ...ret,
                invoice_display: getInvoiceNo(ret),
                branch_display: getBranchDisplay(ret.branch_code),
                reason_label: RETURN_REASON_OPTIONS.find((r) => r.value === ret.return_reason)?.label || ret.return_reason || "-",
                return_status: getStatus(ret),
            })),
        [filteredReturns] // eslint-disable-line react-hooks/exhaustive-deps
    );

    // The Favorite star column plus real-data columns — sorting is done via
    // the grid's own column header menu, not a separate "Sort by" control.
    const saleReturnColumns: TDataGridColumn<SaleReturnRow>[] = useMemo(
        () => [
            {
                field: "favorite",
                header: "",
                width: 48,
                sortable: false,
                align: "center",
                headerAlign: "center",
                renderCell: (params: GridRenderCellParams<SaleReturnRow>) => (
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
                field: "sale_return_no",
                header: "Return No",
                flex: 1,
                minWidth: 150,
                renderCell: (params: GridRenderCellParams<SaleReturnRow>) =>
                    params.row.sale_return_no || `RET-${params.row.id}`,
            },
            { field: "invoice_display", header: "Invoice", width: 150 },
            { field: "branch_display", header: "Branch", width: 170 },
            {
                field: "added_date",
                header: "Date",
                width: 130,
                renderCell: (params: GridRenderCellParams<SaleReturnRow>) =>
                    params.row.added_date ? new Date(params.row.added_date).toLocaleDateString() : "-",
            },
            { field: "reason_label", header: "Reason", width: 170 },
            {
                field: "return_status",
                header: "Status",
                width: 140,
                align: "center",
                headerAlign: "center",
                renderCell: (params: GridRenderCellParams<SaleReturnRow>) => (
                    <TStatusChip status={params.row.return_status} statusMap="salesReturn" size="small" />
                ),
            },
            {
                field: "total_refund",
                header: "Total",
                width: 140,
                align: "right",
                headerAlign: "right",
                renderCell: (params: GridRenderCellParams<SaleReturnRow>) =>
                    `Rs. ${fmtLKR(params.row.total_refund || 0)}`,
            },
            {
                field: "view",
                header: "",
                width: 56,
                sortable: false,
                align: "center",
                headerAlign: "center",
                renderCell: (params: GridRenderCellParams<SaleReturnRow>) => (
                    <Tooltip title="Open">
                        <IconButton
                            size="small"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleSelectReturnWithItems(params.row);
                            }}
                        >
                            <OpenInNewIcon fontSize="small" color="action" />
                        </IconButton>
                    </Tooltip>
                ),
            },
        ],
        [favorites, toggleFavorite, handleSelectReturnWithItems] // eslint-disable-line react-hooks/exhaustive-deps
    );

    // Cancelling out of "New Return" should return to the browse table, not
    // auto-open the first return the way useMasterDetailState's generic
    // handleCancel does (that behavior made sense for the old always-visible
    // detail panel, but not here). Cancelling out of editing an existing
    // return still just reverts its form, which the generic handler already
    // does correctly.
    const handleCancel = useCallback(() => {
        if (isCreating) {
            setIsCreating(false);
            setIsEditing(false);
            handleSelectReturn(null as any);
        } else {
            handleCancelBase(filteredReturns);
        }
        setLineItems([]);
        setFormStep(0);
        setBarcodeInput("");
        setTouched({});
    }, [isCreating, filteredReturns, handleCancelBase, handleSelectReturn, setIsCreating, setIsEditing]);

    // Whether we're showing a single sale return's detail view (selected or
    // being created) instead of the browse table.
    const isReturnDetailMode = !!selectedReturn || isCreating;

    // Returns to the browse table from the detail view (the "Back to Sale
    // Returns" link above the detail content's breadcrumbs).
    const handleBackToReturns = useCallback(() => {
        handleSelectReturn(null as any);
        if (isCreating) {
            setIsCreating(false);
            setIsEditing(false);
        }
    }, [isCreating, handleSelectReturn, setIsCreating, setIsEditing]);

    const createMutation = useCrudMutation({
        mutationFn: saleReturnsApi.create,
        invalidateQueryKeys: [["sale-returns"], ["sales"]],
        successMessage: "Sale return created successfully",
        errorMessage: "Failed to create sale return",
        onSuccess: (newReturn) => {
            setIsCreating(false);
            setIsEditing(false);
            setTimeout(() => handleSelectReturnWithItems(newReturn), 0);
        },
    });

    const deleteMutation = useCrudMutation({
        mutationFn: saleReturnsApi.delete,
        invalidateQueryKeys: [["sale-returns"]],
        successMessage: "Sale return deleted",
        errorMessage: "Failed to delete sale return",
        onSuccess: () => {
            handleSelectReturn(null as any);
        },
    });

    // Workflow dialogs
    const deleteDialog2 = useTConfirmDialog();

    // Permissions
    const canDelete = usePermission("sales_returns", "delete");

    const calculateTotal = () => {
        return lineItems.reduce((sum, item) => sum + (Number(item.return_price) * (item.quantity || 1) || 0), 0);
    };

    // Line item handlers
    const handleAddLineItemFromBarcode = useCallback(() => {
        const barcode = barcodeInput.trim();
        if (!barcode) return;

        if (lineItems.some((item) => item.barcode === barcode)) {
            showErrorToast("This barcode has already been added");
            return;
        }

        if (!invoiceItems || invoiceItems.length === 0) {
            showErrorToast("Please select an invoice first");
            return;
        }

        const invoiceItemMatch = invoiceItems.find((item: any) => item.barcode === barcode);
        if (!invoiceItemMatch) {
            showErrorToast("Barcode not found in selected invoice");
            return;
        }

        const newItem: ReturnLineItem = {
            _id: `scan-${Date.now()}`,
            barcode,
            return_price: Number(invoiceItemMatch.selling_price || 0),
            sold_price: Number(invoiceItemMatch.selling_price || 0),
            branch_code: formData.branch_code,
            invoice_item_id: invoiceItemMatch.id,
            product_id: invoiceItemMatch.product_id,
            quantity: invoiceItemMatch.quantity || 1,
            condition: "good",
            restockable: true,
            added_date: invoiceItemMatch.created_date || new Date().toISOString(),
        };
        setLineItems((prev) => [...prev, newItem]);
        setBarcodeInput("");
        barcodeInputRef.current?.focus();
    }, [barcodeInput, formData.branch_code, invoiceItems, lineItems]);

    const handleRemoveLineItem = (id: string) => {
        setLineItems(prev => prev.filter(item => item._id !== id));
    };

    const handleUpdateLineItem = (id: string, field: keyof ReturnLineItem, value: any) => {
        setLineItems(lineItems.map(item =>
            item._id === id ? { ...item, [field]: value } : item
        ));
    };

    const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && barcodeInput.trim()) {
            e.preventDefault();
            handleAddLineItemFromBarcode();
        }
    };

    const handleAddSelectedCandidates = useCallback(() => {
        if (!invoiceItems || selectedCandidates.size === 0) return;
        const toAdd = invoiceItems.filter(inv => selectedCandidates.has(inv.id) && !lineItems.some(li => li.invoice_item_id === inv.id));
        const newItems: ReturnLineItem[] = toAdd.map(inv => ({
            _id: `inv-${inv.id}-${Date.now()}`,
            barcode: inv.barcode || "",
            return_price: Number(inv.selling_price || 0),
            sold_price: Number(inv.selling_price || 0),
            branch_code: formData.branch_code,
            invoice_item_id: inv.id,
            product_id: inv.product_id,
            quantity: inv.quantity || 1,
            condition: "good",
            restockable: true,
            added_date: inv.created_date || new Date().toISOString(),
        }));
        if (newItems.length > 0) {
            setLineItems(prev => [...prev, ...newItems]);
            setSelectedCandidates(new Set());
            showSuccessToast(`${newItems.length} item(s) added`);
        }
    }, [invoiceItems, selectedCandidates, lineItems, formData.branch_code]);

    const handleExportCSV = () => {
        const headers = [
            "Return No",
            "Original Invoice",
            "Branch",
            "Date",
            "Status",
            "Refund Status",
            "Subtotal",
            "Tax Refund",
            "Total Refund"
        ];

        const rows = filteredReturns.map(ret => [
            ret.sale_return_no || `RET-${ret.id}`,
            getInvoiceNo(ret),
            getBranchDisplay(ret.branch_code),
            ret.added_date ? new Date(ret.added_date).toLocaleDateString() : "",
            getStatus(ret),
            ret.refund_status || "pending",
            ret.subtotal || 0,
            ret.tax_refund || 0,
            ret.total_refund || 0
        ]);

        exportToCSV({
            filename: `sale_returns_${new Date().toISOString().split("T")[0]}`,
            headers,
            rows
        });
    };

    const handleSave = useCallback(() => {
        const dataToSave: SaleReturnCreate = {
            ...formData,
            payment_method: "credit_note",
            items: lineItems.map(({ _id, added_date, product_name, ...item }) => item),
        };

        if (isCreating) {
            createMutation.mutate(dataToSave);
        }
    }, [isCreating, formData, lineItems, createMutation]);

    // Validation
    const getFieldError = (fieldName: string): string | undefined => {
        if (!touched[fieldName] && !isCreating) return undefined;

        switch (fieldName) {
            case 'invoice_id':
                if (!formData.invoice_id || formData.invoice_id === 0) return 'Invoice selection is required';
                break;
            case 'branch_code':
                if (!formData.branch_code) return 'Branch is required';
                break;
            case 'lineItems':
                if (lineItems.length === 0) return 'At least one item is required';
                break;
        }
        return undefined;
    };

    const hasError = (fieldName: string): boolean => {
        return !!getFieldError(fieldName);
    };

    // Step 1 validation
    const isStep1Valid = formData.invoice_id > 0;

    // Full form validation
    const isFormValid = isStep1Valid && lineItems.length > 0;
    const isSaving = createMutation.isPending;

    const handleNextStep = useCallback(() => {
        if (formStep < FORM_STEPS.length - 1) {
            setFormStep(prev => prev + 1);
        }
    }, [formStep]);

    const handlePreviousStep = useCallback(() => {
        if (formStep > 0) {
            setFormStep(prev => prev - 1);
        }
    }, [formStep]);

    // Browse mode: a full-width table of every sale return (shown when
    // nothing is selected and nothing is being created). Sorting is done
    // per-column via the grid's own column header menu, not a separate
    // "Sort by" control.
    const saleReturnsTablePanel = (
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
                <TDataGrid<SaleReturnRow>
                    rows={saleReturnRows}
                    columns={saleReturnColumns}
                    loading={isLoading}
                    onRowClick={(row) => handleSelectReturnWithItems(row)}
                    pageSizeOptions={[10, 25, 50, 100]}
                    pageSize={25}
                    emptyMessage="No sale returns found"
                    autoHeight={false}
                    height="100%"
                />
            </Box>
        </Box>
    );

    // Detail mode: a narrow left panel showing only the current sale return
    // (or the "New Return" placeholder while creating), with a "Back to
    // Sale Returns" link returning to the table.
    const singleReturnPanel = (
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
                    onClick={handleBackToReturns}
                    sx={{ textTransform: "none" }}
                >
                    Back to Sale Returns
                </Button>
            </Box>
            {isCreating ? (
                <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                        <Avatar sx={{ bgcolor: "warning.main" }}>
                            <AssignmentReturnIcon />
                        </Avatar>
                        <Typography variant="caption" color="text.secondary">
                            New Return
                        </Typography>
                    </Box>
                </Box>
            ) : selectedReturn && (
                <SelectableListItem
                    id={selectedReturn.id}
                    isSelected
                    onClick={() => {}}
                    primaryText={
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
                            <Avatar sx={{ bgcolor: "warning.main" }}>
                                <AssignmentReturnIcon />
                            </Avatar>
                            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                                <span>{selectedReturn.sale_return_no || `RET-${selectedReturn.id}`}</span>
                            </Box>
                        </Box>
                    }
                    isFavorite={favorites.includes(selectedReturn.id)}
                    onToggleFavorite={(e) => toggleFavorite(selectedReturn.id, e)}
                />
            )}
        </Paper>
    );

    const detailPanel = (
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <DetailPanelHeader
                breadcrumbs={[
                    { label: "Sales", href: "/sales" },
                    { label: "Sale Returns", href: "/sales/returns" },
                    ...(selectedReturn || isCreating
                        ? [{ label: isCreating ? "New Return" : selectedReturn?.sale_return_no || `RET-${selectedReturn?.id}` }]
                        : []),
                ]}
                title={selectedReturn ? (selectedReturn.sale_return_no || `RET-${selectedReturn.id}`) : ""}
                titleIcon={<AssignmentReturnIcon color="warning" />}
                isCreating={isCreating}
                createTitle="New Sale Return"
                noSelectionTitle="Select a Return"
                isFavorite={selectedReturn ? favorites.includes(selectedReturn.id) : false}
                onToggleFavorite={selectedReturn ? (e) => toggleFavorite(selectedReturn.id, e) : undefined}
            />

            <ActionToolbar
                hasSelectedItem={!!selectedReturn}
                isCreating={isCreating}
                isEditing={isEditing}
                isSaving={isSaving}
                isFormValid={!!isFormValid}
                canDelete={canDelete && selectedReturn?.status === 'pending'}
                canUpdate={selectedReturn?.status === 'pending'}
                onNew={handleNewReturn}
                onSave={handleSave}
                onCancel={handleCancel}
                onEdit={handleStartEdit}
                onDelete={() => {
                    if (selectedReturn) {
                        deleteDialog2.open(
                            "Delete Sale Return",
                            `Delete return ${selectedReturn.sale_return_no}? This cannot be undone.`,
                            () => deleteMutation.mutate(selectedReturn.id)
                        );
                    }
                }}
                endActions={
                    isCreating && formStep === 0 ? (
                        <Button
                            size="small"
                            variant="contained"
                            color="warning"
                            onClick={handleNextStep}
                            disabled={!isStep1Valid}
                            endIcon={<ArrowForwardIcon />}
                        >
                            Next
                        </Button>
                    ) : selectedReturn && !isCreating && !isEditing ? (
                        <>
                            <Tooltip title={!canPrintDocument(selectedReturn.status, ["approved", "cancelled", "rejected"]) ? `Cannot email: return is ${(selectedReturn.status || "").replace(/_/g, " ")}` : "Send via Email"}>
                                <span>
                                    <Button size="small" variant="outlined" color="primary" startIcon={<EmailIcon />}
                                        disabled={!canPrintDocument(selectedReturn.status, ["approved", "cancelled", "rejected"])}
                                        onClick={() => setEmailDialogOpen(true)}>
                                        Email
                                    </Button>
                                </span>
                            </Tooltip>
                            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                            <TPrintButton
                                documentType="credit-note"
                                documentId={selectedReturn.id}
                                disabled={!canPrintDocument(selectedReturn.status, ["approved", "cancelled", "rejected"])}
                                disabledReason={`Cannot print: return is ${(selectedReturn.status || "").replace(/_/g, " ")}`}
                                tooltip="Print Credit Note"
                                onClick={() => {
                                    setSelectedReturnForPrint(selectedReturn);
                                    setPrintDialogOpen(true);
                                }}
                            />
                        </>
                    ) : undefined
                }
            />

            <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
                {!selectedReturn && !isCreating ? (
                    <EmptyState message="Select a sale return from the list or create a new one" />
                ) : (
                    <>
                        {/* Stepper for create mode only */}
                        {isCreating && (
                            <TSteps
                                steps={FORM_STEPS.map((label, i) => ({ id: `step-${i}`, label }))}
                                activeStep={formStep}
                                sx={{ mb: 3 }}
                            />
                        )}

                        {/* Step 1: Return Information */}
                        {(formStep === 0 || !isCreating) && (
                            <>
                                <FormSection title="Return Information" columns={3}>
                                    <TextField
                                        label="Return Number"
                                        size="small"
                                        value={isCreating ? nextSRNumber : formData.sale_return_no}
                                        disabled
                                        InputProps={{ readOnly: true }}
                                    />
                                    <Autocomplete
                                        size="small"
                                        options={invoices || []}
                                        getOptionLabel={(option: Invoice) => `${option.invoice_no} - ${format(new Date(option.created_date), "MMM dd, yyyy")}`}
                                        value={invoices?.find((i: Invoice) => i.id === formData.invoice_id) || null}
                                        onChange={(_, newValue: Invoice | null) => {
                                            if (newValue) {
                                                setFormData({
                                                    ...formData,
                                                    invoice_id: newValue.id,
                                                    branch_code: newValue.branch_code
                                                });
                                                setLineItems([]);
                                                setSelectedCandidates(new Set());
                                            } else {
                                                setFormData({ ...formData, invoice_id: 0 });
                                                setSelectedCandidates(new Set());
                                            }
                                            handleBlur('invoice_id');
                                        }}
                                        disabled={!isEditing && !isCreating}
                                        renderInput={(params) => (
                                            <TextField
                                                {...params}
                                                label="Original Invoice"
                                                required
                                                error={hasError('invoice_id')}
                                                helperText={getFieldError('invoice_id')}
                                            />
                                        )}
                                    />
                                    <TextField
                                        label="Branch"
                                        size="small"
                                        value={getBranchDisplay(formData.branch_code)}
                                        disabled
                                        helperText="Auto-filled from Invoice"
                                    />
                                </FormSection>

                                <FormSection title="Payment & Remarks" columns={2}>
                                    <TextField
                                        label="Refund Method"
                                        size="small"
                                        value={PAYMENT_OPTIONS.find((p) => p.value === (formData.payment_method || "credit_note"))?.label || "Store Credit (Credit Note)"}
                                        disabled
                                        helperText="Refunds are issued as credit notes"
                                    />
                                    <TextField
                                        select
                                        label="Return Reason"
                                        size="small"
                                        value={formData.return_reason || ""}
                                        onChange={(e) => setFormData({ ...formData, return_reason: e.target.value })}
                                        disabled={!isEditing && !isCreating}
                                    >
                                        <MenuItem value="">Select reason...</MenuItem>
                                        {RETURN_REASON_OPTIONS.map((opt) => (
                                            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                                        ))}
                                    </TextField>
                                </FormSection>

                                <FormSection title="Additional Details" columns={1}>
                                    <TextField
                                        label="Remarks"
                                        size="small"
                                        value={formData.remark}
                                        onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                                        disabled={!isEditing && !isCreating}
                                        multiline
                                        rows={2}
                                        placeholder="Enter additional notes..."
                                        fullWidth
                                    />
                                </FormSection>

                                {/* View mode: Show date, status, and totals */}
                                {!isCreating && !isEditing && selectedReturn && (
                                    <>
                                        <FormSection
                                            title="Status & Dates"
                                            columns={4}
                                            titleAction={
                                                <Tooltip title="View activity history">
                                                    <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                                                        <HistoryIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            }
                                        >
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">Status</Typography>
                                                <Box sx={{ mt: 0.5 }}>
                                                    <TStatusChip status={getStatus(selectedReturn)} statusMap="salesReturn" size="small" />
                                                </Box>
                                            </Box>
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">Created Date</Typography>
                                                <Typography variant="body2" fontWeight={500}>
                                                    {format(new Date(selectedReturn.added_date), "MMM dd, yyyy")}
                                                </Typography>
                                            </Box>
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">Last Modified</Typography>
                                                <Typography variant="body2" fontWeight={500}>
                                                    {formatDateTimeReadable(selectedReturn.updated_at) || "-"}
                                                </Typography>
                                            </Box>
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">Return Reason</Typography>
                                                <Typography variant="body2" fontWeight={500}>
                                                    {RETURN_REASON_OPTIONS.find(r => r.value === selectedReturn.return_reason)?.label || selectedReturn.return_reason || "-"}
                                                </Typography>
                                            </Box>
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">Refund Method</Typography>
                                                <Typography variant="body2" fontWeight={500}>
                                                    {PAYMENT_OPTIONS.find(p => p.value === selectedReturn.payment_method)?.label || selectedReturn.payment_method}
                                                </Typography>
                                            </Box>
                                        </FormSection>

                                        <FormSection title="Refund Summary" columns={4}>
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">Subtotal</Typography>
                                                <Typography variant="body2" fontWeight={500}>
                                                    Rs. {fmtLKR(selectedReturn.subtotal || 0)}
                                                </Typography>
                                            </Box>
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">Tax Refund</Typography>
                                                <Typography variant="body2" fontWeight={500}>
                                                    Rs. {fmtLKR(selectedReturn.tax_refund || 0)}
                                                </Typography>
                                            </Box>
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">Total Refund</Typography>
                                                <Typography variant="h6" color="warning.main" fontWeight={600}>
                                                    Rs. {fmtLKR(selectedReturn.total_refund || 0)}
                                                </Typography>
                                            </Box>
                                            <Box>
                                                <Typography variant="caption" color="text.secondary">Refund Status</Typography>
                                                <Chip
                                                    size="small"
                                                    label={selectedReturn.refund_status === 'processed' ? 'Refunded' : 'Pending'}
                                                    color={selectedReturn.refund_status === 'processed' ? 'success' : 'warning'}
                                                />
                                            </Box>
                                        </FormSection>

                                        {/* Show refund details if processed */}
                                        {selectedReturn.refund_status === 'processed' && (
                                            <FormSection title="Refund Details" columns={3}>
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">Refund Amount</Typography>
                                                    <Typography variant="body2" fontWeight={500}>
                                                        Rs. {fmtLKR(selectedReturn.refund_amount || 0)}
                                                    </Typography>
                                                </Box>
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">Refund Date</Typography>
                                                    <Typography variant="body2" fontWeight={500}>
                                                        {selectedReturn.refund_date ? format(new Date(selectedReturn.refund_date), "MMM dd, yyyy") : "-"}
                                                    </Typography>
                                                </Box>
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">Reference</Typography>
                                                    <Typography variant="body2" fontWeight={500}>
                                                        {selectedReturn.refund_reference || "-"}
                                                    </Typography>
                                                </Box>
                                            </FormSection>
                                        )}
                                    </>
                                )}
                            </>
                        )}

                        {/* Step 2: Return Items */}
                        {(formStep === 1 || !isCreating) && (
                            <>
                                {/* Back button in create mode only */}
                                {isCreating && (
                                    <Button
                                        variant="text"
                                        onClick={handlePreviousStep}
                                        startIcon={<ArrowBackIcon />}
                                        sx={{ mb: 2 }}
                                    >
                                        Back to Return Information
                                    </Button>
                                )}

                                {/* Load Invoice Items Panel */}
                                {(isEditing || isCreating) && invoiceItems && invoiceItems.length > 0 && (
                                    <Paper
                                        variant="outlined"
                                        sx={{ p: 2, mb: 2, borderColor: "primary.main", borderWidth: 2, borderRadius: 2 }}
                                    >
                                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
                                            <Typography variant="subtitle2" fontWeight="bold" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                                <AssignmentReturnIcon color="primary" fontSize="small" />
                                                Invoice Items — Tick to Add
                                            </Typography>
                                            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    onClick={() => {
                                                        const unaddedIds = invoiceItems
                                                            .filter(inv => !lineItems.some(li => li.invoice_item_id === inv.id))
                                                            .map(inv => inv.id);
                                                        setSelectedCandidates(new Set(unaddedIds));
                                                    }}
                                                >
                                                    Select All
                                                </Button>
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    onClick={() => setSelectedCandidates(new Set())}
                                                    disabled={selectedCandidates.size === 0}
                                                >
                                                    Clear
                                                </Button>
                                                <Button
                                                    size="small"
                                                    variant="contained"
                                                    color="primary"
                                                    onClick={handleAddSelectedCandidates}
                                                    disabled={selectedCandidates.size === 0}
                                                    startIcon={<AddIcon />}
                                                >
                                                    Add Selected ({selectedCandidates.size})
                                                </Button>
                                            </Box>
                                        </Box>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow sx={modernTableStyles.headerRow}>
                                                    <TableCell padding="checkbox" />
                                                    <TableCell>Product</TableCell>
                                                    <TableCell>Barcode</TableCell>
                                                    <TableCell align="right">Qty</TableCell>
                                                    <TableCell align="right">Selling Price</TableCell>
                                                    <TableCell>Status</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {invoiceItems.map((inv) => {
                                                    const alreadyAdded = lineItems.some(li => li.invoice_item_id === inv.id);
                                                    const isChecked = selectedCandidates.has(inv.id);
                                                    return (
                                                        <TableRow
                                                            key={inv.id}
                                                            sx={{
                                                                ...modernTableStyles.bodyRow,
                                                                opacity: alreadyAdded ? 0.45 : 1,
                                                                cursor: alreadyAdded ? "default" : "pointer",
                                                            }}
                                                            onClick={() => {
                                                                if (alreadyAdded) return;
                                                                setSelectedCandidates(prev => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(inv.id)) next.delete(inv.id); else next.add(inv.id);
                                                                    return next;
                                                                });
                                                            }}
                                                        >
                                                            <TableCell padding="checkbox">
                                                                <Checkbox
                                                                    checked={isChecked || alreadyAdded}
                                                                    disabled={alreadyAdded}
                                                                    size="small"
                                                                    onChange={() => {}}
                                                                />
                                                            </TableCell>
                                                            <TableCell>{getProductName(inv.product_id) || `Product #${inv.product_id}`}</TableCell>
                                                            <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{inv.barcode || "—"}</TableCell>
                                                            <TableCell align="right">{inv.quantity}</TableCell>
                                                            <TableCell align="right">Rs. {fmtLKR(Number(inv.selling_price))}</TableCell>
                                                            <TableCell>
                                                                {alreadyAdded
                                                                    ? <Chip label="Added" size="small" color="success" sx={{ height: 18, fontSize: "0.65rem" }} />
                                                                    : <Chip label="Available" size="small" color="default" sx={{ height: 18, fontSize: "0.65rem" }} />
                                                                }
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </Paper>
                                )}

                                {/* Barcode Scanner Section */}
                                {(isEditing || isCreating) && (
                                    <Paper
                                        variant="outlined"
                                        sx={{
                                            p: 2,
                                            mb: 2,
                                            bgcolor: "warning.50",
                                            borderColor: "warning.main",
                                            borderWidth: 2,
                                        }}
                                    >
                                        <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1, display: "flex", alignItems: "center", gap: 1 }}>
                                            <QrCodeScannerIcon color="warning" />
                                            Scan Barcode to Add Return Items
                                        </Typography>
                                        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                                            <TextField
                                                inputRef={barcodeInputRef}
                                                size="small"
                                                fullWidth
                                                placeholder="Scan or type barcode and press Enter..."
                                                value={barcodeInput}
                                                onChange={(e) => setBarcodeInput(e.target.value)}
                                                onKeyDown={handleBarcodeKeyDown}
                                                disabled={formData.invoice_id === 0}
                                                helperText={formData.invoice_id === 0 ? "Please select an invoice first" : "Press Enter to add item"}
                                                InputProps={{
                                                    startAdornment: (
                                                        <InputAdornment position="start">
                                                            <QrCodeScannerIcon fontSize="small" color="action" />
                                                        </InputAdornment>
                                                    ),
                                                }}
                                                autoFocus
                                            />
                                            <Button
                                                variant="contained"
                                                color="warning"
                                                onClick={handleAddLineItemFromBarcode}
                                                disabled={!barcodeInput.trim() || formData.invoice_id === 0}
                                                sx={{ minWidth: 100 }}
                                            >
                                                Add
                                            </Button>
                                        </Box>
                                    </Paper>
                                )}

                                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, mt: isCreating ? 0 : 2 }}>
                                    <Typography variant="subtitle1" fontWeight="bold">Return Items</Typography>
                                    {(isEditing || isCreating) && (
                                        <IconButton
                                            size="small"
                                            onClick={handleAddLineItemFromBarcode}
                                            color="warning"
                                            title="Add scanned item"
                                            disabled={!barcodeInput.trim() || formData.invoice_id === 0}
                                        >
                                            <AddIcon />
                                        </IconButton>
                                    )}
                                </Box>

                                {/* Warning for empty items */}
                                {(isEditing || isCreating) && lineItems.length === 0 && (
                                    <Alert severity="warning" sx={{ mb: 2 }}>
                                        At least one item is required. Select items from the invoice list above, or scan a barcode.
                                    </Alert>
                                )}

                                <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
                                    <Table size="small">
                                        <TableHead>
                                            <TableRow sx={modernTableStyles.headerRow}>
                                                <TableCell>Product</TableCell>
                                                <TableCell>Branch Code</TableCell>
                                                <TableCell>Added Date</TableCell>
                                                <TableCell sx={{ width: 100 }}>Condition</TableCell>
                                                <TableCell sx={{ width: 120 }}>Restockable</TableCell>
                                                <TableCell align="right" sx={{ width: 120 }}>Sold Price</TableCell>
                                                <TableCell align="right" sx={{ width: 120 }}>Return Price</TableCell>
                                                {(isEditing || isCreating) && <TableCell sx={{ width: 50 }} />}
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {lineItems.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={isEditing || isCreating ? 8 : 7} sx={modernTableStyles.emptyCell}>
                                                        {(isEditing || isCreating)
                                                            ? "Scan barcodes above to add items"
                                                            : "No items in this return"}
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                lineItems.map((item, index) => (
                                                    <TableRow key={item._id} sx={{
                                                        ...modernTableStyles.bodyRow,
                                                        ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                                                    }}>
                                                        <TableCell>
                                                            {item.product_name || getProductName(item.product_id) || "-"}
                                                        </TableCell>
                                                        <TableCell>
                                                            {item.branch_code || formData.branch_code}
                                                        </TableCell>
                                                        <TableCell>
                                                            {item.added_date ? new Date(item.added_date).toLocaleDateString() : (isCreating ? "New" : "-")}
                                                        </TableCell>
                                                        <TableCell>
                                                            {(isEditing || isCreating) ? (
                                                                <TextField
                                                                    select
                                                                    size="small"
                                                                    fullWidth
                                                                    value={item.condition || "good"}
                                                                    onChange={(e) => handleUpdateLineItem(item._id, "condition", e.target.value)}
                                                                >
                                                                    {ITEM_CONDITION_OPTIONS.map((option) => (
                                                                        <MenuItem key={option.value} value={option.value}>
                                                                            {option.label}
                                                                        </MenuItem>
                                                                    ))}
                                                                </TextField>
                                                            ) : (
                                                                ITEM_CONDITION_OPTIONS.find((opt) => opt.value === item.condition)?.label || item.condition || "-"
                                                            )}
                                                        </TableCell>
                                                        <TableCell>
                                                            {(isEditing || isCreating) ? (
                                                                <Checkbox
                                                                    checked={item.restockable !== false}
                                                                    onChange={(e) => handleUpdateLineItem(item._id, "restockable", e.target.checked)}
                                                                />
                                                            ) : (
                                                                item.restockable !== false ? "Yes" : "No"
                                                            )}
                                                        </TableCell>
                                                        <TableCell align="right">
                                                            {`Rs. ${fmtLKR(Number(item.sold_price) || 0)}`}
                                                        </TableCell>
                                                        <TableCell align="right">
                                                            {(isEditing || isCreating) ? (
                                                                <TextField
                                                                    size="small"
                                                                    type="number"
                                                                    value={item.return_price}
                                                                    onChange={(e) => handleUpdateLineItem(item._id, "return_price", parseFloat(e.target.value) || 0)}
                                                                    sx={{ width: 100 }}
                                                                    inputProps={{ min: 0, step: 0.01 }}
                                                                />
                                                            ) : (
                                                                `Rs. ${fmtLKR(Number(item.return_price) || 0)}`
                                                            )}
                                                        </TableCell>
                                                        {(isEditing || isCreating) && (
                                                            <TableCell>
                                                                <Tooltip title="Remove item">
                                                                    <IconButton size="small" onClick={() => handleRemoveLineItem(item._id)} color="error" aria-label="Remove line item">
                                                                        <DeleteIcon fontSize="small" />
                                                                    </IconButton>
                                                                </Tooltip>
                                                            </TableCell>
                                                        )}
                                                    </TableRow>
                                                ))
                                            )}
                                            <TableRow sx={{ bgcolor: "action.hover" }}>
                                                <TableCell colSpan={isEditing || isCreating ? 6 : 6} align="right">
                                                    <Typography fontWeight="bold">Total Return:</Typography>
                                                </TableCell>
                                                <TableCell align="right">
                                                    <Typography fontWeight="bold">Rs. {fmtLKR(calculateTotal() || 0)}</Typography>
                                                </TableCell>
                                                {(isEditing || isCreating) && <TableCell />}
                                            </TableRow>
                                        </TableBody>
                                    </Table>
                                </Paper>
                                {/* Sticky Live Total Bar */}
                                {(isEditing || isCreating) && lineItems.length > 0 && (
                                    <Paper
                                        variant="outlined"
                                        sx={{
                                            position: "sticky",
                                            bottom: 8,
                                            mt: 2,
                                            p: 1.5,
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            bgcolor: "background.paper",
                                            borderColor: "primary.main",
                                            borderWidth: 2,
                                            zIndex: 10,
                                        }}
                                    >
                                        <Box sx={{ display: "flex", gap: 3, alignItems: "center" }}>
                                            <Typography variant="body2" color="text.secondary">
                                                Items: <strong>{lineItems.length}</strong>
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                Qty: <strong>{lineItems.reduce((s, i) => s + (Number(i.quantity) || 1), 0)}</strong>
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                                            <Typography variant="body2" color="text.secondary">Total Return:</Typography>
                                            <Typography variant="h6" fontWeight="bold" color="primary.main">
                                                Rs. {fmtLKR(calculateTotal() || 0)}
                                            </Typography>
                                        </Box>
                                    </Paper>
                                )}
                            </>
                        )}
                    </>
                )}
            </Box>
        </Box>
    );

    return (
        <>
            <MasterDetailLayout
                title="Sale Returns"
                titleSlot={
                    isReturnDetailMode ? undefined : (
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
                            <Box sx={{ width: 150, flexShrink: 0 }}>
                                <TStatusFilter options={RETURN_STATUS_FILTER_OPTIONS} value={filterStatus} onChange={setFilterStatus} label="" placeholder="All Status" size="small" />
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
                headerActions={
                    isReturnDetailMode ? undefined : (
                        <>
                            <Button
                                variant="contained"
                                size="small"
                                startIcon={<AddIcon />}
                                onClick={handleNewReturn}
                                sx={{ mr: 1 }}
                            >
                                Add Sale Return
                            </Button>
                            <Button
                                variant="outlined"
                                size="small"
                                startIcon={<DownloadIcon />}
                                onClick={handleExportCSV}
                                disabled={filteredReturns.length === 0}
                                sx={{ mr: 1 }}
                            >
                                Export CSV
                            </Button>
                        </>
                    )
                }
                onRefresh={() => {
                    queryClient.invalidateQueries({ queryKey: ["sale-returns"] });
                    queryClient.invalidateQueries({ queryKey: ["sales"] });
                }}
                isLoading={isLoading}
                {...(isReturnDetailMode
                    ? { masterPanel: singleReturnPanel, detailPanel }
                    : { children: saleReturnsTablePanel })}
            />

            {/* Confirm Dialogs */}
            <TConfirmDialog {...confirmDialog.dialogProps} />
            <TConfirmDialog {...deleteDialog2.dialogProps} confirmText="Delete" confirmColor="error" />

            {/* Print Preview Dialog */}
            {selectedReturnForPrint && (
                <TPrintPreviewDialog
                    open={printDialogOpen}
                    onClose={() => {
                        setPrintDialogOpen(false);
                        setSelectedReturnForPrint(undefined);
                    }}
                    documentType="credit-note"
                    documentId={selectedReturnForPrint.id}
                    title={`Print Credit Note: ${selectedReturnForPrint.sale_return_no}`}
                />
            )}

            {/* Email Dialog */}
            {selectedReturn && (
                <TEmailDialog
                    open={emailDialogOpen}
                    onClose={() => setEmailDialogOpen(false)}
                    documentType="sales-return"
                    documentId={selectedReturn.id}
                />
            )}

            <TActivityHistoryPanel
                open={activityHistoryOpen}
                onClose={() => setActivityHistoryOpen(false)}
                entityType="sale_return"
                entityId={selectedReturn?.id}
                actionLabels={{
                    create: "Return created",
                    approve: "Return approved",
                    reject: "Return rejected",
                    process: "Return processed",
                    delete: "Return deleted",
                }}
            />
        </>
    );
}
