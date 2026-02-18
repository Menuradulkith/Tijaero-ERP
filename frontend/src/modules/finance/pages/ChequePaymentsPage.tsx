/**
 * Cheque Payments Page - Master-Detail Layout
 * Follows the Purchasing/Sales UI pattern with Tijaero components.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Autocomplete,
  Box,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";
import {
  Receipt as ChequeIcon,
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
  TBranchFilter,
  TFilterPanel,
  TDatePicker,
} from "@/components/tijaero";

import { chequePaymentsApi } from "@/modules/finance/api";
import { ChequePayment, ChequePaymentCreate } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";

interface Branch {
  branch_code: string;
  branch_name: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: "cheque_date", label: "Cheque Date" },
  { value: "amount", label: "Amount" },
  { value: "cheque_number", label: "Cheque No." },
  { value: "from_party", label: "Party" },
];

const INITIAL_FORM_DATA: Partial<ChequePaymentCreate> = {
  cheque_number: 0,
  branch_code: 0,
  from_party: "",
  bank: "",
  amount: 0,
  cheque_date: "",
  deposit_date: "",
  remark: "",
  payment_for: "",
  invoice_no: "",
};

const resetFormFromItem = (item: ChequePayment): Partial<ChequePaymentCreate> => ({
  cheque_number: item.cheque_number || 0,
  branch_code: item.branch_code || 0,
  from_party: item.from_party || "",
  bank: item.bank || "",
  amount: Number(item.amount) || 0,
  cheque_date: item.cheque_date || "",
  deposit_date: item.deposit_date || "",
  remark: item.remark || "",
  payment_for: item.payment_for || "",
  invoice_no: item.invoice_no || "",
});

export default function ChequePaymentsPage() {
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
  } = useMasterDetailState<ChequePayment, Partial<ChequePaymentCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    favoritesKey: "cheque_payments_favorites",
    defaultSortField: "cheque_date",
  });

  const { data: refData } = useReferenceData(["branches"]);
  const branches: Branch[] = refData?.branches || [];

  const { data: cheques = [], isLoading, refetch } = useQuery({
    queryKey: ["cheque-payments", filterBranch],
    queryFn: () =>
      chequePaymentsApi.getAll({
        branch_code: filterBranch || undefined,
      }),
  });

  const filteredCheques = useMemo(() => {
    if (!cheques) return [];
    let filtered = cheques.filter(
      (c) =>
        (c.from_party || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.bank || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.invoice_no || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(c.cheque_number || "").includes(searchQuery) ||
        String(c.id).includes(searchQuery)
    );
    filtered.sort((a, b) => {
      if (sortField === "cheque_date") return new Date(b.cheque_date || "").getTime() - new Date(a.cheque_date || "").getTime();
      if (sortField === "amount") return Number(b.amount || 0) - Number(a.amount || 0);
      if (sortField === "cheque_number") return Number(b.cheque_number || 0) - Number(a.cheque_number || 0);
      const fA = a[sortField as keyof ChequePayment] || "";
      const fB = b[sortField as keyof ChequePayment] || "";
      return String(fA).localeCompare(String(fB));
    });
    return filtered;
  }, [cheques, searchQuery, sortField]);

  useEffect(() => {
    if (filteredCheques.length > 0 && !selectedItem && !isCreating) {
      handleSelectItem(filteredCheques[0]);
    }
  }, [filteredCheques, selectedItem, isCreating]);

  const handleSelectWithCheck = useCallback(
    async (item: ChequePayment) => {
      await handleSelectItem(item);
    },
    [handleSelectItem]
  );

  const masterPanel = (
    <SearchableList<ChequePayment>
      items={filteredCheques}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search cheques..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectWithCheck}
      emptyMessage="No cheque payments found"
      listHeader={
        <TFilterPanel>
          <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} />
        </TFilterPanel>
      }
      renderItem={(chq, isSelected) => (
        <SelectableListItem
          key={chq.id}
          id={chq.id}
          isSelected={isSelected}
          onClick={() => handleSelectWithCheck(chq)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>CHQ-{chq.cheque_number || chq.id}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (Cheque No.)
                  </Typography>
                )}
              </Box>
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">{chq.from_party || "-"}</Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Party)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      Rs. {Number(chq.amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Amount)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">{chq.bank || "-"}</Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Bank)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {chq.cheque_date ? new Date(chq.cheque_date).toLocaleDateString() : "-"}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Cheque Date)</Typography>
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? `${chq.from_party || "-"} - Rs. ${Number(chq.amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}` : undefined}
          isFavorite={favorites.includes(chq.id)}
          onToggleFavorite={(e) => toggleFavorite(chq.id, e)}
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Payment Methods", href: "/finance/payment-methods" },
          { label: "Cheque Payments", href: "/finance/payment-methods/cheque-payments" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Cheque" : `CHQ-${selectedItem?.cheque_number || selectedItem?.id}` }] : []),
        ]}
        title={selectedItem ? `CHQ-${selectedItem.cheque_number || selectedItem.id}` : ""}
        titleIcon={<ChequeIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Cheque Payment"
        noSelectionTitle="Select a Cheque"
        isFavorite={selectedItem ? favorites.includes(selectedItem.id) : false}
        onToggleFavorite={selectedItem ? (e) => toggleFavorite(selectedItem.id, e) : undefined}
      />

      {/* Actions disabled - read-only mode */}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a cheque payment from the list or create a new one" />
        ) : (
          <>
            <FormSection title="Cheque Information" columns={3}>
              <TextField
                label="Cheque Number"
                size="small"
                type="number"
                value={formData.cheque_number || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="From Party"
                size="small"
                value={formData.from_party || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
              <TextField
                label="Bank"
                size="small"
                value={formData.bank || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            <FormSection title="Payment Details" columns={3}>
              <TextField
                label="Amount"
                size="small"
                type="number"
                value={formData.amount || ""}
                disabled
                InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment>, readOnly: true }}
              />
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(option: Branch) => `${option.branch_code} - ${option.branch_name}`}
                value={branches.find((b) => String(b.branch_code) === String(formData.branch_code)) || null}
                disabled
                readOnly
                renderInput={(params) => <TextField {...params} label="Branch" InputProps={{ ...params.InputProps, readOnly: true }} />}
              />
              <TextField
                label="Invoice Number"
                size="small"
                value={formData.invoice_no || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            <FormSection title="Dates" columns={2}>
              <TDatePicker
                label="Cheque Date"
                value={formData.cheque_date || ""}
                onChange={() => {}}
                disabled
                size="small"
              />
              <TDatePicker
                label="Deposit Date"
                value={formData.deposit_date || ""}
                onChange={() => {}}
                disabled
                size="small"
              />
            </FormSection>

            <FormSection title="Additional Info" columns={2}>
              <TextField
                label="Payment For"
                size="small"
                value={formData.payment_for || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
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
      title="Cheque Payments"
      onRefresh={refetch}
      isLoading={isLoading}
      masterPanel={masterPanel}
      detailPanel={detailPanel}
    />
  );
}
