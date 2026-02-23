/**
 * Bank Deposits Page - Master-Detail Layout
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
  AccountBalance as BankIcon,
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
  TStatusFilter,
} from "@/components/tijaero";

import { bankDepositsApi } from "@/modules/finance/api";
import { BankDeposit, BankDepositCreate } from "@/modules/finance/types";
import { useReferenceData } from "@/hooks";

interface Branch {
  branch_code: string;
  branch_name: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: "created_date", label: "Date" },
  { value: "deposits_amount", label: "Amount" },
  { value: "bank_name", label: "Bank" },
];

const INITIAL_FORM_DATA: Partial<BankDepositCreate> = {
  deposits_amount: 0,
  branch_code: "",
  bank_name: "",
  remarks: "",
  payment_for: "",
  invoice_no: "",
};

const resetFormFromItem = (item: BankDeposit): Partial<BankDepositCreate> => ({
  deposits_amount: Number(item.deposits_amount) || 0,
  branch_code: item.branch_code || "",
  bank_name: item.bank_name || "",
  remarks: item.remarks || "",
  payment_for: item.payment_for || "",
  invoice_no: item.invoice_no || "",
});

export default function BankDepositsPage() {
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterVerified, setFilterVerified] = useState<string | null>(null);

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
  } = useMasterDetailState<BankDeposit, Partial<BankDepositCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    favoritesKey: "bank_deposits_favorites",
    defaultSortField: "created_date",
  });

  const { filteredBranches } = useReferenceData(["branches"]);
  const branches: Branch[] = filteredBranches || [];

  const { data: deposits = [], isLoading, refetch } = useQuery({
    queryKey: ["bank-deposits", filterBranch, filterVerified],
    queryFn: () =>
      bankDepositsApi.getAll({
        branch_code: filterBranch || undefined,
        verified: filterVerified === null ? undefined : filterVerified === "verified",
      }),
  });

  const filteredDeposits = useMemo(() => {
    if (!deposits) return [];
    let filtered = deposits.filter(
      (d) =>
        (d.bank_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (d.invoice_no || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (d.payment_for || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(d.id).includes(searchQuery)
    );
    filtered.sort((a, b) => {
      if (sortField === "created_date") return new Date(b.created_date || "").getTime() - new Date(a.created_date || "").getTime();
      if (sortField === "deposits_amount") return Number(b.deposits_amount || 0) - Number(a.deposits_amount || 0);
      const fA = a[sortField as keyof BankDeposit] || "";
      const fB = b[sortField as keyof BankDeposit] || "";
      return String(fA).localeCompare(String(fB));
    });
    return filtered;
  }, [deposits, searchQuery, sortField]);

  useEffect(() => {
    if (filteredDeposits.length > 0 && !selectedItem && !isCreating) {
      handleSelectItem(filteredDeposits[0]);
    }
  }, [filteredDeposits, selectedItem, isCreating]);

  const handleSelectWithCheck = useCallback(
    async (item: BankDeposit) => {
      await handleSelectItem(item);
    },
    [handleSelectItem]
  );

  const masterPanel = (
    <SearchableList<BankDeposit>
      items={filteredDeposits}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search deposits..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectWithCheck}
      emptyMessage="No bank deposits found"
      listHeader={
        <TFilterPanel>
          <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} />
          <TStatusFilter
            options={[
              { value: null, label: "All" },
              { value: "verified", label: "Verified" },
              { value: "pending", label: "Pending" },
            ]}
            value={filterVerified}
            onChange={setFilterVerified}
            label="Status"
          />
        </TFilterPanel>
      }
      renderItem={(dep, isSelected) => (
        <SelectableListItem
          key={dep.id}
          id={dep.id}
          isSelected={isSelected}
          onClick={() => handleSelectWithCheck(dep)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{dep.bank_name || `Deposit #${dep.id}`}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (Bank)
                  </Typography>
                )}
              </Box>
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      Rs. {Number(dep.deposits_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Amount)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">{dep.branch_code || "-"}</Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Branch)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {dep.created_date ? new Date(dep.created_date).toLocaleDateString() : "-"}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Date)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                    <Chip label={dep.verified ? "Verified" : "Pending"} size="small" color={dep.verified ? "success" : "warning"} sx={{ height: 18, fontSize: "0.65rem" }} />
                  </Box>
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? `Rs. ${Number(dep.deposits_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2 })} - ${dep.branch_code || ""}` : undefined}
          isFavorite={favorites.includes(dep.id)}
          onToggleFavorite={(e) => toggleFavorite(dep.id, e)}
          statusChip={!isSelected ? (dep.verified ? { label: "Verified", color: "success" } : { label: "Pending", color: "warning" }) : undefined}
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
          { label: "Bank Deposits", href: "/finance/payment-methods/bank-deposits" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Deposit" : `Deposit #${selectedItem?.id}` }] : []),
        ]}
        title={selectedItem ? (selectedItem.bank_name || `Deposit #${selectedItem.id}`) : ""}
        titleIcon={<BankIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Bank Deposit"
        noSelectionTitle="Select a Deposit"
        isFavorite={selectedItem ? favorites.includes(selectedItem.id) : false}
        onToggleFavorite={selectedItem ? (e) => toggleFavorite(selectedItem.id, e) : undefined}
      />

      {/* Actions disabled - read-only mode */}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a bank deposit from the list or create a new one" />
        ) : (
          <>
            <FormSection title="Deposit Information" columns={3}>
              <TextField
                label="Deposit Amount"
                size="small"
                type="number"
                value={formData.deposits_amount || ""}
                disabled
                InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment>, readOnly: true }}
              />
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(option: Branch) => `${option.branch_code} - ${option.branch_name}`}
                value={branches.find((b) => b.branch_code === formData.branch_code) || null}
                disabled
                readOnly
                renderInput={(params) => (
                  <TextField {...params} label="Branch" InputProps={{ ...params.InputProps, readOnly: true }} />
                )}
              />
              <TextField
                label="Bank Name"
                size="small"
                value={formData.bank_name || ""}
                disabled
                InputProps={{ readOnly: true }}
              />
            </FormSection>

            <FormSection title="Reference Details" columns={2}>
              <TextField
                label="Payment For"
                size="small"
                value={formData.payment_for || ""}
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

            {selectedItem && !isCreating && (
              <FormSection title="Status" columns={3}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2" color="text.secondary">Verification:</Typography>
                  <Chip label={selectedItem.verified ? "Verified" : "Pending"} size="small" color={selectedItem.verified ? "success" : "warning"} />
                </Box>
                <TextField
                  label="Created Date"
                  size="small"
                  value={selectedItem.created_date ? new Date(selectedItem.created_date).toLocaleString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
                {selectedItem.returned !== undefined && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">Returned:</Typography>
                    <Chip label={selectedItem.returned ? "Yes" : "No"} size="small" color={selectedItem.returned ? "error" : "default"} />
                  </Box>
                )}
              </FormSection>
            )}

            <FormSection title="Remarks" columns={1}>
              <TextField
                label="Remarks"
                size="small"
                value={formData.remarks || ""}
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
      title="Bank Deposits"
      onRefresh={refetch}
      isLoading={isLoading}
      masterPanel={masterPanel}
      detailPanel={detailPanel}
    />
  );
}
