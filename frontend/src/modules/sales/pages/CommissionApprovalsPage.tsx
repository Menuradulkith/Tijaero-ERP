/**
 * CommissionApprovalsPage - Agent Commission Approvals
 * 
 * Dedicated approvals page for agent commissions.
 * Shows pending commissions and allows approve/reject actions.
 * Follows the same UI pattern as SalesOrderApprovalsPage.
 */

import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import PersonIcon from "@mui/icons-material/Person";
import {
  Box,
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";

import {
  DetailPanelHeader,
  EmptyState,
  fmtLKR,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  SortOption,
  TDetailSkeleton,
  TConfirmDialog,
  TSearchableSelect,
  TStatusChip,
  modernTableStyles,
  showErrorToast,
  showSuccessToast,
  useTConfirmDialog,
} from "@/components/tijaero";

import { usePermission } from "@/auth/permissions";
import { customersApi } from "@/modules/customers/api";
import { commissionsApi } from "@/modules/sales/commission-api";
import { CustomerAgentCommissionWithDetails } from "@/modules/sales/commission-types";

// ─── Configuration ───────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: "pending", label: "Pending", color: "warning" as const },
  { value: "approved", label: "Approved", color: "success" as const },
  { value: "paid", label: "Paid", color: "info" as const },
];

