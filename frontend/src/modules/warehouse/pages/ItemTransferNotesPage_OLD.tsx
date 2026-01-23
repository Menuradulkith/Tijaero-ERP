/**
 * ItemTransferNotesPage - Item Transfer Note Management
 * Allows creating and managing item transfers between locations
 * Following GRN page patterns for consistency
 */

import { useMemo, useCallback, useState, useEffect } from "react";
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
  Card,
  CardContent,
  Alert,
} from "@mui/material";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import SaveIcon from "@mui/icons-material/Save";
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
  useMasterDetailState,
  SortOption,
  modernTableStyles,
  getStatusProps,
} from "@/components/tijaero";

import { transferNotesApi, transferNoteItemsApi } from "@/modules/warehouse/api";
import { locationsApi } from "@/modules/common/api";
import { branchApi } from "@/modules/branches/api";
import { productsApi, salesStockApi } from "@/modules/inventory/api";
import { SalesStock } from "@/modules/inventory/types";
import { 
  ItemTransferNote, 
  ItemTransferNoteCreate,
  ItemTransferNoteItem,
  ItemTransferNoteItemCreate,
  ItemTransferNoteWithItems,
} from "@/modules/warehouse/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date" },
  { value: "item_transfer_note", label: "ITN Number" },
];

const FORM_STEPS = ["Transfer Information", "Select Items"];

const generateITNNo = () => `ITN-${Date.now().toString(36).toUpperCase()}`;

const INITIAL_FORM_DATA: ItemTransferNoteCreate = {
  item_transfer_note: "",
  created_date: new Date().toISOString().split("T")[0],
  remark: "",
  branch_code: "HQ",
  from_location_id: 0,
  to_location_id: 0,
};

interface ITNLineItem extends Partial<ItemTransferNoteItemCreate> {
  _id: string;
  id?: number;
  product_name?: string;
  product_id: number;
  barcode?: string;
  scanned?: boolean;
  barcodeError?: string;
  sales_stock_id?: number;
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
  if ('approved_records' in itn && itn.approved_records && itn.approved_records.length > 0) {
    const latestApproval = itn.approved_records[itn.approved_records.length - 1];
    switch (latestApproval.approved_status) {
      case 1: return "approved";
      case 2: return "rejected";
      default: return "pending";
    }
  }
  return itn.status || "pending";
};

