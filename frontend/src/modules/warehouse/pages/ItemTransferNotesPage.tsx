/**
 * ItemTransferNotesPage - Item Transfer Note Management
 * Allows creating and managing item transfers between locations with QR/barcode scanning
 * Following GRN page patterns for UI consistency
 */

import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  TextField,
  MenuItem,
  Typography,
  IconButton,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  CircularProgress,
  Button,
  Stepper,
  Step,
  StepLabel,
  Chip,
  Alert,
  InputAdornment,
} from "@mui/material";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import SaveIcon from "@mui/icons-material/Save";
import DeleteIcon from "@mui/icons-material/Delete";

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
  useMasterDetailState,
  SortOption,
  modernTableStyles,
  getStatusProps,
  handleApiError,
  TConfirmDialog,
  useTConfirmDialog,
  showSuccessToast,
  showErrorToast,
} from "@/components/tijaero";

import { transferNotesApi, transferNoteItemsApi, transferWorkflowApi } from "@/modules/warehouse/api";
import { locationsApi } from "@/modules/common/api";
import { useReferenceData } from "@/hooks";
// OPTIMIZED: Removed branchApi import - using aggregated endpoint
import { 
  ItemTransferNote, 
  ItemTransferNoteCreate,
  ItemTransferNoteItem,
  ItemTransferNoteWithItems,
} from "@/modules/warehouse/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date" },
  { value: "item_transfer_note", label: "ITN Number" },
];

const FORM_STEPS = ["Transfer Information", "Scan & Transfer Items"];

const generateITNNo = () => `ITN-${Date.now().toString(36).toUpperCase()}`;

const INITIAL_FORM_DATA: ItemTransferNoteCreate = {
  item_transfer_note: "",
  created_date: new Date().toISOString().split("T")[0],
  remark: "",
  branch_code: "HQ",
  from_location_id: 0,
  to_location_id: 0,
};

interface ITNLineItem {
  _id: string;
  id?: number;
  product_id: number;
  product_name: string;
  barcode: string;
  branch_code?: string;
  remark?: string;
  sales_stock_id?: number;
  item_recieved?: boolean;
  cost_price?: number;
}

const resetFormFromITN = (itn: ItemTransferNote): ItemTransferNoteCreate => ({
  item_transfer_note: itn.item_transfer_note,
  created_date: itn.created_date?.split("T")[0] || "",
  remark: itn.remark || "",
  branch_code: itn.branch_code,
  from_location_id: itn.from_location_id,
  to_location_id: itn.to_location_id,
});

// Get status based on approval records
const getITNStatus = (itn: ItemTransferNote | ItemTransferNoteWithItems): string => {
  return itn.status || "pending";
};