const SORT_OPTIONS: SortOption[] = [
  { value: "created_at", label: "Date Created" },
  { value: "commission_amount", label: "Commission Amount" },
  { value: "invoice_amount", label: "Invoice Amount" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function CommissionApprovalsPage() {
  const queryClient = useQueryClient();
  const canApprove = usePermission("sales", "approve");
  const canDelete = usePermission("customers", "delete");

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("created_at");
  const [filterStatus, setFilterStatus] = useState<string | null>("pending");
  const [filterAgentId, setFilterAgentId] = useState<number | null>(null);
  const [selectedCommission, setSelectedCommission] = useState<CustomerAgentCommissionWithDetails | null>(null);

  // Confirm dialogs
  const approveDialog = useTConfirmDialog();
  const rejectDialog = useTConfirmDialog();

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const { data: commissionsData, isLoading, refetch } = useQuery({
    queryKey: ["commission-approvals", filterStatus, filterAgentId],
    queryFn: () =>
      commissionsApi.getAll({
        status: filterStatus || undefined,
        agent_id: filterAgentId || undefined,
        limit: 500,
      }),
  });

  const commissions = (commissionsData?.items || []) as CustomerAgentCommissionWithDetails[];

  // Fetch agents
  const { data: allCustomers } = useQuery({
    queryKey: ["customers"],
    queryFn: () => customersApi.getAll(0, 1000),
  });

  const agents = useMemo(
    () => (allCustomers || []).filter((c) => c.is_customer_agent && c.active),
    [allCustomers]
  );

  const agentMap = useMemo(() => {
    const map = new Map<number, string>();
    (allCustomers || []).forEach((c) => map.set(c.id, c.customer_name));
    return map;
  }, [allCustomers]);

  // ─── Filter & Sort ─────────────────────────────────────────────────────────

  const filteredCommissions = useMemo(() => {
    let filtered = [...commissions];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.invoice_no?.toLowerCase().includes(q) ||
          c.agent_name?.toLowerCase().includes(q) ||
          c.customer_name?.toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) => {
      if (sortField === "commission_amount") {
        return Number(b.commission_amount) - Number(a.commission_amount);
      } else if (sortField === "invoice_amount") {
        return Number(b.invoice_amount) - Number(a.invoice_amount);
      }
      return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
    });

    return filtered;
  }, [commissions, searchQuery, sortField]);

  // Auto-select first
  useEffect(() => {
    if (filteredCommissions.length > 0 && !selectedCommission) {
      setSelectedCommission(filteredCommissions[0]);
    }
  }, [filteredCommissions, selectedCommission]);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: (id: number) => commissionsApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commission-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["agent-commissions"] });
      queryClient.invalidateQueries({ queryKey: ["agent-commission-summaries"] });
      showSuccessToast("Commission approved successfully");
      setSelectedCommission(null);
    },
    onError: (error: unknown) =>
      showErrorToast(handleApiError(error, "Failed to approve commission")),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => commissionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commission-approvals"] });
      queryClient.invalidateQueries({ queryKey: ["agent-commissions"] });
      queryClient.invalidateQueries({ queryKey: ["agent-commission-summaries"] });
      showSuccessToast("Commission rejected (deleted)");
      setSelectedCommission(null);
    },
    onError: (error: unknown) =>
      showErrorToast(handleApiError(error, "Failed to reject commission")),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleApprove = useCallback(() => {
    if (!selectedCommission) return;

    const currentHour = new Date().getHours();
    const isAfterHours = currentHour >= 18;

    if (isAfterHours) {
      approveDialog.open(
        "After-Hours Approval Warning",
        `It is currently after 6:00 PM (now: ${new Date().toLocaleTimeString()}). Approving commissions after business hours is not recommended. Do you want to approve anyway?`,
        () => approveMutation.mutate(selectedCommission.id)
      );
    } else {
      approveDialog.open(
        "Approve Commission",
        `Approve commission of ${fmtLKR(selectedCommission.commission_amount)} for agent "${selectedCommission.agent_name || agentMap.get(selectedCommission.customer_agent_id) || "Unknown"}"?`,
        () => approveMutation.mutate(selectedCommission.id)
      );
    }
  }, [selectedCommission, approveMutation, approveDialog, agentMap]);

  const handleReject = useCallback(() => {
    if (!selectedCommission) return;

    rejectDialog.open(
      "Reject Commission",
      `Are you sure you want to reject this commission? This will delete the commission record and cannot be undone.`,
      () => rejectMutation.mutate(selectedCommission.id)
    );
  }, [selectedCommission, rejectMutation, rejectDialog]);

  // Helpers
  const getAgentName = (agentId: number) =>
    agentMap.get(agentId) || `Agent #${agentId}`;

  // ─── Master Panel ──────────────────────────────────────────────────────────

  const masterPanel = (
    <SearchableList
      items={filteredCommissions}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search by invoice, agent..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedCommission}
      emptyMessage="No commissions found"
      listHeader={
        <Box
          sx={{
            p: 1,
            borderBottom: "1px solid",
            borderColor: "divider",
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <TSearchableSelect
            label="Status"
            value={filterStatus}
            onChange={(val) => setFilterStatus(val as string | null)}
            options={STATUS_FILTER_OPTIONS.map((opt) => ({
              value: opt.value,
              label: opt.label,
              color: opt.color,
            }))}
            showAllOption
            allOptionLabel="All Statuses"
            placeholder="Search status..."
          />
          <TSearchableSelect
            label="Filter by Agent"
            value={filterAgentId}
            onChange={(val) => setFilterAgentId(val ? Number(val) : null)}
            options={agents.map((agent) => ({
              value: agent.id,
              label: agent.customer_name,
            }))}
            showAllOption
            allOptionLabel="All Agents"
            placeholder="Search agents..."
          />
        </Box>
      }
      renderItem={(commission, isSelected) => {
        const statusChip = getStatusProps(commission.status, "commissionStatus");
        return (
          <SelectableListItem
            key={commission.id}
            isSelected={isSelected}
            onClick={() => setSelectedCommission(commission)}
            primaryText={
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  width: "100%",
                  gap: 0.5,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>{commission.invoice_no || `Invoice #${commission.invoice_id}`}</span>
                  {isSelected && (
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ color: "inherit", opacity: 0.7 }}
                    >
                      (Invoice)
                    </Typography>
                  )}
                </Box>
                {isSelected && (
                  <>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Typography component="span" variant="caption">
                        {commission.agent_name || getAgentName(commission.customer_agent_id)}
                      </Typography>
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: "inherit", opacity: 0.7 }}
                      >
                        (Agent)
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Typography component="span" variant="caption">
                        {commission.created_at
                          ? format(new Date(commission.created_at), "dd/MM/yyyy")
                          : "N/A"}
                      </Typography>
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: "inherit", opacity: 0.7 }}
                      >
                        (Date)
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Typography component="span" variant="caption">
                        Rs. {Number(commission.commission_amount).toLocaleString()}
                      </Typography>
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: "inherit", opacity: 0.7 }}
                      >
                        (Amount)
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                      <Chip
                        label={statusChip.label}
                        size="small"
                        color={statusChip.color}
                        sx={{ height: 18, fontSize: "0.65rem" }}
                      />
                    </Box>
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected
                ? `${commission.agent_name || getAgentName(commission.customer_agent_id)} - ${commission.created_at ? format(new Date(commission.created_at), "dd/MM/yyyy") : "N/A"}`
                : undefined
            }
          />
        );
      }}
    />
  );

  // ─── Detail Panel ──────────────────────────────────────────────────────────

  const detailPanel = (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Sales" },
          { label: "Commission Approvals", href: "/sales/commission-approvals" },
          ...(selectedCommission
            ? [{ label: selectedCommission.invoice_no || `Commission #${selectedCommission.id}` }]
            : []),
        ]}
        title={
          selectedCommission
            ? selectedCommission.invoice_no || `Commission #${selectedCommission.id}`
            : ""
        }
        titleIcon={<FactCheckIcon color="primary" />}
        noSelectionTitle="Select a Commission to Review"
        chips={
          selectedCommission
            ? [
                {
                  label:
                    selectedCommission.status.charAt(0).toUpperCase() +
                    selectedCommission.status.slice(1),
                  color: getStatusProps(selectedCommission.status, "commissionStatus").color,
                },
              ]
            : [{ label: "Pending Approval", color: "warning" }]
        }
      />

      {/* Approval Actions - Same style as SO Approvals */}
      {selectedCommission && selectedCommission.status === "pending" && (
        <Box
          sx={{
            display: "flex",
            gap: 1,
            p: 1,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          {canApprove && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<CheckCircleIcon />}
              onClick={handleApprove}
              disabled={approveMutation.isPending}
            >
              Approve
            </Button>
          )}
          {canDelete && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<CancelIcon />}
              onClick={handleReject}
              disabled={rejectMutation.isPending}
            >
              Reject / Delete
            </Button>
          )}
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedCommission ? (
          <EmptyState message="Select a commission from the list to review" />
        ) : isLoading ? (
          <TDetailSkeleton sections={2} fieldsPerSection={4} showHeader={false} showToolbar={false} showTable />
        ) : (
          <>
            {/* Agent & Customer Information */}
            <FormSection title="Agent & Customer Information" columns={2}>
              <TextField
                label="Agent"
                size="small"
                value={selectedCommission.agent_name || getAgentName(selectedCommission.customer_agent_id)}
                disabled
                InputProps={{
                  startAdornment: <PersonIcon fontSize="small" color="primary" sx={{ mr: 1 }} />,
                }}
              />
              <TextField
                label="Customer"
                size="small"
                value={
                  selectedCommission.customer_name ||
                  agentMap.get(selectedCommission.represented_customer_id) ||
                  `Customer #${selectedCommission.represented_customer_id}`
                }
                disabled
              />
            </FormSection>

            {/* Invoice Information */}
            <FormSection title="Invoice Information" columns={2}>
              <TextField
                label="Invoice"
                size="small"
                value={selectedCommission.invoice_no || `Invoice #${selectedCommission.invoice_id}`}
                disabled
              />
              <TextField
                label="Invoice Amount"
                size="small"
                value={`Rs. ${fmtLKR(selectedCommission.invoice_amount)}`}
                disabled
              />
            </FormSection>

            {/* Commission Details */}
            <FormSection title="Commission Details" columns={3}>
              <TextField
                label="Commission Type"
                size="small"
                value={selectedCommission.commission_type === "PERCENT" ? "Percentage" : "Fixed Amount"}
                disabled
              />
              {selectedCommission.commission_rate && (
                <TextField
                  label="Commission Rate"
                  size="small"
                  value={`${Number(selectedCommission.commission_rate)}%`}
                  disabled
                />
              )}
              <TextField
                label="Commission Amount"
                size="small"
                value={`Rs. ${fmtLKR(selectedCommission.commission_amount)}`}
                disabled
                sx={{
                  "& .MuiInputBase-input": {
                    fontWeight: 700,
                    color: "primary.main",
                  },
                }}
              />
            </FormSection>

            {/* Status & Dates */}
            <FormSection title="Status & Dates" columns={2}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Status:
                </Typography>
                <TStatusChip status={selectedCommission.status} statusMap="commissionStatus" />
              </Box>
              <TextField
                label="Created At"
                size="small"
                value={
                  selectedCommission.created_at
                    ? format(new Date(selectedCommission.created_at), "dd MMM yyyy HH:mm")
                    : "N/A"
                }
                disabled
              />
              {selectedCommission.approved_date && (
                <TextField
                  label="Approved At"
                  size="small"
                  value={format(new Date(selectedCommission.approved_date), "dd MMM yyyy HH:mm")}
                  disabled
                />
              )}
            </FormSection>

            {/* Calculation Breakdown - Only for percentage */}
            {selectedCommission.commission_type === "PERCENT" && selectedCommission.commission_rate && (
              <FormSection title="Calculation Breakdown" columns={1}>
                <Paper variant="outlined" sx={{ p: 2, bgcolor: "grey.50" }}>
                  <Table size="small" sx={modernTableStyles}>
                    <TableBody>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600, width: "50%" }}>Invoice Amount</TableCell>
                        <TableCell align="right">Rs. {fmtLKR(selectedCommission.invoice_amount)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>Commission Rate</TableCell>
                        <TableCell align="right">{Number(selectedCommission.commission_rate)}%</TableCell>
                      </TableRow>
                      <TableRow sx={{ "& td": { borderTop: 2, borderColor: "divider" } }}>
                        <TableCell sx={{ fontWeight: 700 }}>Commission Amount</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: "primary.main" }}>
                          Rs. {fmtLKR(selectedCommission.commission_amount)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Paper>
              </FormSection>
            )}

            {/* Remarks */}
            {selectedCommission.remarks && (
              <FormSection title="Remarks" columns={1}>
                <TextField
                  multiline
                  rows={2}
                  fullWidth
                  value={selectedCommission.remarks}
                  disabled
                  size="small"
                />
              </FormSection>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <MasterDetailLayout
        title="Commission Approvals"
        icon={<FactCheckIcon color="primary" />}
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...approveDialog.dialogProps} />
      <TConfirmDialog {...rejectDialog.dialogProps} />
    </>
  );
}
