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
} from "@mui/material";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
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

import { goodReceivedNotesApi, purchaseOrdersApi } from "@/modules/purchasing/api";
import { 
  GoodReceivedNote, 
  GoodReceivedNoteCreate, 
  GoodReceivedItemCreate,
  PurchasingOrder,
} from "@/modules/purchasing/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "good_received_date", label: "Date" },
  { value: "good_received_no", label: "GRN Number" },
];

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

  const handleNewGRN = useCallback(() => {
    handleNewGRNBase();
    setFormData(prev => ({
      ...prev,
      good_received_no: generateGRNNo(),
    }));
    setLineItems([]);
  }, [handleNewGRNBase, setFormData]);

  const handleStartEdit = useCallback(() => {
    handleStartEditBase();
    // Fetch items for the selected GRN
    if (selectedGRN) {
      // Items would be fetched separately
      setLineItems([]);
    }
  }, [handleStartEditBase, selectedGRN]);

  const handleCancel = useCallback((items: GoodReceivedNote[]) => {
    handleCancelBase(items);
    setLineItems([]);
  }, [handleCancelBase]);

  const handleSelectGRNWithItems = useCallback((grn: GoodReceivedNote) => {
    handleSelectGRN(grn);
    setLineItems([]);
  }, [handleSelectGRN]);

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

    filtered.sort((a, b) => {
      if (sortField === "good_received_date") {
        return new Date(b.good_received_date || "").getTime() - new Date(a.good_received_date || "").getTime();
      }
      const fieldA = a[sortField as keyof GoodReceivedNote] || "";
      const fieldB = b[sortField as keyof GoodReceivedNote] || "";
      return String(fieldA).localeCompare(String(fieldB));
    });

    return filtered;
  }, [grns, searchQuery, sortField]);

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

  const confirmDialog = useConfirmDialog();

  const handleDelete = useCallback(async () => {
    if (selectedGRN) {
      const confirmed = await confirmDialog.confirm({
        title: "Delete GRN",
        message: `Are you sure you want to delete GRN "${selectedGRN.good_received_no || selectedGRN.id}"?`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        toast.error("Delete operation not supported for GRNs");
      }
    }
  }, [selectedGRN, confirmDialog]);

  const handleDuplicate = useCallback(() => {
    if (selectedGRN) {
      const newFormData = {
        ...resetFormFromGRN(selectedGRN),
        good_received_no: generateGRNNo(),
        good_received_date: new Date().toISOString().split("T")[0],
      };
      setFormData(newFormData);
      handleNewGRNBase();
    }
  }, [selectedGRN, setFormData, handleNewGRNBase]);

  const getOrderNumber = (orderId: number) => {
    const order = purchaseOrders?.find((o: PurchasingOrder) => o.id === orderId);
    return order ? order.purchasing_order_no : "Unknown";
  };

  const isFormValid = formData.good_received_no && formData.purchasingorders_id > 0;
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
      renderItem={(grn, isSelected) => (
        <SelectableListItem
          key={grn.id}
          id={grn.id}
          isSelected={isSelected}
          onClick={() => handleSelectGRNWithItems(grn)}
          primaryText={grn.good_received_no || `GRN-${grn.id}`}
          secondaryText={`PO: ${getOrderNumber(grn.purchasingorders_id)} - ${new Date(grn.good_received_date || "").toLocaleDateString()}`}
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
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredGRNs)}
        onEdit={handleStartEdit}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {!selectedGRN && !isCreating ? (
          <EmptyState message="Select a GRN from the list or create a new one" />
        ) : (
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
                label="GRN Date"
                size="small"
                type="date"
                value={formData.good_received_date}
                onChange={(e) => setFormData({ ...formData, good_received_date: e.target.value })}
                disabled={!isEditing && !isCreating}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Branch Code"
                size="small"
                value={formData.branch_code}
                onChange={(e) => setFormData({ ...formData, branch_code: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
              <TextField
                select
                label="Purchase Order"
                size="small"
                value={formData.purchasingorders_id}
                onChange={(e) => setFormData({ ...formData, purchasingorders_id: parseInt(e.target.value) })}
                disabled={!isEditing && !isCreating}
                required
              >
                <MenuItem value={0}>Select Order</MenuItem>
                {purchaseOrders?.map((order: PurchasingOrder) => (
                  <MenuItem key={order.id} value={order.id}>
                    {order.purchasing_order_no}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Location ID"
                size="small"
                type="number"
                value={formData.good_received_locations_id}
                onChange={(e) => setFormData({ ...formData, good_received_locations_id: parseInt(e.target.value) || 1 })}
                disabled={!isEditing && !isCreating}
              />
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

            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, mt: 2 }}>
              <Typography variant="subtitle1" fontWeight="bold">Received Items</Typography>
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
      <ConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
