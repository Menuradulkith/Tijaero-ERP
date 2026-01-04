/**
 * PurchaseReturnsPage - Using Tijaero-style reusable components
 */

import { useMemo, useCallback, useState } from "react";
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
} from "@mui/material";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import toast from "react-hot-toast";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";

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
  })) : [],
});

export default function PurchaseReturnsPage() {
  const queryClient = useQueryClient();
  const [lineItems, setLineItems] = useState<ReturnLineItem[]>([]);
  const [formStep, setFormStep] = useState(0);
  
  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

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
  });

  const handleNewReturn = useCallback(() => {
    handleNewReturnBase();
    setFormData(prev => ({
      ...prev,
      purchasing_return_no: generateReturnNo(),
    }));
    setLineItems([]);
    setFormStep(0);
  }, [handleNewReturnBase, setFormData]);

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
    setFormStep(0);
    // @ts-ignore
    if (selectedReturn?.items) {
      // @ts-ignore
      setLineItems(selectedReturn.items.map((item: any, idx: number) => ({
        _id: `existing-${idx}`,
        product_id: item.product_id,
        purchasing_price: item.purchasing_price,
        return_price: item.return_price,
        barcode: item.barcode,
      })));
    }
  }, [handleStartEditBase, selectedReturn]);

  const handleCancel = useCallback((items: PurchasingReturn[]) => {
    handleCancelBase(items);
    setLineItems([]);
    setFormStep(0);
  }, [handleCancelBase]);

  const handleSelectReturnWithItems = useCallback((ret: PurchasingReturn) => {
    handleSelectReturn(ret);
    // Fetch detailed return with items
    purchaseReturnsApi.getById(ret.id).then((detailedReturn) => {
      if (detailedReturn.items) {
        setLineItems(detailedReturn.items.map((item, idx) => ({
          _id: `existing-${idx}`,
          product_id: item.product_id,
          purchasing_price: item.purchasing_price,
          return_price: item.return_price,
          barcode: item.barcode,
        })));
      } else {
        setLineItems([]);
      }
    }).catch(() => {
      setLineItems([]);
    });
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

    filtered.sort((a, b) => {
      if (sortField === "added_date") {
        return new Date(b.added_date || "").getTime() - new Date(a.added_date || "").getTime();
      }
      const fieldA = a[sortField as keyof PurchasingReturn] || "";
      const fieldB = b[sortField as keyof PurchasingReturn] || "";
      return String(fieldA).localeCompare(String(fieldB));
    });

    return filtered;
  }, [returns, searchQuery, sortField, filterBranch]);

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
    setLineItems(lineItems.filter(item => item._id !== id));
  };

  const handleUpdateLineItem = (id: string, field: keyof ReturnLineItem, value: any) => {
    setLineItems(lineItems.map(item => 
      item._id === id ? { ...item, [field]: value } : item
    ));
  };

  const handleSave = useCallback(() => {
    const dataToSave: PurchasingReturnCreate = {
      ...formData,
      items: lineItems.map(({ _id, ...item }) => item),
    };

    if (isCreating) {
      createMutation.mutate(dataToSave);
    }
    // Note: Update not supported by current API
  }, [isCreating, formData, lineItems, createMutation]);

  const confirmDialog = useConfirmDialog();

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

  const getGRNNumber = (grnId: number) => {
    const grn = grns?.find((g: GoodReceivedNote) => g.id === grnId);
    return grn ? grn.good_received_no : "Unknown";
  };

  const calculateTotal = () => {
    return lineItems.reduce((sum, item) => sum + item.return_price, 0);
  };

  const getBranchDisplay = (branchCode: string) => {
    const branch = branches.find((b) => b.branch_code === branchCode);
    return branch ? `${branch.branch_code} - ${branch.branch_name}` : branchCode;
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
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Autocomplete
            size="small"
            options={branches}
            getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
            value={branches.find(b => b.branch_code === filterBranch) || null}
            onChange={(_, newValue) => setFilterBranch(newValue?.branch_code || null)}
            renderInput={(params) => (
              <TextField {...params} label="Filter by Branch" placeholder="All Branches" />
            )}
          />
        </Box>
      }
      renderItem={(ret, isSelected) => (
        <SelectableListItem
          key={ret.id}
          id={ret.id}
          isSelected={isSelected}
          onClick={() => handleSelectReturnWithItems(ret)}
          primaryText={ret.purchasing_return_no || `RET-${ret.id}`}
          secondaryText={`GRN: ${getGRNNumber(ret.goodreceivednote_id)} • ${getBranchDisplay(ret.branch_code)} • ${new Date(ret.added_date || "").toLocaleDateString()}`}
          isFavorite={favorites.includes(ret.id)}
          onToggleFavorite={(e) => toggleFavorite(ret.id, e)}
          statusChip={{ label: "Returned", color: "warning" }}
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchase Returns", href: "#" },
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
        onNew={handleNewReturn}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredReturns)}
        onEdit={handleStartEdit}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
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
                    disabled={!isEditing && !isCreating}
                    required
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
                    }}
                    disabled={!isEditing && !isCreating}
                    renderInput={(params) => (
                      <TextField {...params} label="Good Received Note" required />
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

                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, mt: isCreating ? 0 : 2 }}>
                  <Typography variant="subtitle1" fontWeight="bold">Return Items</Typography>
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
                      <TableCell>Product ID</TableCell>
                      <TableCell align="right" sx={{ width: 120 }}>Purchase Price</TableCell>
                      <TableCell align="right" sx={{ width: 120 }}>Return Price</TableCell>
                      {(isEditing || isCreating) && <TableCell sx={{ width: 50 }} />}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lineItems.length === 0 ? (
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
                                value={item.product_id}
                                onChange={(e) => handleUpdateLineItem(item._id, "product_id", parseInt(e.target.value) || 0)}
                                sx={{ width: 100 }}
                              />
                            ) : (
                              item.product_id
                            )}
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
                              Number(item.purchasing_price).toFixed(2)
                            )}
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
                              Number(item.return_price).toFixed(2)
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
                      ))
                    )}
                    <TableRow sx={{ bgcolor: "action.hover" }}>
                      <TableCell colSpan={isEditing || isCreating ? 3 : 3} align="right">
                        <Typography fontWeight="bold">Total Return:</Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="bold">{calculateTotal().toFixed(2)}</Typography>
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