export default function ItemTransferNotesPage() {
  const queryClient = useQueryClient();
  const [lineItems, setLineItems] = useState<ITNLineItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [formStep, setFormStep] = useState(0);
  
  // Confirm dialog for unsaved changes
  const confirmDialog = useConfirmDialog();
  
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

  // Fetch branches
  const { data: branchesData } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(1, 100),
  });
  const branches = branchesData?.items || [];

  // Fetch products
  const { data: productsData } = useQuery({
    queryKey: ["products"],
    queryFn: () => productsApi.getAll(0, 1000),
  });
  const products = productsData || [];

  // Fetch available sales stock from the selected "from" location
  const { data: availableStockData, refetch: refetchStock } = useQuery({
    queryKey: ["salesStock", formData.from_location_id, formData.branch_code],
    queryFn: async () => {
      const result = await salesStockApi.getAll({ 
        branch_code: formData.branch_code,
      });
      // Filter to only show available items from the source location
      return result.filter((stock: SalesStock) => 
        stock.status === "available" && 
        (stock as any).location_name === locations.find(l => l.id === formData.from_location_id)?.name
      );
    },
    enabled: !!formData.from_location_id && !!formData.branch_code,
  });
  const availableStock = availableStockData || [];

  const handleNewITN = useCallback(() => {
    handleNewITNBase();
    setFormData(prev => ({
      ...prev,
      item_transfer_note: generateITNNo(),
    }));
    setLineItems([]);
    setFormStep(0);
    setTouched({});
  }, [handleNewITNBase, setFormData]);

  // Load ITN items when selecting an ITN
  const loadITNItems = useCallback(async (itnId: number) => {
    setLoadingItems(true);
    try {
      const items = await transferNoteItemsApi.getAll(itnId);
      setLineItems(items.map((item: ItemTransferNoteItem) => ({
        ...item,
        _id: `existing-${item.id}`,
        product_name: item.product_name || products.find(p => p.id === item.product_id)?.name,
      })));
    } catch (error) {
      console.error("Failed to load ITN items:", error);
      setLineItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, [products]);

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
    setFormStep(0);
  }, [handleStartEditBase]);

  const handleCancel = useCallback((items: ItemTransferNote[]) => {
    handleCancelBase(items);
    setLineItems([]);
    setFormStep(0);
    setTouched({});
  }, [handleCancelBase]);

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
      // Validate items
      if (lineItems.length === 0) {
        throw new Error("No items selected for transfer");
      }
      
      // Check for any barcode errors
      const itemsWithErrors = lineItems.filter(item => item.barcodeError && item.barcodeError !== "Checking...");
      if (itemsWithErrors.length > 0) {
        throw new Error(`Cannot save: ${itemsWithErrors.length} item(s) have errors`);
      }
      
      // Create the ITN
      const newITN = await transferNotesApi.create(data);
      
      // Create ITN items
      for (const item of lineItems) {
        await transferNoteItemsApi.create({
          product_id: item.product_id,
          barcode: item.barcode || "",
          branch_code: data.branch_code,
          remark: item.remark,
          item_recieved: false,
          itemtransfernote_id: newITN.id,
        });
        
        // Update sales stock status to "transferred" if we have the sales_stock_id
        if (item.sales_stock_id) {
          try {
            await salesStockApi.updateStatus(item.sales_stock_id, "transferred");
          } catch (error) {
            console.error("Failed to update stock status:", error);
          }
        }
      }
      
      return { itn: newITN, itemCount: lineItems.length };
    },
    onSuccess: ({ itn: newITN, itemCount }) => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      queryClient.invalidateQueries({ queryKey: ["salesStock"] });
      toast.success(`Transfer note created with ${itemCount} items!`);
      setIsCreating(false);
      setIsEditing(false);
      setLineItems([]);
      setTimeout(() => handleSelectITNWithItems(newITN), 0);
    },
    onError: (error: any) => {
      const errorDetail = error.response?.data?.detail || error.message || "Failed to create transfer note";
      toast.error(errorDetail);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => transferNotesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-notes"] });
      toast.success("Transfer note deleted");
      handleCancel(filteredITNs);
    },
    onError: () => toast.error("Failed to delete transfer note"),
  });

  const handleDelete = async () => {
    if (!selectedITN) return;
    const confirmed = await confirmDialog.confirm({
      title: "Delete Transfer Note",
      message: `Are you sure you want to delete ${selectedITN.item_transfer_note}?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmColor: "error",
    });
    if (confirmed) {
      deleteMutation.mutate(selectedITN.id);
    }
  };

  // Add item from available stock
  const handleAddItemFromStock = (stock: SalesStock) => {
    // Check if already added
    if (lineItems.some(item => item.barcode === stock.barcode)) {
      toast.error("This item is already added to the transfer list");
      return;
    }
    
    const product = products.find(p => p.id === stock.product_id);
    const newItem: ITNLineItem = {
      _id: `new-${Date.now()}-${Math.random()}`,
      product_id: stock.product_id,
      product_name: product?.name || `Product #${stock.product_id}`,
      barcode: stock.barcode,
      scanned: true,
      sales_stock_id: stock.id,
    };
    
    setLineItems(prev => [...prev, newItem]);
    toast.success(`Added ${product?.name || "item"} to transfer list`);
  };

  // Remove item
  const handleRemoveItem = (itemId: string) => {
    setLineItems(prev => prev.filter(item => item._id !== itemId));
  };

  // Validate form for step navigation
  const validateStep = (step: number): boolean => {
    if (step === 0) {
      return !!(
        formData.item_transfer_note &&
        formData.from_location_id &&
        formData.to_location_id &&
        formData.from_location_id !== formData.to_location_id &&
        formData.branch_code
      );
    }
    return true;
  };

  // Handle form submit
  const handleSave = () => {
    if (!validateStep(0)) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (lineItems.length === 0) {
      toast.error("Please add at least one item to transfer");
      return;
    }
    createMutation.mutate(formData);
  };

  // Location lookup
  const getLocationName = (locationId: number): string => {
    return locations.find(l => l.id === locationId)?.name || `Location #${locationId}`;
  };

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
                </Box>
                {isSelected && (
                  <>
                    <Typography variant="caption" color="text.secondary">
                      From: {getLocationName(itn.from_location_id)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      To: {getLocationName(itn.to_location_id)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(itn.created_date).toLocaleDateString()}
                    </Typography>
                    <Box sx={{ mt: 0.5 }}>
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
                ? `${getLocationName(itn.from_location_id)} → ${getLocationName(itn.to_location_id)}`
                : undefined
            }
            statusChip={!isSelected ? statusProps : undefined}
          />
        );
      }}
    />
  );

  // Filtered available stock (excluding already selected items)
  const filteredAvailableStock = useMemo(() => {
    const selectedBarcodes = new Set(lineItems.map(item => item.barcode));
    return availableStock.filter((stock: SalesStock) => !selectedBarcodes.has(stock.barcode));
  }, [availableStock, lineItems]);

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Warehouse" },
          { label: "Item Transfer Notes", href: "/warehouse/transfer-notes" },
          ...(selectedITN && !isCreating ? [{ label: selectedITN.item_transfer_note }] : []),
          ...(isCreating ? [{ label: "New Transfer Note" }] : []),
        ]}
        title={isCreating ? "New Item Transfer Note" : (selectedITN?.item_transfer_note || "")}
        titleIcon={<SwapHorizIcon color="primary" />}
        noSelectionTitle="Select a Transfer Note"
        chips={
          selectedITN && !isCreating
            ? (() => {
                const status = getITNStatus(selectedITN);
                const s = getStatusProps(status, "orderStatus");
                return [{ label: s.label, color: s.color }];
              })()
            : isCreating
            ? [{ label: "Creating", color: "warning" as const }]
            : []
        }
      />

      {/* Action Toolbar */}
      {!isCreating && !isEditing && selectedITN && (
        <ActionToolbar
          isCreating={isCreating}
          isEditing={isEditing}
          onNew={handleNewITN}
          onEdit={handleStartEdit}
          onDelete={handleDelete}
          hasSelectedItem={!!selectedITN}
          canUpdate={getITNStatus(selectedITN) === "pending"}
          canDelete={getITNStatus(selectedITN) === "pending"}
        />
      )}

      {/* Form Stepper (for create/edit mode) */}
      {(isCreating || isEditing) && (
        <Box sx={{ px: 2, pt: 1.5, pb: 1, borderBottom: 1, borderColor: "divider" }}>
          <Stepper activeStep={formStep} alternativeLabel>
            {FORM_STEPS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedITN && !isCreating ? (
          <EmptyState
            message="Select a transfer note from the list or create a new one"
            action={{
              label: "Create New Transfer Note",
              onClick: handleNewITN
            }}
          />
        ) : isCreating || isEditing ? (
          // Create/Edit Form
          <>
            {formStep === 0 && (
              <FormSection title="Transfer Information" columns={2}>
                <TextField
                  label="ITN Number"
                  size="small"
                  value={formData.item_transfer_note}
                  onChange={(e) => setFormData(prev => ({ ...prev, item_transfer_note: e.target.value }))}
                  onBlur={() => handleBlur("item_transfer_note")}
                  error={touched.item_transfer_note && !formData.item_transfer_note}
                  helperText={touched.item_transfer_note && !formData.item_transfer_note ? "Required" : ""}
                  required
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Transfer Date"
                  type="date"
                  size="small"
                  value={formData.created_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, created_date: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                  required
                />
                <TextField
                  select
                  label="Branch"
                  size="small"
                  value={formData.branch_code}
                  onChange={(e) => setFormData(prev => ({ ...prev, branch_code: e.target.value }))}
                  required
                >
                  {branches.map((branch: any) => (
                    <MenuItem key={branch.branch_code} value={branch.branch_code}>
                      {branch.branch_name}
                    </MenuItem>
                  ))}
                </TextField>
                <Box /> {/* Spacer */}
                <TextField
                  select
                  label="From Location"
                  size="small"
                  value={formData.from_location_id || ""}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, from_location_id: Number(e.target.value) }));
                    setLineItems([]); // Clear items when location changes
                  }}
                  onBlur={() => handleBlur("from_location_id")}
                  error={touched.from_location_id && !formData.from_location_id}
                  helperText={touched.from_location_id && !formData.from_location_id ? "Required" : ""}
                  required
                >
                  {locations
                    .filter(loc => loc.branch_code === formData.branch_code)
                    .map((loc) => (
                      <MenuItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </MenuItem>
                    ))}
                </TextField>
                <TextField
                  select
                  label="To Location"
                  size="small"
                  value={formData.to_location_id || ""}
                  onChange={(e) => setFormData(prev => ({ ...prev, to_location_id: Number(e.target.value) }))}
                  onBlur={() => handleBlur("to_location_id")}
                  error={
                    (touched.to_location_id && !formData.to_location_id) ||
                    (formData.from_location_id === formData.to_location_id && formData.to_location_id !== 0)
                  }
                  helperText={
                    touched.to_location_id && !formData.to_location_id
                      ? "Required"
                      : formData.from_location_id === formData.to_location_id && formData.to_location_id !== 0
                      ? "Must be different from source"
                      : ""
                  }
                  required
                >
                  {locations
                    .filter(loc => loc.id !== formData.from_location_id)
                    .map((loc) => (
                      <MenuItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </MenuItem>
                    ))}
                </TextField>
                <Box sx={{ gridColumn: "span 2" }}>
                  <TextField
                    label="Remarks"
                    size="small"
                    fullWidth
                    multiline
                    rows={2}
                    value={formData.remark}
                    onChange={(e) => setFormData(prev => ({ ...prev, remark: e.target.value }))}
                  />
                </Box>
              </FormSection>
            )}

            {formStep === 1 && (
              <>
                {/* Summary */}
                <Card variant="outlined" sx={{ mb: 2 }}>
                  <CardContent sx={{ py: 1.5 }}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      Transfer Summary
                    </Typography>
                    <Box sx={{ display: "flex", gap: 4 }}>
                      <Box>
                        <Typography variant="body2" color="text.secondary">From</Typography>
                        <Typography variant="body1" fontWeight={500}>
                          {getLocationName(formData.from_location_id)}
                        </Typography>
                      </Box>
                      <Box sx={{ display: "flex", alignItems: "center" }}>
                        <SwapHorizIcon color="action" />
                      </Box>
                      <Box>
                        <Typography variant="body2" color="text.secondary">To</Typography>
                        <Typography variant="body1" fontWeight={500}>
                          {getLocationName(formData.to_location_id)}
                        </Typography>
                      </Box>
                      <Box sx={{ ml: "auto" }}>
                        <Typography variant="body2" color="text.secondary">Items Selected</Typography>
                        <Typography variant="h6" fontWeight={600} color="primary">
                          {lineItems.length}
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>

                {/* Available Stock to Transfer */}
                <FormSection title="Available Items at Source Location" columns={1}>
                  {!formData.from_location_id ? (
                    <Alert severity="info">Select a source location first</Alert>
                  ) : filteredAvailableStock.length === 0 ? (
                    <Alert severity="info">No available items at this location</Alert>
                  ) : (
                    <Paper variant="outlined" sx={{ maxHeight: 250, overflow: "auto" }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow sx={modernTableStyles.headerRow}>
                            <TableCell>Product</TableCell>
                            <TableCell>Barcode</TableCell>
                            <TableCell>Item Code</TableCell>
                            <TableCell align="center">Action</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {filteredAvailableStock.map((stock: SalesStock) => {
                            const product = products.find(p => p.id === stock.product_id);
                            return (
                              <TableRow key={stock.id} sx={modernTableStyles.bodyRow}>
                                <TableCell>{product?.name || `Product #${stock.product_id}`}</TableCell>
                                <TableCell>{stock.barcode}</TableCell>
                                <TableCell>{product?.item_code || "-"}</TableCell>
                                <TableCell align="center">
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<AddIcon />}
                                    onClick={() => handleAddItemFromStock(stock)}
                                  >
                                    Add
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </Paper>
                  )}
                </FormSection>

                {/* Selected Items */}
                <FormSection title="Items to Transfer" columns={1}>
                  {lineItems.length === 0 ? (
                    <Alert severity="warning">No items selected. Add items from the available list above.</Alert>
                  ) : (
                    <Paper variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={modernTableStyles.headerRow}>
                            <TableCell>Product</TableCell>
                            <TableCell>Barcode</TableCell>
                            <TableCell>Remark</TableCell>
                            <TableCell align="center">Action</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {lineItems.map((item) => (
                            <TableRow key={item._id} sx={modernTableStyles.bodyRow}>
                              <TableCell>{item.product_name}</TableCell>
                              <TableCell>{item.barcode}</TableCell>
                              <TableCell>
                                <TextField
                                  size="small"
                                  value={item.remark || ""}
                                  onChange={(e) => {
                                    setLineItems(prev =>
                                      prev.map(i =>
                                        i._id === item._id ? { ...i, remark: e.target.value } : i
                                      )
                                    );
                                  }}
                                  placeholder="Optional remark"
                                  variant="standard"
                                  fullWidth
                                />
                              </TableCell>
                              <TableCell align="center">
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => handleRemoveItem(item._id)}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Paper>
                  )}
                </FormSection>
              </>
            )}

            {/* Navigation Buttons */}
            <Box sx={{ display: "flex", justifyContent: "space-between", mt: 2, pt: 2, borderTop: 1, borderColor: "divider" }}>
              <Button
                variant="outlined"
                onClick={() => handleCancel(filteredITNs)}
              >
                Cancel
              </Button>
              <Box sx={{ display: "flex", gap: 1 }}>
                {formStep > 0 && (
                  <Button
                    variant="outlined"
                    startIcon={<ArrowBackIcon />}
                    onClick={() => setFormStep(prev => prev - 1)}
                  >
                    Back
                  </Button>
                )}
                {formStep < FORM_STEPS.length - 1 ? (
                  <Button
                    variant="contained"
                    endIcon={<ArrowForwardIcon />}
                    onClick={() => {
                      if (validateStep(formStep)) {
                        setFormStep(prev => prev + 1);
                        refetchStock();
                      } else {
                        toast.error("Please fill in all required fields");
                      }
                    }}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<SaveIcon />}
                    onClick={handleSave}
                    disabled={createMutation.isPending || lineItems.length === 0}
                  >
                    {createMutation.isPending ? "Saving..." : "Create Transfer Note"}
                  </Button>
                )}
              </Box>
            </Box>
          </>
        ) : (
          // View Mode
          <>
            <FormSection title="Transfer Information" columns={2}>
              <TextField label="ITN Number" size="small" value={selectedITN?.item_transfer_note} disabled />
              <TextField
                label="Transfer Date"
                size="small"
                value={selectedITN?.created_date ? new Date(selectedITN.created_date).toLocaleDateString() : ""}
                disabled
              />
              <TextField label="Branch" size="small" value={selectedITN?.branch_code} disabled />
              <TextField
                label="Status"
                size="small"
                value={getITNStatus(selectedITN!)}
                disabled
              />
              <TextField
                label="From Location"
                size="small"
                value={getLocationName(selectedITN?.from_location_id || 0)}
                disabled
              />
              <TextField
                label="To Location"
                size="small"
                value={getLocationName(selectedITN?.to_location_id || 0)}
                disabled
              />
              <Box sx={{ gridColumn: "span 2" }}>
                <TextField
                  label="Remarks"
                  size="small"
                  fullWidth
                  multiline
                  rows={2}
                  value={selectedITN?.remark || "No remarks"}
                  disabled
                />
              </Box>
            </FormSection>

            <FormSection title="Transfer Items" columns={1}>
              {loadingItems ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                  <CircularProgress />
                </Box>
              ) : lineItems.length === 0 ? (
                <Alert severity="info">No items in this transfer note</Alert>
              ) : (
                <Paper variant="outlined">
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
                      {lineItems.map((item) => (
                        <TableRow key={item._id} sx={modernTableStyles.bodyRow}>
                          <TableCell>{item.product_name}</TableCell>
                          <TableCell>{item.barcode}</TableCell>
                          <TableCell>{item.remark || "-"}</TableCell>
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
              )}
            </FormSection>
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
      <ConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
