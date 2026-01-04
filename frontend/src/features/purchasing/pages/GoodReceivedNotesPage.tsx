/**
 * GoodReceivedNotesPage - Using Tijaero-style reusable components
 */

import { useMemo, useCallback, useState } from "react";
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
  Autocomplete,
  Button,
  Stepper,
  Step,
  StepLabel,
} from "@mui/material";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import toast from "react-hot-toast";

import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  useMasterDetailState,
  SortOption,
} from "@/components/tijaero";

import { goodReceivedNotesApi, goodReceivedItemsApi, purchaseOrdersApi } from "@/modules/purchasing/api";
import { locationsApi, Location } from "@/modules/common/api";
import { branchApi } from "@/modules/branches/api";
import { 
  GoodReceivedNote, 
  GoodReceivedNoteCreate, 
  GoodReceivedItemCreate,
  GoodReceivedItem,
  PurchasingOrder,
} from "@/modules/purchasing/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "good_received_date", label: "Date" },
  { value: "good_received_no", label: "GRN Number" },
];

const FORM_STEPS = ["GRN Information", "Received Items"];

const generateGRNNo = () => `GRN-${Date.now().toString(36).toUpperCase()}`;

const INITIAL_FORM_DATA: GoodReceivedNoteCreate = {
  good_received_no: "",
  good_received_date: new Date().toISOString().split("T")[0],
  supplier_invoice_no: "",
  supplier_invoice_date: new Date().toISOString().split("T")[0],
  remark: "",
  branch_code: "HQ",
  good_received_locations_id: 1,
  purchasingorders_id: 0,
};

interface GRNLineItem extends GoodReceivedItemCreate {
  _id: string;
  id?: number; // For existing items
  product_name?: string;
  quantity?: number;
  unit_price?: number;
}

const resetFormFromGRN = (grn: GoodReceivedNote): GoodReceivedNoteCreate => ({
  good_received_no: grn.good_received_no,
  good_received_date: grn.good_received_date?.split("T")[0] || "",
  supplier_invoice_no: grn.supplier_invoice_no,
  supplier_invoice_date: grn.supplier_invoice_date?.split("T")[0] || "",
  remark: grn.remark || "",
  branch_code: grn.branch_code,
  good_received_locations_id: grn.good_received_locations_id,
  purchasingorders_id: grn.purchasingorders_id,
});

