/**
 * PurchaseInvoicesPage - Using Tijaero-style reusable components
 * Similar layout to PurchaseOrdersPage with MasterDetailLayout
 */

import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  MasterDetailLayout,
  modernTableStyles,
  SearchableList,
  SelectableListItem,
  showErrorToast,
  showSuccessToast,
  SortOption,
  TBranchFilter,
  TConfirmDialog,
  TFilterPanel,
  TStatusChip,
  TSupplierFilter,
  useCrudMutation,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";

import { useReferenceData } from "@/hooks";
import { useLocation } from "react-router-dom";
import { suppliersApi, purchaseOrdersApi } from "@/modules/purchasing/api";
import {
  purchaseInvoicesApi,
  PurchaseInvoice,
  PurchaseInvoiceCreate,
  PurchaseInvoiceListItem,
  GRNInvoiceableItem,
} from "@/modules/purchasing/purchaseInvoiceApi";
import { Supplier } from "@/modules/purchasing/types";
import { useAuthStore } from "@/state/authStore";
import { hasPermission } from "@/auth/permissions";

const SORT_OPTIONS: SortOption[] = [
  { value: "created_at", label: "Date" },
  { value: "invoice_no", label: "Invoice Number" },
];

interface InvoiceFormData {
  supplier_invoice_no: string;
  supplier_invoice_date: string;
  supplier_id: number;
  branch_code: string;
  payment_type: string;
  remarks: string;
}

const INITIAL_FORM_DATA: InvoiceFormData = {
  supplier_invoice_no: "",
  supplier_invoice_date: new Date().toISOString().split("T")[0],
  supplier_id: 0,
  branch_code: "",
  payment_type: "non_credit",
  remarks: "",
};

const resetFormFromInvoice = (invoice: PurchaseInvoiceListItem): InvoiceFormData => ({
  supplier_invoice_no: invoice.supplier_invoice_no || "",
  supplier_invoice_date: invoice.supplier_invoice_date?.split("T")[0] || "",
  supplier_id: invoice.supplier_id,
  branch_code: invoice.branch_code,
  payment_type: invoice.payment_type || "non_credit",
  remarks: "",
});