export default function ItemTransferNotesPage() {
  const queryClient = useQueryClient();
  const [lineItems, setLineItems] = useState<ITNLineItem[]>([]);
  const [formStep, setFormStep] = useState(0);
  
  // Barcode scanning state (Purchase Returns pattern)
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validatedItems, setValidatedItems] = useState<Array<{
    barcode: string;
    product_id: number;
    product_name: string;
    branch_code: string;
    cost_price?: number;
  }>>([]);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  
  // Confirm dialog for unsaved changes
  const confirmDialog = useTConfirmDialog();
  
  // Validation state
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  
  const handleBlur = (fieldName: string) => {
    setTouched(prev => ({ ...prev, [fieldName]: true }));
  };
  
  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedITN,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectITN,
    handleNew: handleNewITNBase,
    handleCancel: handleCancelBase,
    handleStartEdit: handleStartEditBase,
  } = useMasterDetailState<ItemTransferNote, ItemTransferNoteCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromITN,
    favoritesKey: "itn_favorites",
    defaultSortField: "created_date",
    confirmUnsavedChanges: () => confirmDialog.confirm({
      title: "Discard Changes",
      message: "You have unsaved changes. Discard them?",
      confirmText: "Discard",
      cancelText: "Keep Editing",
      confirmColor: "warning",
    }),
  });

  // Fetch locations
  const { data: locationsData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => locationsApi.getAll(),
  });
  const locations = locationsData || [];

  // OPTIMIZED: Using aggregated endpoint for branches (was separate branchApi call)
  const { filteredBranches } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  const handleNewITN = useCallback(() => {
    handleNewITNBase();
    setFormData(prev => ({
      ...prev,
      item_transfer_note: generateITNNo(),
    }));
    setLineItems([]);
    setValidatedItems([]);
    setBarcodeInput('');
    setValidationError(null);
    setFormStep(0);
    setTouched({});
  }, [handleNewITNBase, setFormData]);

  // Load ITN items when selecting an ITN
  const loadITNItems = useCallback(async (itnId: number) => {
    try {
      const items = await transferNoteItemsApi.getAll(itnId);
      setLineItems(items.map((item: ItemTransferNoteItem) => ({
        _id: `existing-${item.id}`,
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name || "",
        barcode: item.barcode || "",
        branch_code: item.branch_code,
        remark: item.remark,
        item_recieved: item.item_recieved,
      })));
    } catch (error) {
      console.error("Failed to load ITN items:", error);
      setLineItems([]);
    }
  }, []);

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
    setFormStep(0);
  }, [handleStartEditBase]);

  const handleCancel = useCallback((items: ItemTransferNote[]) => {
    handleCancelBase(items);
    setLineItems([]);
    setValidatedItems([]);
    setBarcodeInput('');
    setValidationError(null);
    setFormStep(0);
    setTouched({});
  }, [handleCancelBase]);

  // Barcode validation handler (using new workflow API)
  const handleValidateBarcode = useCallback(async (barcode: string) => {
    if (!barcode.trim()) {
      setValidationError('Please enter a barcode');
      return;
    }

    // Check if already scanned
    if (validatedItems.some(item => item.barcode === barcode)) {
      setValidationError('This barcode has already been scanned');
      return;
    }

    if (!formData.from_location_id) {
      setValidationError('Please select a source location first');
      return;
    }

    setIsValidating(true);
    setValidationError(null);

    try {
      // Use the new workflow validation API
      const response = await transferWorkflowApi.validateBarcode({
        barcode: barcode.trim(),
        from_location_id: formData.from_location_id,
        branch_code: formData.branch_code,
      });
      
      if (!response.valid) {
        setValidationError(response.message);
        return;
      }

      // Add validated item
      const validatedItem = {
        barcode: barcode,
        product_id: response.product_id!,
        product_name: response.product_name || `Product #${response.product_id}`,
        branch_code: formData.branch_code,
        cost_price: response.cost_price || 0,
      };

      setValidatedItems(prev => [...prev, validatedItem]);

      // Add to line items
      const newLineItem: ITNLineItem = {
        _id: Math.random().toString(),
        id: undefined,
        barcode: barcode,
        product_id: response.product_id!,
        product_name: response.product_name || '',
        branch_code: formData.branch_code,
        sales_stock_id: response.sales_stock_id,
        item_recieved: false,
        cost_price: response.cost_price || 0,
      };

      setLineItems(prev => [...prev, newLineItem]);

      // Clear input and focus for next scan
      setBarcodeInput('');
      setTimeout(() => barcodeInputRef.current?.focus(), 100);

      showSuccessToast(`Added: ${validatedItem.product_name}`);
    } catch (error) {
      console.error('Barcode validation error:', error);
      setValidationError(handleApiError(error, 'Invalid barcode or item not found'));
    } finally {
      setIsValidating(false);
    }
  }, [formData.from_location_id, formData.branch_code, validatedItems]);

  // Handle barcode input
  const handleBarcodeKeyPress = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleValidateBarcode(barcodeInput);
    }
  }, [barcodeInput, handleValidateBarcode]);

  // Remove validated item
  const handleRemoveValidatedItem = useCallback((barcode: string) => {
    setValidatedItems(prev => prev.filter(item => item.barcode !== barcode));
    setLineItems(prev => prev.filter(item => item.barcode !== barcode));
  }, []);

  const handleSelectITNWithItems = useCallback(async (itn: ItemTransferNote) => {
    const selected = await handleSelectITN(itn);
    if (!selected) return;
    
    setTouched({});
    loadITNItems(itn.id);
  }, [handleSelectITN, loadITNItems]);

  const { data: transferNotes, isLoading, refetch } = useQuery({
    queryKey: ["transfer-notes"],
    queryFn: () => transferNotesApi.getAll(),
  });

  const filteredITNs = useMemo(() => {
    if (!transferNotes) return [];

    let filtered = transferNotes.filter(
      (itn) =>
        itn.item_transfer_note?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(itn.id).includes(searchQuery)
    );

    if (filterBranch) {
      filtered = filtered.filter(itn => itn.branch_code === filterBranch);
    }

    filtered.sort((a, b) => {
      if (sortField === "created_date") {
        return new Date(b.created_date || "").getTime() - new Date(a.created_date || "").getTime();
      }
      const fieldA = a[sortField as keyof ItemTransferNote] || "";
      const fieldB = b[sortField as keyof ItemTransferNote] || "";
      return String(fieldA).localeCompare(String(fieldB));
    });

    return filtered;
  }, [transferNotes, searchQuery, sortField, filterBranch]);

  // Auto-select first item
  useEffect(() => {
    if (filteredITNs.length > 0 && !selectedITN && !isCreating) {
      handleSelectITNWithItems(filteredITNs[0]);
    }
  }, [filteredITNs, selectedITN, isCreating]);

  const createMutation = useMutation({
    mutationFn: async (data: ItemTransferNoteCreate) => {
      // Validate we have items
      if (lineItems.length === 0) {
        throw new Error("No items to transfer. Please scan barcodes to add items.");
      }
      
      // Create the ITN
      const newITN = await transferNotesApi.create(data);
      
      // Create ITN items
      for (const item of lineItems) {
        await transferNoteItemsApi.create({
          product_id: item.product_id,
          barcode: item.barcode,
          branch_code: item.branch_code || data.branch_code,
          remark: item.remark,
          item_recieved: false,
          itemtransfernote_id: newITN.id,
        });
      }
      
      return { itn: newITN, itemCount: lineItems.length };
    },
    onSuccess: ({ itn: newITN, itemCount }) => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      queryClient.invalidateQueries({ queryKey: ["salesStock"] });
      showSuccessToast(`Transfer note created with ${itemCount} items!`);
      setIsCreating(false);
      setIsEditing(false);
      setLineItems([]);
      setValidatedItems([]);
      setBarcodeInput('');
      setTimeout(() => handleSelectITNWithItems(newITN), 0);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to create transfer note"));
    },
  });

  // Load stock from source location when location is selected
  const handleFromLocationChange = async (locationId: number) => {
    setFormData(prev => ({ ...prev, from_location_id: locationId }));
    handleBlur("from_location_id");
  };
  
  // Location lookup
  const getLocationName = (locationId: number): string => {
    return locations.find(l => l.id === locationId)?.name || `Location #${locationId}`;
  };

  // Validation
  const isStep1Valid = formData.item_transfer_note && 
    formData.from_location_id > 0 && 
    formData.to_location_id > 0 &&
    formData.from_location_id !== formData.to_location_id &&
    formData.branch_code;

  const isFormValid = isStep1Valid && lineItems.length > 0;

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

  const handleSave = useCallback(() => {
    createMutation.mutate(formData);
  }, [formData, createMutation]);

  const isSaving = createMutation.isPending;

  // Master Panel
  const masterPanel = (
    <SearchableList
      items={filteredITNs}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search transfer notes..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedITN}
      onSelectItem={handleSelectITNWithItems}
      emptyMessage="No transfer notes found"
      listHeader={
        <TFilterPanel>
          <TBranchFilter
            branches={branches}
            value={filterBranch}
            onChange={setFilterBranch}
          />
        </TFilterPanel>
      }
      renderItem={(itn, isSelected) => {
        const status = getITNStatus(itn);
        const statusProps = getStatusProps(status, "orderStatus");
        return (
          <SelectableListItem
            key={itn.id}
            id={itn.id}
            isSelected={isSelected}
            onClick={() => handleSelectITNWithItems(itn)}
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
            secondaryText={!isSelected ? `${getLocationName(itn.from_location_id)} → ${getLocationName(itn.to_location_id)} • ${new Date(itn.created_date).toLocaleDateString()}` : undefined}
            isFavorite={favorites.includes(itn.id)}
            onToggleFavorite={(e) => toggleFavorite(itn.id, e)}
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
          { label: "Item Transfer Notes", href: "/warehouse/item-transfer-notes" },
          ...(selectedITN || isCreating
            ? [{ label: isCreating ? "New Transfer Note" : selectedITN?.item_transfer_note || `ITN-${selectedITN?.id}` }]
            : []),
        ]}
        title={selectedITN ? (selectedITN.item_transfer_note || `ITN-${selectedITN.id}`) : ""}
        titleIcon={<SwapHorizIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Item Transfer Note"
        noSelectionTitle="Select a Transfer Note"
        isFavorite={selectedITN ? favorites.includes(selectedITN.id) : false}
        onToggleFavorite={selectedITN ? (e) => toggleFavorite(selectedITN.id, e) : undefined}
      />

      <ActionToolbar
        hasSelectedItem={!!selectedITN}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={handleNewITN}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredITNs)}
        onEdit={handleStartEdit}
        canUpdate={selectedITN ? getITNStatus(selectedITN) === "pending" : false}
        canDelete={selectedITN ? getITNStatus(selectedITN) === "pending" : false}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedITN && !isCreating ? (
          <EmptyState 
            message="Select a transfer note from the list or create a new one"
            action={{
              label: "Create New Transfer Note",
              onClick: handleNewITN
            }}
          />
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

            {/* Step 1: Transfer Information */}
            {(formStep === 0 || !isCreating) && (
              <>
                <FormSection title="Transfer Information" columns={2}>
                  <TextField
                    label="ITN Number"
                    size="small"
                    value={formData.item_transfer_note}
                    disabled
                    required
                  />
                  <TextField
                    label="Transfer Date"
                    type="date"
                    size="small"
                    value={formData.created_date}
                    onChange={(e) => setFormData(prev => ({ ...prev, created_date: e.target.value }))}
                    disabled={!isCreating && !isEditing}
                    InputLabelProps={{ shrink: true }}
                    required
                  />
                  <TextField
                    select
                    label="Branch"
                    size="small"
                    value={formData.branch_code}
                    onChange={(e) => setFormData(prev => ({ ...prev, branch_code: e.target.value }))}
                    disabled={!isCreating && !isEditing}
                    required
                  >
                    {branches.map((branch) => (
                      <MenuItem key={branch.branch_code} value={branch.branch_code}>
                        {branch.branch_code} - {branch.branch_name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="From Location"
                    size="small"
                    value={formData.from_location_id}
                    onChange={(e) => handleFromLocationChange(parseInt(e.target.value))}
                    disabled={!isCreating && !isEditing}
                    required
                  >
                    {locations.map((location) => (
                      <MenuItem key={location.id} value={location.id}>
                        {location.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="To Location"
                    size="small"
                    value={formData.to_location_id}
                    onChange={(e) => {
                      setFormData(prev => ({ ...prev, to_location_id: parseInt(e.target.value) }));
                      handleBlur("to_location_id");
                    }}
                    disabled={!isCreating && !isEditing}
                    required
                    error={touched.to_location_id && formData.from_location_id === formData.to_location_id}
                    helperText={touched.to_location_id && formData.from_location_id === formData.to_location_id ? "Must be different from source location" : ""}
                  >
                    {locations.filter(l => l.id !== formData.from_location_id).map((location) => (
                      <MenuItem key={location.id} value={location.id}>
                        {location.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </FormSection>

                <FormSection title="Remarks" columns={1}>
                  <TextField
                    label="Remarks"
                    size="small"
                    value={formData.remark}
                    onChange={(e) => setFormData(prev => ({ ...prev, remark: e.target.value }))}
                    disabled={!isCreating && !isEditing}
                    multiline
                    rows={2}
                  />
                </FormSection>

                {/* Next/Cancel buttons for step 1 in create mode */}
                {isCreating && (
                  <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2, mt: 3 }}>
                    <Button 
                      variant="outlined" 
                      onClick={() => handleCancel(filteredITNs)}
                    >
                      Cancel
                    </Button>
                    <Button 
                      variant="contained" 
                      onClick={handleNextStep}
                      disabled={!isStep1Valid}
                      endIcon={<ArrowForwardIcon />}
                    >
                      Next: Select Items
                    </Button>
                  </Box>
                )}
              </>
            )}

            {/* Step 2: Scan & Transfer Items */}
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
                    Back to Transfer Information
                  </Button>
                )}

                {/* After-hours warning */}
                {isCreating && (() => {
                  const hour = new Date().getHours();
                  const isAfterHours = hour < 8 || hour >= 18;
                  return isAfterHours ? (
                    <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>
                      You are creating a transfer note outside business hours (8 AM - 6 PM). Please ensure proper authorization.
                    </Alert>
                  ) : null;
                })()}

                {/* Barcode Scanner Section (Purchase Returns pattern) */}
                {isCreating && (
                  <Paper 
                    variant="outlined" 
                    sx={{ 
                      p: 2, 
                      mb: 2, 
                      bgcolor: 'primary.lighter',
                      borderColor: 'primary.main',
                      borderWidth: 2,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <QrCodeScannerIcon color="primary" />
                      <Typography variant="subtitle1" fontWeight="bold">
                        Scan Items for Transfer
                      </Typography>
                    </Box>
                    
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                      <TextField
                        inputRef={barcodeInputRef}
                        fullWidth
                        size="small"
                        placeholder="Scan or enter barcode"
                        value={barcodeInput}
                        onChange={(e) => {
                          setBarcodeInput(e.target.value);
                          if (validationError) setValidationError(null);
                        }}
                        onKeyPress={handleBarcodeKeyPress}
                        disabled={isValidating || !formData.from_location_id}
                        error={!!validationError}
                        helperText={validationError || (isValidating ? 'Validating barcode...' : 'Press Enter or click Add button')}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <QrCodeScannerIcon color={validationError ? 'error' : 'primary'} />
                            </InputAdornment>
                          ),
                          endAdornment: isValidating ? (
                            <InputAdornment position="end">
                              <CircularProgress size={20} />
                            </InputAdornment>
                          ) : undefined,
                        }}
                      />
                      <Button
                        variant="contained"
                        onClick={() => handleValidateBarcode(barcodeInput)}
                        disabled={isValidating || !barcodeInput.trim() || !formData.from_location_id}
                        sx={{ minWidth: 100 }}
                      >
                        {isValidating ? <CircularProgress size={20} /> : 'Add'}
                      </Button>
                    </Box>

                    {/* Scanned items display */}
                    {validatedItems.length > 0 && (
                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                          Scanned Items ({validatedItems.length}):
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                          {validatedItems.map((item) => (
                            <Chip
                              key={item.barcode}
                              label={`${item.barcode} - ${item.product_name}`}
                              onDelete={() => handleRemoveValidatedItem(item.barcode)}
                              color="success"
                              icon={<CheckCircleIcon />}
                            />
                          ))}
                        </Box>
                      </Box>
                    )}

                    {!formData.from_location_id && (
                      <Alert severity="info" sx={{ mt: 2 }}>
                        Please select a source location in Step 1 before scanning items
                      </Alert>
                    )}
                  </Paper>
                )}

                {/* Warning for empty items */}
                {isCreating && lineItems.length === 0 && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    At least one item is required to save the transfer note. Scan barcodes to add items.
                  </Alert>
                )}

                {/* Items Table */}
                {!isCreating && lineItems.length > 0 ? (
                  // View mode - simple table
                  <Paper variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={modernTableStyles.headerRow}>
                          <TableCell>Barcode</TableCell>
                          <TableCell>Product</TableCell>
                          <TableCell>Branch Code</TableCell>
                          <TableCell align="right">Cost Price (Rs.)</TableCell>
                          <TableCell align="center">Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {lineItems
                          .slice()
                          .sort((a, b) => {
                            // Group by product_name first, then by barcode
                            const nameCompare = (a.product_name || '').localeCompare(b.product_name || '');
                            if (nameCompare !== 0) return nameCompare;
                            return (a.barcode || '').localeCompare(b.barcode || '');
                          })
                          .map((item, index) => (
                          <TableRow key={item._id} sx={{
                            ...modernTableStyles.bodyRow,
                            ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                          }}>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <CheckCircleIcon fontSize="small" color="success" />
                                <Typography variant="body2">{item.barcode}</Typography>
                              </Box>
                            </TableCell>
                            <TableCell>{item.product_name || `Product #${item.product_id}`}</TableCell>
                            <TableCell>{item.branch_code || formData.branch_code || "-"}</TableCell>
                            <TableCell align="right">{item.cost_price ? item.cost_price.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</TableCell>
                            <TableCell align="center">
                              {item.item_recieved ? (
                                <Chip label="Received" size="small" color="success" />
                              ) : (
                                <Chip label="Pending" size="small" color="warning" />
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Paper>
                ) : isCreating && lineItems.length > 0 ? (
                  // Create mode - table with scanned items
                  <Paper variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={modernTableStyles.headerRow}>
                          <TableCell>Barcode</TableCell>
                          <TableCell>Product</TableCell>
                          <TableCell>Branch Code</TableCell>
                          <TableCell align="right">Cost Price (Rs.)</TableCell>
                          <TableCell sx={{ width: 50 }} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {lineItems
                          .slice()
                          .sort((a, b) => {
                            // Group by product_name first, then by barcode
                            const nameCompare = (a.product_name || '').localeCompare(b.product_name || '');
                            if (nameCompare !== 0) return nameCompare;
                            return (a.barcode || '').localeCompare(b.barcode || '');
                          })
                          .map((item, index) => {
                          const validatedItem = validatedItems.find(v => v.barcode === item.barcode);
                          return (
                            <TableRow key={item._id} sx={{
                              ...modernTableStyles.bodyRow,
                              ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                            }}>
                              <TableCell>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  {validatedItem && (
                                    <CheckCircleIcon fontSize="small" color="success" />
                                  )}
                                  <Typography variant="body2">{item.barcode}</Typography>
                                </Box>
                              </TableCell>
                              <TableCell>
                                {validatedItem ? (
                                  <Typography variant="body2">{validatedItem.product_name}</Typography>
                                ) : (
                                  <Typography variant="body2">{item.product_name || `Product #${item.product_id}`}</Typography>
                                )}
                              </TableCell>
                              <TableCell>{validatedItem?.branch_code || item.branch_code || formData.branch_code || "-"}</TableCell>
                              <TableCell align="right">
                                {item.cost_price || validatedItem?.cost_price ? (item.cost_price || validatedItem?.cost_price || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                              </TableCell>
                              <TableCell>
                                <IconButton size="small" onClick={() => handleRemoveValidatedItem(item.barcode)} color="error">
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Paper>
                ) : (
                  <EmptyState
                    message={isCreating ? "Scan barcodes above to add items for transfer" : "No items in this transfer note"}
                  />
                )}

                {/* Save/Cancel buttons for final step in create mode */}
                {isCreating && lineItems.length > 0 && (
                  <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, mt: 3 }}>
                    <Button 
                      variant="text" 
                      onClick={handlePreviousStep}
                      startIcon={<ArrowBackIcon />}
                    >
                      Back
                    </Button>
                    <Box sx={{ display: "flex", gap: 2 }}>
                      <Button 
                        variant="outlined" 
                        onClick={() => handleCancel(filteredITNs)}
                      >
                        Cancel
                      </Button>
                      <Button 
                        variant="contained" 
                        onClick={handleSave}
                        disabled={!isFormValid || isSaving || lineItems.length === 0}
                        startIcon={isSaving ? <CircularProgress size={16} /> : <SaveIcon />}
                      >
                        {isSaving ? "Saving..." : "Save Transfer Note"}
                      </Button>
                    </Box>
                  </Box>
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
        title="Item Transfer Notes"
        masterPanel={masterPanel}
        detailPanel={detailPanel}
        onRefresh={() => refetch()}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
