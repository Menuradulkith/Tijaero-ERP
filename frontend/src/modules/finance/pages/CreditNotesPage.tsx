/**
 * Credit Notes Page - Master-Detail Layout
 * Follows the Purchasing/Sales UI pattern with Tijaero components.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  NoteAlt as CreditNoteIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  ArrowBack as ArrowBackIcon,
  Star as StarIcon,
  StarBorder as StarOutlineIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import type { GridRenderCellParams } from "@mui/x-data-grid";

import {
  ActionToolbar,
  canPrintDocument,
  MasterDetailLayout,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  SelectableListItem,
  TPrintButton,
  TPrintPreviewDialog,
  useMasterDetailState,
  TDetailSkeleton,
  TExportButton,
  fmtLKR,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";

import { creditNotesApi } from "@/modules/finance/api";
import { CustomerCreditNote, CustomerCreditNoteCreate } from "@/modules/finance/types";
import { customersApi } from "@/modules/customers/api";

interface Customer {
  id: number;
  customer_name: string;
}

// A credit note row as shown in the browse table, with the customer name
// looked up and attached directly so the grid's own column-header sort
// orders by the displayed name rather than the raw customer_id.
type CreditNoteRow = CustomerCreditNote & { customer_name: string };

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
  // Filter state - all filters apply live as the user types/selects, no
  // separate "Search" step needed.
  const [filterCustomerId, setFilterCustomerId] = useState<number | null>(null);

  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [selectedItemForPrint, setSelectedItemForPrint] = useState<CustomerCreditNote | null>(null);

  const {
    searchQuery,
    setSearchQuery,
    selectedItem,
    setSelectedItem,
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

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterCustomerId(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Default order before the user sorts a column in the table itself (the
    // table's own column-header sort takes over from there) — newest first.
    filtered.sort((a, b) => {
      const diff = new Date(b.date || "").getTime() - new Date(a.date || "").getTime();
      return diff !== 0 ? diff : (b.id || 0) - (a.id || 0);
    });
    return filtered;
  }, [creditNotes, searchQuery, getCustomerName]);

  // The Customer column displays a looked-up name rather than the raw
  // customer_id, so it needs that name as its own field for the grid to
  // sort on correctly.
  const creditNoteRows: CreditNoteRow[] = useMemo(
    () => filteredNotes.map((n) => ({ ...n, customer_name: getCustomerName(n.customer_id) })),
    [filteredNotes, getCustomerName]
  );

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

  // The table sorts by whichever column the user clicks via the grid's own
  // column header menu, not a separate "Sort by" control.
  const creditNoteColumns: TDataGridColumn<CreditNoteRow>[] = useMemo(
    () => [
      {
        field: "favorite",
        header: "",
        width: 48,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<CreditNoteRow>) => (
          <IconButton size="small" onClick={(e) => toggleFavorite(params.row.id, e)}>
            {favorites.includes(params.row.id) ? (
              <StarIcon fontSize="small" color="warning" />
            ) : (
              <StarOutlineIcon fontSize="small" color="action" />
            )}
          </IconButton>
        ),
      },
      {
        field: "id",
        header: "Credit Note No",
        width: 150,
        renderCell: (params: GridRenderCellParams<CreditNoteRow>) => `CN-${params.row.id}`,
      },
      { field: "customer_name", header: "Customer", flex: 1, minWidth: 170 },
      {
        field: "date",
        header: "Date",
        width: 130,
        renderCell: (params: GridRenderCellParams<CreditNoteRow>) =>
          params.row.date ? new Date(params.row.date).toLocaleDateString() : "-",
      },
      {
        field: "amount",
        header: "Amount",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<CreditNoteRow>) =>
          `Rs. ${fmtLKR(Number(params.row.amount || 0))}`,
      },
      { field: "invoice_no", header: "Invoice No", width: 140 },
      { field: "remark", header: "Reason", flex: 1, minWidth: 180 },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<CreditNoteRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectWithCheck(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [favorites, toggleFavorite, handleSelectWithCheck]
  );

  // Whether we're showing a single credit note's detail view (this page is
  // view-only, so this is just "is something selected").
  const isCreditNoteDetailMode = !!selectedItem || isCreating;

  // Browse mode: a full-width table of every credit note.
  const creditNoteTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<CreditNoteRow>
          rows={creditNoteRows}
          columns={creditNoteColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectWithCheck(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No credit notes found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Returns to the browse table from the detail view.
  const handleBackToCreditNotes = useCallback(() => {
    setSelectedItem(null);
  }, [setSelectedItem]);

  // Detail mode: a narrow left panel showing only the current credit note,
  // plus a "Back to Credit Notes" link that returns to the table.
  const singleCreditNotePanel = (
    <Paper
      elevation={0}
      sx={{
        width: 280,
        minWidth: 240,
        maxWidth: 300,
        borderRight: 1,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon fontSize="small" />}
          onClick={handleBackToCreditNotes}
          sx={{ textTransform: "none" }}
        >
          Back to Credit Notes
        </Button>
      </Box>
      {selectedItem && (
        <SelectableListItem
          id={selectedItem.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ width: 36, height: 36 }}>
                <CreditNoteIcon fontSize="small" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5, minWidth: 0 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{`CN-${selectedItem.id}`}</span>
                  <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                    (Credit Note No)
                  </Typography>
                </Box>
              </Box>
            </Box>
          }
          isFavorite={favorites.includes(selectedItem.id)}
          onToggleFavorite={(e) => toggleFavorite(selectedItem.id, e)}
        />
      )}
    </Paper>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Customer Payment Methods", href: "/finance/customer-payment-methods" },
          { label: "Credit Notes", href: "/finance/customer-payment-methods/credit-notes" },
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
                value={Number(formData.amount) || ""}
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
        titleSlot={
          isCreditNoteDetailMode ? undefined : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search credit notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 220, flexShrink: 0 }}
            />
            <Box sx={{ width: 190, flexShrink: 0 }}>
              <Autocomplete
                size="small"
                options={customers}
                getOptionLabel={(option: Customer) => option.customer_name || `Customer #${option.id}`}
                value={customers.find((c: Customer) => c.id === filterCustomerId) || null}
                onChange={(_, newValue) => setFilterCustomerId(newValue?.id || null)}
                renderInput={(params) => <TextField {...params} placeholder="All Customers" />}
              />
            </Box>
            {(searchQuery || filterCustomerId) && (
              <Tooltip title="Clear filters">
                <IconButton size="small" onClick={handleClearFilters}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        headerActions={
          isCreditNoteDetailMode ? undefined : (
            <TExportButton
              filename={`credit_notes_${new Date().toISOString().split("T")[0]}`}
              headers={["ID", "Customer", "Amount", "Date", "Invoice No", "Remark"]}
              rows={() =>
                filteredNotes.map((n) => [
                  `CN-${n.id}`,
                  getCustomerName(n.customer_id),
                  Number(n.amount || 0),
                  n.date ? new Date(n.date).toLocaleString() : "",
                  n.invoice_no || "",
                  n.remark || "",
                ])
              }
              disabled={filteredNotes.length === 0}
            />
          )
        }
        {...(isCreditNoteDetailMode
          ? { masterPanel: singleCreditNotePanel, detailPanel }
          : { children: creditNoteTablePanel })}
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
