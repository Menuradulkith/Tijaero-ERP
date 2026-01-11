/**
 * PurchaseReturnsPage - Using Tijaero-style reusable components
 * Refactored to use common purchasing components for better code reuse
 * With barcode scanning/validation for purchase returns
 */

import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  TextField,
  Typography,
  IconButton,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Autocomplete,
  Button,
  Stepper,
  Step,
  StepLabel,
  Chip,
  CircularProgress,
  InputAdornment,
  Alert,
} from "@mui/material";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import toast from "react-hot-toast";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";

// Import tijaero components
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  TFilterPanel,
  TBranchFilter,
  TStatusFilter,
  RETURN_STATUS_FILTER_OPTIONS,
  TStatusChip,
  TPrintButton,
  canPrintDocument,
  getStatusProps,
  useMasterDetailState,
  SortOption,
  modernTableStyles,
} from "@/components/tijaero";

import { purchaseReturnsApi, goodReceivedNotesApi } from "@/modules/purchasing/api";
import { branchApi } from "@/modules/branches/api";
import { 
  PurchasingReturn, 
  PurchasingReturnWithItems,
  PurchasingReturnCreate, 
  PurchasingReturnItemCreate,
  GoodReceivedNote,
} from "@/modules/purchasing/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "added_date", label: "Date" },
  { value: "purchasing_return_no", label: "Return Number" },
];

const FORM_STEPS = ["Return Information", "Return Items"];

const generateReturnNo = () => `RET-${Date.now().toString(36).toUpperCase()}`;

const INITIAL_FORM_DATA: PurchasingReturnCreate = {
  purchasing_return_no: "",
  branch_code: "HQ",
  remark: "",
  goodreceivednote_id: 0,
  items: [],
};

interface ReturnLineItem extends PurchasingReturnItemCreate {
  _id: string;
  branch_code?: string;
  added_date?: string;
  product_name?: string;
}

const resetFormFromReturn = (ret: PurchasingReturn | PurchasingReturnWithItems): PurchasingReturnCreate => ({
  purchasing_return_no: ret.purchasing_return_no,
  branch_code: ret.branch_code,
  remark: ret.remark || "",
  goodreceivednote_id: ret.goodreceivednote_id,
  items: "items" in ret && ret.items ? ret.items.map(item => ({
    product_id: item.product_id,
    purchasing_price: item.purchasing_price,
    return_price: item.return_price,
    barcode: item.barcode,
    sales_stock_id: item.sales_stock_id,
  })) : [],
  require_approval: true,
});

interface ValidatedItem {
  barcode: string;
  sales_stock_id: number;
  product_id: number;
  product_name: string;
  purchasing_price: number;
  grn_id: number;
  grn_no: string;
  supplier_name: string;
  branch_code: string;
}

