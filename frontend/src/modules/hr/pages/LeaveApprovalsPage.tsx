/**
 * LeaveApprovalsPage — Master/Detail layout for pending leave approvals.
 * Left: list of pending leaves.
 * Right: leave details + approve/reject actions.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Chip, TextField, Typography } from "@mui/material";
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
  SearchableList,
  SelectableListItem,
  SortOption,
  TButton,
  TConfirmDialog,
  TDetailSkeleton,
  TFormDialog,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { leavesApi } from "@/modules/hr/api";
import type { Leave } from "@/modules/hr/types";

const SORT_OPTIONS: SortOption[] = [
  { value: "from_date", label: "From Date" },
  { value: "created_desc", label: "Date Applied" },
  { value: "employee_id", label: "Employee" },
];

export default function LeaveApprovalsPage() {
  const qc = useQueryClient();
  const canApprove = usePermission("leave_approvals", "approve");

  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("from_date");
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
    let list = (leaves || []).filter(
      (l) =>
        !q ||
        l.employee_id.toLowerCase().includes(q) ||
        (l.employee_name || "").toLowerCase().includes(q) ||
        l.leave_type.toLowerCase().includes(q)
    );
    list.sort((a, b) => {
      if (sortField === "employee_id") return a.employee_id.localeCompare(b.employee_id);
      if (sortField === "created_desc") return (b.created_at || "").localeCompare(a.created_at || "");
      return a.from_date.localeCompare(b.from_date);
    });
    return list;
  }, [leaves, searchQuery, sortField]);

  useEffect(() => {
    if (filtered.length > 0 && !selectedLeave) {
      setSelectedLeave(filtered[0]);
    } else if (filtered.length === 0) {
      setSelectedLeave(null);
    } else if (selectedLeave && !filtered.find((l) => l.id === selectedLeave.id)) {
      setSelectedLeave(filtered[0] || null);
    }
  }, [filtered, selectedLeave]);

  const approveMutation = useMutation({
    mutationFn: (id: number) => leavesApi.approve(id, { remarks }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-leaves-pending"] });
      qc.invalidateQueries({ queryKey: ["hr-leaves"] });
      qc.invalidateQueries({ queryKey: ["leaves-pending-count"] });
      showSuccessToast("Leave approved");
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

  const masterPanel = (
    <SearchableList<Leave>
      items={filtered}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search pending leaves..."
      sortOptions={SORT_OPTIONS}
      currentSort={sortField}
      onSortChange={setSortField}
      selectedItem={selectedLeave}
      onSelectItem={setSelectedLeave}
      emptyMessage="No pending leave requests"
      renderItem={(leave, isSelected) => (
        <SelectableListItem
          key={leave.id}
          id={leave.id}
          isSelected={isSelected}
          onClick={() => setSelectedLeave(leave)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{leave.employee_name || leave.employee_id}</span>
                <Chip
                  label="pending"
                  size="small"
                  color="warning"
                  sx={{ height: 18, fontSize: "0.65rem" }}
                />
              </Box>
              <Typography component="span" variant="caption" sx={{ color: isSelected ? "inherit" : "text.secondary" }}>
                {leave.leave_type.toUpperCase()} • {leave.leave_duration} day(s)
              </Typography>
            </Box>
          }
          secondaryText={
            !isSelected
              ? `${format(new Date(leave.from_date), "MMM dd")} → ${format(new Date(leave.to_date), "MMM dd, yyyy")}`
              : undefined
          }
        />
      )}
    />
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "HR", href: "/hr" },
          { label: "Leave Approvals", href: "/hr/leave-approvals" },
          ...(selectedLeave ? [{ label: `LV-${selectedLeave.id}` }] : []),
        ]}
        title={
          selectedLeave
            ? `${selectedLeave.leave_type.toUpperCase()} • ${selectedLeave.employee_name || selectedLeave.employee_id}`
            : ""
        }
        titleIcon={<EventAvailableIcon color="primary" />}
        noSelectionTitle="Select a Pending Leave"
        chips={selectedLeave ? [{ label: "pending", color: "warning" as const }] : []}
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
        onRefresh={refetch}
        isLoading={isLoading}
        masterPanel={masterPanel}
        detailPanel={detailPanel}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
