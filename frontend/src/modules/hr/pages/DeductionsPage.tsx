/**
 * DeductionsPage — Browse table + single-record detail toggle for salary deductions.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Box, Button, IconButton, InputAdornment, Paper, TextField, Tooltip, Typography } from "@mui/material";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  MasterDetailLayout,
  SelectableListItem,
  TConfirmDialog,
  TDataGrid,
  type TDataGridColumn,
  TDetailSkeleton,
  TExportButton,
  fmtLKR,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { salaryDeductionsApi } from "@/modules/hr/api";
import { formatDateTimeReadable } from "@/utils/formatters";
import type { SalaryDeduction, SalaryDeductionCreate } from "@/modules/hr/types";

const INITIAL_FORM: SalaryDeductionCreate = {
  employee_id: 0,
  reason: "",
  amount: 0,
};

export default function DeductionsPage() {
  const qc = useQueryClient();
  const canCreate = usePermission("deductions", "create");
  const canUpdate = usePermission("deductions", "update");
  const canDelete = usePermission("deductions", "delete");

  const {
    searchQuery, setSearchQuery,
    selectedItem, setSelectedItem, isEditing, isCreating,
    setIsCreating, setIsEditing,
    formData, setFormData,
    handleSelectItem, handleNew, handleCancel: baseCancel, handleStartEdit,
  } = useMasterDetailState<SalaryDeduction, SalaryDeductionCreate>({
    initialFormData: INITIAL_FORM,
    resetFormFromItem: (d) => ({
      employee_id: d.employee_id,
      reason: d.reason,
      amount: d.amount,
      approval_id: d.approval_id,
      remarks: d.remarks || "",
    }),
    defaultSortField: "created_desc",
  });

  const { data: deductions, isLoading, refetch } = useQuery({
    queryKey: ["salary-deductions"],
    queryFn: () => salaryDeductionsApi.getAll(),
  });

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let list = (deductions || []).filter(
      (d) => !q || String(d.employee_id).includes(q) || d.reason.toLowerCase().includes(q)
    );
    // Fixed default order (newest first) — the browse table's own
    // column-header sort takes over from here.
    list.sort((a, b) => (b.created_date || b.created_at || "").localeCompare(a.created_date || a.created_at || ""));
    return list;
  }, [deductions, searchQuery]);

  const createMut = useMutation({
    mutationFn: (d: SalaryDeductionCreate) => salaryDeductionsApi.create(d),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["salary-deductions"] });
      showSuccessToast("Deduction created");
      setIsCreating(false); setIsEditing(false);
      setTimeout(() => handleSelectItem(rec), 0);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to create deduction")),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: SalaryDeductionCreate }) => salaryDeductionsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-deductions"] });
      showSuccessToast("Deduction updated");
      setIsEditing(false);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to update deduction")),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => salaryDeductionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-deductions"] });
      showSuccessToast("Deduction deleted");
      // Return to the browse table rather than the hook's default handleCancel,
      // which would try to re-select an item from the (now stale) filtered list.
      setSelectedItem(null);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to delete deduction")),
  });

  const confirmDialog = useTConfirmDialog();

  const handleSave = useCallback(() => {
    if (isCreating) createMut.mutate(formData);
    else if (selectedItem) updateMut.mutate({ id: selectedItem.id, data: formData });
  }, [isCreating, selectedItem, formData, createMut, updateMut]);

  const handleDelete = useCallback(async () => {
    if (!selectedItem) return;
    const ok = await confirmDialog.confirm({ title: "Delete Deduction", message: "Delete this deduction?", confirmText: "Delete", confirmColor: "error" });
    if (ok) deleteMut.mutate(selectedItem.id);
  }, [selectedItem, deleteMut, confirmDialog]);

  const isFormValid = !!formData.employee_id && !!formData.reason && formData.amount > 0;
  const isSaving = createMut.isPending || updateMut.isPending;
  const isDisabled = !isEditing && !isCreating;

  // Cancelling a brand-new record returns to the browse table (the hook's
  // default handleCancel would instead auto-select the first item, which made
  // sense for the old always-visible detail panel but not here). Cancelling
  // an edit of an existing record still just reverts its form.
  const handleCancelDeduction = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedItem(null);
    } else {
      baseCancel(filtered);
    }
  }, [isCreating, filtered, baseCancel, setIsCreating, setIsEditing, setSelectedItem]);

  // Returns to the browse table from the detail view.
  const handleBackToDeductions = useCallback(() => {
    setSelectedItem(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedItem, setIsCreating, setIsEditing]);

  // Whether we're showing a single deduction's detail view (selected or
  // being created) instead of the browse table.
  const isDetailMode = !!selectedItem || isCreating;

  const columns: TDataGridColumn<SalaryDeduction>[] = useMemo(
    () => [
      {
        field: "employee_id",
        header: "Employee",
        width: 140,
        renderCell: (params: GridRenderCellParams<SalaryDeduction>) => `Employee #${params.row.employee_id}`,
      },
      { field: "reason", header: "Reason", flex: 1, minWidth: 220 },
      {
        field: "amount",
        header: "Amount",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<SalaryDeduction>) => fmtLKR(params.row.amount),
      },
      {
        field: "deduction_period",
        header: "Period",
        width: 130,
        renderCell: (params: GridRenderCellParams<SalaryDeduction>) => params.row.deduction_period || "-",
      },
      {
        field: "created_date",
        header: "Created",
        width: 170,
        renderCell: (params: GridRenderCellParams<SalaryDeduction>) =>
          formatDateTimeReadable(params.row.created_date || params.row.created_at) || "-",
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<SalaryDeduction>) => (
          <Tooltip title="Open">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectItem(params.row);
              }}
            >
              <OpenInNewIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [handleSelectItem]
  );

  // Browse mode: a full-width table of every deduction. Sorting is done
  // per-column via the grid's own column header menu.
  const tablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<SalaryDeduction>
          rows={filtered}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => handleSelectItem(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No deductions found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current deduction
  // (or the "New Deduction" placeholder while creating) plus a
  // "Back to Deductions" link that returns to the table.
  const singleDeductionPanel = (
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
        <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={handleBackToDeductions} sx={{ textTransform: "none" }}>
          Back to Deductions
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
              <MoneyOffIcon color="primary" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Deduction
            </Typography>
          </Box>
        </Box>
      ) : selectedItem && (
        <SelectableListItem
          id={selectedItem.id}
          isSelected
          onClick={() => {}}
          primaryText={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, width: "100%" }}>
              <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
                <MoneyOffIcon color="primary" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>Deduction #{selectedItem.id} • Employee #{selectedItem.employee_id}</span>
              </Box>
            </Box>
          }
        />
      )}
    </Paper>
  );

  // Detail mode: the existing detail content, unchanged, shown full-width.
  const detailContent = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Deductions", href: "/hr/deductions" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Deduction" : `#${selectedItem?.id}` }] : [])]}
        title={selectedItem ? `Deduction #${selectedItem.id} • Employee #${selectedItem.employee_id}` : ""}
        titleIcon={<MoneyOffIcon color="primary" />}
        isCreating={isCreating} createTitle="New Deduction" noSelectionTitle="Select a Deduction"
      />
      <ActionToolbar canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} hasSelectedItem={!!selectedItem}
        isCreating={isCreating} isEditing={isEditing} isSaving={isSaving} isFormValid={isFormValid}
        onNew={handleNew} onDelete={handleDelete} onSave={handleSave} onCancel={handleCancelDeduction} onEdit={handleStartEdit}
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a deduction from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={3} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Deduction Details" columns={2}>
              <TextField label="Employee ID" size="small" type="number" value={formData.employee_id || ""} onChange={(e) => setFormData({ ...formData, employee_id: Number(e.target.value) })} disabled={isDisabled} required />
              <TextField label="Amount" size="small" type="number" value={Number(formData.amount) || ""} onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })} disabled={isDisabled} required inputProps={{ step: "0.01" }} />
              <Box sx={{ gridColumn: "1 / -1" }}>
                <TextField label="Reason" size="small" value={formData.reason} onChange={(e) => setFormData({ ...formData, reason: e.target.value })} disabled={isDisabled} required fullWidth multiline rows={3} />
              </Box>
              <TextField label="Remarks (Optional)" size="small" value={formData.remarks || ""} onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} disabled={isDisabled} fullWidth />
              <TextField label="Approval ID (Optional)" size="small" type="number" value={formData.approval_id || ""} onChange={(e) => setFormData({ ...formData, approval_id: Number(e.target.value) || undefined })} disabled={isDisabled} />
            </FormSection>
            {selectedItem && !isCreating && !isEditing && (
              <FormSection title="Record Info" columns={2}>
                <Box><Typography variant="caption" color="text.secondary">Created</Typography><Typography variant="body2">{formatDateTimeReadable(selectedItem.created_date || selectedItem.created_at) || "-"}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Last Modified</Typography><Typography variant="body2">{formatDateTimeReadable(selectedItem.updated_at) || "-"}</Typography></Box>
              </FormSection>
            )}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Salary Deductions"
        titleSlot={
          isDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search deductions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 260 }}
              />
            </Box>
          )
        }
        headerActions={
          isDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleNew} sx={{ mr: 1 }}>
                  Add Deduction
                </Button>
              )}
              <TExportButton
                filename="salary_deductions"
                headers={["Employee ID", "Reason", "Amount", "Remarks", "Created"]}
                rows={() =>
                  filtered.map((d) => [
                    d.employee_id ?? "",
                    d.reason || "",
                    d.amount ?? 0,
                    d.remarks || "",
                    d.created_date || d.created_at || "",
                  ])
                }
                disabled={filtered.length === 0}
              />
            </>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        {...(isDetailMode
          ? { masterPanel: singleDeductionPanel, detailPanel: detailContent }
          : { children: tablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