export default function GoodReceivedNotesPage() {
  const queryClient = useQueryClient();
  const [lineItems, setLineItems] = useState<GRNLineItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [formStep, setFormStep] = useState(0);
  
  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedGRN,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectGRN,
    handleNew: handleNewGRNBase,
    handleCancel: handleCancelBase,
    handleStartEdit: handleStartEditBase,
  } = useMasterDetailState<GoodReceivedNote, GoodReceivedNoteCreate>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromGRN,
    favoritesKey: "grn_favorites",
    defaultSortField: "good_received_date",
  });

  // Fetch locations
  const { data: locations } = useQuery({
    queryKey: ["locations"],
    queryFn: () => locationsApi.getAll(),
  });

  // Fetch branches
  const { data: branchesData } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(1, 100),
  });

  const handleNewGRN = useCallback(() => {
    handleNewGRNBase();
    setFormData(prev => ({
      ...prev,
      good_received_no: generateGRNNo(),
    }));
    setLineItems([]);
    setFormStep(0);
  }, [handleNewGRNBase, setFormData]);

  // Load GRN items when selecting a GRN
  const loadGRNItems = useCallback(async (grnId: number) => {
    setLoadingItems(true);
    try {
      const items = await goodReceivedItemsApi.getByGRN(grnId);
      setLineItems(items.map((item: GoodReceivedItem) => ({
        ...item,
        _id: `existing-${item.id}`,
      })));
    } catch (error) {
      console.error("Failed to load GRN items:", error);
      setLineItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, []);

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
    setFormStep(0);
  }, [handleStartEditBase]);

  const handleCancel = useCallback((items: GoodReceivedNote[]) => {
    handleCancelBase(items);
    setLineItems([]);
    setFormStep(0);
  }, [handleCancelBase]);

  const handleSelectGRNWithItems = useCallback((grn: GoodReceivedNote) => {
    handleSelectGRN(grn);
    loadGRNItems(grn.id);
  }, [handleSelectGRN, loadGRNItems]);

  const { data: grns, isLoading, refetch } = useQuery({
    queryKey: ["goodReceivedNotes"],
    queryFn: () => goodReceivedNotesApi.getAll(),
  });

  const { data: purchaseOrders } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: () => purchaseOrdersApi.getAll(),
  });

  const filteredGRNs = useMemo(() => {
    if (!grns) return [];

    let filtered = grns.filter(
      (grn) =>
        grn.good_received_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(grn.id).includes(searchQuery)
    );

    // Apply branch filter
    if (filterBranch) {
      filtered = filtered.filter(grn => grn.branch_code === filterBranch);
    }

    filtered.sort((a, b) => {
      if (sortField === "good_received_date") {
        return new Date(b.good_received_date || "").getTime() - new Date(a.good_received_date || "").getTime();
      }
      const fieldA = a[sortField as keyof GoodReceivedNote] || "";
      const fieldB = b[sortField as keyof GoodReceivedNote] || "";
      return String(fieldA).localeCompare(String(fieldB));
    });

    return filtered;
  }, [grns, searchQuery, sortField, filterBranch]);

  const createMutation = useMutation({
    mutationFn: goodReceivedNotesApi.create,
    onSuccess: (newGRN) => {
      queryClient.invalidateQueries({ queryKey: ["goodReceivedNotes"] });
      toast.success("GRN created successfully");
      setIsCreating(false);
      setIsEditing(false);
      setTimeout(() => handleSelectGRNWithItems(newGRN), 0);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to create GRN");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<GoodReceivedNoteCreate> }) =>
      goodReceivedNotesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goodReceivedNotes"] });
      toast.success("GRN updated successfully");
      setIsEditing(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.detail || "Failed to update GRN");
    },
  });

  const handleAddLineItem = () => {
    const newItem: GRNLineItem = {
      _id: `new-${Date.now()}`,
      good_received_note: formData.good_received_no,
      barcode: "",
      branch_code: formData.branch_code,
      active: true,
      purchasing_order_items_id: 0,
    };
    setLineItems([...lineItems, newItem]);
  };

  const handleRemoveLineItem = (id: string) => {
    setLineItems(lineItems.filter(item => item._id !== id));
  };

  const handleUpdateLineItem = (id: string, field: keyof GRNLineItem, value: any) => {
    setLineItems(lineItems.map(item => 
      item._id === id ? { ...item, [field]: value } : item
    ));
  };

  const handleSave = useCallback(() => {
    if (isCreating) {
      createMutation.mutate(formData);
    } else if (selectedGRN) {
      updateMutation.mutate({ id: selectedGRN.id, data: formData });
    }
  }, [isCreating, selectedGRN, formData, createMutation, updateMutation]);

  const getOrderNumber = (orderId: number) => {
    const order = purchaseOrders?.find((o: PurchasingOrder) => o.id === orderId);
    return order ? order.purchasing_order_no : "Unknown";
  };

  const getLocationName = (locationId: number) => {
    const location = locations?.find((l: Location) => l.id === locationId);
    return location ? location.name : `Location ${locationId}`;
  };

  const getBranchDisplay = (branchCode: string) => {
    const branch = branchesData?.items?.find((b) => b.branch_code === branchCode);
    return branch ? `${branch.branch_code} - ${branch.branch_name}` : branchCode;
  };

  const handlePOChange = (poId: number) => {
    const selectedPO = purchaseOrders?.find((o: PurchasingOrder) => o.id === poId);
    if (selectedPO) {
      setFormData({ 
        ...formData, 
        purchasingorders_id: poId,
        branch_code: selectedPO.branch_code 
      });
    } else {
      setFormData({ ...formData, purchasingorders_id: poId });
    }
  };

  const poIdsWithGrn = useMemo(() => {
    const ids = new Set<number>();
    (grns || []).forEach((g) => {
      if (g.purchasingorders_id) ids.add(g.purchasingorders_id);
    });
    return ids;
  }, [grns]);

  const branches = branchesData?.items || [];

  // Step 1 validation: GRN Information, Supplier Invoice, Remarks
  const isStep1Valid = formData.good_received_no && 
    formData.purchasingorders_id > 0 && 
    formData.supplier_invoice_no;

  // Full form validation
  const isFormValid = isStep1Valid;

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

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const masterPanel = (
    <SearchableList<GoodReceivedNote>
      items={filteredGRNs}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search GRNs..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedGRN}
      onSelectItem={handleSelectGRNWithItems}
      emptyMessage="No GRNs found"
      listHeader={
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
            value={branches.find(b => b.branch_code === filterBranch) || null}
            onChange={(_, newValue) => setFilterBranch(newValue?.branch_code || null)}
            renderInput={(params) => (
              <TextField {...params} placeholder="Filter by Branch" size="small" />
            )}
          />
        </Box>
      }
      renderItem={(grn, isSelected) => (
        <SelectableListItem
          key={grn.id}
          id={grn.id}
          isSelected={isSelected}
          onClick={() => handleSelectGRNWithItems(grn)}
          primaryText={grn.good_received_no || `GRN-${grn.id}`}
          secondaryText={`PO: ${getOrderNumber(grn.purchasingorders_id)} • ${getLocationName(grn.good_received_locations_id)} • ${new Date(grn.good_received_date || "").toLocaleDateString()}`}
          isFavorite={favorites.includes(grn.id)}
          onToggleFavorite={(e) => toggleFavorite(grn.id, e)}
          statusChip={{ label: "Received", color: "success" }}
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Good Received Notes", href: "#" },
          ...(selectedGRN || isCreating
            ? [{ label: isCreating ? "New GRN" : selectedGRN?.good_received_no || `GRN-${selectedGRN?.id}` }]
            : []),
        ]}
        title={selectedGRN ? (selectedGRN.good_received_no || `GRN-${selectedGRN.id}`) : ""}
        titleIcon={<ReceiptLongIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Good Received Note"
        noSelectionTitle="Select a GRN"
        isFavorite={selectedGRN ? favorites.includes(selectedGRN.id) : false}
        onToggleFavorite={selectedGRN ? (e) => toggleFavorite(selectedGRN.id, e) : undefined}
      />

      <ActionToolbar
        hasSelectedItem={!!selectedGRN}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={handleNewGRN}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredGRNs)}
        onEdit={handleStartEdit}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {!selectedGRN && !isCreating ? (
          <EmptyState message="Select a GRN from the list or create a new one" />
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

            {/* Step 1: GRN Information, Supplier Invoice, Remarks (always show in view/edit mode) */}
            {(formStep === 0 || !isCreating) && (
              <>
                <FormSection title="GRN Information" columns={3}>
                  <TextField
                    label="GRN Number"
                    size="small"
                    value={formData.good_received_no}
                    onChange={(e) => setFormData({ ...formData, good_received_no: e.target.value })}
                    disabled={!isEditing && !isCreating}
                    required
                  />
                  <TextField
                    select
                    label="Purchase Order (Approved Only)"
                    size="small"
                value={formData.purchasingorders_id}
                onChange={(e) => handlePOChange(parseInt(e.target.value))}
                disabled={!isEditing && !isCreating}
                required
              >
                <MenuItem value={0}>Select Order</MenuItem>
                {purchaseOrders
                  ?.filter((order: PurchasingOrder) => {
                    if (order.status !== "approved") return false;
                    const isCurrent = order.id === formData.purchasingorders_id;
                    return isCurrent || !poIdsWithGrn.has(order.id);
                  })
                  .map((order: PurchasingOrder) => (
                    <MenuItem key={order.id} value={order.id}>
                      {order.purchasing_order_no}
                    </MenuItem>
                  ))}
              </TextField>
              <TextField
                label="GRN Date"
                size="small"
                type="date"
                value={formData.good_received_date}
                onChange={(e) => setFormData({ ...formData, good_received_date: e.target.value })}
                disabled={!isEditing && !isCreating}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Branch"
                size="small"
                value={getBranchDisplay(formData.branch_code)}
                disabled
                helperText="Auto-filled from Purchase Order"
              />
              <TextField
                select
                label="Location"
                size="small"
                value={formData.good_received_locations_id}
                onChange={(e) => setFormData({ ...formData, good_received_locations_id: parseInt(e.target.value) || 1 })}
                disabled={!isEditing && !isCreating}
                required
              >
                {locations?.map((location: Location) => (
                  <MenuItem key={location.id} value={location.id}>
                    {location.name}
                  </MenuItem>
                ))}
                {(!locations || locations.length === 0) && (
                  <MenuItem value={1}>Default Location</MenuItem>
                )}
              </TextField>
            </FormSection>

            <FormSection title="Supplier Invoice" columns={2}>
              <TextField
                label="Supplier Invoice No"
                size="small"
                value={formData.supplier_invoice_no}
                onChange={(e) => setFormData({ ...formData, supplier_invoice_no: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
              <TextField
                label="Supplier Invoice Date"
                size="small"
                type="date"
                value={formData.supplier_invoice_date}
                onChange={(e) => setFormData({ ...formData, supplier_invoice_date: e.target.value })}
                disabled={!isEditing && !isCreating}
                InputLabelProps={{ shrink: true }}
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
                      onClick={() => handleCancel(filteredGRNs)}
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

            {/* Step 2: Received Items (always show in view/edit mode, step 2 in create mode) */}
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
                    Back to GRN Information
                  </Button>
                )}

                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, mt: isCreating ? 0 : 2 }}>
                  <Typography variant="subtitle1" fontWeight="bold">
                    Received Items
                    {loadingItems && <CircularProgress size={16} sx={{ ml: 1 }} />}
                  </Typography>
                  {(isEditing || isCreating) && (
                    <IconButton size="small" onClick={handleAddLineItem} color="primary">
                      <AddIcon />
                    </IconButton>
                  )}
                </Box>
            <Box>
              <Paper variant="outlined" sx={{ overflow: "hidden" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: "action.hover" }}>
                      <TableCell>Barcode</TableCell>
                      <TableCell>PO Item ID</TableCell>
                      <TableCell>Branch</TableCell>
                      <TableCell align="center">Active</TableCell>
                      {(isEditing || isCreating) && <TableCell sx={{ width: 50 }} />}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loadingItems ? (
                      <TableRow>
                        <TableCell colSpan={isEditing || isCreating ? 5 : 4} align="center">
                          <CircularProgress size={24} sx={{ my: 2 }} />
                        </TableCell>
                      </TableRow>
                    ) : lineItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isEditing || isCreating ? 5 : 4} align="center">
                          <Typography variant="body2" color="text.secondary" py={2}>
                            No items added yet
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      lineItems.map((item) => (
                        <TableRow key={item._id}>
                          <TableCell>
                            {(isEditing || isCreating) ? (
                              <TextField
                                size="small"
                                fullWidth
                                value={item.barcode}
                                onChange={(e) => handleUpdateLineItem(item._id, "barcode", e.target.value)}
                                placeholder="Barcode"
                              />
                            ) : (
                              item.barcode
                            )}
                          </TableCell>
                          <TableCell>
                            {(isEditing || isCreating) ? (
                              <TextField
                                size="small"
                                type="number"
                                value={item.purchasing_order_items_id}
                                onChange={(e) => handleUpdateLineItem(item._id, "purchasing_order_items_id", parseInt(e.target.value) || 0)}
                                sx={{ width: 100 }}
                              />
                            ) : (
                              item.purchasing_order_items_id
                            )}
                          </TableCell>
                          <TableCell>
                            {item.branch_code}
                          </TableCell>
                          <TableCell align="center">
                            {item.active ? "Yes" : "No"}
                          </TableCell>
                          {(isEditing || isCreating) && (
                            <TableCell>
                              <IconButton size="small" onClick={() => handleRemoveLineItem(item._id)} color="error">
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
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
        title="Good Received Notes"
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
    </>
  );
}
