/**
 * SaleReturnsPage - Complete Sale Returns Management with Workflow
 * Features:
 * - Create sale returns from completed invoices
 * - Approve/Reject/Process returns workflow
 * - Stock restoration for returned items
 * - Credit note generation or cash/bank refund
 */

import { usePermission } from "@/auth/permissions";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import DeleteIcon from "@mui/icons-material/Delete";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import {
    Alert,
    Autocomplete,
    Box,
    Button,
    Checkbox,
    Chip,
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
    SearchableList,
    SelectableListItem,
    showErrorToast,
    showSuccessToast,
    SortOption,
    TConfirmDialog,
    TPrintButton,
    TPrintPreviewDialog,
    TStatusChip,
    TSteps,
    canPrintDocument,
    getStatusProps,
    handleApiError,
    modernTableStyles,
    useMasterDetailState,
    useTConfirmDialog,
} from "@/components/tijaero";
import { formatDateTimeReadable } from "@/utils/formatters";
import SalesFilterPanel from "@/modules/sales/components/ui/SalesFilterPanel";

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

const getNextNumber = (prefix: string, existing: { no: string }[]): string => {
  const year = new Date().getFullYear();
  const fullPrefix = `${prefix}-${year}-`;
  let maxSeq = 0;
  for (const item of existing) {
    if (item.no?.startsWith(fullPrefix)) {
      const seq = parseInt(item.no.slice(fullPrefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return `${prefix}-${year}-${String(maxSeq + 1).padStart(5, '0')}`;
};

const SORT_OPTIONS: SortOption[] = [
    { value: "added_date", label: "Date" },
    { value: "sale_return_no", label: "Return Number" },
    { value: "total_refund", label: "Refund Amount" },
];

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

    // Filter states
    const [filterBranch, setFilterBranch] = useState<string | null>(null);
    const [filterStatus, setFilterStatus] = useState<string | null>(null);

    // Barcode input state
    const [barcodeInput, setBarcodeInput] = useState("");
    const barcodeInputRef = useRef<HTMLInputElement>(null);
    const [invoiceItems, setInvoiceItems] = useState<InvoiceWithItems["items"] | null>(null);
    const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set());

    // Print Dialog State
    const [printDialogOpen, setPrintDialogOpen] = useState(false);
    const [selectedReturnForPrint, setSelectedReturnForPrint] = useState<SaleReturn | null>(null);

    const {
        searchQuery,
        setSearchQuery,
        sortField,
        setSortField,
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

    const handleCancel = useCallback((items: SaleReturn[]) => {
        handleCancelBase(items);
        setLineItems([]);
        setFormStep(0);
        setBarcodeInput("");
        setTouched({});
    }, [handleCancelBase]);

    const handleSelectReturnWithItems = useCallback(async (ret: SaleReturn) => {
        const selected = await handleSelectReturn(ret);
        if (!selected) return;

        setTouched({});
        setBarcodeInput("");
        try {
            const detailedReturn = await saleReturnsApi.getById(ret.id);
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
            setLineItems([]);
        }
    }, [handleSelectReturn]);

    const { data: returns, isLoading } = useQuery({
        queryKey: ["sale-returns"],
        queryFn: () => saleReturnsApi.getAll(),
    });

    const nextSRNumber = useMemo(() =>
        getNextNumber('SR', (returns || []).map((r: any) => ({ no: r.sale_return_no }))),
    [returns]);

    const { data: invoices } = useQuery({
        queryKey: ["sales"],
        queryFn: () => salesApi.getAll(),
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

    const filteredReturns = useMemo(() => {
        if (!returns) return [];

        let filtered = returns.filter(
            (ret) =>
                ret.sale_return_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                String(ret.id).includes(searchQuery) ||
                getInvoiceNo(ret.invoice_id).toLowerCase().includes(searchQuery.toLowerCase())
        );

        // Apply branch filter
        if (filterBranch) {
            filtered = filtered.filter(ret => ret.branch_code === filterBranch);
        }

        // Apply status filter
        if (filterStatus) {
            filtered = filtered.filter(ret => ret.status === filterStatus);
        }

        filtered.sort((a, b) => {
            if (sortField === "added_date") {
                return new Date(b.added_date || "").getTime() - new Date(a.added_date || "").getTime();
            }
            const fieldA = a[sortField as keyof SaleReturn] || "";
            const fieldB = b[sortField as keyof SaleReturn] || "";
            return String(fieldA).localeCompare(String(fieldB));
        });

        return filtered;
    }, [returns, searchQuery, sortField, filterBranch, filterStatus]);


    useEffect(() => {
        if (filteredReturns.length > 0 && !selectedReturn && !isCreating) {
            handleSelectReturnWithItems(filteredReturns[0]);
        }
    }, [filteredReturns, selectedReturn, isCreating]);

    const createMutation = useMutation({
        mutationFn: saleReturnsApi.create,
        onSuccess: (newReturn) => {
            queryClient.invalidateQueries({ queryKey: ["sale-returns"] });
            queryClient.invalidateQueries({ queryKey: ["sales"] });
            showSuccessToast("Sale return created successfully");
            setIsCreating(false);
            setIsEditing(false);
            setTimeout(() => handleSelectReturnWithItems(newReturn), 0);
        },
        onError: (error: unknown) => {
            showErrorToast(handleApiError(error, "Failed to create sale return"));
        },
    });

    const deleteMutation = useMutation({
        mutationFn: saleReturnsApi.delete,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["sale-returns"] });
            showSuccessToast("Sale return deleted");
            handleSelectReturn(null as any);
        },
        onError: (error: unknown) => {
            showErrorToast(handleApiError(error, "Failed to delete sale return"));
        },
    });

    // Workflow dialogs
    const deleteDialog2 = useTConfirmDialog();

    // Permissions
    const canDelete = usePermission("sales", "delete");

    // Helper functions
    const getInvoiceNo = useCallback((invoiceId: number) => {
        const invoice = invoices?.find((i) => i.id === invoiceId);
        return invoice ? invoice.invoice_no : `INV-${invoiceId}`;
    }, [invoices]);

    const getStatus = useCallback((ret: SaleReturn) => {
        return ret.status || (ret.approval_id ? "approved" : "pending");
    }, []);

    const getBranchDisplay = (branchCode: string) => {
        const branch = branches.find((b) => b.branch_code === branchCode);
        return branch ? `${branch.branch_code} - ${branch.branch_name}` : branchCode;
    };

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

    const masterPanel = (
        <SearchableList<SaleReturn>
            items={filteredReturns}
            isLoading={isLoading}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            placeholder="Search returns..."
            sortOptions={SORT_OPTIONS}
            sortField={sortField}
            onSortChange={setSortField}
            selectedItem={selectedReturn}
            onSelectItem={handleSelectReturnWithItems}
            emptyMessage="No sale returns found"
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
            renderItem={(ret, isSelected) => (
                <SelectableListItem
                    key={ret.id}
                    id={ret.id}
                    isSelected={isSelected}
                    onClick={() => handleSelectReturnWithItems(ret)}
                    primaryText={
                        <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                            {/* Return Number */}
                            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span>{ret.sale_return_no || `RET-${ret.id}`}</span>
                                {isSelected && (
                                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                                        (Return No)
                                    </Typography>
                                )}
                            </Box>
                            {/* Additional fields when selected */}
                            {isSelected && (
                                <>
                                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <Typography component="span" variant="caption">
                                            {getInvoiceNo(ret.invoice_id)}
                                        </Typography>
                                        <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                                            (Invoice)
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <Typography component="span" variant="caption">
                                            {getBranchDisplay(ret.branch_code)}
                                        </Typography>
                                        <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                                            (Branch)
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <Typography component="span" variant="caption">
                                            {new Date(ret.added_date || "").toLocaleDateString()}
                                        </Typography>
                                        <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                                            (Date)
                                        </Typography>
                                    </Box>
                                    {/* Status Chips */}
                                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                                        <TStatusChip status={getStatus(ret)} statusMap="salesReturn" size="small" />
                                    </Box>
                                </>
                            )}
                        </Box>
                    }
                    secondaryText={!isSelected ? `Invoice: ${getInvoiceNo(ret.invoice_id)} • ${getBranchDisplay(ret.branch_code)} • ${new Date(ret.added_date || "").toLocaleDateString()}` : undefined}
                    isFavorite={favorites.includes(ret.id)}
                    onToggleFavorite={(e) => toggleFavorite(ret.id, e)}
                    statusChip={!isSelected ? { label: getStatusProps(getStatus(ret), "salesReturn").label, color: getStatusProps(getStatus(ret), "salesReturn").color } : undefined}
                />
            )}
        />
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
                onCancel={() => handleCancel(filteredReturns)}
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
                    selectedReturn && !isCreating && !isEditing ? (
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
                                        <FormSection title="Status & Dates" columns={4}>
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

                                {/* Next/Cancel buttons for step 1 in create mode */}
                                {isCreating && (
                                    <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2, mt: 3 }}>
                                        <Button
                                            variant="outlined"
                                            onClick={() => handleCancel(filteredReturns)}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            variant="contained"
                                            color="warning"
                                            onClick={handleNextStep}
                                            disabled={!isStep1Valid}
                                            endIcon={<ArrowForwardIcon />}
                                        >
                                            Next
                                        </Button>
                                    </Box>
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

                                <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
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
                onRefresh={() => {
                  queryClient.invalidateQueries({ queryKey: ["sale-returns"] });
                  queryClient.invalidateQueries({ queryKey: ["sales"] });
                }}
                isLoading={isLoading}
                masterPanel={masterPanel}
                detailPanel={detailPanel}
            />
            <TConfirmDialog {...confirmDialog.dialogProps} />
            <TConfirmDialog {...deleteDialog2.dialogProps} confirmText="Delete" confirmColor="error" />
            
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
        </>
    );
}
