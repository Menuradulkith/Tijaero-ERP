/**
 * PayrollPage — Browse table + single-record detail toggle for employee payroll records.
 */
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Box, Button, Chip, IconButton, InputAdornment, Paper, TextField, Tooltip, Typography } from "@mui/material";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
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
  TPrintButton,
  TPrintPreviewDialog,
  fmtLKR,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { payrollApi } from "@/modules/hr/api";
import { formatDateTimeReadable } from "@/utils/formatters";
import type { EmployeePayroll, EmployeePayrollCreate } from "@/modules/hr/types";

const INITIAL_FORM: EmployeePayrollCreate = {
  employee_id: "",
  basic_salary: 0,
  add_1_name: "",
  add_1_value: 0,
  add_2_name: "",
  add_2_value: 0,
  add_sales_commision: 0,
  less_epf_employee: 0,
  less_etf_employee: 0,
  less_stamp_duty: 0,
  epf_employer: 0,
  etf_employer: 0,
};

export default function PayrollPage() {
  const qc = useQueryClient();
  const canCreate = usePermission("payroll", "create");
  const canUpdate = usePermission("payroll", "update");
  const canDelete = usePermission("payroll", "delete");
  const [printDialogOpen, setPrintDialogOpen] = useState(false);

  const {
    searchQuery, setSearchQuery,
    selectedItem, setSelectedItem, isEditing, isCreating,
    setIsCreating, setIsEditing,
    formData, setFormData,
    handleSelectItem, handleNew, handleCancel: baseCancel, handleStartEdit,
  } = useMasterDetailState<EmployeePayroll, EmployeePayrollCreate>({
    initialFormData: INITIAL_FORM,
    resetFormFromItem: (p) => ({
      employee_id: p.employee_id,
      basic_salary: p.basic_salary,
      add_1_name: p.add_1_name || "",
      add_1_value: p.add_1_value || 0,
      add_2_name: p.add_2_name || "",
      add_2_value: p.add_2_value || 0,
      add_sales_commision: p.add_sales_commision || 0,
      less_epf_employee: p.less_epf_employee || 0,
      less_etf_employee: p.less_etf_employee || 0,
      less_stamp_duty: p.less_stamp_duty || 0,
      epf_employer: p.epf_employer || 0,
      etf_employer: p.etf_employer || 0,
    }),
    defaultSortField: "created_desc",
  });

  const { data: payrolls, isLoading, refetch } = useQuery({
    queryKey: ["payroll"],
    queryFn: () => payrollApi.getAll(),
  });

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let list = (payrolls || []).filter(
      (p) => !q || p.employee_id.toLowerCase().includes(q) || (p.employee_name || "").toLowerCase().includes(q) || (p.payroll_batch_no || "").toLowerCase().includes(q)
    );
    // Fixed default order (newest first) — the browse table's own
    // column-header sort takes over from here.
    list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return list;
  }, [payrolls, searchQuery]);

  const createMut = useMutation({
    mutationFn: (d: EmployeePayrollCreate) => payrollApi.create(d),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      showSuccessToast("Payroll record created");
      setIsCreating(false); setIsEditing(false);
      setTimeout(() => handleSelectItem(rec), 0);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to create payroll record")),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmployeePayrollCreate }) => payrollApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      showSuccessToast("Payroll record updated");
      setIsEditing(false);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to update payroll record")),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => payrollApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      showSuccessToast("Payroll record deleted");
      // Return to the browse table rather than the hook's default handleCancel,
      // which would try to re-select an item from the (now stale) filtered list.
      setSelectedItem(null);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to delete payroll record")),
  });

  const confirmDialog = useTConfirmDialog();

  const handleSave = useCallback(() => {
    if (isCreating) createMut.mutate(formData);
    else if (selectedItem) updateMut.mutate({ id: selectedItem.id, data: formData });
  }, [isCreating, selectedItem, formData, createMut, updateMut]);

  const handleDelete = useCallback(async () => {
    if (!selectedItem) return;
    const ok = await confirmDialog.confirm({ title: "Delete Payroll", message: "Delete this payroll record?", confirmText: "Delete", confirmColor: "error" });
    if (ok) deleteMut.mutate(selectedItem.id);
  }, [selectedItem, deleteMut, confirmDialog]);

  const isFormValid = !!formData.employee_id && formData.basic_salary > 0;
  const isSaving = createMut.isPending || updateMut.isPending;
  const isDisabled = !isEditing && !isCreating;

  const statusColor = (s?: string): "success" | "warning" | "error" | "default" => {
    switch (s) {
      case "approved": case "paid": return "success";
      case "pending_approval": case "draft": return "warning";
      case "rejected": return "error";
      default: return "default";
    }
  };

  // Cancelling a brand-new record returns to the browse table (the hook's
  // default handleCancel would instead auto-select the first item, which made
  // sense for the old always-visible detail panel but not here). Cancelling
  // an edit of an existing record still just reverts its form.
  const handleCancelPayroll = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedItem(null);
    } else {
      baseCancel(filtered);
    }
  }, [isCreating, filtered, baseCancel, setIsCreating, setIsEditing, setSelectedItem]);

  // Returns to the browse table from the detail view.
  const handleBackToPayroll = useCallback(() => {
    setSelectedItem(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedItem, setIsCreating, setIsEditing]);

  // Whether we're showing a single payroll record's detail view (selected or
  // being created) instead of the browse table.
  const isDetailMode = !!selectedItem || isCreating;

  const columns: TDataGridColumn<EmployeePayroll>[] = useMemo(
    () => [
      {
        field: "employee_name",
        header: "Employee",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<EmployeePayroll>) => params.row.employee_name || params.row.employee_id,
      },
      {
        field: "payroll_month",
        header: "Pay Period",
        width: 130,
        renderCell: (params: GridRenderCellParams<EmployeePayroll>) =>
          params.row.payroll_month && params.row.payroll_year ? `${params.row.payroll_month}/${params.row.payroll_year}` : "-",
      },
      {
        field: "gross_salary",
        header: "Gross Pay",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<EmployeePayroll>) => fmtLKR(params.row.gross_salary || 0),
      },
      {
        field: "total_deductions",
        header: "Deductions",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<EmployeePayroll>) => fmtLKR(params.row.total_deductions || 0),
      },
      {
        field: "net_salary",
        header: "Net Pay",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<EmployeePayroll>) => fmtLKR(params.row.net_salary || params.row.basic_salary),
      },
      {
        field: "status",
        header: "Status",
        width: 140,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<EmployeePayroll>) =>
          params.row.status ? (
            <Chip
              label={params.row.status.replace("_", " ")}
              size="small"
              color={statusColor(params.row.status)}
              sx={{ height: 20, fontSize: "0.65rem", textTransform: "capitalize" }}
            />
          ) : (
            "-"
          ),
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<EmployeePayroll>) => (
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

  // Browse mode: a full-width table of every payroll record. Sorting is done
  // per-column via the grid's own column header menu.
  const tablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<EmployeePayroll>
          rows={filtered}
          columns={columns}
          loading={isLoading}
          onRowClick={(row) => handleSelectItem(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No payroll records found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current payroll
  // record (or the "New Payroll Record" placeholder while creating) plus a
  // "Back to Payroll" link that returns to the table.
  const singlePayrollPanel = (
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
        <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={handleBackToPayroll} sx={{ textTransform: "none" }}>
          Back to Payroll
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
              <AccountBalanceIcon color="primary" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Payroll Record
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
                <AccountBalanceIcon color="primary" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>{selectedItem.employee_name || selectedItem.employee_id}</span>
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
        breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Payroll", href: "/hr/payroll" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Record" : selectedItem?.employee_id || "" }] : [])]}
        title={selectedItem ? `${selectedItem.employee_name || selectedItem.employee_id}` : ""}
        titleIcon={<AccountBalanceIcon color="primary" />}
        isCreating={isCreating} createTitle="New Payroll Record" noSelectionTitle="Select a Payroll Record"
        chips={selectedItem && !isCreating && selectedItem.status ? [{ label: selectedItem.status.replace("_", " "), color: statusColor(selectedItem.status) }] : []}
        actions={
          !isCreating && !isEditing ? (
            <TPrintButton documentType="payroll" documentId={selectedItem?.id || 0} tooltip="Print Payslip" onClick={() => setPrintDialogOpen(true)} />
          ) : undefined
        }
      />
      <ActionToolbar canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} hasSelectedItem={!!selectedItem}
        isCreating={isCreating} isEditing={isEditing} isSaving={isSaving} isFormValid={isFormValid}
        onNew={handleNew} onDelete={handleDelete} onSave={handleSave} onCancel={handleCancelPayroll} onEdit={handleStartEdit}
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a payroll record from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={3} fieldsPerSection={4} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Employee & Earnings" columns={2}>
              <TextField label="Employee ID" size="small" value={formData.employee_id} onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })} disabled={isDisabled} required />
              <TextField label="Basic Salary" size="small" type="number" value={Number(formData.basic_salary) || ""} onChange={(e) => setFormData({ ...formData, basic_salary: parseFloat(e.target.value) || 0 })} disabled={isDisabled} required inputProps={{ step: "0.01" }} />
              <TextField label="Sales Commission" size="small" type="number" value={formData.add_sales_commision || ""} onChange={(e) => setFormData({ ...formData, add_sales_commision: parseFloat(e.target.value) || 0 })} disabled={isDisabled} inputProps={{ step: "0.01" }} />
              <Box />
              <TextField label="Addition 1 Name" size="small" value={formData.add_1_name || ""} onChange={(e) => setFormData({ ...formData, add_1_name: e.target.value })} disabled={isDisabled} />
              <TextField label="Addition 1 Value" size="small" type="number" value={formData.add_1_value || ""} onChange={(e) => setFormData({ ...formData, add_1_value: parseFloat(e.target.value) || 0 })} disabled={isDisabled} inputProps={{ step: "0.01" }} />
            </FormSection>

            <FormSection title="Deductions & Statutory" columns={2}>
              <TextField label="EPF (Employee)" size="small" type="number" value={formData.less_epf_employee || ""} onChange={(e) => setFormData({ ...formData, less_epf_employee: parseFloat(e.target.value) || 0 })} disabled={isDisabled} inputProps={{ step: "0.01" }} />
              <TextField label="EPF (Employer)" size="small" type="number" value={formData.epf_employer || ""} onChange={(e) => setFormData({ ...formData, epf_employer: parseFloat(e.target.value) || 0 })} disabled={isDisabled} inputProps={{ step: "0.01" }} />
              <TextField label="ETF (Employee)" size="small" type="number" value={formData.less_etf_employee || ""} onChange={(e) => setFormData({ ...formData, less_etf_employee: parseFloat(e.target.value) || 0 })} disabled={isDisabled} inputProps={{ step: "0.01" }} />
              <TextField label="ETF (Employer)" size="small" type="number" value={formData.etf_employer || ""} onChange={(e) => setFormData({ ...formData, etf_employer: parseFloat(e.target.value) || 0 })} disabled={isDisabled} inputProps={{ step: "0.01" }} />
              <TextField label="Stamp Duty" size="small" type="number" value={formData.less_stamp_duty || ""} onChange={(e) => setFormData({ ...formData, less_stamp_duty: parseFloat(e.target.value) || 0 })} disabled={isDisabled} inputProps={{ step: "0.01" }} />
            </FormSection>

            {selectedItem && !isCreating && !isEditing && selectedItem.net_salary != null && (
              <FormSection title="Summary" columns={3}>
                <Box>
                  <Typography variant="caption" color="text.secondary">Gross Salary</Typography>
                  <Typography variant="body2" fontWeight={600}>{fmtLKR(selectedItem.gross_salary || 0)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Total Deductions</Typography>
                  <Typography variant="body2" fontWeight={600} color="error.main">{fmtLKR(selectedItem.total_deductions || 0)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Net Salary</Typography>
                  <Typography variant="h6" fontWeight={700} color="success.main">{fmtLKR(selectedItem.net_salary || 0)}</Typography>
                </Box>
              </FormSection>
            )}

            {selectedItem && !isCreating && !isEditing && (
              <FormSection title="Record Info" columns={2}>
                <Box><Typography variant="caption" color="text.secondary">Created</Typography><Typography variant="body2">{formatDateTimeReadable(selectedItem.created_at) || "-"}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Period</Typography><Typography variant="body2">{selectedItem.payroll_month && selectedItem.payroll_year ? `${selectedItem.payroll_month}/${selectedItem.payroll_year}` : "-"}</Typography></Box>
              </FormSection>
            )}
          </>
        )}
      </Box>

      <TPrintPreviewDialog open={printDialogOpen} onClose={() => setPrintDialogOpen(false)} documentType="payroll" documentId={selectedItem?.id || 0} title="Payslip" />
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Employee Payroll"
        titleSlot={
          isDetailMode ? undefined : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search payroll records..."
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
                  Add Payroll Record
                </Button>
              )}
              <TExportButton
                filename="payroll"
                headers={[
                  "Batch No",
                  "Employee ID",
                  "Employee",
                  "Month",
                  "Year",
                  "Basic Salary",
                  "Gross Salary",
                  "Total Deductions",
                  "Net Salary",
                  "Status",
                  "Payment Status",
                ]}
                rows={() =>
                  filtered.map((p) => [
                    p.payroll_batch_no || "",
                    p.employee_id || "",
                    p.employee_name || "",
                    p.payroll_month ?? "",
                    p.payroll_year ?? "",
                    p.basic_salary ?? 0,
                    p.gross_salary ?? "",
                    p.total_deductions ?? "",
                    p.net_salary ?? "",
                    p.status || "",
                    p.payment_status || "",
                  ])
                }
                disabled={filtered.length === 0}
              />
              <TPrintButton documentType="payroll" documentId={0} tooltip="Print Payroll Report" onClick={() => setPrintDialogOpen(true)} />
            </>
          )
        }
        onRefresh={refetch}
        isLoading={isLoading}
        {...(isDetailMode
          ? { masterPanel: singlePayrollPanel, detailPanel: detailContent }
          : { children: tablePanel })}
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
