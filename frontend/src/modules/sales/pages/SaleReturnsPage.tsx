import { usePermission } from "@/auth/permissions";
import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  SortOption,
  useMasterDetailState,
} from "@/components/tijaero";
import { branchApi } from "@/modules/branches/api";
import { customersApi } from "@/modules/customers/api";
import {
  AssignmentReturn as ReturnIcon,
} from "@mui/icons-material";
import {
  Autocomplete,
  Box,
  Chip,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { saleReturnsApi, salesApi } from "../api";
import SaleReturnDialog from "../components/SaleReturnDialog";
import { SaleReturn } from "../types";

// Sort options
const sortOptions: SortOption[] = [
  { value: "added_date", label: "Date (Newest)" },
  { value: "sale_return_no", label: "Return No" },
];

export default function SaleReturnsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterCustomer, setFilterCustomer] = useState<number | null>(null);

  // Permissions
  const canCreate = usePermission("sales", "create");

  // Main state
  const state = useMasterDetailState<SaleReturn, null>({
    initialFormData: null,
    initialSortField: "added_date",
  });

  // Queries
  const { data: saleReturns, isLoading, refetch } = useQuery({
    queryKey: ["sale-returns"],
    queryFn: () => saleReturnsApi.getAll(),
  });

  const { data: invoices } = useQuery({
    queryKey: ["sales"],
    queryFn: () => salesApi.getAll(),
  });

  const { data: branchesData } = useQuery({
    queryKey: ["branches"],
    queryFn: () => branchApi.getAll(1, 100),
  });
  const branches = branchesData?.items || [];

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(),
  });

  // Filter and sort
  const filteredReturns = useMemo(() => {
    if (!saleReturns) return [];

    let filtered = saleReturns.filter(
      (ret) =>
        ret.sale_return_no.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
        ret.branch_code.toLowerCase().includes(state.searchQuery.toLowerCase())
    );

    // Apply branch filter
    if (filterBranch) {
      filtered = filtered.filter((ret) => ret.branch_code === filterBranch);
    }

    // Apply customer filter (via invoice)
    if (filterCustomer && invoices) {
      const customerInvoiceIds = invoices
        .filter((inv) => inv.customer_id === filterCustomer)
        .map((inv) => inv.id);
      filtered = filtered.filter((ret) => customerInvoiceIds.includes(ret.invoice_id));
    }

    filtered.sort((a, b) => {
      if (state.sortField === "sale_return_no") {
        return a.sale_return_no.localeCompare(b.sale_return_no);
      }
      return new Date(b.added_date).getTime() - new Date(a.added_date).getTime();
    });

    return filtered;
  }, [saleReturns, state.searchQuery, state.sortField, filterBranch, filterCustomer, invoices]);

  // Auto-select first item when data loads
  useEffect(() => {
    if (filteredReturns.length > 0 && !state.selectedItem && !state.isCreating) {
      state.setSelectedItem(filteredReturns[0]);
    }
  }, [filteredReturns, state.selectedItem, state.isCreating]);

  // Get invoice for a return
  const getInvoiceNo = (invoiceId: number) => {
    return invoices?.find((i) => i.id === invoiceId)?.invoice_no || `#${invoiceId}`;
  };

  const handleSelectReturn = (returnItem: SaleReturn) => {
    state.setSelectedItem(returnItem);
  };

  const handleCreate = () => {
    setDialogOpen(true);
  };

  // Render view return details
  const renderViewReturn = () => (
    <>
      <FormSection title="Return Details">
        <Box>
          <Typography variant="caption" color="text.secondary">
            Return No
          </Typography>
          <Typography variant="body2" fontWeight={500}>
            {state.selectedItem?.sale_return_no}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Branch
          </Typography>
          <Typography variant="body2" fontWeight={500}>
            {state.selectedItem?.branch_code}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Date
          </Typography>
          <Typography variant="body2" fontWeight={500}>
            {state.selectedItem && format(new Date(state.selectedItem.added_date), "MMMM dd, yyyy")}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Original Invoice
          </Typography>
          <Typography variant="body2" fontWeight={500}>
            {state.selectedItem && getInvoiceNo(state.selectedItem.invoice_id)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Payment Method
          </Typography>
          <Typography variant="body2" fontWeight={500}>
            {state.selectedItem?.payment_method}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Approval Status
          </Typography>
          <Chip
            label={state.selectedItem?.approval_id ? "Approved" : "Pending"}
            size="small"
            color={state.selectedItem?.approval_id ? "success" : "warning"}
          />
        </Box>
      </FormSection>

      {state.selectedItem?.remark && (
        <FormSection title="Remarks" isLast>
          <Typography variant="body2" color="text.secondary" sx={{ gridColumn: "1 / -1" }}>
            {state.selectedItem.remark}
          </Typography>
        </FormSection>
      )}
    </>
  );

  return (
    <>
      <MasterDetailLayout title="Sale Returns" onRefresh={refetch}>
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            overflow: "hidden",
          }}
        >
          {/* Master List */}
          <SearchableList
            searchValue={state.searchQuery}
            onSearchChange={state.setSearchQuery}
            searchPlaceholder="Search by return no..."
            sortOptions={sortOptions}
            currentSort={state.sortField}
            onSortChange={state.setSortField}
            isLoading={isLoading}
            emptyMessage="No sale returns found"
            listHeader={
              <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
                <Autocomplete
                  size="small"
                  options={branches}
                  getOptionLabel={(option) => `${option.branch_code} - ${option.branch_name}`}
                  value={branches.find(b => b.branch_code === filterBranch) || null}
                  onChange={(_, newValue) => setFilterBranch(newValue?.branch_code || null)}
                  renderInput={(params) => (
                    <TextField {...params} placeholder="Filter by Branch" size="small" />
                  )}
                  sx={{ mb: 1 }}
                />
                <Autocomplete
                  size="small"
                  options={customers || []}
                  getOptionLabel={(option) => option.customer_name}
                  value={customers?.find((c) => c.id === filterCustomer) || null}
                  onChange={(_, newValue) => setFilterCustomer(newValue?.id || null)}
                  renderInput={(params) => (
                    <TextField {...params} placeholder="Filter by Customer" size="small" />
                  )}
                />
              </Box>
            }
          >
            {filteredReturns.map((returnItem) => {
              const isSelected = state.selectedItem?.id === returnItem.id;
              return (
                <SelectableListItem
                  key={returnItem.id}
                  isSelected={isSelected}
                  onClick={() => handleSelectReturn(returnItem)}
                  primaryText={
                    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                      {/* Return No */}
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>{returnItem.sale_return_no}</span>
                        {isSelected && (
                          <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                            (Return No)
                          </Typography>
                        )}
                      </Box>
                      {/* Additional fields when selected */}
                      {isSelected && (
                        <>
                          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <Typography component="span" variant="caption">
                              {format(new Date(returnItem.added_date), "MMM dd, yyyy")}
                            </Typography>
                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                              (Date)
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <Typography component="span" variant="caption">
                              {getInvoiceNo(returnItem.invoice_id)}
                            </Typography>
                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                              (Invoice)
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <Typography component="span" variant="caption" sx={{ textTransform: "capitalize" }}>
                              {returnItem.payment_method}
                            </Typography>
                            <Typography component="span" variant="caption" sx={{ color: "inherit", opacity: 0.7 }}>
                              (Payment)
                            </Typography>
                          </Box>
                          {/* Status Chips - shown below all fields when selected */}
                          <Box sx={{ display: "flex", gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
                            <Chip
                              label={returnItem.approval_id ? "Approved" : "Pending"}
                              size="small"
                              color={returnItem.approval_id ? "success" : "warning"}
                              sx={{ height: 18, fontSize: "0.65rem" }}
                            />
                          </Box>
                        </>
                      )}
                    </Box>
                  }
                  secondaryText={!isSelected ? `${format(new Date(returnItem.added_date), "MMM dd, yyyy")} • Invoice: ${getInvoiceNo(returnItem.invoice_id)}` : undefined}
                  isFavorite={state.favorites.includes(returnItem.id)}
                  onToggleFavorite={() => state.toggleFavorite(returnItem.id)}
                />
              );
            })}
          </SearchableList>

          {/* Detail Panel */}
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <DetailPanelHeader
              icon={<ReturnIcon color="warning" />}
              breadcrumbs={[{ label: "Sales", href: "/sales" }, { label: "Sale Returns" }]}
              title={
                state.selectedItem
                  ? state.selectedItem.sale_return_no
                  : "Select a Return"
              }
              chips={
                state.selectedItem
                  ? [
                      {
                        label: state.selectedItem.approval_id ? "Approved" : "Pending",
                        color: state.selectedItem.approval_id ? "success" : "warning",
                      },
                    ]
                  : undefined
              }
            />

            <ActionToolbar
              canCreate={canCreate}
              canDelete={false}
              canUpdate={false}
              isEditing={false}
              isCreating={false}
              hasSelection={!!state.selectedItem}
              onAdd={handleCreate}
              saveDisabled={true}
            />

            <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
              {!state.selectedItem ? (
                <EmptyState message="Select a sale return from the list or create a new one" />
              ) : (
                renderViewReturn()
              )}
            </Box>
          </Box>
        </Box>
      </MasterDetailLayout>

      <SaleReturnDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