export default function PurchaseInvoicesPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const navigationState = location.state as { supplier_id?: number; branch_code?: string; grn_id?: number } | null;

  const [selectedGRNs, setSelectedGRNs] = useState<GRNInvoiceableItem[]>([]);
  const [invoiceableGRNs, setInvoiceableGRNs] = useState<GRNInvoiceableItem[]>([]);
  const [loadingGRNs, setLoadingGRNs] = useState(false);
  const [detailedInvoice, setDetailedInvoice] = useState<PurchaseInvoice | null>(null);

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterSupplier, setFilterSupplier] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [filterPaymentType, setFilterPaymentType] = useState<string | null>(null);
  const [filterPO, setFilterPO] = useState<string>("");

  const confirmDialog = useTConfirmDialog();

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem: selectedInvoice,
    setSelectedItem: setSelectedInvoice,
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    favorites,
    toggleFavorite,
    formData,
    setFormData,
    handleSelectItem: handleSelectInvoice,
    handleNew: handleNewBase,
    handleCancel: handleCancelBase,
    handleStartEdit,
  } = useMasterDetailState<PurchaseInvoiceListItem, InvoiceFormData>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem: resetFormFromInvoice,
    favoritesKey: "purchase_invoices_favorites",
    defaultSortField: "created_at",
    confirmUnsavedChanges: () =>
      confirmDialog.confirm({
        title: "Discard Changes",
        message: "You have unsaved changes. Discard them?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        confirmColor: "warning",
      }),
    extraDirty: selectedGRNs.length > 0,
    onDiscard: () => {
      setSelectedGRNs([]);
    },
  });

  const handleCancel = useCallback(
    (items: PurchaseInvoiceListItem[]) => {
      handleCancelBase(items);
      setSelectedGRNs([]);
      setInvoiceableGRNs([]);
    },
    [handleCancelBase],
  );

  const handleNewOrder = useCallback(async () => {
    const result = await handleNewBase();
    setSelectedGRNs([]);
    setInvoiceableGRNs([]);
    return result;
  }, [handleNewBase]);

  // Ref to hold pending nav-state fill values until isCreating is confirmed true
  const pendingNavFillRef = useRef<{ supplier_id: number; branch_code: string } | null>(null);

  // Fetch suppliers
  const canViewSuppliers = hasPermission(user, "suppliers", "view");
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
    enabled: canViewSuppliers,
  });

  // Reference data
  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  // Auto-default branch filter
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Auto-fill from navigation state (e.g. from GRN page "Make Payment" button)
  // Step 1: On mount, stash the nav values in a ref and call handleNewOrder
  useEffect(() => {
    if (navigationState?.supplier_id && navigationState?.branch_code) {
      pendingNavFillRef.current = {
        supplier_id: navigationState.supplier_id,
        branch_code: navigationState.branch_code,
      };
      handleNewOrder();
      window.history.replaceState({}, document.title);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 2: Once handleNew flips isCreating to true, apply the stashed values
  useEffect(() => {
    if (isCreating && pendingNavFillRef.current) {
      const { supplier_id, branch_code } = pendingNavFillRef.current;
      pendingNavFillRef.current = null;
      setFormData((prev) => ({ ...prev, supplier_id, branch_code }));
    }
  }, [isCreating]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch POs for the filter dropdown (scoped to selected supplier/branch)
  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ["purchaseOrdersForFilter", filterBranch, filterSupplier],
    queryFn: () =>
      purchaseOrdersApi.getAll({
        supplier_id: filterSupplier || undefined,
        branch_code: filterBranch || undefined,
        limit: 200,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  // Fetch invoices
  const { data: invoices, isLoading } = useQuery({
    queryKey: ["purchaseInvoices", filterBranch, filterSupplier, filterStatus, filterPaymentType, filterPO],
    queryFn: () =>
      purchaseInvoicesApi.getAll({
        branch_code: filterBranch || undefined,
        supplier_id: filterSupplier || undefined,
        status: filterStatus || undefined,
        payment_type: filterPaymentType || undefined,
        po_no: filterPO.trim() || undefined,
      }),
    enabled: branchResolved,
  });

  // Load invoiceable GRNs when supplier OR branch changes in create mode
  useEffect(() => {
    if (isCreating && formData.supplier_id > 0 && formData.branch_code) {
      setLoadingGRNs(true);
      setSelectedGRNs([]);
      purchaseInvoicesApi
        .getInvoiceableGRNs(formData.supplier_id, formData.branch_code)
        .then((grns) => {
          setInvoiceableGRNs(grns);
        })
        .catch(() => {
          setInvoiceableGRNs([]);
          showErrorToast("Failed to load invoiceable GRNs");
        })
        .finally(() => setLoadingGRNs(false));
    } else {
      setInvoiceableGRNs([]);
    }
  }, [isCreating, formData.supplier_id, formData.branch_code]);

  // Load detailed invoice when selecting
  const handleSelectInvoiceWithDetail = useCallback(
    async (invoice: PurchaseInvoiceListItem) => {
      const selected = await handleSelectInvoice(invoice);
      if (!selected) return;
      try {
        const detail = await purchaseInvoicesApi.getById(invoice.id);
        setDetailedInvoice(detail);
      } catch {
        setDetailedInvoice(null);
      }
    },
    [handleSelectInvoice],
  );

  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    let filtered = invoices.filter(
      (inv) =>
        inv.invoice_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inv.supplier_invoice_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inv.supplier_name?.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    filtered.sort((a, b) => {
      if (sortField === "created_at") {
        const diff = new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
        return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
      }
      const fieldA = a[sortField as keyof PurchaseInvoiceListItem] || "";
      const fieldB = b[sortField as keyof PurchaseInvoiceListItem] || "";
      const comp = String(fieldA).localeCompare(String(fieldB));
      return comp !== 0 ? comp : (b.id || 0) - (a.id || 0);
    });
    return filtered;
  }, [invoices, searchQuery, sortField]);

  // Auto-select first
  useEffect(() => {
    if (filteredInvoices.length > 0 && !selectedInvoice && !isCreating) {
      handleSelectInvoiceWithDetail(filteredInvoices[0]);
    }
  }, [filteredInvoices, selectedInvoice, isCreating, handleSelectInvoiceWithDetail]);

  const getSupplierName = (supplierId: number) => {
    const supplier = suppliers?.find((s: Supplier) => s.id === supplierId);
    return supplier ? supplier.full_name : "Unknown";
  };

  // GRN selection toggle
  const handleToggleGRN = (grn: GRNInvoiceableItem) => {
    setSelectedGRNs((prev) => {
      const exists = prev.find((g) => g.grn_id === grn.grn_id);
      if (exists) return prev.filter((g) => g.grn_id !== grn.grn_id);
      return [...prev, grn];
    });
  };

  // Calculate totals
  const calculateTotal = () =>
    invoiceableGRNs.reduce((sum, grn) => sum + grn.remaining_amount, 0);

  const calculateSelectedTotal = () =>
    selectedGRNs.reduce((sum, grn) => sum + grn.remaining_amount, 0);

  // Form validation
  const isFormValid =
    formData.supplier_id > 0 &&
    formData.branch_code &&
    formData.supplier_invoice_no &&
    formData.supplier_invoice_date &&
    selectedGRNs.length > 0;

  // Create mutation
  const createMutation = useCrudMutation({
    mutationFn: purchaseInvoicesApi.create,
    invalidateQueryKeys: [["purchaseInvoices"]],
    successMessage: "Purchase invoice created successfully",
    errorMessage: "Failed to create purchase invoice",
    onSuccess: () => {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedGRNs([]);
      setInvoiceableGRNs([]);
    },
  });

  // Cancel mutation
  const cancelMutation = useCrudMutation({
    mutationFn: (id: number) => purchaseInvoicesApi.cancel(id),
    invalidateQueryKeys: [["purchaseInvoices"]],
    successMessage: "Invoice cancelled",
    errorMessage: "Failed to cancel invoice",
    onSuccess: () => {
      setSelectedInvoice(null);
      setDetailedInvoice(null);
    },
  });

  const handleSave = useCallback(() => {
    const total = calculateSelectedTotal();
    const today = new Date().toISOString().split("T")[0];
    const invoiceDate = formData.supplier_invoice_date || today;
    // Build per-product items from selected GRNs
    const items = selectedGRNs.flatMap((grn) =>
      (grn.products || []).map((p) => ({
        grn_id: grn.grn_id,
        purchasing_order_id: grn.po_id,
        product_id: p.product_id,
        quantity: p.quantity,
        unit_price: p.unit_price,
        line_total: p.line_total,
      })),
    );
    const dataToSave: PurchaseInvoiceCreate = {
      supplier_invoice_no: formData.supplier_invoice_no,
      supplier_invoice_date: invoiceDate,
      supplier_id: formData.supplier_id,
      branch_code: formData.branch_code,
      payment_type: formData.payment_type,
      received_date: today,
      // For credit invoices the backend will override due_date using supplier.credit_days
      // For non-credit we use the invoice date (same-day payment expected)
      due_date: invoiceDate,
      subtotal: total,
      total_amount: total,
      remarks: formData.remarks || undefined,
      items,
    };
    createMutation.mutate(dataToSave);
  }, [formData, selectedGRNs, createMutation]);

  const handleCancelInvoice = useCallback(async () => {
    if (!selectedInvoice) return;
    const confirmed = await confirmDialog.confirm({
      title: "Cancel Invoice",
      message: `Cancel invoice "${selectedInvoice.invoice_no}"? This cannot be undone.`,
      confirmText: "Cancel Invoice",
      confirmColor: "error",
    });
    if (confirmed) {
      cancelMutation.mutate(selectedInvoice.id);
    }
  }, [selectedInvoice, cancelMutation, confirmDialog]);

  const isSaving = createMutation.isPending;

  const canCancelInvoice = selectedInvoice?.status === "unpaid";

  // Master panel
  const masterPanel = (
    <SearchableList<PurchaseInvoiceListItem>
      items={filteredInvoices}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search invoices..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedInvoice}
      onSelectItem={handleSelectInvoiceWithDetail}
      emptyMessage="No purchase invoices found"
      listHeader={
        <TFilterPanel>
          <TBranchFilter
            branches={branches}
            value={filterBranch}
            onChange={setFilterBranch}
          />
          <TSupplierFilter
            suppliers={suppliers || []}
            value={filterSupplier}
            onChange={setFilterSupplier}
          />
          <Autocomplete
            size="small"
            options={purchaseOrders}
            getOptionLabel={(option) => option.purchasing_order_no || ""}
            value={purchaseOrders.find((po) => po.purchasing_order_no === filterPO) || null}
            onChange={(_, newValue) => setFilterPO(newValue?.purchasing_order_no || "")}
            renderInput={(params) => (
              <TextField {...params} placeholder="Filter by PO" label="Filter by PO" />
            )}
            sx={{ minWidth: 200 }}
            clearOnEscape
          />
        </TFilterPanel>
      }
      renderItem={(invoice, isSelected) => (
        <SelectableListItem
          key={invoice.id}
          id={invoice.id}
          isSelected={isSelected}
          onClick={() => handleSelectInvoiceWithDetail(invoice)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{invoice.invoice_no}</span>
                <Typography variant="caption" sx={{ fontWeight: "bold" }}>
                  {fmtLKR(invoice.total_amount)}
                </Typography>
              </Box>
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="caption">
                      {invoice.supplier_name || getSupplierName(invoice.supplier_id)}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>(Supplier)</Typography>
                  </Box>
                  {invoice.po_nos && (
                    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                      <Typography variant="caption">
                        {invoice.po_nos}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>(PO)</Typography>
                    </Box>
                  )}
                  <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                    <Typography variant="caption">
                      {new Date(invoice.supplier_invoice_date || "").toLocaleDateString()}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>(Invoice Date)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                    <TStatusChip status={invoice.status || "unpaid"} statusMap="purchaseOrder" size="small" />
                    <Chip
                      size="small"
                      label={invoice.payment_type === "credit" ? "Credit" : "Non-Credit"}
                      color={invoice.payment_type === "credit" ? "warning" : "default"}
                      variant="outlined"
                      sx={{ height: 20, fontSize: "0.7rem" }}
                    />
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={
            !isSelected
              ? `${invoice.supplier_name || getSupplierName(invoice.supplier_id)} - ${new Date(invoice.supplier_invoice_date || "").toLocaleDateString()}`
              : undefined
          }
          isFavorite={favorites.includes(invoice.id)}
          onToggleFavorite={(e) => toggleFavorite(invoice.id, e)}
          statusChip={
            !isSelected
              ? {
                  label: invoice.status || "unpaid",
                  color: invoice.status === "paid" ? "success" : invoice.status === "partially_paid" ? "info" : "default",
                }
              : undefined
          }
        />
      )}
    />
  );

  // Detail panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchasing", href: "/purchasing" },
          { label: "Supplier Voucher Payment", href: "/purchasing/invoices" },
          ...(selectedInvoice || isCreating
            ? [{ label: isCreating ? "New Voucher" : selectedInvoice?.invoice_no || "" }]
            : []),
        ]}
        title={selectedInvoice ? selectedInvoice.invoice_no : ""}
        titleIcon={<ReceiptLongIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Supplier Voucher Payment"
        noSelectionTitle="Select an Invoice"
        isFavorite={selectedInvoice ? favorites.includes(selectedInvoice.id) : false}
        onToggleFavorite={selectedInvoice ? (e) => toggleFavorite(selectedInvoice.id, e) : undefined}
      />

      <ActionToolbar
        hasSelectedItem={!!selectedInvoice}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={!!isFormValid}
        onNew={handleNewOrder}
        onSave={handleSave}
        onCancel={() => handleCancel(filteredInvoices)}
        onDelete={canCancelInvoice ? handleCancelInvoice : undefined}
        canDelete={!!canCancelInvoice}
        endActions={undefined}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedInvoice && !isCreating ? (
          <EmptyState message="Select a supplier voucher payment from the list or create a new one" />
        ) : (
          <>
            <FormSection title="Invoice Information" columns={3}>
              {!isCreating && (
                <TextField
                  label="Invoice Number"
                  size="small"
                  value={selectedInvoice?.invoice_no || ""}
                  disabled
                />
              )}
              <TextField
                label="Supplier Invoice No"
                size="small"
                value={formData.supplier_invoice_no}
                onChange={(e) => setFormData({ ...formData, supplier_invoice_no: e.target.value })}
                disabled={!isEditing && !isCreating}
                required
              />
              <TextField
                label="Supplier Invoice Date"
                size="small"
                type="date"
                value={formData.supplier_invoice_date}
                onChange={(e) => setFormData({ ...formData, supplier_invoice_date: e.target.value })}
                disabled={!isEditing && !isCreating}
                InputLabelProps={{ shrink: true }}
                required
              />
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
                value={branches.find((b) => b.branch_code === formData.branch_code) || null}
                onChange={(_, newValue) => setFormData({ ...formData, branch_code: newValue?.branch_code || "" })}
                disabled={!isEditing && !isCreating}
                renderInput={(params) => <TextField {...params} label="Branch" required />}
              />
              <Autocomplete
                size="small"
                options={suppliers || []}
                getOptionLabel={(option: Supplier) =>
                  option.company_name ? `${option.full_name} (${option.company_name})` : option.full_name
                }
                value={suppliers?.find((s: Supplier) => s.id === formData.supplier_id) || null}
                onChange={(_, newValue: Supplier | null) =>
                  setFormData({ ...formData, supplier_id: newValue?.id || 0 })
                }
                disabled={!isEditing && !isCreating}
                renderInput={(params) => <TextField {...params} label="Supplier" required />}
              />
              <TextField
                select
                label="Payment Type"
                size="small"
                value={formData.payment_type}
                onChange={(e) => setFormData({ ...formData, payment_type: e.target.value })}
                disabled={!isEditing && !isCreating}
              >
                <MenuItem value="non_credit">Non-Credit</MenuItem>
                <MenuItem value="credit">Credit</MenuItem>
              </TextField>
            </FormSection>

            {/* View mode: status & amounts */}
            {selectedInvoice && !isCreating && (
              <FormSection title="Status & Amounts" columns={3}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">Status:</Typography>
                  <TStatusChip status={selectedInvoice.status || "unpaid"} statusMap="purchaseOrder" />
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">Payment Type:</Typography>
                  <Chip
                    size="small"
                    label={selectedInvoice.payment_type === "credit" ? "Credit" : "Non-Credit"}
                    color={selectedInvoice.payment_type === "credit" ? "warning" : "default"}
                  />
                </Box>
                <TextField label="Total Amount" size="small" value={fmtLKR(selectedInvoice.total_amount)} disabled />
                <TextField label="Paid Amount" size="small" value={fmtLKR(selectedInvoice.paid_amount)} disabled />
                <TextField label="Balance Due" size="small" value={fmtLKR(selectedInvoice.balance_due)} disabled />
                {selectedInvoice.is_overdue && (
                  <Alert severity="error" sx={{ gridColumn: "1 / -1" }}>
                    Overdue by {selectedInvoice.days_overdue} days
                  </Alert>
                )}
              </FormSection>
            )}

            <FormSection title="Remarks" columns={1}>
              <TextField
                label="Remarks"
                size="small"
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                disabled={!isEditing && !isCreating}
                multiline
                rows={2}
              />
            </FormSection>

            {/* GRN Selection (create mode) */}
            {isCreating && (
              <>
                <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1, mt: 1 }}>
                  Select GRNs to Invoice
                </Typography>
                {loadingGRNs ? (
                  <Typography color="text.secondary">Loading GRNs...</Typography>
                ) : formData.supplier_id === 0 ? (
                  <Alert severity="info">Select a supplier above to load invoiceable GRNs.</Alert>
                ) : !formData.branch_code ? (
                  <Alert severity="info">Select a branch above to load invoiceable GRNs.</Alert>
                ) : invoiceableGRNs.length === 0 ? (
                  <Alert severity="info">
                    No invoiceable GRNs found for this supplier in the selected branch.
                  </Alert>
                ) : (
                  <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={modernTableStyles.headerRow}>
                          <TableCell padding="checkbox" />
                          <TableCell>GRN No</TableCell>
                          <TableCell>PO No</TableCell>
                          <TableCell>GRN Date</TableCell>
                          <TableCell align="right">Remaining Qty</TableCell>
                          <TableCell align="right">Remaining Amount</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {invoiceableGRNs.map((grn) => {
                          const isChecked = selectedGRNs.some((g) => g.grn_id === grn.grn_id);
                          return (
                            <TableRow
                              key={grn.grn_id}
                              hover
                              onClick={() => handleToggleGRN(grn)}
                              sx={{ cursor: "pointer", ...modernTableStyles.bodyRow }}
                            >
                              <TableCell padding="checkbox">
                                <Checkbox checked={isChecked} size="small" />
                              </TableCell>
                              <TableCell>{grn.grn_no}</TableCell>
                              <TableCell>{grn.po_no}</TableCell>
                              <TableCell>{new Date(grn.grn_date).toLocaleDateString()}</TableCell>
                              <TableCell align="right">{grn.remaining_qty}</TableCell>
                              <TableCell align="right">{fmtLKR(grn.remaining_amount)}</TableCell>
                            </TableRow>
                          );
                        })}
                        <TableRow sx={modernTableStyles.footerRow}>
                          <TableCell colSpan={5} align="right">
                            <Typography fontWeight="bold">Total:</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography fontWeight="bold">{fmtLKR(calculateTotal())}</Typography>
                          </TableCell>
                        </TableRow>
                        {selectedGRNs.length > 0 && (
                          <TableRow sx={{ bgcolor: "primary.50" }}>
                            <TableCell colSpan={5} align="right">
                              <Typography variant="body2" color="primary.main" fontWeight="bold">
                                Selected ({selectedGRNs.length}):
                              </Typography>
                            </TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" color="primary.main" fontWeight="bold">
                                {fmtLKR(calculateSelectedTotal())}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </Paper>
                )}
                {selectedGRNs.length === 0 && !loadingGRNs && invoiceableGRNs.length > 0 && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Select at least one GRN to create the invoice
                  </Alert>
                )}
              </>
            )}

            {/* View mode: invoice line items */}
            {!isCreating && detailedInvoice && detailedInvoice.items?.length > 0 && (
              <>
                <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1, mt: 2 }}>
                  Invoice Items
                </Typography>
                <Paper variant="outlined" sx={{ overflow: "hidden", borderRadius: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={modernTableStyles.headerRow}>
                        <TableCell>GRN No</TableCell>
                        <TableCell>PO No</TableCell>
                        <TableCell>Product</TableCell>
                        <TableCell align="right">Quantity</TableCell>
                        <TableCell align="right">Unit Price</TableCell>
                        <TableCell align="right">Line Total</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailedInvoice.items.map((item) => (
                        <TableRow key={item.id} sx={modernTableStyles.bodyRow}>
                          <TableCell>{item.grn_no || "-"}</TableCell>
                          <TableCell>{item.po_no || "-"}</TableCell>
                          <TableCell>{item.product_name || item.description || "-"}</TableCell>
                          <TableCell align="right">{item.quantity}</TableCell>
                          <TableCell align="right">{fmtLKR(item.unit_price)}</TableCell>
                          <TableCell align="right">{fmtLKR(item.line_total)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow sx={modernTableStyles.footerRow}>
                        <TableCell colSpan={5} align="right">
                          <Typography fontWeight="bold">Total:</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography fontWeight="bold">
                            {fmtLKR(detailedInvoice.total_amount)}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Paper>
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
        title="Supplier Voucher Payment"
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["purchaseInvoices"] });
        }}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
