/**
 * Credit Payments Page - Master-Detail Layout
 * Follows the standard ERP master-detail pattern using Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Chip,
  TextField,
  Typography,
} from "@mui/material";
import {
  CreditScore as CreditIcon,
} from "@mui/icons-material";

import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  useMasterDetailState,
  SortOption,
  TDetailSkeleton,
  TBranchFilter,
  TFilterPanel,
  fmtLKR,
} from "@/components/tijaero";

import { creditPaymentsApi } from "@/modules/finance/api";
import { CreditPayment } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";

interface Branch {
  branch_code: string;
  branch_name: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date Created" },
  { value: "amount", label: "Amount" },
  { value: "due_date", label: "Due Date" },
];

const INITIAL_FORM_DATA: Partial<CreditPayment> = {
  customer_name: "",
  invoice_no: "",
  amount: 0,
  credit_terms: "",
  due_date: "",
  status: "pending",
};

const resetFormFromItem = (item: CreditPayment): Partial<CreditPayment> => ({
  customer_name: item.customer_name || "",
  invoice_no: item.invoice_no || "",
  amount: Number(item.amount) || 0,
  credit_terms: item.credit_terms || "",
  due_date: item.due_date || "",
  status: item.status || "pending",
});

const getStatusColor = (status: string): "warning" | "success" | "error" | "default" => {
  switch ((status || "").toLowerCase()) {
    case "pending": return "warning";
    case "settled":
    case "active":
    case "paid":
      return "success";
    case "overdue": return "error";
    default: return "default";
  }
};

export default function CreditPaymentsPage() {
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    selectedItem,
    isCreating,
    favorites,
    toggleFavorite,
    formData,
    handleSelectItem,
  } = useMasterDetailState<CreditPayment, Partial<CreditPayment>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    favoritesKey: "credit_payments_favorites",
    defaultSortField: "created_date",
  });

  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches: Branch[] = filteredBranches || [];

  // Auto-default branch filter for non-superuser users
  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: payments = [], isLoading, refetch } = useQuery({
    queryKey: ["credit-payments", filterBranch],
    queryFn: () =>
      creditPaymentsApi.getAll({
        branch_code: filterBranch || undefined,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const filteredPayments = useMemo(() => {
    if (!payments) return [];
    let filtered = payments.filter(
      (p) =>
        (p.customer_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.invoice_no || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.status || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(p.id).includes(searchQuery)
    );
    filtered.sort((a, b) => {
      if (sortField === "created_date") return new Date(b.created_date || "").getTime() - new Date(a.created_date || "").getTime();
      if (sortField === "due_date") return new Date(a.due_date || "").getTime() - new Date(b.due_date || "").getTime();
      if (sortField === "amount") return Number(b.amount || 0) - Number(a.amount || 0);
      const fA = a[sortField as keyof CreditPayment] || "";
      const fB = b[sortField as keyof CreditPayment] || "";
      return String(fA).localeCompare(String(fB));
    });
    return filtered;
  }, [payments, searchQuery, sortField]);

  useEffect(() => {
    if (filteredPayments.length > 0 && !selectedItem && !isCreating) {
      handleSelectItem(filteredPayments[0]);
    }
  }, [filteredPayments, selectedItem, isCreating]);

  const handleSelectWithCheck = useCallback(
    async (item: CreditPayment) => {
      await handleSelectItem(item);
    },
    [handleSelectItem]
  );

  const masterPanel = (
    <SearchableList<CreditPayment>
      items={filteredPayments}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search credit payments..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectWithCheck}
      emptyMessage="No credit payments found"
      listHeader={
        <TFilterPanel>
          <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} />
        </TFilterPanel>
      }
      renderItem={(pmt, isSelected) => (
        <SelectableListItem
          key={pmt.id}
          id={pmt.id}
          isSelected={isSelected}
          onClick={() => handleSelectWithCheck(pmt)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: "bold" }}>{pmt.customer_name || `Customer #${pmt.customer_id}`}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (Customer)
                  </Typography>
                )}
              </Box>
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      Rs. {fmtLKR(Number(pmt.amount || 0))}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Amount)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {pmt.invoice_no || "-"}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Invoice No)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {pmt.due_date ? new Date(pmt.due_date).toLocaleDateString() : "-"}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Due Date)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                    <Chip label={pmt.status || "pending"} size="small" color={getStatusColor(pmt.status)} sx={{ height: 18, fontSize: "0.65rem" }} />
                    <Chip label={pmt.credit_terms || "N/A"} size="small" sx={{ height: 18, fontSize: "0.65rem" }} />
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? `Rs. ${fmtLKR(Number(pmt.amount || 0))} - ${pmt.invoice_no || "No Invoice"}` : undefined}
          isFavorite={favorites.includes(pmt.id)}
          onToggleFavorite={(e) => toggleFavorite(pmt.id, e)}
          statusChip={!isSelected ? { label: pmt.status || "pending", color: getStatusColor(pmt.status) } : undefined}
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Customer Payment Methods", href: "/finance/customer-payment-methods" },
          { label: "Credit Payments", href: "/finance/customer-payment-methods/credit-payments" },
          ...(selectedItem || isCreating ? [{ label: `Credit Payment #${selectedItem?.id}` }] : []),
        ]}
        title={selectedItem ? (selectedItem.customer_name || `Payment #${selectedItem.id}`) : ""}
        titleIcon={<CreditIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Credit Payment"
        noSelectionTitle="Select a Credit Payment"
        isFavorite={selectedItem ? favorites.includes(selectedItem.id) : false}
        onToggleFavorite={selectedItem ? (e) => toggleFavorite(selectedItem.id, e) : undefined}
      />

      {/* Actions disabled - read-only mode */}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a customer credit payment from the list to view its details" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Customer & Financial Details" columns={3}>
              <TextField
                label="Customer Name"
                size="small"
                value={formData.customer_name || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Amount"
                size="small"
                type="number"
                value={Number(formData.amount) || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Invoice Number"
                size="small"
                value={formData.invoice_no || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            <FormSection title="Credit Terms & Schedule" columns={3}>
              <TextField
                label="Credit Terms"
                size="small"
                value={formData.credit_terms || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Due Date"
                size="small"
                value={formData.due_date ? new Date(formData.due_date).toLocaleDateString() : "-"}
                disabled
                InputProps={{ readOnly: true }}
              />
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2" color="text.secondary">Status:</Typography>
                <Chip
                  label={formData.status ? (formData.status.charAt(0).toUpperCase() + formData.status.slice(1)) : "Pending"}
                  size="small"
                  color={getStatusColor(formData.status || "")}
                />
              </Box>
            </FormSection>

            {selectedItem && !isCreating && (
              <FormSection title="Metadata & Audit" columns={2}>
                <TextField
                  label="Date Created"
                  size="small"
                  value={selectedItem.created_date ? new Date(selectedItem.created_date).toLocaleString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Status Update"
                  size="small"
                  value={selectedItem.status ? `Payment is currently ${selectedItem.status}` : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
              </FormSection>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <MasterDetailLayout
      title="Credit Payments"
      onRefresh={refetch}
      isLoading={isLoading}
      masterPanel={masterPanel}
      detailPanel={detailPanel}
    />
  );
}