export default function PurchaseReturnsPage() {
  const queryClient = useQueryClient();
  const [lineItems, setLineItems] = useState<ReturnLineItem[]>([]);
  const [formStep, setFormStep] = useState(0);
  
  // Confirm dialog for unsaved changes and delete actions
  const confirmDialog = useConfirmDialog();
  
  // Validation state - track which fields have been touched/blurred
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  
  // Mark field as touched when user leaves it
  const handleBlur = (fieldName: string) => {
    setTouched(prev => ({ ...prev, [fieldName]: true }));
  };
  
  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // Barcode scanning states
  const [barcodeInput, setBarcodeInput] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validatedItems, setValidatedItems] = useState<ValidatedItem[]>([]);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

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
  } = useMasterDetailState<PurchasingReturn, PurchasingReturnCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromReturn,
    favoritesKey: "purchase_returns_favorites",
    defaultSortField: "added_date",
    confirmUnsavedChanges: () => confirmDialog.confirm({
      title: "Discard Changes",
      message: "You have unsaved changes. Discard them?",
      confirmText: "Discard",
      cancelText: "Keep Editing",
      confirmColor: "warning",
    }),
  });

  const handleNewReturn = useCallback(() => {
    handleNewReturnBase();
    setFormData(prev => ({
      ...prev,
      purchasing_return_no: generateReturnNo(),
    }));
    setLineItems([]);
    setFormStep(0);
    setBarcodeInput("");
    setValidationError(null);
    setValidatedItems([]);
    setTouched({}); // Reset validation state
  }, [handleNewReturnBase, setFormData]);

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
    setFormStep(0);
    setBarcodeInput("");
    setValidationError(null);
    setTouched({}); // Reset validation state
    // @ts-ignore
    if (selectedReturn?.items) {
      // @ts-ignore
      setLineItems(selectedReturn.items.map((item: any, idx: number) => ({
        _id: `existing-${idx}`,
        product_id: item.product_id,
        purchasing_price: item.purchasing_price,
        return_price: item.return_price,
        barcode: item.barcode,
        sales_stock_id: item.sales_stock_id,
      })));
    }
  }, [handleStartEditBase, selectedReturn]);

  const handleCancel = useCallback((items: PurchasingReturn[]) => {
    handleCancelBase(items);
    setLineItems([]);
    setFormStep(0);
    setBarcodeInput("");
    setValidationError(null);
    setValidatedItems([]);
    setTouched({}); // Reset validation state
  }, [handleCancelBase]);

  // Handler that wraps hook's handler (which already handles unsaved changes confirm)
  const handleSelectReturnWithItems = useCallback(async (ret: PurchasingReturn) => {
    const selected = await handleSelectReturn(ret);
    if (!selected) return; // User cancelled
    
    // Load detailed items after selection
    setTouched({});
    setBarcodeInput("");
    setValidationError(null);
    setValidatedItems([]);
    try {
      const detailedReturn = await purchaseReturnsApi.getById(ret.id);
      if (detailedReturn.items) {
        setLineItems(detailedReturn.items.map((item: any, idx: number) => ({
          _id: `existing-${idx}`,
          product_id: item.product_id,
          purchasing_price: item.purchasing_price,
          return_price: item.return_price,
          barcode: item.barcode,
          sales_stock_id: item.sales_stock_id,
          branch_code: item.branch_code,
          added_date: item.added_date,
          product_name: item.product_name,
        })));
      } else {
        setLineItems([]);
      }
    } catch {
      setLineItems([]);
    }
  }, [handleSelectReturn]);

  const { data: returns, isLoading, refetch } = useQuery({
    queryKey: ["purchaseReturns"],
    queryFn: () => purchaseReturnsApi.getAll(),
  });

  const { data: grns } = useQuery({
    queryKey: ["goodReceivedNotes"],
    queryFn: () => goodReceivedNotesApi.getAll(),
  });

  const { data: branchesData } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(1, 100),
  });
  const branches = branchesData?.items || [];

  const filteredReturns = useMemo(() => {
    if (!returns) return [];

    let filtered = returns.filter(
      (ret) =>
        ret.purchasing_return_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(ret.id).includes(searchQuery)
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
      const fieldA = a[sortField as keyof PurchasingReturn] || "";
      const fieldB = b[sortField as keyof PurchasingReturn] || "";
      return String(fieldA).localeCompare(String(fieldB));
    });

    return filtered;
  }, [returns, searchQuery, sortField, filterBranch, filterStatus]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredReturns.length > 0 && !selectedReturn && !isCreating) {
      handleSelectReturnWithItems(filteredReturns[0]);
    }
  }, [filteredReturns, selectedReturn, isCreating]);

  const createMutation = useMutation({
    mutationFn: purchaseReturnsApi.create,
    onSuccess: (newReturn) => {
      queryClient.invalidateQueries({ queryKey: ["purchaseReturns"] });
      toast.success("Purchase return created successfully");
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectReturnWithItems(newReturn), 0);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to create purchase return");
    },
  });

  // Helper functions (moved up for use in callbacks)
  const getGRNNumber = useCallback((grnId: number) => {
    const grn = grns?.find((g: GoodReceivedNote) => g.id === grnId);
    return grn ? grn.good_received_no : "Unknown";
  }, [grns]);

  // getStatusColor is now imported from common components and uses RETURN_STATUS_OPTIONS

  // Barcode validation handler
  const handleValidateBarcode = useCallback(async (barcode: string) => {
    if (!barcode.trim()) {
      setValidationError("Please enter a barcode");
      return;
    }

    // Check if barcode already added
    if (lineItems.some(item => item.barcode === barcode.trim())) {
      setValidationError("This barcode has already been added to the return");
      return;
    }

    // Get the selected GRN info for validation
    const selectedGrn = grns?.find((g: GoodReceivedNote) => g.id === formData.goodreceivednote_id);
    
    if (!selectedGrn) {
      setValidationError("Please select a GRN first");
      return;
    }

    setIsValidating(true);
    setValidationError(null);

    try {
      const response = await purchaseReturnsApi.validateBarcode({
        barcode: barcode.trim(),
        grn_id: formData.goodreceivednote_id,
        branch_code: formData.branch_code,
      });

      if (response.valid && response.sales_stock_id) {
        // Add to validated items list
        const validatedItem: ValidatedItem = {
          barcode: barcode.trim(),
          sales_stock_id: response.sales_stock_id,
          product_id: response.product_id || 0,
          product_name: response.product_name || "Unknown Product",
          purchasing_price: response.purchasing_price || 0,
          grn_id: formData.goodreceivednote_id,
          grn_no: getGRNNumber(formData.goodreceivednote_id),
          supplier_name: "",
          branch_code: formData.branch_code,
        };
        setValidatedItems(prev => [...prev, validatedItem]);

        // Add to line items
        const newLineItem: ReturnLineItem = {
          _id: `validated-${Date.now()}`,
          product_id: response.product_id || 0,
          purchasing_price: response.purchasing_price || 0,
          return_price: response.purchasing_price || 0, // Default to purchase price
          barcode: barcode.trim(),
          sales_stock_id: response.sales_stock_id,
        };
        setLineItems(prev => [...prev, newLineItem]);

        // Clear input and focus for next scan
        setBarcodeInput("");
        toast.success(`Added: ${response.product_name || barcode}`);
        barcodeInputRef.current?.focus();
      } else {
        setValidationError(response.message || "Barcode validation failed");
      }
    } catch (error: any) {
      const errorMessage = error.response?.data?.detail || error.message || "Failed to validate barcode";
      setValidationError(errorMessage);
    } finally {
      setIsValidating(false);
    }
  }, [formData.goodreceivednote_id, formData.branch_code, grns, lineItems, getGRNNumber]);

  const handleBarcodeKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleValidateBarcode(barcodeInput);
    }
  }, [barcodeInput, handleValidateBarcode]);

  const handleRemoveValidatedItem = useCallback((barcode: string) => {
    setValidatedItems(prev => prev.filter(item => item.barcode !== barcode));
    setLineItems(prev => prev.filter(item => item.barcode !== barcode));
  }, []);

  const handleAddLineItem = () => {
    const newItem: ReturnLineItem = {
      _id: `new-${Date.now()}`,
      product_id: 0,
      purchasing_price: 0,
      return_price: 0,
      barcode: "",
    };
    setLineItems([...lineItems, newItem]);
  };

  const handleRemoveLineItem = (id: string) => {
    setLineItems(prev => prev.filter(item => item._id !== id));
    // Also remove from validated items if exists
    const removedItem = lineItems.find(item => item._id === id);
    if (removedItem?.barcode) {
      setValidatedItems(prev => prev.filter(item => item.barcode !== removedItem.barcode));
    }
  };

  const handleUpdateLineItem = (id: string, field: keyof ReturnLineItem, value: any) => {
    setLineItems(lineItems.map(item => 
      item._id === id ? { ...item, [field]: value } : item
    ));
  };

  const handleSave = useCallback(() => {
    const dataToSave: PurchasingReturnCreate = {
      ...formData,
      items: lineItems.map(({ _id, branch_code, added_date, product_name, ...item }) => item),
      require_approval: true, // Approval is always required for purchase returns
    };

    if (isCreating) {
      createMutation.mutate(dataToSave);
    }
    // Note: Update not supported by current API
  }, [isCreating, formData, lineItems, createMutation]);

  // Completely prevent deletion of approved returns - delete button won't show
  const canDelete = selectedReturn?.status !== "approved";

  const handleDelete = useCallback(async () => {
    if (selectedReturn) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete Purchase Return",
        message: `Are you sure you want to delete return "${selectedReturn.purchasing_return_no || selectedReturn.id}"?`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        toast.error("Delete operation not supported for purchase returns");
      }
    }
  }, [selectedReturn, confirmDialog]);

  const handleDuplicate = useCallback(() => {
    if (selectedReturn) {
      const newFormData = {
        ...resetFormFromReturn(selectedReturn),
        purchasing_return_no: generateReturnNo(),
      };
      setFormData(newFormData);
      // @ts-ignore
      if (selectedReturn.items) {
        // @ts-ignore
        setLineItems(selectedReturn.items.map((item: any, idx: number) => ({
          _id: `copy-${idx}`,
          product_id: item.product_id,
          purchasing_price: item.purchasing_price,
          return_price: item.return_price,
          barcode: item.barcode,
        })));
      }
      handleNewReturnBase();
    }
  }, [selectedReturn, setFormData, handleNewReturnBase]);

  const calculateTotal = () => {
    return lineItems.reduce((sum, item) => sum + (Number(item.return_price) || 0), 0);
  };

  const getBranchDisplay = (branchCode: string) => {
    const branch = branches.find((b) => b.branch_code === branchCode);
    return branch ? `${branch.branch_code} - ${branch.branch_name}` : branchCode;
  };

  // Validation error messages
  const getFieldError = (fieldName: string): string | undefined => {
    if (!touched[fieldName] && !isCreating) return undefined;
    
    switch (fieldName) {
      case 'purchasing_return_no':
        if (!formData.purchasing_return_no) return 'Return number is required';
        break;
      case 'goodreceivednote_id':
        if (!formData.goodreceivednote_id || formData.goodreceivednote_id === 0) return 'GRN selection is required';
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

  // Check if a field has an error (for styling)
  const hasError = (fieldName: string): boolean => {
    return !!getFieldError(fieldName);
  };

  // Step 1 validation
  const isStep1Valid = formData.purchasing_return_no && formData.goodreceivednote_id > 0;
  
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
    <SearchableList<PurchasingReturn>
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
      emptyMessage="No purchase returns found"
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
                <span>{ret.purchasing_return_no || `RET-${ret.id}`}</span>
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
                      {getGRNNumber(ret.goodreceivednote_id)}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (GRN)
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
                  {/* Status Chips - shown below all fields when selected */}
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                    <TStatusChip status={ret.status || "pending"} statusMap="purchaseReturn" size="small" />
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? `GRN: ${getGRNNumber(ret.goodreceivednote_id)} • ${getBranchDisplay(ret.branch_code)} • ${new Date(ret.added_date || "").toLocaleDateString()}` : undefined}
          isFavorite={favorites.includes(ret.id)}
          onToggleFavorite={(e) => toggleFavorite(ret.id, e)}
          statusChip={!isSelected ? { label: getStatusProps(ret.status || "pending", "purchaseReturn").label, color: getStatusProps(ret.status || "pending", "purchaseReturn").color } : undefined}
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchasing", href: "/purchasing" },
          { label: "Purchase Returns", href: "/purchasing/returns" },
          ...(selectedReturn || isCreating
            ? [{ label: isCreating ? "New Return" : selectedReturn?.purchasing_return_no || `RET-${selectedReturn?.id}` }]
            : []),
        ]}
        title={selectedReturn ? (selectedReturn.purchasing_return_no || `RET-${selectedReturn.id}`) : ""}
        titleIcon={<AssignmentReturnIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Purchase Return"
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
        canDelete={canDelete}
        onNew={handleNewReturn}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredReturns)}
        onEdit={handleStartEdit}
        endActions={
          selectedReturn && !isCreating && !isEditing ? (
            <TPrintButton
              documentType="purchase-return"
              documentId={selectedReturn.id}
              disabled={!canPrintDocument(selectedReturn.status)}
              disabledReason="Cannot print draft/pending returns"
            />
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedReturn && !isCreating ? (
          <EmptyState message="Select a purchase return from the list or create a new one" />
        ) : (
          <>
            {/* Stepper for create mode only */}
            {isCreating && (
              <Stepper activeStep={formStep} sx={{ mb: 3 }}>
                {FORM_STEPS.map((label) => (
                  <Step key={label}>
                    <StepLabel>{label}</StepLabel>
                  </Step>
                ))}
              </Stepper>
            )}

            {/* Step 1: Return Information (always show in view/edit mode) */}
            {(formStep === 0 || !isCreating) && (
              <>
                <FormSection title="Return Information" columns={3}>
                  <TextField
                    label="Return Number"
                    size="small"
                    value={formData.purchasing_return_no}
                    onChange={(e) => setFormData({ ...formData, purchasing_return_no: e.target.value })}
                    onBlur={() => handleBlur('purchasing_return_no')}
                    disabled={!isEditing && !isCreating}
                    required
                    error={hasError('purchasing_return_no')}
                    helperText={getFieldError('purchasing_return_no')}
                  />
                  <Autocomplete
                    size="small"
                    options={grns || []}
                    getOptionLabel={(option: GoodReceivedNote) => option.good_received_no || `GRN-${option.id}`}
                    value={grns?.find((g: GoodReceivedNote) => g.id === formData.goodreceivednote_id) || null}
                    onChange={(_, newValue: GoodReceivedNote | null) => {
                      if (newValue) {
                        setFormData({ 
                          ...formData, 
                          goodreceivednote_id: newValue.id,
                          branch_code: newValue.branch_code 
                        });
                      } else {
                        setFormData({ ...formData, goodreceivednote_id: 0 });
                      }
                      handleBlur('goodreceivednote_id');
                    }}
                    disabled={!isEditing && !isCreating}
                    renderInput={(params) => (
                      <TextField 
                        {...params} 
                        label="Good Received Note" 
                        required 
                        error={hasError('goodreceivednote_id')}
                        helperText={getFieldError('goodreceivednote_id')}
                      />
                    )}
                  />
                  <TextField
                    label="Branch"
                    size="small"
                    value={getBranchDisplay(formData.branch_code)}
                    disabled
                    helperText="Auto-filled from GRN"
                  />
                </FormSection>

                <FormSection title="Remarks" columns={1}>
                  <TextField
                    label="Remarks"
                    size="small"
                    value={formData.remark}
                    onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    multiline
                    rows={2}
                  />
                </FormSection>

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

            {/* Step 2: Return Items (always show in view/edit mode, step 2 in create mode) */}
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

                {/* Barcode Scanner Section */}
                {(isEditing || isCreating) && (
                  <Paper 
                    variant="outlined" 
                    sx={{ 
                      p: 2, 
                      mb: 2, 
                      bgcolor: "primary.50",
                      borderColor: "primary.main",
                      borderWidth: 2,
                    }}
                  >
                    <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1, display: "flex", alignItems: "center", gap: 1 }}>
                      <QrCodeScannerIcon color="primary" />
                      Scan Barcode to Add Return Items
                    </Typography>
                    <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                      <TextField
                        inputRef={barcodeInputRef}
                        size="small"
                        fullWidth
                        placeholder="Scan or type barcode and press Enter..."
                        value={barcodeInput}
                        onChange={(e) => {
                          setBarcodeInput(e.target.value);
                          if (validationError) setValidationError(null);
                        }}
                        onKeyDown={handleBarcodeKeyDown}
                        disabled={isValidating || formData.goodreceivednote_id === 0}
                        error={!!validationError}
                        helperText={validationError || (formData.goodreceivednote_id === 0 ? "Please select a GRN first" : "Press Enter to validate and add item")}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <QrCodeScannerIcon fontSize="small" color={isValidating ? "disabled" : "action"} />
                            </InputAdornment>
                          ),
                          endAdornment: isValidating ? (
                            <InputAdornment position="end">
                              <CircularProgress size={20} />
                            </InputAdornment>
                          ) : null,
                        }}
                        autoFocus
                      />
                      <Button
                        variant="contained"
                        onClick={() => handleValidateBarcode(barcodeInput)}
                        disabled={isValidating || !barcodeInput.trim() || formData.goodreceivednote_id === 0}
                        sx={{ minWidth: 100 }}
                      >
                        {isValidating ? <CircularProgress size={20} /> : "Add"}
                      </Button>
                    </Box>

                    {/* Note: Approval is always required for purchase returns */}
                    <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: "divider" }}>
                      <Typography variant="body2" color="text.secondary">
                        <Chip 
                          label="Requires Approval" 
                          size="small" 
                          color="warning" 
                          sx={{ mr: 1 }} 
                        />
                        All purchase returns require approval before processing
                      </Typography>
                    </Box>

                    {/* Scanned Items Summary */}
                    {validatedItems.length > 0 && (
                      <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: "divider" }}>
                        <Typography variant="caption" color="text.secondary">
                          Scanned Items: {validatedItems.length}
                        </Typography>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 1 }}>
                          {validatedItems.map((item, idx) => (
                            <Chip
                              key={idx}
                              size="small"
                              icon={<CheckCircleIcon fontSize="small" />}
                              label={item.barcode}
                              onDelete={() => handleRemoveValidatedItem(item.barcode)}
                              color="success"
                              variant="outlined"
                            />
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Paper>
                )}

                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, mt: isCreating ? 0 : 2 }}>
                  <Typography variant="subtitle1" fontWeight="bold">Return Items</Typography>
                  {(isEditing || isCreating) && (
                    <IconButton size="small" onClick={handleAddLineItem} color="primary" title="Add manual item">
                      <AddIcon />
                    </IconButton>
                  )}
                </Box>
                
                {/* Warning for empty items */}
                {(isEditing || isCreating) && lineItems.length === 0 && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    At least one item is required to save the return. Scan barcodes to add items.
                  </Alert>
                )}
                
                <Box>
              <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell>Barcode</TableCell>
                      <TableCell>Product</TableCell>
                      <TableCell>Branch Code</TableCell>
                      <TableCell>Added Date</TableCell>
                      <TableCell align="right" sx={{ width: 120 }}>Purchase Price</TableCell>
                      <TableCell align="right" sx={{ width: 120 }}>Return Price</TableCell>
                      {(isEditing || isCreating) && <TableCell sx={{ width: 50 }} />}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lineItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isEditing || isCreating ? 7 : 6} sx={modernTableStyles.emptyCell}>
                          {(isEditing || isCreating) 
                            ? "Scan barcodes above to add items" 
                            : "No items added yet"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      lineItems.map((item, index) => {
                        const validatedItem = validatedItems.find(v => v.barcode === item.barcode);
                        return (
                        <TableRow key={item._id} sx={{ 
                          ...modernTableStyles.bodyRow,
                          ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                        }}>
                          <TableCell>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              {validatedItem && (
                                <CheckCircleIcon fontSize="small" color="success" />
                              )}
                            {(isEditing || isCreating) && !validatedItem ? (
                              <TextField
                                size="small"
                                fullWidth
                                value={item.barcode}
                                onChange={(e) => handleUpdateLineItem(item._id, "barcode", e.target.value)}
                                placeholder="Barcode"
                              />
                            ) : (
                              <Typography variant="body2">{item.barcode}</Typography>
                            )}
                            </Box>
                          </TableCell>
                          <TableCell>
                            {validatedItem ? (
                              <Typography variant="body2">{validatedItem.product_name}</Typography>
                            ) : item.product_name ? (
                              <Typography variant="body2">{item.product_name}</Typography>
                            ) : (isEditing || isCreating) ? (
                              <TextField
                                size="small"
                                type="number"
                                value={item.product_id}
                                onChange={(e) => handleUpdateLineItem(item._id, "product_id", parseInt(e.target.value) || 0)}
                                sx={{ width: 100 }}
                                placeholder="Product ID"
                              />
                            ) : (
                              `#${item.product_id}`
                            )}
                          </TableCell>
                          <TableCell>
                            {validatedItem?.branch_code || item.branch_code || formData.branch_code || "-"}
                          </TableCell>
                          <TableCell>
                            {item.added_date ? new Date(item.added_date).toLocaleDateString() : (isCreating ? "New" : "-")}
                          </TableCell>
                          <TableCell align="right">
                            {(isEditing || isCreating) ? (
                              <TextField
                                size="small"
                                type="number"
                                value={item.purchasing_price}
                                onChange={(e) => handleUpdateLineItem(item._id, "purchasing_price", parseFloat(e.target.value) || 0)}
                                sx={{ width: 100 }}
                                inputProps={{ min: 0, step: 0.01 }}
                              />
                            ) : (
                              `Rs. ${(Number(item.purchasing_price) || 0).toFixed(2)}`
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {(isEditing || isCreating) ? (
                              <TextField
                                size="small"
                                type="number"
                                value={item.return_price ?? 0}
                                onChange={(e) => handleUpdateLineItem(item._id, "return_price", parseFloat(e.target.value) || 0)}
                                sx={{ width: 100 }}
                                inputProps={{ min: 0, step: 0.01 }}
                              />
                            ) : (
                              `Rs. ${(Number(item.return_price) || 0).toFixed(2)}`
                            )}
                          </TableCell>
                          {(isEditing || isCreating) && (
                            <TableCell>
                              <IconButton size="small" onClick={() => handleRemoveLineItem(item._id)} color="error">
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </TableCell>
                          )}
                        </TableRow>
                      );})
                    )}
                    <TableRow sx={{ bgcolor: "action.hover" }}>
                      <TableCell colSpan={isEditing || isCreating ? 5 : 5} align="right">
                        <Typography fontWeight="bold">Total Return:</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="bold">Rs. {(calculateTotal() || 0).toFixed(2)}</Typography>
                      </TableCell>
                      {(isEditing || isCreating) && <TableCell />}
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </Box>
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
        title="Purchase Returns"
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <ConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
