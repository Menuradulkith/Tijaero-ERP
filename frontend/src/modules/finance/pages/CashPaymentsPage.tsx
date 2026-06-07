/**
 * Cash Payments Page - Master-Detail Layout
 * Follows the standard ERP master-detail pattern using Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  TextField,
  Typography,
} from "@mui/material";
import {
  LocalAtm as CashIcon,
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

import { cashPaymentsApi } from "@/modules/finance/api";
import { CashPayment } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";

interface Branch {
  branch_code: string;
  branch_name: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: "created_date_time", label: "Date & Time" },
  { value: "amount", label: "Amount" },
];

const INITIAL_FORM_DATA: Partial<CashPayment> = {
  customer_name: "",
  invoice_no: "",
  amount: 0,
  remarks: "",
  branch_code: "",
  created_date: "",
};

const resetFormFromItem = (item: CashPayment): Partial<CashPayment> => ({
  customer_name: item.customer_name || "",
  invoice_no: item.invoice_no || "",
  amount: Number(item.amount) || 0,
  remarks: item.remarks || "",
  branch_code: item.branch_code || "",
  created_date: item.created_date || "",
});

export default function CashPaymentsPage() {
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
  } = useMasterDetailState<CashPayment, Partial<CashPayment>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    favoritesKey: "cash_payments_favorites",
    defaultSortField: "created_date_time",
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
    queryKey: ["cash-payments", filterBranch],
    queryFn: () =>
      cashPaymentsApi.getAll({
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
        (p.remarks || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(p.id).includes(searchQuery)
    );
    filtered.sort((a, b) => {
      if (sortField === "created_date_time") {
        const diff = new Date(b.created_date_time || "").getTime() - new Date(a.created_date_time || "").getTime();
        return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
      }
      if (sortField === "amount") return Number(b.amount || 0) - Number(a.amount || 0);
      const fA = a[sortField as keyof CashPayment] || "";
      const fB = b[sortField as keyof CashPayment] || "";
      const comp = String(fA).localeCompare(String(fB));
      return comp !== 0 ? comp : (b.id || 0) - (a.id || 0);
    });
    return filtered;
  }, [payments, searchQuery, sortField]);

  useEffect(() => {
    if (filteredPayments.length > 0 && !selectedItem && !isCreating) {
      handleSelectItem(filteredPayments[0]);
    }
  }, [filteredPayments, selectedItem, isCreating]);

  const handleSelectWithCheck = useCallback(
    async (item: CashPayment) => {
      await handleSelectItem(item);
    },
    [handleSelectItem]
  );

  const masterPanel = (
    <SearchableList<CashPayment>
      items={filteredPayments}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search cash payments..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectWithCheck}
      emptyMessage="No cash payments found"
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
                      {pmt.created_date_time ? new Date(pmt.created_date_time).toLocaleString() : "-"}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Date & Time)</Typography>
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? `Rs. ${fmtLKR(Number(pmt.amount || 0))} - ${pmt.invoice_no || "No Invoice"}` : undefined}
          isFavorite={favorites.includes(pmt.id)}
          onToggleFavorite={(e) => toggleFavorite(pmt.id, e)}
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
          { label: "Cash Payments", href: "/finance/customer-payment-methods/cash-payments" },
          ...(selectedItem || isCreating ? [{ label: `Cash Payment #${selectedItem?.id}` }] : []),
        ]}
        title={selectedItem ? (selectedItem.customer_name || `Payment #${selectedItem.id}`) : ""}
        titleIcon={<CashIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Cash Payment"
        noSelectionTitle="Select a Cash Payment"
        isFavorite={selectedItem ? favorites.includes(selectedItem.id) : false}
        onToggleFavorite={selectedItem ? (e) => toggleFavorite(selectedItem.id, e) : undefined}
      />

      {/* Actions disabled - read-only mode */}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a customer cash payment from the list to view its details" />
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

            <FormSection title="Transaction Information" columns={3}>
              <TextField
                label="Branch Code"
                size="small"
                value={formData.branch_code || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Date & Time"
                size="small"
                value={selectedItem?.created_date_time ? new Date(selectedItem.created_date_time).toLocaleString() : "-"}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Remarks"
                size="small"
                value={formData.remarks || "-"}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            {selectedItem && !isCreating && (
              <FormSection title="Metadata & Audit" columns={2}>
                <TextField
                  label="Date Created (Date)"
                  size="small"
                  value={selectedItem.created_date ? new Date(selectedItem.created_date).toLocaleDateString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                <TextField
                  label="Created By User ID"
                  size="small"
                  value={selectedItem.created_by || "System"}
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
      title="Cash Payments"
      onRefresh={refetch}
      isLoading={isLoading}
      masterPanel={masterPanel}
      detailPanel={detailPanel}
    />
  );
}
