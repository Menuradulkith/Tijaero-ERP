/**
 * Advance Payments Page
 *
 * Unified Master-Detail page for managing both Customer and Supplier advance payments.
 * Follows Purchasing/Sales UI pattern with Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Autocomplete,
  Box,
  Chip,
  InputAdornment,
  MenuItem,
  TextField,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import {
  AccountBalanceWallet as WalletIcon,
  Person as PersonIcon,
  Store as SupplierIcon,
  CheckCircle as CheckCircleIcon,
} from "@mui/icons-material";
import { ConfirmDialog, useConfirmDialog } from "@/components/ConfirmDialog";
import { advancePaymentsApi } from "@/modules/finance/api";
import { customersApi } from "@/modules/customers/api";
import { suppliersApi, supplierAdvancePaymentsApi } from "@/modules/purchasing/api";
import { CustomerAdvancePaymentCreate } from "@/modules/finance/types";
import {
  SupplierAdvancePaymentCreate,
} from "@/modules/purchasing/types";
import { useReferenceData } from "@/hooks";

// Tijaero Components
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  SortOption,
  TBranchFilter,
  TFilterPanel,
  TSupplierFilter,
  GENERIC_PAYMENT_METHOD,
} from "@/components/tijaero";

// Types
interface Branch {
  branch_code: string;
  branch_name: string;
}

interface Customer {
  id: number;
  customer_name: string;
  company_name?: string;
}

interface Supplier {
  id: number;
  full_name: string;
  company_name?: string;
}

// Any for advance records (customer + supplier have different shapes)
type AdvanceRecord = any;

const SORT_OPTIONS: SortOption[] = [
  { value: "created_at", label: "Date" },
  { value: "amount", label: "Amount" },
  { value: "id", label: "ID" },
];

const CUSTOMER_INITIAL_FORM: Partial<CustomerAdvancePaymentCreate> = {
  advance_payments_no: "",
  payment_method: "cash",
  branch_code: "",
  payment_amount: 0,
  remarks: "",
  customer_id: 0,
  cheque_date: new Date().toISOString().split("T")[0],
  active: true,
};

const SUPPLIER_INITIAL_FORM: Partial<SupplierAdvancePaymentCreate> = {
  supplier_id: 0,
  payment_date: new Date().toISOString().split("T")[0],
  payment_method: "Bank Transfer",
  original_amount: 0,
  reference_number: "",
  bank_name: "",
  branch_code: "",
  remarks: "",
};

export default function AdvancePaymentsPage() {
  const queryClient = useQueryClient();
  const confirmDialog = useConfirmDialog();

  // Tab: customer vs supplier
  const [advanceType, setAdvanceType] = useState<"customer" | "supplier">("customer");

  // Validation state
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const handleBlur = (fieldName: string) => {
    setTouched((prev) => ({ ...prev, [fieldName]: true }));
  };

  // Filter states
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterEntity, setFilterEntity] = useState<number | null>(null);

  // Master-detail state (generic)
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("created_at");
  const [selectedItem, setSelectedItem] = useState<AdvanceRecord | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [favorites, setFavorites] = useState<number[]>([]);

  // Form data — customer
  const [customerForm, setCustomerForm] = useState<Partial<CustomerAdvancePaymentCreate>>(CUSTOMER_INITIAL_FORM);
  // Form data — supplier
  const [supplierForm, setSupplierForm] = useState<Partial<SupplierAdvancePaymentCreate>>(SUPPLIER_INITIAL_FORM);

  // Reference data
  const { data: refData } = useReferenceData(["branches"]);
  const branches: Branch[] = refData?.branches || [];

  // Fetch customers
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });

  // Fetch suppliers
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => suppliersApi.getAll(),
  });

  // Fetch customer advance payments
  const {
    data: customerAdvances = [],
    isLoading: loadingCustomer,
    refetch: refetchCustomer,
  } = useQuery({
    queryKey: ["customer-advance-payments", filterBranch, filterEntity],
    queryFn: () =>
      advancePaymentsApi.getAll({
        branch_code: filterBranch || undefined,
        customer_id: advanceType === "customer" ? (filterEntity || undefined) : undefined,
      }),
    enabled: advanceType === "customer",
  });

  // Fetch supplier advance payments
  const {
    data: supplierAdvances = [],
    isLoading: loadingSupplier,
    refetch: refetchSupplier,
  } = useQuery({
    queryKey: ["supplier-advance-payments", filterBranch, filterEntity],
    queryFn: () =>
      supplierAdvancePaymentsApi.getAll({
        branch_code: filterBranch || undefined,
        supplier_id: advanceType === "supplier" ? (filterEntity || undefined) : undefined,
      }),
    enabled: advanceType === "supplier",
  });

  // Active dataset
  const isLoading = advanceType === "customer" ? loadingCustomer : loadingSupplier;
  const advances: AdvanceRecord[] = advanceType === "customer" ? customerAdvances : supplierAdvances;
  const refetchData = advanceType === "customer" ? refetchCustomer : refetchSupplier;

  // Filtered & sorted list
  const filteredAdvances = useMemo(() => {
    if (!advances) return [];

    let filtered = advances.filter((adv: AdvanceRecord) => {
      const q = searchQuery.toLowerCase();
      if (advanceType === "customer") {
        return (
          (adv.advance_payments_no || "").toLowerCase().includes(q) ||
          String(adv.id).includes(q) ||
          (adv.remarks || "").toLowerCase().includes(q)
        );
      }
      return (
        (adv.advance_no || "").toLowerCase().includes(q) ||
        (adv.supplier_name || "").toLowerCase().includes(q) ||
        String(adv.id).includes(q)
      );
    });

    filtered.sort((a: AdvanceRecord, b: AdvanceRecord) => {
      if (sortField === "created_at") {
        return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
      }
      if (sortField === "amount") {
        const aAmt = advanceType === "customer" ? Number(a.payment_amount || 0) : Number(a.original_amount || 0);
        const bAmt = advanceType === "customer" ? Number(b.payment_amount || 0) : Number(b.original_amount || 0);
        return bAmt - aAmt;
      }
      return (b.id || 0) - (a.id || 0);
    });

    return filtered;
  }, [advances, searchQuery, sortField, advanceType]);

  // Auto-select first
  useEffect(() => {
    if (filteredAdvances.length > 0 && !selectedItem && !isCreating) {
      setSelectedItem(filteredAdvances[0]);
      resetFormFromRecord(filteredAdvances[0]);
    }
  }, [filteredAdvances, selectedItem, isCreating]);

  // Reset form from selected record
  const resetFormFromRecord = useCallback(
    (item: AdvanceRecord) => {
      if (advanceType === "customer") {
        setCustomerForm({
          advance_payments_no: item.advance_payments_no || "",
          payment_method: item.payment_method || "cash",
          branch_code: item.branch_code || "",
          payment_amount: Number(item.payment_amount) || 0,
          remarks: item.remarks || "",
          customer_id: item.customer_id || 0,
          cheque_date: (item.cheque_date || "").split("T")[0] || new Date().toISOString().split("T")[0],
          active: item.active ?? true,
        });
      } else {
        setSupplierForm({
          supplier_id: item.supplier_id || 0,
          payment_date: (item.payment_date || "").split("T")[0] || new Date().toISOString().split("T")[0],
          payment_method: item.payment_method || "Bank Transfer",
          original_amount: Number(item.original_amount) || 0,
          reference_number: item.reference_number || "",
          bank_name: item.bank_name || "",
          branch_code: item.branch_code || "",
          remarks: item.remarks || "",
        });
      }
      setTouched({});
    },
    [advanceType]
  );

  // Select item handler
  const handleSelectItem = useCallback(
    (item: AdvanceRecord) => {
      setSelectedItem(item);
      setIsCreating(false);
      setIsEditing(false);
      resetFormFromRecord(item);
    },
    [resetFormFromRecord]
  );

  // New handler
  const handleNew = useCallback(() => {
    setSelectedItem(null);
    setIsCreating(true);
    setIsEditing(true);
    setTouched({});
    if (advanceType === "customer") {
      setCustomerForm({ ...CUSTOMER_INITIAL_FORM });
    } else {
      setSupplierForm({ ...SUPPLIER_INITIAL_FORM });
    }
  }, [advanceType]);

  // Cancel handler
  const handleCancel = useCallback(() => {
    setIsCreating(false);
    setIsEditing(false);
    setTouched({});
    if (filteredAdvances.length > 0) {
      handleSelectItem(filteredAdvances[0]);
    } else {
      setSelectedItem(null);
    }
  }, [filteredAdvances, handleSelectItem]);

  // Toggle favorites
  const toggleFavorite = useCallback((id: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setFavorites((prev) => (prev.includes(id) ? prev.filter((fid) => fid !== id) : [...prev, id]));
  }, []);

  // Tab switch handler
  const handleTypeSwitch = useCallback(
    (_: React.MouseEvent<HTMLElement>, newType: "customer" | "supplier" | null) => {
      if (!newType) return;
      setAdvanceType(newType);
      setSelectedItem(null);
      setIsCreating(false);
      setIsEditing(false);
      setFilterBranch(null);
      setFilterEntity(null);
      setSearchQuery("");
      setTouched({});
    },
    []
  );

  // --- Mutations ---
  const createCustomerMutation = useMutation({
    mutationFn: (data: CustomerAdvancePaymentCreate) => advancePaymentsApi.create(data),
    onSuccess: (newItem: any) => {
      queryClient.invalidateQueries({ queryKey: ["customer-advance-payments"] });
      showSuccessToast("Customer advance payment recorded successfully");
      setIsCreating(false);
      setIsEditing(false);
      setTouched({});
      setTimeout(() => handleSelectItem(newItem), 0);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to record customer advance"));
    },
  });

  const createSupplierMutation = useMutation({
    mutationFn: (data: SupplierAdvancePaymentCreate) => supplierAdvancePaymentsApi.create(data),
    onSuccess: (newItem: any) => {
      queryClient.invalidateQueries({ queryKey: ["supplier-advance-payments"] });
      showSuccessToast("Supplier advance payment created successfully");
      setIsCreating(false);
      setIsEditing(false);
      setTouched({});
      setTimeout(() => handleSelectItem(newItem), 0);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to create supplier advance"));
    },
  });

  const deleteSupplierMutation = useMutation({
    mutationFn: (id: number) => supplierAdvancePaymentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-advance-payments"] });
      showSuccessToast("Advance payment deleted");
      setSelectedItem(null);
    },
    onError: (error: unknown) => {
      showErrorToast(handleApiError(error, "Failed to delete advance payment"));
    },
  });

  // Delete handler
  const handleDelete = useCallback(async () => {
    if (!selectedItem) return;
    if (advanceType === "supplier") {
      if (selectedItem.is_fully_applied || Number(selectedItem.applied_amount) > 0) {
        showErrorToast("Cannot delete an advance that has been applied");
        return;
      }
      const confirmed = await confirmDialog.confirm({
        title: "Delete Advance Payment",
        message: `Are you sure you want to delete advance "${selectedItem.advance_no || selectedItem.id}"? This action cannot be undone.`,
        confirmText: "Delete",
        confirmColor: "error",
      });
      if (confirmed) {
        deleteSupplierMutation.mutate(selectedItem.id);
      }
    }
  }, [selectedItem, advanceType, confirmDialog, deleteSupplierMutation]);

  // Can delete?
  const canDelete =
    advanceType === "supplier" &&
    !!selectedItem &&
    !selectedItem.is_fully_applied &&
    Number(selectedItem.applied_amount || 0) === 0;

  // Helper functions
  const getCustomerName = useCallback(
    (customerId: number) => {
      const c = customers.find((cust: Customer) => cust.id === customerId);
      return c?.customer_name || c?.company_name || `Customer #${customerId}`;
    },
    [customers]
  );

  const getSupplierName = useCallback(
    (supplierId: number) => {
      const s = suppliers.find((sup: Supplier) => sup.id === supplierId);
      return s?.full_name || s?.company_name || `Supplier #${supplierId}`;
    },
    [suppliers]
  );

  // --- Validation ---
  const getFieldError = (fieldName: string): string | undefined => {
    if (!touched[fieldName] && !isCreating) return undefined;

    if (advanceType === "customer") {
      switch (fieldName) {
        case "customer_id":
          if (!customerForm.customer_id || customerForm.customer_id === 0) return "Customer is required";
          break;
        case "branch_code":
          if (!customerForm.branch_code) return "Branch is required";
          break;
        case "payment_amount":
          if (!customerForm.payment_amount || customerForm.payment_amount <= 0) return "Amount must be greater than 0";
          break;
      }
    } else {
      switch (fieldName) {
        case "supplier_id":
          if (!supplierForm.supplier_id || supplierForm.supplier_id === 0) return "Supplier is required";
          break;
        case "branch_code":
          if (!supplierForm.branch_code) return "Branch is required";
          break;
        case "original_amount":
          if (!supplierForm.original_amount || supplierForm.original_amount <= 0) return "Amount must be greater than 0";
          break;
        case "payment_date":
          if (!supplierForm.payment_date) return "Payment date is required";
          break;
      }
    }
    return undefined;
  };

  const hasError = (fieldName: string): boolean => !!getFieldError(fieldName);

  const isFormValid =
    advanceType === "customer"
      ? !!(customerForm.customer_id && customerForm.customer_id > 0 && customerForm.branch_code && customerForm.payment_amount && customerForm.payment_amount > 0)
      : !!(supplierForm.supplier_id && supplierForm.supplier_id > 0 && supplierForm.branch_code && supplierForm.original_amount && supplierForm.original_amount > 0 && supplierForm.payment_date);

  const isSaving = createCustomerMutation.isPending || createSupplierMutation.isPending;

  const handleSave = useCallback(() => {
    if (!isCreating) return;
    if (advanceType === "customer") {
      createCustomerMutation.mutate(customerForm as CustomerAdvancePaymentCreate);
    } else {
      createSupplierMutation.mutate(supplierForm as SupplierAdvancePaymentCreate);
    }
  }, [isCreating, advanceType, customerForm, supplierForm, createCustomerMutation, createSupplierMutation]);

  // --- Helpers for list rendering ---
  const getRecordLabel = (adv: AdvanceRecord): string => {
    if (advanceType === "customer") return adv.advance_payments_no || `ADV-${adv.id}`;
    return adv.advance_no || `ADV-${adv.id}`;
  };

  const getRecordEntity = (adv: AdvanceRecord): string => {
    if (advanceType === "customer") return getCustomerName(adv.customer_id);
    return adv.supplier_name || getSupplierName(adv.supplier_id);
  };

  const getRecordAmount = (adv: AdvanceRecord): number => {
    if (advanceType === "customer") return Number(adv.payment_amount || 0);
    return Number(adv.original_amount || 0);
  };

  const getRecordDate = (adv: AdvanceRecord): string => {
    if (advanceType === "customer") return adv.cheque_date || adv.created_at || "";
    return adv.payment_date || adv.created_at || "";
  };

  // ================= MASTER PANEL =================
  const masterPanel = (
    <SearchableList<AdvanceRecord>
      items={filteredAdvances}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder={`Search ${advanceType} advances...`}
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectItem}
      emptyMessage={`No ${advanceType} advance payments found`}
      listHeader={
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {/* Type toggle */}
          <Box sx={{ display: "flex", justifyContent: "center", py: 0.5 }}>
            <ToggleButtonGroup
              value={advanceType}
              exclusive
              onChange={handleTypeSwitch}
              size="small"
              color="primary"
            >
              <ToggleButton value="customer" sx={{ px: 1.5, py: 0.25, fontSize: "0.75rem" }}>
                <PersonIcon sx={{ fontSize: 16, mr: 0.5 }} /> Customer
              </ToggleButton>
              <ToggleButton value="supplier" sx={{ px: 1.5, py: 0.25, fontSize: "0.75rem" }}>
                <SupplierIcon sx={{ fontSize: 16, mr: 0.5 }} /> Supplier
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <TFilterPanel>
            <TBranchFilter
              branches={branches}
              value={filterBranch}
              onChange={setFilterBranch}
            />
            {advanceType === "supplier" && (
              <TSupplierFilter
                suppliers={suppliers || []}
                value={filterEntity}
                onChange={setFilterEntity}
              />
            )}
            {advanceType === "customer" && (
              <Autocomplete
                size="small"
                options={customers}
                getOptionLabel={(option: Customer) => option.customer_name || ""}
                value={customers.find((c: Customer) => c.id === filterEntity) || null}
                onChange={(_, newVal) => setFilterEntity((newVal as Customer)?.id || null)}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                renderInput={(params) => (
                  <TextField {...params} label="Customer" placeholder="All Customers" />
                )}
                sx={{ minWidth: 180 }}
              />
            )}
          </TFilterPanel>
        </Box>
      }
      renderItem={(adv, isSelected) => (
        <SelectableListItem
          key={adv.id}
          id={adv.id}
          isSelected={isSelected}
          onClick={() => handleSelectItem(adv)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{getRecordLabel(adv)}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    ({advanceType === "customer" ? "Payment No" : "Advance No"})
                  </Typography>
                )}
              </Box>
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">{getRecordEntity(adv)}</Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      ({advanceType === "customer" ? "Customer" : "Supplier"})
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      Rs. {getRecordAmount(adv).toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Amount)
                    </Typography>
                  </Box>
                  {advanceType === "supplier" && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption" sx={{ color: "success.main" }}>
                        Rs. {Number(adv.remaining_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                      </Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                        (Remaining)
                      </Typography>
                    </Box>
                  )}
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {getRecordDate(adv) ? new Date(getRecordDate(adv)).toLocaleDateString() : "-"}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                      (Date)
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                    {advanceType === "customer" ? (
                      <Chip
                        label={adv.active ? "Active" : "Inactive"}
                        size="small"
                        color={adv.active ? "success" : "default"}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    ) : (
                      <Chip
                        label={adv.is_fully_applied ? "Fully Applied" : "Active"}
                        size="small"
                        color={adv.is_fully_applied ? "default" : "success"}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    )}
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={
            !isSelected
              ? `${getRecordEntity(adv)} - Rs. ${getRecordAmount(adv).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`
              : undefined
          }
          isFavorite={favorites.includes(adv.id)}
          onToggleFavorite={(e) => toggleFavorite(adv.id, e)}
          statusChip={
            !isSelected
              ? advanceType === "customer"
                ? adv.active
                  ? { label: "Active", color: "success" }
                  : { label: "Inactive", color: "default" }
                : adv.is_fully_applied
                  ? { label: "Fully Applied", color: "default" }
                  : { label: "Active", color: "success" }
              : undefined
          }
        />
      )}
    />
  );

  // ================= DETAIL PANEL =================
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Advance Payments" },
          { label: advanceType === "customer" ? "Customer" : "Supplier" },
          ...(selectedItem || isCreating
            ? [{ label: isCreating ? "New Advance" : getRecordLabel(selectedItem) }]
            : []),
        ]}
        title={selectedItem ? getRecordLabel(selectedItem) : ""}
        titleIcon={advanceType === "customer" ? <PersonIcon color="primary" /> : <SupplierIcon color="primary" />}
        isCreating={isCreating}
        createTitle={`New ${advanceType === "customer" ? "Customer" : "Supplier"} Advance Payment`}
        noSelectionTitle="Select an Advance Payment"
        isFavorite={selectedItem ? favorites.includes(selectedItem.id) : false}
        onToggleFavorite={selectedItem ? (e) => toggleFavorite(selectedItem.id, e) : undefined}
        chips={
          selectedItem && !isCreating
            ? [
                {
                  label: advanceType === "customer"
                    ? (selectedItem.active ? "Active" : "Inactive")
                    : (selectedItem.is_fully_applied ? "Fully Applied" : "Active"),
                  color: advanceType === "customer"
                    ? (selectedItem.active ? "success" : "default")
                    : (selectedItem.is_fully_applied ? "default" : "success"),
                },
              ]
            : undefined
        }
      />

      <ActionToolbar
        hasSelectedItem={!!selectedItem}
        isCreating={isCreating}
        isEditing={isEditing}
        isSaving={isSaving}
        isFormValid={isFormValid}
        onNew={handleNew}
        onSave={handleSave}
        onCancel={() => handleCancel()}
        onDelete={canDelete ? handleDelete : undefined}
        canDelete={canDelete}
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message={`Select a ${advanceType} advance payment from the list or create a new one`} />
        ) : advanceType === "customer" ? (
          /* ======= CUSTOMER FORM ======= */
          <>
            <FormSection title="Customer Information" columns={3}>
              <Autocomplete
                size="small"
                options={customers}
                getOptionLabel={(option: Customer) =>
                  option.company_name
                    ? `${option.customer_name} (${option.company_name})`
                    : option.customer_name || ""
                }
                value={customers.find((c: Customer) => c.id === customerForm.customer_id) || null}
                onChange={(_, newValue: Customer | null) => {
                  setCustomerForm({ ...customerForm, customer_id: newValue?.id || 0 });
                  handleBlur("customer_id");
                }}
                disabled={!isEditing && !isCreating}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Customer"
                    required
                    error={hasError("customer_id")}
                    helperText={getFieldError("customer_id")}
                  />
                )}
              />
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(option: Branch) => `${option.branch_code} - ${option.branch_name}`}
                value={branches.find((b) => b.branch_code === customerForm.branch_code) || null}
                onChange={(_, newValue) => {
                  setCustomerForm({ ...customerForm, branch_code: newValue?.branch_code || "" });
                  handleBlur("branch_code");
                }}
                disabled={!isEditing && !isCreating}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Branch"
                    required
                    error={hasError("branch_code")}
                    helperText={getFieldError("branch_code")}
                  />
                )}
              />
              <TextField
                label="Payment Number"
                size="small"
                value={customerForm.advance_payments_no || ""}
                onChange={(e) => setCustomerForm({ ...customerForm, advance_payments_no: e.target.value })}
                disabled={!isEditing && !isCreating}
              />
            </FormSection>

            <FormSection title="Payment Details" columns={3}>
              <TextField
                select
                label="Payment Method"
                size="small"
                value={customerForm.payment_method || "cash"}
                onChange={(e) => setCustomerForm({ ...customerForm, payment_method: e.target.value })}
                disabled={!isEditing && !isCreating}
              >
                {GENERIC_PAYMENT_METHOD.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Amount"
                size="small"
                type="number"
                value={customerForm.payment_amount || ""}
                onChange={(e) => setCustomerForm({ ...customerForm, payment_amount: parseFloat(e.target.value) || 0 })}
                onBlur={() => handleBlur("payment_amount")}
                disabled={!isEditing && !isCreating}
                required
                error={hasError("payment_amount")}
                helperText={getFieldError("payment_amount")}
                InputProps={{
                  startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                }}
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                label="Payment Date"
                size="small"
                type="date"
                value={customerForm.cheque_date || ""}
                onChange={(e) => setCustomerForm({ ...customerForm, cheque_date: e.target.value })}
                disabled={!isEditing && !isCreating}
                InputLabelProps={{ shrink: true }}
                required
              />
            </FormSection>

            {/* Status for existing records */}
            {selectedItem && !isCreating && (
              <FormSection title="Status" columns={3}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">Active:</Typography>
                  <Chip
                    label={selectedItem.active ? "Active" : "Inactive"}
                    size="small"
                    color={selectedItem.active ? "success" : "default"}
                    icon={selectedItem.active ? <CheckCircleIcon /> : undefined}
                  />
                </Box>
                <TextField
                  label="Branch"
                  size="small"
                  value={selectedItem.branch_code || "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Created"
                  size="small"
                  value={selectedItem.created_at ? new Date(selectedItem.created_at).toLocaleString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
              </FormSection>
            )}

            <FormSection title="Remarks" columns={1}>
              <TextField
                label="Remarks"
                size="small"
                value={customerForm.remarks || ""}
                onChange={(e) => setCustomerForm({ ...customerForm, remarks: e.target.value })}
                disabled={!isEditing && !isCreating}
                multiline
                rows={2}
              />
            </FormSection>
          </>
        ) : (
          /* ======= SUPPLIER FORM ======= */
          <>
            <FormSection title="Supplier Information" columns={3}>
              <Autocomplete
                size="small"
                options={suppliers}
                getOptionLabel={(option: Supplier) =>
                  option.company_name
                    ? `${option.full_name} (${option.company_name})`
                    : option.full_name || ""
                }
                value={suppliers.find((s: Supplier) => s.id === supplierForm.supplier_id) || null}
                onChange={(_, newValue: Supplier | null) => {
                  setSupplierForm({ ...supplierForm, supplier_id: newValue?.id || 0 });
                  handleBlur("supplier_id");
                }}
                disabled={!isEditing && !isCreating}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Supplier"
                    required
                    error={hasError("supplier_id")}
                    helperText={getFieldError("supplier_id")}
                  />
                )}
              />
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(option: Branch) => `${option.branch_code} - ${option.branch_name}`}
                value={branches.find((b) => b.branch_code === supplierForm.branch_code) || null}
                onChange={(_, newValue) => {
                  setSupplierForm({ ...supplierForm, branch_code: newValue?.branch_code || "" });
                  handleBlur("branch_code");
                }}
                disabled={!isEditing && !isCreating}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Branch"
                    required
                    error={hasError("branch_code")}
                    helperText={getFieldError("branch_code")}
                  />
                )}
              />
              <TextField
                label="Payment Date"
                size="small"
                type="date"
                value={supplierForm.payment_date || ""}
                onChange={(e) => setSupplierForm({ ...supplierForm, payment_date: e.target.value })}
                onBlur={() => handleBlur("payment_date")}
                disabled={!isEditing && !isCreating}
                InputLabelProps={{ shrink: true }}
                required
                error={hasError("payment_date")}
                helperText={getFieldError("payment_date")}
              />
            </FormSection>

            <FormSection title="Payment Details" columns={3}>
              <TextField
                select
                label="Payment Method"
                size="small"
                value={supplierForm.payment_method || "Bank Transfer"}
                onChange={(e) => setSupplierForm({ ...supplierForm, payment_method: e.target.value })}
                disabled={!isEditing && !isCreating}
              >
                {GENERIC_PAYMENT_METHOD.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Amount"
                size="small"
                type="number"
                value={supplierForm.original_amount || ""}
                onChange={(e) => setSupplierForm({ ...supplierForm, original_amount: parseFloat(e.target.value) || 0 })}
                onBlur={() => handleBlur("original_amount")}
                disabled={!isEditing && !isCreating}
                required
                error={hasError("original_amount")}
                helperText={getFieldError("original_amount")}
                InputProps={{
                  startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                }}
                inputProps={{ min: 0, step: 0.01 }}
              />
              {(supplierForm.payment_method === "Bank Transfer" || supplierForm.payment_method === "Cheque") && (
                <TextField
                  label={supplierForm.payment_method === "Cheque" ? "Cheque Number" : "Reference Number"}
                  size="small"
                  value={supplierForm.reference_number || ""}
                  onChange={(e) => setSupplierForm({ ...supplierForm, reference_number: e.target.value })}
                  disabled={!isEditing && !isCreating}
                />
              )}
            </FormSection>

            {/* Bank info */}
            {(supplierForm.payment_method === "Bank Transfer" || supplierForm.payment_method === "Cheque") && (
              <FormSection title="Bank Information" columns={3}>
                <TextField
                  label="Bank Name"
                  size="small"
                  value={supplierForm.bank_name || ""}
                  onChange={(e) => setSupplierForm({ ...supplierForm, bank_name: e.target.value })}
                  disabled={!isEditing && !isCreating}
                />
              </FormSection>
            )}

            {/* Amount tracking for existing supplier records */}
            {selectedItem && !isCreating && (
              <FormSection title="Amount Tracking" columns={4}>
                <TextField
                  label="Original Amount"
                  size="small"
                  value={`Rs. ${Number(selectedItem.original_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Applied Amount"
                  size="small"
                  value={`Rs. ${Number(selectedItem.applied_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`}
                  disabled
                  InputProps={{ readOnly: true }}
                  sx={{
                    "& .MuiInputBase-input.Mui-disabled": {
                      WebkitTextFillColor: "orange",
                    },
                  }}
                />
                <TextField
                  label="Remaining Amount"
                  size="small"
                  value={`Rs. ${Number(selectedItem.remaining_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`}
                  disabled
                  InputProps={{ readOnly: true }}
                  sx={{
                    "& .MuiInputBase-input.Mui-disabled": {
                      WebkitTextFillColor: "green",
                      fontWeight: "bold",
                    },
                  }}
                />
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">Status:</Typography>
                  <Chip
                    label={selectedItem.is_fully_applied ? "Fully Applied" : "Active"}
                    size="small"
                    color={selectedItem.is_fully_applied ? "default" : "success"}
                    icon={selectedItem.is_fully_applied ? <CheckCircleIcon /> : undefined}
                  />
                </Box>
              </FormSection>
            )}

            {/* Tracking info */}
            {selectedItem && !isCreating && (
              <FormSection title="Tracking" columns={2}>
                <TextField
                  label="Created Date"
                  size="small"
                  value={selectedItem.created_at ? new Date(selectedItem.created_at).toLocaleString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Last Updated"
                  size="small"
                  value={selectedItem.updated_at ? new Date(selectedItem.updated_at).toLocaleString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
              </FormSection>
            )}

            <FormSection title="Remarks" columns={1}>
              <TextField
                label="Remarks"
                size="small"
                value={supplierForm.remarks || ""}
                onChange={(e) => setSupplierForm({ ...supplierForm, remarks: e.target.value })}
                disabled={!isEditing && !isCreating}
                multiline
                rows={2}
              />
            </FormSection>
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Advance Payments"
        icon={<WalletIcon />}
        onRefresh={refetchData}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <ConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
