/**
 * Card Payments Page - Master-Detail Layout
 * Follows the Purchasing/Sales UI pattern with Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Autocomplete,
  Box,
  Chip,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";
import {
  CreditCard as CardIcon,
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
  TExportButton,
  CARD_TYPE,
  fmtLKR,
} from "@/components/tijaero";

import { cardPaymentsApi } from "@/modules/finance/api";
import { CardPayment, CardPaymentCreate } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";

interface Branch {
  branch_code: string;
  branch_name: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: "date_time", label: "Date" },
  { value: "amount", label: "Amount" },
  { value: "card_type", label: "Card Type" },
];

const INITIAL_FORM_DATA: Partial<CardPaymentCreate> = {
  card_type: "",
  amount: 0,
  remark: "",
  ref_number: "",
  invoice_no: "",
  deposited: false,
};

const resetFormFromItem = (item: CardPayment): Partial<CardPaymentCreate> => ({
  card_type: item.card_type || "",
  amount: Number(item.amount) || 0,
  remark: item.remark || "",
  ref_number: item.ref_number || "",
  invoice_no: item.invoice_no || "",
  deposited: item.deposited ?? false,
});

const getCardColor = (type: string): "primary" | "secondary" | "info" | "default" => {
  switch ((type || "").toUpperCase()) {
    case "VISA": return "primary";
    case "MASTERCARD": return "secondary";
    case "AMEX": return "info";
    default: return "default";
  }
};

export default function CardPaymentsPage() {
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
  } = useMasterDetailState<CardPayment, Partial<CardPaymentCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    favoritesKey: "card_payments_favorites",
    defaultSortField: "date_time",
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
    queryKey: ["card-payments", filterBranch],
    queryFn: () =>
      cardPaymentsApi.getAll({
        branch_code: filterBranch || undefined,
      }),
    enabled: branchResolved,
    placeholderData: (prev) => prev,
  });

  const filteredPayments = useMemo(() => {
    if (!payments) return [];
    let filtered = payments.filter(
      (p) =>
        (p.card_type || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.ref_number || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.invoice_no || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(p.id).includes(searchQuery)
    );
    filtered.sort((a, b) => {
      if (sortField === "date_time") {
        const diff = new Date(b.date_time || "").getTime() - new Date(a.date_time || "").getTime();
        return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
      }
      if (sortField === "amount") return Number(b.amount || 0) - Number(a.amount || 0);
      const fA = a[sortField as keyof CardPayment] || "";
      const fB = b[sortField as keyof CardPayment] || "";
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
    async (item: CardPayment) => {
      await handleSelectItem(item);
    },
    [handleSelectItem]
  );

  const masterPanel = (
    <SearchableList<CardPayment>
      items={filteredPayments}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search card payments..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectWithCheck}
      emptyMessage="No card payments found"
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
                <span>{pmt.ref_number || `Card #${pmt.id}`}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (Ref)
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
                      {pmt.date_time ? new Date(pmt.date_time).toLocaleDateString() : "-"}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Date)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                    <Chip label={pmt.card_type || "N/A"} size="small" color={getCardColor(pmt.card_type)} sx={{ height: 18, fontSize: "0.65rem" }} />
                    {pmt.deposited && <Chip label="Deposited" size="small" color="success" sx={{ height: 18, fontSize: "0.65rem" }} />}
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? `Rs. ${fmtLKR(Number(pmt.amount || 0))} - ${pmt.card_type || ""}` : undefined}
          isFavorite={favorites.includes(pmt.id)}
          onToggleFavorite={(e) => toggleFavorite(pmt.id, e)}
          statusChip={!isSelected ? { label: pmt.card_type || "N/A", color: getCardColor(pmt.card_type) as "primary" | "secondary" | "info" | "default" } : undefined}
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
          { label: "Card Payments", href: "/finance/customer-payment-methods/card-payments" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Payment" : `Payment #${selectedItem?.id}` }] : []),
        ]}
        title={selectedItem ? (selectedItem.ref_number || `Payment #${selectedItem.id}`) : ""}
        titleIcon={<CardIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Card Payment"
        noSelectionTitle="Select a Payment"
        isFavorite={selectedItem ? favorites.includes(selectedItem.id) : false}
        onToggleFavorite={selectedItem ? (e) => toggleFavorite(selectedItem.id, e) : undefined}
      />

      {/* Actions disabled - read-only mode */}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a card payment from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Card Information" columns={3}>
              <Autocomplete
                size="small"
                options={CARD_TYPE.map((ct) => ct.value)}
                getOptionLabel={(option) => CARD_TYPE.find((ct) => ct.value === option)?.label || option}
                value={formData.card_type || null}
                disabled
                readOnly
                renderInput={(params) => (
                  <TextField {...params} label="Card Type" InputProps={{ ...params.InputProps, readOnly: true }} />
                )}
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
                label="Reference Number"
                size="small"
                value={formData.ref_number || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            <FormSection title="Reference Details" columns={2}>
              <TextField
                label="Invoice Number"
                size="small"
                value={formData.invoice_no || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2" color="text.secondary">Deposited:</Typography>
                <Chip
                  label={formData.deposited ? "Yes" : "No"}
                  size="small"
                  color={formData.deposited ? "success" : "default"}
                />
              </Box>
            </FormSection>

            {selectedItem && !isCreating && (
              <FormSection title="Date" columns={1}>
                <TextField
                  label="Payment Date"
                  size="small"
                  value={selectedItem.date_time ? new Date(selectedItem.date_time).toLocaleString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
              </FormSection>
            )}

            <FormSection title="Remarks" columns={1}>
              <TextField
                label="Remark"
                size="small"
                value={formData.remark || ""}
                disabled
                InputProps={{ readOnly: true }}
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
    <MasterDetailLayout
      title="Card Payments"
      onRefresh={refetch}
      isLoading={isLoading}
      headerActions={
        <TExportButton
          filename={`card_payments_${new Date().toISOString().split("T")[0]}`}
          headers={["ID", "Ref Number", "Card Type", "Amount", "Invoice No", "Deposited", "Date", "Remark"]}
          rows={() =>
            filteredPayments.map((p) => [
              p.id,
              p.ref_number || "",
              p.card_type || "",
              Number(p.amount || 0),
              p.invoice_no || "",
              p.deposited ? "Yes" : "No",
              p.date_time ? new Date(p.date_time).toLocaleString() : "",
              p.remark || "",
            ])
          }
          disabled={filteredPayments.length === 0}
        />
      }
      masterPanel={masterPanel}
      detailPanel={detailPanel}
    />
  );
}
