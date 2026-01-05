import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Typography,
  Chip,
} from "@mui/material";
import {
  AssignmentReturn as ReturnIcon,
} from "@mui/icons-material";
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  useMasterDetailState,
  SortOption,
} from "@/components/tijaero";
import { saleReturnsApi, salesApi } from "../api";
import { SaleReturn } from "../types";
import { usePermission } from "@/auth/permissions";
import { format } from "date-fns";
import SaleReturnDialog from "../components/SaleReturnDialog";

// Sort options
const sortOptions: SortOption[] = [
  { value: "added_date", label: "Date (Newest)" },
  { value: "sale_return_no", label: "Return No" },
];

export default function SaleReturnsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

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

  // Filter and sort
  const filteredReturns = useMemo(() => {
    if (!saleReturns) return [];

    let filtered = saleReturns.filter(
      (ret) =>
        ret.sale_return_no.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
        ret.branch_code.toLowerCase().includes(state.searchQuery.toLowerCase())
    );

    filtered.sort((a, b) => {
      if (state.sortField === "sale_return_no") {
        return a.sale_return_no.localeCompare(b.sale_return_no);
      }
      return new Date(b.added_date).getTime() - new Date(a.added_date).getTime();
    });

    return filtered;
  }, [saleReturns, state.searchQuery, state.sortField]);

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
          >
            {filteredReturns.map((returnItem) => (
              <SelectableListItem
                key={returnItem.id}
                isSelected={state.selectedItem?.id === returnItem.id}
                onClick={() => handleSelectReturn(returnItem)}
                primaryText={
                  <Box sx={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                    <span>{returnItem.sale_return_no}</span>
                    <Chip
                      label={returnItem.payment_method}
                      size="small"
                      variant="outlined"
                      sx={{ ml: 1 }}
                    />
                  </Box>
                }
                secondaryText={`${format(new Date(returnItem.added_date), "MMM dd, yyyy")} • Invoice: ${getInvoiceNo(returnItem.invoice_id)}`}
                isFavorite={state.favorites.includes(returnItem.id)}
                onToggleFavorite={() => state.toggleFavorite(returnItem.id)}
              />
            ))}
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

            <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
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
