/**
 * Credit Notes Page - Master-Detail Layout
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
  NoteAlt as CreditNoteIcon,
} from "@mui/icons-material";

import {
  ActionToolbar,
  canPrintDocument,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  TPrintButton,
  TPrintPreviewDialog,
  useMasterDetailState,
  SortOption,
  TDetailSkeleton,
  TFilterPanel,
  fmtLKR,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";

import { creditNotesApi } from "@/modules/finance/api";
import { CustomerCreditNote, CustomerCreditNoteCreate } from "@/modules/finance/types";
import { customersApi } from "@/modules/customers/api";

interface Customer {
  id: number;
  customer_name: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: "date", label: "Date" },
  { value: "amount", label: "Amount" },
  { value: "customer_id", label: "Customer" },
];

const INITIAL_FORM_DATA: Partial<CustomerCreditNoteCreate> = {
  customer_id: 0,
  amount: 0,
  remark: "",
  invoice_no: "",
};

const resetFormFromItem = (item: CustomerCreditNote): Partial<CustomerCreditNoteCreate> => ({
  customer_id: item.customer_id || 0,
  amount: Number(item.amount) || 0,
  remark: item.remark || "",
  invoice_no: item.invoice_no || "",
});

export default function CreditNotesPage() {
  const canViewCustomers = usePermission("customers", "view");
  const [filterCustomerId, setFilterCustomerId] = useState<number | null>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedItemForPrint, setSelectedItemForPrint] = useState<CustomerCreditNote | null>(null);

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
  } = useMasterDetailState<CustomerCreditNote, Partial<CustomerCreditNoteCreate>>({
    initialFormData: INITIAL_FORM_DATA,
    resetFormFromItem,
    favoritesKey: "credit_notes_favorites",
    defaultSortField: "date",
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
    enabled: canViewCustomers,
  });

  const { data: creditNotes = [], isLoading, refetch } = useQuery({
    queryKey: ["credit-notes", filterCustomerId],
    queryFn: () =>
      creditNotesApi.getAll({
        customer_id: filterCustomerId || undefined,
      }),
  });

  const getCustomerName = useCallback(
    (customerId: number): string => {
      const customer = customers.find((c: Customer) => c.id === customerId);
      return customer?.customer_name || `Customer #${customerId}`;
    },
    [customers]
  );

  const filteredNotes = useMemo(() => {
    if (!creditNotes) return [];
    let filtered = creditNotes.filter(
      (n) =>
        getCustomerName(n.customer_id).toLowerCase().includes(searchQuery.toLowerCase()) ||
        (n.invoice_no || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (n.remark || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(n.id).includes(searchQuery)
    );
    filtered.sort((a, b) => {
      if (sortField === "date") return new Date(b.date || "").getTime() - new Date(a.date || "").getTime();
      if (sortField === "amount") return Number(b.amount || 0) - Number(a.amount || 0);
      const fA = a[sortField as keyof CustomerCreditNote] || "";
      const fB = b[sortField as keyof CustomerCreditNote] || "";
      return String(fA).localeCompare(String(fB));
    });
    return filtered;
  }, [creditNotes, searchQuery, sortField, getCustomerName]);

  useEffect(() => {
    if (filteredNotes.length > 0 && !selectedItem && !isCreating) {
      handleSelectItem(filteredNotes[0]);
    }
  }, [filteredNotes, selectedItem, isCreating]);

  const handleSelectWithCheck = useCallback(
    async (item: CustomerCreditNote) => {
      await handleSelectItem(item);
    },
    [handleSelectItem]
  );

  const selectedCustomer = useMemo(
    () => customers.find((c: Customer) => c.id === formData.customer_id) || null,
    [customers, formData.customer_id]
  );

  const filterCustomer = useMemo(
    () => customers.find((c: Customer) => c.id === filterCustomerId) || null,
    [customers, filterCustomerId]
  );

  const masterPanel = (
    <SearchableList<CustomerCreditNote>
      items={filteredNotes}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search credit notes..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectWithCheck}
      emptyMessage="No credit notes found"
      listHeader={
        <TFilterPanel>
          <Autocomplete
            size="small"
            options={customers}
            getOptionLabel={(option: Customer) => option.customer_name || `Customer #${option.id}`}
            value={filterCustomer}
            onChange={(_, newValue) => setFilterCustomerId(newValue?.id || null)}
            renderInput={(params) => <TextField {...params} label="Filter by Customer" placeholder="All Customers" />}
            sx={{ minWidth: 200 }}
          />
        </TFilterPanel>
      }
      renderItem={(note, isSelected) => (
        <SelectableListItem
          key={note.id}
          id={note.id}
          isSelected={isSelected}
          onClick={() => handleSelectWithCheck(note)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{`CN-${note.id}`}</span>
                {isSelected && (
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (Credit Note)
                  </Typography>
                )}
              </Box>
              {isSelected && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">{getCustomerName(note.customer_id)}</Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Customer)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      Rs. {fmtLKR(Number(note.amount || 0))}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Amount)</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography component="span" variant="caption">
                      {note.date ? new Date(note.date).toLocaleDateString() : "-"}
                    </Typography>
                    <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Date)</Typography>
                  </Box>
                  {note.invoice_no && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography component="span" variant="caption">{note.invoice_no}</Typography>
                      <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>(Invoice)</Typography>
                    </Box>
                  )}
                </>
              )}
            </Box>
          }
          secondaryText={!isSelected ? `${getCustomerName(note.customer_id)} - Rs. ${fmtLKR(Number(note.amount || 0))}` : undefined}
          isFavorite={favorites.includes(note.id)}
          onToggleFavorite={(e) => toggleFavorite(note.id, e)}
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
          { label: "Credit Notes", href: "/finance/payment-methods/credit-notes" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Credit Note" : `CN-${selectedItem?.id}` }] : []),
        ]}
        title={selectedItem ? `CN-${selectedItem.id}` : ""}
        titleIcon={<CreditNoteIcon color="primary" />}
        isCreating={isCreating}
        createTitle="New Credit Note"
        noSelectionTitle="Select a Credit Note"
        isFavorite={selectedItem ? favorites.includes(selectedItem.id) : false}
        onToggleFavorite={selectedItem ? (e) => toggleFavorite(selectedItem.id, e) : undefined}
      />

      <ActionToolbar
        hasSelectedItem={!!selectedItem}
        isCreating={isCreating}
        isEditing={false}
        canCreate={false}
        canUpdate={false}
        canDelete={false}
        endActions={
          selectedItem && !isCreating ? (
            <TPrintButton
              documentType="credit-note"
              documentId={selectedItem.id}
              disabled={!canPrintDocument("approved", [])}
              disabledReason="Cannot print this credit note"
              tooltip="Print Credit Note"
              onClick={() => {
                setSelectedItemForPrint(selectedItem);
                setPrintDialogOpen(true);
              }}
            />
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a credit note from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Credit Note Information" columns={2}>
              <Autocomplete
                size="small"
                options={customers}
                getOptionLabel={(option: Customer) => option.customer_name || `Customer #${option.id}`}
                value={selectedCustomer}
                disabled
                readOnly
                renderInput={(params) => (
                  <TextField {...params} label="Customer" InputProps={{ ...params.InputProps, readOnly: true }} />
                )}
              />
              <TextField
                label="Amount"
                size="small"
                type="number"
                value={formData.amount || ""}
                disabled
                InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment>, readOnly: true }}
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
              {selectedItem && !isCreating && (
                <TextField
                  label="Date"
                  size="small"
                  value={selectedItem.date ? new Date(selectedItem.date).toLocaleString() : "-"}
                  disabled
                  InputProps={{ readOnly: true }}
                />
              )}
            </FormSection>

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
    <>
      <MasterDetailLayout
        title="Credit Notes"
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />

      {/* Print Preview Dialog */}
      {selectedItemForPrint && (
        <TPrintPreviewDialog
          open={printDialogOpen}
          onClose={() => {
            setPrintDialogOpen(false);
            setSelectedItemForPrint(null);
          }}
          documentType="credit-note"
          documentId={selectedItemForPrint.id}
          title={`Print Credit Note: CN-${selectedItemForPrint.id}`}
        />
      )}
    </>
  );
}
