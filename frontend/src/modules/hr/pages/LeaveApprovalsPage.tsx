/**
 * LeaveApprovalsPage — Master/Detail layout for pending leave approvals.
 * Left: list of pending leaves.
 * Right: leave details + approve/reject actions.
 */
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Button, InputAdornment, TextField, Typography } from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import { format } from "date-fns";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  MasterDetailLayout,
  TDataGrid,
  type TDataGridColumn,
  TButton,
  TConfirmDialog,
  TDetailSkeleton,
  TFormDialog,
  TStatusChip,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { leavesApi } from "@/modules/hr/api";
import type { Leave } from "@/modules/hr/types";

export default function LeaveApprovalsPage() {
  const qc = useQueryClient();
  const canApprove = usePermission("leave_approvals", "approve");

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLeave, setSelectedLeave] = useState<Leave | null>(null);

  const [approveDialog, setApproveDialog] = useState(false);
  const [rejectDialog, setRejectDialog] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  const { data: leaves, isLoading, refetch } = useQuery({
    queryKey: ["hr-leaves-pending"],
    queryFn: () => leavesApi.getAll({ status: "pending", limit: 200 }),
  });

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const list = (leaves || []).filter(
      (l) =>
        !q ||
        l.employee_id.toLowerCase().includes(q) ||
        (l.employee_name || "").toLowerCase().includes(q) ||
        l.leave_type.toLowerCase().includes(q)
    );
    return list;
  }, [leaves, searchQuery]);

  const approveMutation = useMutation({
    mutationFn: (id: number) => leavesApi.approve(id, { remarks }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-leaves-pending"] });
      qc.invalidateQueries({ queryKey: ["hr-leaves"] });
      qc.invalidateQueries({ queryKey: ["leaves-pending-count"] });
      showSuccessToast("Leave approved");
      setSelectedLeave(null);
      setApproveDialog(false);
      setRemarks("");
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to approve leave")),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => leavesApi.reject(id, { rejection_reason: rejectionReason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-leaves-pending"] });
      qc.invalidateQueries({ queryKey: ["hr-leaves"] });
      qc.invalidateQueries({ queryKey: ["leaves-pending-count"] });
      showSuccessToast("Leave rejected");
      setSelectedLeave(null);
      setRejectDialog(false);
      setRejectionReason("");
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to reject leave")),
  });

  const confirmDialog = useTConfirmDialog();

  const handleApprove = useCallback(() => {
    if (selectedLeave) approveMutation.mutate(selectedLeave.id);
  }, [selectedLeave, approveMutation]);

  const handleReject = useCallback(() => {
    if (!rejectionReason.trim()) {
      showErrorToast("Please provide a rejection reason");
      return;
    }
    if (selectedLeave) rejectMutation.mutate(selectedLeave.id);
  }, [selectedLeave, rejectionReason, rejectMutation]);

  const columns: TDataGridColumn<Leave>[] = useMemo(
    () => [
      { field: "employee_name", header: "Employee", flex: 1, minWidth: 180, renderCell: (p: GridRenderCellParams<Leave>) => p.row.employee_name || p.row.employee_id },
      { field: "leave_type", header: "Leave Type", width: 140, renderCell: (p: GridRenderCellParams<Leave>) => <span style={{ textTransform: "capitalize" }}>{p.row.leave_type}</span> },
      { field: "from_date", header: "From", width: 130, renderCell: (p: GridRenderCellParams<Leave>) => format(new Date(p.row.from_date), "MMM dd, yyyy") },
      { field: "to_date", header: "To", width: 130, renderCell: (p: GridRenderCellParams<Leave>) => format(new Date(p.row.to_date), "MMM dd, yyyy") },
      { field: "leave_duration", header: "Days", width: 90, align: "right", headerAlign: "right" },
      { field: "created_at", header: "Applied", width: 150, renderCell: (p: GridRenderCellParams<Leave>) => (p.row.created_at ? format(new Date(p.row.created_at), "MMM dd, yyyy") : "—") },
      { field: "status", header: "Status", width: 120, align: "center", headerAlign: "center", renderCell: () => <TStatusChip status="pending" statusMap="leaveStatus" size="small" /> },
    ],
    []
  );

  const tablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<Leave>
          rows={filtered}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => setSelectedLeave(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No pending leave requests"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "HR", href: "/hr" },
          { label: "Leave Approvals", href: "/hr/approvals/leave-approvals" },
          ...(selectedLeave ? [{ label: `LV-${selectedLeave.id}` }] : []),
        ]}
        title={
          selectedLeave
            ? `${selectedLeave.leave_type.toUpperCase()} • ${selectedLeave.employee_name || selectedLeave.employee_id}`
            : ""
        }
        titleIcon={<EventAvailableIcon color="primary" />}
        noSelectionTitle="Select a Pending Leave"
        chips={selectedLeave ? [{ label: "Pending", color: "warning" as const }] : []}
      />

      <ActionToolbar
        canCreate={false}
        canUpdate={false}
        canDelete={false}
        hasSelectedItem={!!selectedLeave}
        isCreating={false}
        isEditing={false}
        startActions={
          selectedLeave && canApprove ? (
            <Box sx={{ display: "flex", gap: 1 }}>
              <TButton
                size="small"
                variant="success"
                startIcon={<CheckCircleIcon />}
                onClick={() => setApproveDialog(true)}
                disabled={approveMutation.isPending}
              >
                Approve
              </TButton>
              <TButton
                size="small"
                variant="outlined"
                startIcon={<CancelIcon />}
                onClick={() => setRejectDialog(true)}
                disabled={rejectMutation.isPending}
                sx={{ color: "error.main", borderColor: "error.main" }}
              >
                Reject
              </TButton>
            </Box>
          ) : undefined
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedLeave ? (
          <EmptyState message="Select a pending leave request to review" />
        ) : isLoading ? (
          <TDetailSkeleton sections={2} fieldsPerSection={3} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Leave Request Details" columns={3}>
              <Box>
                <Typography variant="caption" color="text.secondary">Employee</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {selectedLeave.employee_name || selectedLeave.employee_id}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Leave Type</Typography>
                <Typography variant="body2" fontWeight={600} sx={{ textTransform: "capitalize" }}>
                  {selectedLeave.leave_type}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Time</Typography>
                <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
                  {(selectedLeave.leave_time || "full_day").replace("_", " ")}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">From Date</Typography>
                <Typography variant="body2">
                  {format(new Date(selectedLeave.from_date), "MMM dd, yyyy")}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">To Date</Typography>
                <Typography variant="body2">
                  {format(new Date(selectedLeave.to_date), "MMM dd, yyyy")}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Days</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {selectedLeave.leave_duration}
                </Typography>
              </Box>
              <Box sx={{ gridColumn: "1 / -1" }}>
                <Typography variant="caption" color="text.secondary">Reason</Typography>
                <Typography variant="body2">{selectedLeave.leave_reason}</Typography>
              </Box>
            </FormSection>

            {selectedLeave.created_at && (
              <FormSection title="Application Info" columns={2}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Applied On</Typography>
                  <Typography variant="body2">
                    {format(new Date(selectedLeave.created_at), "MMM dd, yyyy HH:mm")}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Approval Workflow</Typography>
                  <Typography variant="body2">
                    {selectedLeave.approval_id ? `Workflow #${selectedLeave.approval_id}` : "Direct"}
                  </Typography>
                </Box>
              </FormSection>
            )}
          </>
        )}
      </Box>

      <TFormDialog
        open={approveDialog}
        onClose={() => setApproveDialog(false)}
        title="Approve Leave"
        onSubmit={(e) => {
          e.preventDefault();
          handleApprove();
        }}
        submitText="Approve"
        isSubmitting={approveMutation.isPending}
        maxWidth="sm"
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Typography variant="body2">
            Approve {selectedLeave?.leave_duration} day(s) of {selectedLeave?.leave_type} leave for{" "}
            <strong>{selectedLeave?.employee_name || selectedLeave?.employee_id}</strong>?
          </Typography>
          <TextField
            label="Approval Remarks (Optional)"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            multiline
            rows={3}
            fullWidth
            size="small"
          />
        </Box>
      </TFormDialog>

      <TFormDialog
        open={rejectDialog}
        onClose={() => setRejectDialog(false)}
        title="Reject Leave"
        onSubmit={(e) => {
          e.preventDefault();
          handleReject();
        }}
        submitText="Reject"
        isSubmitting={rejectMutation.isPending}
        maxWidth="sm"
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Typography variant="body2">
            Reject leave request for{" "}
            <strong>{selectedLeave?.employee_name || selectedLeave?.employee_id}</strong>?
          </Typography>
          <TextField
            label="Rejection Reason"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            multiline
            rows={3}
            fullWidth
            size="small"
            required
          />
        </Box>
      </TFormDialog>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Leave Approvals"
        icon={<EventAvailableIcon color="primary" />}
        titleSlot={
          selectedLeave ? (
            <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={() => setSelectedLeave(null)} sx={{ textTransform: "none" }}>
              Back to Leave Approvals
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search pending leaves..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment> }}
                sx={{ width: 240, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
              />
              {searchQuery && (
                <Button size="small" onClick={() => setSearchQuery("")} sx={{ textTransform: "none" }}>
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
      >
        {selectedLeave ? detailPanel : tablePanel}
      </MasterDetailLayout>
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
