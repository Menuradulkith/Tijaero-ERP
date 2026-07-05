/**
 * PayrollPage — Master/Detail layout for employee payroll records.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Chip, TextField, Typography } from "@mui/material";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  SortOption,
  TConfirmDialog,
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

const SORT_OPTIONS: SortOption[] = [
  { value: "created_desc", label: "Date (Newest)" },
  { value: "employee_id", label: "Employee ID" },
  { value: "net_salary_desc", label: "Net Salary (Highest)" },
];

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
    sortField, setSortField,
    selectedItem, isEditing, isCreating,
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
    list.sort((a, b) => {
      if (sortField === "employee_id") return a.employee_id.localeCompare(b.employee_id);
      if (sortField === "net_salary_desc") return (b.net_salary || 0) - (a.net_salary || 0);
      return (b.created_at || "").localeCompare(a.created_at || "");
    });
    return list;
  }, [payrolls, searchQuery, sortField]);

  useEffect(() => {
    if (filtered.length > 0 && !selectedItem && !isCreating) handleSelectItem(filtered[0]);
  }, [filtered, selectedItem, isCreating, handleSelectItem]);

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
      baseCancel(filtered);
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

  const masterPanel = (
    <SearchableList<EmployeePayroll>
      items={filtered}
      isLoading={isLoading}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search payroll records..."
      sortOptions={SORT_OPTIONS}
      currentSort={sortField}
      onSortChange={setSortField}
      selectedItem={selectedItem}
      onSelectItem={handleSelectItem}
      emptyMessage="No payroll records found"
      renderItem={(p, isSelected) => (
        <SelectableListItem
          key={p.id}
          id={p.id}
          isSelected={isSelected}
          onClick={() => handleSelectItem(p)}
          primaryText={
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.3 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>{p.employee_name || p.employee_id}</span>
                {p.status && (
                  <Chip label={p.status.replace("_", " ")} size="small" color={statusColor(p.status) as any} sx={{ height: 18, fontSize: "0.65rem", textTransform: "capitalize" }} />
                )}
              </Box>
              <Typography component="span" variant="caption" fontWeight={600} sx={{ color: isSelected ? "inherit" : "success.main" }}>
                Net: {fmtLKR(p.net_salary || p.basic_salary)}
              </Typography>
            </Box>
          }
          secondaryText={
            !isSelected
              ? `${p.payroll_batch_no || p.employee_id}${p.payroll_month ? ` • ${p.payroll_month}/${p.payroll_year}` : ""}`
              : undefined
          }
        />
      )}
    />
  );

  const detailPanel = (
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
        onNew={handleNew} onDelete={handleDelete} onSave={handleSave} onCancel={() => baseCancel(filtered)} onEdit={handleStartEdit}
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
      <MasterDetailLayout title="Employee Payroll" onRefresh={refetch} isLoading={isLoading} masterPanel={masterPanel} detailPanel={detailPanel}
        headerActions={
          <>
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
        }
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
