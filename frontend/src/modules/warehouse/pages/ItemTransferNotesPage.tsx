/**
 * ItemTransferNotesPage - Item Transfer Note Management
 * Allows creating and managing item transfers between locations with QR/barcode scanning
 * Following GRN page patterns for UI consistency
 */

import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
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
  Tooltip,
  Avatar,
} from "@mui/material";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import SaveIcon from "@mui/icons-material/Save";
import DeleteIcon from "@mui/icons-material/Delete";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import StarIcon from "@mui/icons-material/Star";
import StarOutlineIcon from "@mui/icons-material/StarBorder";
import AddIcon from "@mui/icons-material/Add";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";

// Import tijaero components
import {
  MasterDetailLayout,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  fmtLKR,
  TExportButton,
  TBranchFilter,
  TPrintButton,
  TPrintPreviewDialog,
  canPrintDocument,
  useMasterDetailState,
  modernTableStyles,
  handleApiError,
  TConfirmDialog,
  useTConfirmDialog,
  showSuccessToast,
  showErrorToast,
  TDataGrid,
  SelectableListItem,
  type TDataGridColumn,
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

const getNextNumber = (prefix: string, existing: { no: string }[], branchCode?: string): string => {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const actualBranch = branchCode || "HQ";
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

const FORM_STEPS = ["Transfer Information", "Scan & Transfer Items"];

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
  const location = useLocation();
  const prefillTransfer = (location.state as { prefillTransfer?: { fromBranch: string; toBranch: string; items: Array<{ product_id: number; product_name: string; quantity: number }>; quoteId?: number; quoteNo?: string } } | null)?.prefillTransfer;
  const prefillAppliedRef = useRef(false);
  const [lineItems, setLineItems] = useState<ITNLineItem[]>([]);
  const [prefillItems, setPrefillItems] = useState<Array<{ product_id: number; product_name: string; quantity: number }>>([]);
  const [formStep, setFormStep] = useState(0);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  
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
  
  // Filter states - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    selectedItem: selectedITN,
    setSelectedItem: setSelectedITN,
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
    extraDirty: lineItems.length > 0,
    onDiscard: () => { setLineItems([]); setFormStep(0); },
  });

  // Fetch locations
  const { data: locationsData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => locationsApi.getAll(),
  });
  const locations = locationsData || [];

  // OPTIMIZED: Using aggregated endpoint for branches (was separate branchApi call)
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewITN = useCallback(() => {
    handleNewITNBase();
    setFormData(prev => ({
      ...prev,
      item_transfer_note: "",
      branch_code: defaultBranchCode || prev.branch_code,
    }));
    setLineItems([]);
    setValidatedItems([]);
    setBarcodeInput('');
    setValidationError(null);
    setFormStep(0);
    setTouched({});
  }, [handleNewITNBase, setFormData, defaultBranchCode]);

  useEffect(() => {
    if (!prefillTransfer || prefillAppliedRef.current) return;
    handleNewITN();
    setFormData(prev => ({
      ...prev,
      branch_code: prefillTransfer.fromBranch,
      ...(prefillTransfer.quoteId ? { sales_quote_id: prefillTransfer.quoteId } : {}),
    }));
    setPrefillItems(prefillTransfer.items || []);
    prefillAppliedRef.current = true;
  }, [prefillTransfer, handleNewITN, setFormData]);

  useEffect(() => {
    if (!prefillTransfer || locations.length === 0) return;
    if (formData.from_location_id && formData.to_location_id) return;
    const fromLocation = locations.find(l => l.branch_code === prefillTransfer.fromBranch);
    const toLocation = locations.find(l => l.branch_code === prefillTransfer.toBranch && l.id !== fromLocation?.id)
      || locations.find(l => l.branch_code === prefillTransfer.toBranch);
    setFormData(prev => ({
      ...prev,
      from_location_id: fromLocation?.id || prev.from_location_id,
      to_location_id: toLocation?.id || prev.to_location_id,
    }));
  }, [prefillTransfer, locations, formData.from_location_id, formData.to_location_id, setFormData]);

  // Tracks the most recently requested ITN so a slower, stale response
  // (e.g. switching from A to B before A's request resolves) can't overwrite
  // the currently-selected ITN's line items with a different ITN's data.
  const latestITNRequestRef = useRef<number | null>(null);

  // Load ITN items when selecting an ITN
  const loadITNItems = useCallback(async (itnId: number) => {
    try {
      const items = await transferNoteItemsApi.getAll(itnId);
      if (latestITNRequestRef.current !== itnId) return;
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
      if (latestITNRequestRef.current !== itnId) return;
      setLineItems([]);
    }
  }, []);

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
    setFormStep(0);
  }, [handleStartEditBase]);

  // Cancelling out of "New Transfer Note" should return to the browse
  // table, not auto-open the first ITN the way useMasterDetailState's
  // generic handleCancel does (that behavior made sense for the old
  // always-visible detail panel, but not here). Cancelling out of editing
  // an existing ITN still just reverts its form, which the generic handler
  // already does correctly.
  const handleCancel = useCallback((items: ItemTransferNote[]) => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedITN(null);
    } else {
      handleCancelBase(items);
    }
    setLineItems([]);
    setValidatedItems([]);
    setBarcodeInput('');
    setValidationError(null);
    setFormStep(0);
    setTouched({});
  }, [isCreating, handleCancelBase, setIsCreating, setIsEditing, setSelectedITN]);

  // Returns to the browse table from the detail view (the "Back to Item
  // Transfer Notes" link above the detail header).
  const handleBackToITNs = useCallback(() => {
    setSelectedITN(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setLineItems([]);
      setValidatedItems([]);
      setBarcodeInput('');
      setValidationError(null);
      setFormStep(0);
      setTouched({});
    }
  }, [isCreating, setSelectedITN, setIsCreating, setIsEditing]);

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

    latestITNRequestRef.current = itn.id;
    setTouched({});
    loadITNItems(itn.id);
  }, [handleSelectITN, loadITNItems]);

  const { data: transferNotes, isLoading } = useQuery({
    queryKey: ["transfer-notes", filterBranch],
    queryFn: () => {
      if (!filterBranch) return Promise.resolve([]);
      return transferNotesApi.getAll({ branch_code: filterBranch });
    },
    enabled: branchResolved && filterBranch !== null,
  });

  const nextITNNumber = useMemo(() => 
    getNextNumber('ITN', (transferNotes || []).map((t: any) => ({ no: t.item_transfer_note })), formData.branch_code), 
  [transferNotes, formData.branch_code]);

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

    // Default order before the user sorts a column in the browse table
    // itself (the table's own column-header sort takes over from there).
    filtered.sort((a, b) => {
      const diff = new Date(b.created_date || "").getTime() - new Date(a.created_date || "").getTime();
      return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
    });

    return filtered;
  }, [transferNotes, searchQuery, filterBranch]);

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
  // When creating, ITN number is auto-generated (shown in UI but not stored in formData), so use nextITNNumber
  const effectiveITNNumber = isCreating ? nextITNNumber : formData.item_transfer_note;
  const isStep1Valid = effectiveITNNumber && 
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

  // Whether we're showing a single transfer note's detail view (selected or
  // being created) instead of the browse table.
  const isITNDetailMode = !!selectedITN || isCreating;

  // Browse mode: a full-width table of every transfer note. Sorting is done
  // per-column via the grid's own column header menu, not a separate
  // "Sort by" control.
  const itnColumns: TDataGridColumn<ItemTransferNote>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<ItemTransferNote>) => (
          <IconButton size="small" onClick={(e) => toggleFavorite(params.row.id, e)}>
            {favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
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
                handleSelectITNWithItems(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [favorites, toggleFavorite, handleSelectITNWithItems] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const itnTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<ItemTransferNote>
          rows={filteredITNs}
          columns={itnColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectITNWithItems(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No transfer notes found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current transfer note
  // (or the "New Transfer Note" placeholder while creating). A "Back to Item
  // Transfer Notes" link returns to the table.
  const singleITNPanel = (
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
          onClick={handleBackToITNs}
          sx={{ textTransform: "none" }}
        >
          Back to Item Transfer Notes
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "primary.main" }}>
              <SwapHorizIcon fontSize="small" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Transfer Note
            </Typography>
          </Box>
        </Box>
      ) : selectedITN && (
        <Box>
          <SelectableListItem
            id={selectedITN.id}
            isSelected
            onClick={() => {}}
            primaryText={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
                <Avatar sx={{ bgcolor: "primary.main" }}>
                  <SwapHorizIcon fontSize="small" />
                </Avatar>
                <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                  <span>{selectedITN.item_transfer_note || `ITN-${selectedITN.id}`}</span>
                </Box>
              </Box>
            }
            isFavorite={favorites.includes(selectedITN.id)}
            onToggleFavorite={(e) => toggleFavorite(selectedITN.id, e)}
          />
        </Box>
      )}
    </Paper>
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
        endActions={
          isCreating && formStep === 0 ? (
            <Button
              size="small"
              variant="contained"
              onClick={handleNextStep}
              disabled={!isStep1Valid}
              endIcon={<ArrowForwardIcon />}
            >
              Next: Select Items
            </Button>
          ) : selectedITN && !isCreating && !isEditing ? (
            <TPrintButton
              documentType="item-transfer-note"
              documentId={selectedITN.id}
              disabled={!canPrintDocument(getITNStatus(selectedITN), ["rejected", "cancelled"])}
              disabledReason={`Cannot print: transfer note is ${(getITNStatus(selectedITN) || "").replace(/_/g, " ")}`}
              onClick={() => setPrintDialogOpen(true)}
            />
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedITN && !isCreating ? (
          <EmptyState 
            message="Select a transfer note from the list"
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
                    value={isCreating ? nextITNNumber : formData.item_transfer_note}
                    disabled
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

                {isCreating && prefillItems.length > 0 && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 0.5 }}>
                      Transfer requested from quotation
                    </Typography>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                      {prefillItems.map((item, idx) => (
                        <Typography key={`${item.product_id}-${idx}`} variant="body2">
                          {item.product_name} — Qty {item.quantity}
                        </Typography>
                      ))}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                      Scan items below to add them to this transfer.
                    </Typography>
                  </Alert>
                )}

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
                            <TableCell align="right">{item.cost_price ? fmtLKR(item.cost_price) : '-'}</TableCell>
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
                                {item.cost_price || validatedItem?.cost_price ? fmtLKR(item.cost_price || validatedItem?.cost_price || 0) : '-'}
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
        titleSlot={
          isITNDetailMode ? undefined : (
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
                sx={{ width: 220, flexShrink: 0 }}
              />
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TBranchFilter
                  branches={branches}
                  value={filterBranch}
                  onChange={setFilterBranch}
                  label=""
                  placeholder="All Branches"
                  size="small"
                />
              </Box>
              {(searchQuery || filterBranch) && (
                <Tooltip title="Clear filters">
                  <IconButton size="small" onClick={handleClearFilters}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )
        }
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
          queryClient.invalidateQueries({ queryKey: ["locations"] });
        }}
        headerActions={
          isITNDetailMode ? undefined : (
            <>
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={handleNewITN}
                sx={{ mr: 1 }}
              >
                Add Transfer Note
              </Button>
              <TExportButton
                filename="item_transfer_notes"
                headers={[
                  "Transfer Note",
                  "From Location",
                  "To Location",
                  "Branch",
                  "Created Date",
                  "Status",
                  "Remark",
                ]}
                rows={() =>
                  filteredITNs.map((itn) => [
                    itn.item_transfer_note || "",
                    itn.from_location_name || "",
                    itn.to_location_name || "",
                    itn.branch_code || "",
                    itn.created_date || "",
                    itn.status || "",
                    itn.remark || "",
                  ])
                }
                disabled={filteredITNs.length === 0}
              />
            </>
          )
        }
        {...(isITNDetailMode ? { masterPanel: singleITNPanel, detailPanel } : { children: itnTablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />

      {/* Print Preview Dialog */}
      {selectedITN && (
        <TPrintPreviewDialog
          open={printDialogOpen}
          onClose={() => setPrintDialogOpen(false)}
          documentType="item-transfer-note"
          documentId={selectedITN.id}
          title={`Print ITN: ${selectedITN.item_transfer_note}`}
        />
      )}
    </>
  );
}
