/**
 * QuotationApprovalsPage - Sales Quotation Approvals
 * Mirrors POApprovalsPage.tsx: shows quotations pending approval/rejection,
 * with the same step-up-auth approve flow and generic Approvals dispatch.
 */

import { useMemo, useCallback, useState, useEffect } from "react";
import { formatDateTimeReadable } from "@/utils/formatters";
import { useCurrencyStore } from "@/state/currencyStore";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GridPaginationModel } from "@mui/x-data-grid";
import { fetchAllPages } from "@/utils/fetchAllPages";
import {
  Box,
  TextField,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  InputAdornment,
  Tooltip,
} from "@mui/material";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import HistoryIcon from "@mui/icons-material/History";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import type { GridRenderCellParams } from "@mui/x-data-grid";

import {
  TChip,
  MasterDetailLayout,
  ActionToolbar,
  DetailPanelHeader,
  FormSection,
  EmptyState,
  fmtLKR,
  TBranchFilter,
  TStatusFilter,
  QUOTATION_STATUS_FILTER_OPTIONS,
  getStatusProps,
  showErrorToast,
  modernTableStyles,
  useCrudMutation,
  TActivityHistoryPanel,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";

import { quotationApi } from "@/modules/sales/quotation-api";
import { customersApi } from "@/modules/customers/api";
import { approvalsApi } from "@/modules/common/api";
import ApproverAuthDialog from "@/modules/purchasing/components/ApproverAuthDialog";
import { useDebounce } from "@/hooks";
import { useReferenceData } from "@/hooks";
import type { SalesQuote, SalesQuoteDetail } from "@/modules/sales/quotation-types";
import type { Customer } from "@/modules/customers/types";
import { customerDisplayName } from "@/modules/customers/types";
import type { Product } from "@/modules/inventory/types";

// A quote row as shown in the browse table, with the customer name looked up
// and attached directly so the table's own column-header sort orders by the
// displayed name rather than the raw customer id.
type QuoteApprovalRow = SalesQuote & { customer_display_name: string; agent_display_name: string };

export default function QuotationApprovalsPage() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedQuote, setSelectedQuote] = useState<SalesQuoteDetail | null>(null);

  const [activityHistoryOpen, setActivityHistoryOpen] = useState(false);

  const [filterStatus, setFilterStatus] = useState<string | null>("pending_approval");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [remarksDialogOpen, setRemarksDialogOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);

  const { data: refData, filteredBranches, defaultBranchCode } = useReferenceData(["products", "branches"]);
  const products = (refData?.products || []) as Product[];
  const branches = filteredBranches || [];

  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) {
      setFilterBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setFilterStatus(null);
    setFilterBranch(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  // Server-side paging: only the visible page is fetched (this used to download every quotation,
  // up to 100 000, on each visit and filter them in the browser).
  const [paging, setPaging] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [sort, setSort] = useState<{ field: string; sort: "asc" | "desc" } | null>(null);
  const debouncedSearch = useDebounce(searchQuery, 300);

  useEffect(() => {
    setPaging((m) => (m.page === 0 ? m : { ...m, page: 0 }));
  }, [debouncedSearch, filterStatus, filterBranch, sort]);

  const SERVER_SORT: Record<string, string> = {
    quote_no: "quote_no", customer_display_name: "customer_name", branch_code: "branch_code",
    created_date: "created_date", valid_until: "valid_until", status: "status", total_amount: "total_amount",
  };
  const pageParams = (page: number, size: number) => ({
    search: debouncedSearch.trim(),
    status: (filterStatus ?? undefined) as never,
    branch_code: filterBranch ?? undefined,
    sort_by: sort ? SERVER_SORT[sort.field] : undefined,
    order: sort?.sort,
    page: page + 1,
    per_page: size,
  });

  const { data: quotesList, isFetching: isLoading, refetch } = useQuery({
    queryKey: ["sales-quotes-all", "paged", paging.page, paging.pageSize, debouncedSearch.trim(), filterStatus, filterBranch, sort?.field, sort?.sort],
    queryFn: () => quotationApi.getAll(pageParams(paging.page, paging.pageSize)),
    enabled: branchResolved,
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
  });
  const quotes = quotesList?.items || [];

  const { data: customers = [] } = useQuery({
    queryKey: ["customers-all"],
    queryFn: () => customersApi.getAll(),
  });

  const customerMap = useMemo(() => {
    const map = new Map<number, Customer>();
    customers.forEach((c) => map.set(c.id, c));
    return map;
  }, [customers]);

  const productMap = useMemo(() => {
    const map = new Map<number, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const getCustomerName = useCallback(
    (customerId: number) => customerDisplayName(customerMap.get(customerId)) || "Unknown",
    [customerMap],
  );

  const filteredQuotes: SalesQuote[] = quotes;

  const handleSelectQuote = useCallback(async (quote: SalesQuote) => {
    try {
      const fullQuote = await quotationApi.getById(quote.id);
      setSelectedQuote(fullQuote);
    } catch {
      showErrorToast("Failed to load quotation details");
    }
  }, []);

  const handleBackToApprovals = useCallback(() => {
    setSelectedQuote(null);
  }, []);

  const approveMutation = useCrudMutation({
    mutationFn: ({ approvalId, credentials }: { approvalId: number; quoteId: number; credentials?: any; silent?: boolean }) =>
      approvalsApi.approve(approvalId, undefined, credentials),
    invalidateQueryKeys: [["sales-quotes-all"], ["sales-quotes"], ["sales-quote-details"]],
    getSuccessMessage: (_data, { silent }) => (silent ? undefined : "Quotation approved successfully"),
    errorMessage: "Failed to approve quotation",
    onSuccess: (_data, { quoteId }) => {
      setSelectedQuote((prev) => (prev && prev.id === quoteId ? { ...prev, status: "approved", approval: true } : prev));
    },
  });

  const rejectMutation = useCrudMutation({
    mutationFn: ({ approvalId, remarks }: { approvalId: number; quoteId: number; remarks: string; silent?: boolean }) =>
      approvalsApi.reject(approvalId, remarks),
    invalidateQueryKeys: [["sales-quotes-all"], ["sales-quotes"], ["sales-quote-details"]],
    getSuccessMessage: (_data, { silent }) => (silent ? undefined : "Quotation rejected"),
    errorMessage: "Failed to reject quotation",
    onSuccess: (_data, { quoteId }) => {
      setSelectedQuote((prev) => (prev && prev.id === quoteId ? { ...prev, status: "rejected" } : prev));
      setRejectDialogOpen(false);
      setRejectReason("");
    },
  });

  const handleApprove = () => {
    if (!selectedQuote) return;
    if (!selectedQuote.approval_id) {
      showErrorToast("This quotation has no approval record. Please contact support.");
      return;
    }
    setAuthDialogOpen(true);
  };

  const handleAuthSubmit = async (username: string, password: string) => {
    const credentials = { approver_username: username, approver_password: password };

    if (!selectedQuote || !selectedQuote.approval_id) return;
    approveMutation.mutate(
      { approvalId: selectedQuote.approval_id, quoteId: selectedQuote.id, credentials },
      { onSuccess: () => setAuthDialogOpen(false) },
    );
  };

  const handleReject = () => {
    if (!rejectReason.trim()) return;

    if (selectedQuote) {
      if (!selectedQuote.approval_id) {
        showErrorToast("This quotation has no approval record.");
        return;
      }
      rejectMutation.mutate({
        approvalId: selectedQuote.approval_id,
        quoteId: selectedQuote.id,
        remarks: rejectReason,
      });
    }
  };

  const selectedIsPending = (selectedQuote?.status || "").toLowerCase() === "pending_approval";

  const quoteRows = useMemo(
    () =>
      filteredQuotes.map((quote) => ({
        ...quote,
        customer_display_name: getCustomerName(quote.customer_id),
        agent_display_name: quote.customer_agent_id ? getCustomerName(quote.customer_agent_id) : "",
      })),
    [filteredQuotes, getCustomerName],
  );

  const quoteColumns: TDataGridColumn<QuoteApprovalRow>[] = useMemo(
    () => [
      {
        field: "quote_no",
        header: "Quote No",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<QuoteApprovalRow>) => (
          <Typography variant="body2" fontWeight={600}>
            {params.row.quote_no}
          </Typography>
        ),
      },
      {
        field: "customer_display_name",
        header: "Customer",
        flex: 1,
        minWidth: 180,
      },
      {
        field: "branch_code",
        header: "Branch",
        width: 110,
      },
      {
        field: "agent_display_name",
        header: "Sales Agent",
        width: 160,
      },
      {
        field: "created_date",
        header: "Created",
        type: "date",
        width: 130,
      },
      {
        field: "valid_until",
        header: "Valid Until",
        type: "date",
        width: 130,
      },
      {
        field: "pending_age",
        header: "Pending",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<QuoteApprovalRow>) => {
          if ((params.row.status || "").toLowerCase() !== "pending_approval") {
            return <Typography variant="body2" color="text.disabled">-</Typography>;
          }
          const days = Math.max(
            0,
            Math.floor((Date.now() - new Date(params.row.created_date).getTime()) / 86400000),
          );
          const color = days >= 5 ? "error" : days >= 2 ? "warning" : "success";
          return <TChip label={`${days}d`} size="small" color={color} />;
        },
      },
      {
        field: "status",
        header: "Status",
        type: "status",
        statusMap: "quoteStatus",
        width: 160,
      },
      {
        field: "total_amount",
        header: "Total",
        type: "currency",
        width: 140,
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<QuoteApprovalRow>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectQuote(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectQuote],
  );

  const quoteTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<QuoteApprovalRow>
          rows={quoteRows}
          columns={quoteColumns}
          loading={isLoading}
          serverPagination={{ rowCount: quotesList?.total ?? 0, paginationModel: paging, onPaginationModelChange: setPaging }}
          onServerSortChange={setSort}
          exportAllRows={() =>
            fetchAllPages((page) => quotationApi.getAll(pageParams(page, 200)).then((r) => ({ items: r.items, pages: r.pages }))).then((rows) =>
              rows.map((quote) => ({ ...quote, customer_display_name: getCustomerName(quote.customer_id), agent_display_name: quote.customer_agent_id ? getCustomerName(quote.customer_agent_id) : "" }))
            )
          }
          onRowClick={(row) => handleSelectQuote(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No quotations found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  const isQuoteApprovalDetailMode = !!selectedQuote;

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Sales" },
          { label: "Quotation Approvals", href: "/sales/approvals" },
          ...(selectedQuote ? [{ label: selectedQuote.quote_no }] : []),
        ]}
        title={selectedQuote?.quote_no || ""}
        titleIcon={<FactCheckIcon color="primary" />}
        noSelectionTitle="Select a Quotation to Review"
        chips={
          selectedQuote
            ? (() => {
              const s = getStatusProps(selectedQuote.status || "draft", "quoteStatus");
              const chips = [{ label: s.label, color: s.color }];
              if ((selectedQuote.status || "").toLowerCase() === "pending_approval") {
                const days = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(selectedQuote.created_date).getTime()) / 86400000),
                );
                chips.push({ label: `Pending ${days}d`, color: days >= 5 ? "error" : days >= 2 ? "warning" : "success" });
              }
              return chips;
            })()
            : []
        }
      />

      {selectedQuote && selectedIsPending && (
        <ActionToolbar
          hasSelectedItem
          isCreating={false}
          isEditing={false}
          canCreate={false}
          canDuplicate={false}
          canDelete={false}
          endActions={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<CheckCircleIcon />}
                onClick={handleApprove}
                disabled={approveMutation.isPending}
              >
                Approve
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<CancelIcon />}
                onClick={() => setRejectDialogOpen(true)}
                disabled={rejectMutation.isPending}
              >
                Reject
              </Button>
            </Box>
          }
        />
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedQuote ? (
          <EmptyState message="Select a quotation from the list to review" />
        ) : (
          <>
            <FormSection title="Quotation Information" columns={3}>
              <TextField label="Quote No" size="small" value={selectedQuote.quote_no} disabled />
              <TextField
                label="Created"
                size="small"
                value={new Date(selectedQuote.created_date).toLocaleDateString()}
                disabled
              />
              <TextField
                label="Valid Until"
                size="small"
                value={selectedQuote.valid_until ? new Date(selectedQuote.valid_until).toLocaleDateString() : ""}
                disabled
              />
              <TextField label="Branch" size="small" value={selectedQuote.branch_code} disabled />
              <TextField label="Status" size="small" value={selectedQuote.status} disabled />
            </FormSection>

            <FormSection title="Customer Information" columns={2}>
              <TextField label="Customer" size="small" value={getCustomerName(selectedQuote.customer_id)} disabled />
            </FormSection>

            <FormSection title="Quote Items" columns={1}>
              <Paper variant="outlined" sx={{ overflow: "hidden", width: "100%", borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={modernTableStyles.headerRow}>
                      <TableCell sx={{ minWidth: 200 }}>Product</TableCell>
                      <TableCell align="right" sx={{ width: 100 }}>Quantity</TableCell>
                      <TableCell align="right" sx={{ width: 120 }}>{`Unit Price (${currencySymbol})`}</TableCell>
                      <TableCell align="right" sx={{ width: 90 }}>Discount</TableCell>
                      <TableCell sx={{ width: 100 }}>Warranty</TableCell>
                      <TableCell align="center" sx={{ width: 140 }}>Item Status</TableCell>
                      <TableCell align="right" sx={{ width: 120 }}>{`Amount (${currencySymbol})`}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedQuote.items?.map((item, index) => {
                      const product = productMap.get(item.product_id);
                      const discountPercent = item.discount_percentage || 0;
                      const lineTotal = item.quantity * item.selling_price * (1 - discountPercent / 100);
                      const itemStatus = item.item_status ?? "pending";
                      const stockStatus = item.stock_status;
                      return (
                        <TableRow key={index} sx={{
                          ...modernTableStyles.bodyRow,
                          ...(index % 2 === 1 && { bgcolor: "grey.25" }),
                          ...(itemStatus === "cancelled" && { opacity: 0.5 }),
                        }}>
                          <TableCell>{product?.name || `Product #${item.product_id}`}</TableCell>
                          <TableCell align="right">{item.quantity}</TableCell>
                          <TableCell align="right">{fmtLKR(item.selling_price)}</TableCell>
                          <TableCell align="right">
                            {discountPercent > 0
                              ? <Typography variant="body2" color="error.main">{discountPercent}%</Typography>
                              : <Typography variant="body2" color="text.disabled">-</Typography>}
                          </TableCell>
                          <TableCell>{item.warrenty_month || "-"}</TableCell>
                          <TableCell align="center">
                            {itemStatus === "so_created" || itemStatus === "completed" ? (
                              <TChip label="SO Created" color="success" size="small" sx={{ height: 20, fontSize: "0.7rem" }} />
                            ) : itemStatus === "po_created" ? (
                              <TChip label="PO Created" color="info" size="small" sx={{ height: 20, fontSize: "0.7rem" }} />
                            ) : itemStatus === "itn_created" ? (
                              <TChip label="ITN Created" color="info" size="small" sx={{ height: 20, fontSize: "0.7rem" }} />
                            ) : itemStatus === "procurement" ? (
                              stockStatus === "needs_transfer"
                                ? <TChip label="Transfer Available" color="secondary" size="small" sx={{ height: 20, fontSize: "0.7rem" }} />
                                : <TChip label="Need PO" color="warning" size="small" sx={{ height: 20, fontSize: "0.7rem" }} />
                            ) : itemStatus === "cancelled" ? (
                              <TChip label="Cancelled" color="default" size="small" sx={{ height: 20, fontSize: "0.7rem" }} />
                            ) : (
                              stockStatus === "needs_transfer"
                                ? <TChip label="Transfer Available" color="secondary" size="small" sx={{ height: 20, fontSize: "0.7rem" }} />
                                : stockStatus === "needs_procurement"
                                  ? <TChip label="Need PO" color="warning" size="small" sx={{ height: 20, fontSize: "0.7rem" }} />
                                  : <TChip label="Need SO" color="info" size="small" sx={{ height: 20, fontSize: "0.7rem" }} />
                            )}
                          </TableCell>
                          <TableCell align="right">{fmtLKR(lineTotal)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow sx={modernTableStyles.footerRow}>
                      <TableCell colSpan={6} align="right">
                        <strong>Total Amount:</strong>
                      </TableCell>
                      <TableCell align="right">
                        <strong>{fmtLKR(selectedQuote.total_amount)}</strong>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Paper>
            </FormSection>

            <FormSection title="Remarks" columns={1}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
                <TextField
                  multiline
                  rows={2}
                  fullWidth
                  value={selectedQuote.remarks || "No remarks"}
                  disabled
                  size="small"
                />
                <Tooltip title="View / Add Remarks">
                  <IconButton size="small" onClick={() => setRemarksDialogOpen(true)}>
                    <MenuBookIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </FormSection>

            <FormSection
              title="Activity History"
              columns={2}
              titleAction={
                <Tooltip title="View activity history">
                  <IconButton size="small" onClick={() => setActivityHistoryOpen(true)}>
                    <HistoryIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              }
            >
              <Box>
                <Typography variant="caption" color="text.secondary">Created By</Typography>
                <Typography variant="body2">
                  {selectedQuote.created_by_name || "-"}
                  {selectedQuote.created_date_time ? ` on ${formatDateTimeReadable(selectedQuote.created_date_time)}` : ""}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Last Modified By</Typography>
                <Typography variant="body2">
                  {selectedQuote.updated_by_name || "-"}
                  {selectedQuote.updated_at ? ` on ${formatDateTimeReadable(selectedQuote.updated_at)}` : ""}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Approved By</Typography>
                <Typography variant="body2">{selectedQuote.approved_by_name || "-"}</Typography>
              </Box>
            </FormSection>
          </>
        )}
      </Box>

      <Dialog
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Reject Quotation
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Please provide a reason for rejecting this quotation.
          </Typography>
          <TextField
            autoFocus
            label="Rejection Reason"
            multiline
            rows={4}
            fullWidth
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleReject}
            disabled={!rejectReason.trim() || rejectMutation.isPending}
          >
            {rejectMutation.isPending ? "Rejecting..." : "Reject Quotation"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={remarksDialogOpen} onClose={() => setRemarksDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Remarks</DialogTitle>
        <DialogContent>
          <TextField
            multiline
            rows={8}
            fullWidth
            placeholder="No remarks..."
            value={selectedQuote?.remarks || ""}
            InputProps={{ readOnly: true }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemarksDialogOpen(false)}>OK</Button>
          <Button onClick={() => setRemarksDialogOpen(false)} variant="outlined">
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Quotation Approvals"
        icon={<FactCheckIcon color="primary" />}
        titleSlot={
          isQuoteApprovalDetailMode ? (
            <Button
              size="small"
              startIcon={<ArrowBackIcon fontSize="small" />}
              onClick={handleBackToApprovals}
              sx={{ textTransform: "none" }}
            >
              Back to Quotation Approvals
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search quotations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 190, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
              />
              <Box sx={{ width: 170, flexShrink: 0 }}>
                <TStatusFilter options={QUOTATION_STATUS_FILTER_OPTIONS} value={filterStatus} onChange={setFilterStatus} label="" placeholder="All Statuses" size="small" />
              </Box>
              <Box sx={{ width: 160, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}>
                <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
              </Box>
              {(searchQuery || filterStatus || filterBranch) && (
                <Button size="small" onClick={handleClearFilters} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        onRefresh={() => refetch()}
        isLoading={isLoading}
        {...(isQuoteApprovalDetailMode
          ? { children: detailPanel }
          : { children: quoteTablePanel })}
      />

      <ApproverAuthDialog
        open={authDialogOpen}
        onClose={() => setAuthDialogOpen(false)}
        onSubmit={handleAuthSubmit}
        loading={approveMutation.isPending}
      />

      <TActivityHistoryPanel
        open={activityHistoryOpen}
        onClose={() => setActivityHistoryOpen(false)}
        entityType="sales_quote"
        entityId={selectedQuote?.id}
        actionLabels={{
          create: "Quote created",
          update: "Quote updated",
          status_change: "Status changed",
          approve: "Quote approved",
          reject: "Quote rejected",
          convert: "Converted to invoice",
          release_reservation: "Stock reservation released",
          delete: "Quote deleted",
        }}
      />
    </>
  );
}
