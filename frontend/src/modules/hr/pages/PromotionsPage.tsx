/**
 * PromotionsPage — Browse table + single-record detail toggle.
 * Browse mode: a full-width table of every promotion record.
 * Detail mode: the record's detail form (unchanged), full-width, with a
 * "Back to Promotions" link returning to the table.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Box, Button, IconButton, Paper, TextField, Tooltip, Typography } from "@mui/material";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { format } from "date-fns";

import {
  ActionToolbar,
  DetailPanelHeader,
  EmptyState,
  FormSection,
  MasterDetailLayout,
  SelectableListItem,
  TConfirmDialog,
  TDetailSkeleton,
  TExportButton,
  TDataGrid,
  type TDataGridColumn,
  handleApiError,
  showErrorToast,
  showSuccessToast,
  useMasterDetailState,
  useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { promotionsApi } from "@/modules/hr/api";
import { formatDateTimeReadable } from "@/utils/formatters";
import type { EmployeePromotion, EmployeePromotionCreate } from "@/modules/hr/types";

const INITIAL_FORM: EmployeePromotionCreate = {
  employee_id: "",
  designation: "",
  appointed_date: new Date().toISOString().split("T")[0],
  remark: "",
};

export default function PromotionsPage() {
  const qc = useQueryClient();
  const canCreate = usePermission("promotions", "create");
  const canUpdate = usePermission("promotions", "update");
  const canDelete = usePermission("promotions", "delete");

  const {
    searchQuery, setSearchQuery,
    selectedItem, setSelectedItem, isEditing, isCreating,
    setIsCreating, setIsEditing,
    formData, setFormData,
    handleSelectItem, handleNew, handleCancel: baseCancel, handleStartEdit,
  } = useMasterDetailState<EmployeePromotion, EmployeePromotionCreate>({
    initialFormData: INITIAL_FORM,
    resetFormFromItem: (p) => ({
      employee_id: p.employee_id,
      designation: p.designation,
      appointed_date: p.appointed_date,
      remark: p.remark || "",
    }),
    defaultSortField: "appointed_desc",
  });

  const { data: promotions, isLoading, refetch } = useQuery({
    queryKey: ["promotions"],
    queryFn: () => promotionsApi.getAll(),
  });

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let list = (promotions || []).filter(
      (p) => !q || p.employee_id.toLowerCase().includes(q) || p.designation.toLowerCase().includes(q) || (p.remark || "").toLowerCase().includes(q)
    );
    // Default order before the user sorts a column in the table itself
    // (the table's own column-header sort takes over from there).
    list.sort((a, b) => b.appointed_date.localeCompare(a.appointed_date));
    return list;
  }, [promotions, searchQuery]);

  const createMut = useMutation({
    mutationFn: (d: EmployeePromotionCreate) => promotionsApi.create(d),
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["promotions"] });
      showSuccessToast("Promotion created");
      setIsCreating(false); setIsEditing(false);
      setTimeout(() => handleSelectItem(rec), 0);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to create promotion")),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EmployeePromotionCreate }) => promotionsApi.update(id, data),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["promotions"] });
      showSuccessToast("Promotion updated");
      setIsEditing(false);
      setSelectedItem(updated);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to update promotion")),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => promotionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["promotions"] });
      showSuccessToast("Promotion deleted");
      setSelectedItem(null);
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to delete promotion")),
  });

  const confirmDialog = useTConfirmDialog();

  const handleSave = useCallback(() => {
    if (isCreating) createMut.mutate(formData);
    else if (selectedItem) updateMut.mutate({ id: selectedItem.id, data: formData });
  }, [isCreating, selectedItem, formData, createMut, updateMut]);

  const handleDelete = useCallback(async () => {
    if (!selectedItem) return;
    const ok = await confirmDialog.confirm({ title: "Delete Promotion", message: "Delete this promotion record?", confirmText: "Delete", confirmColor: "error" });
    if (ok) deleteMut.mutate(selectedItem.id);
  }, [selectedItem, deleteMut, confirmDialog]);

  // Cancelling out of "New Promotion" should return to the browse table,
  // not auto-open the first record the way useMasterDetailState's generic
  // handleCancel does (that behavior made sense for the old always-visible
  // detail panel, but not here). Cancelling out of editing an existing
  // record still just reverts its form, which the generic handler already
  // does correctly.
  const handleCancelPromotion = useCallback(() => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      setSelectedItem(null);
    } else {
      baseCancel(filtered);
    }
  }, [isCreating, filtered, baseCancel, setIsCreating, setIsEditing, setSelectedItem]);

  // Returns to the browse table from the detail view.
  const handleBackToPromotions = useCallback(() => {
    setSelectedItem(null);
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [isCreating, setSelectedItem, setIsCreating, setIsEditing]);

  const isFormValid = !!formData.employee_id && !!formData.designation && !!formData.appointed_date;
  const isSaving = createMut.isPending || updateMut.isPending;
  const isDisabled = !isEditing && !isCreating;

  // Whether we're showing a single promotion's detail view (selected or
  // being created) instead of the browse table.
  const isPromotionDetailMode = !!selectedItem || isCreating;

  // The table sorts by whichever column the user clicks via the grid's own
  // column-header menu, not a separate "Sort by" control.
  //
  // NOTE: EmployeePromotion only records the resulting designation (plus a
  // free-text remark) — there's no stored "previous designation" field to
  // show a distinct "Old Position" column, so the columns below use New
  // Position (designation), Effective Date and Remark instead.
  const promotionColumns: TDataGridColumn<EmployeePromotion>[] = useMemo(
    () => [
      { field: "employee_id", header: "Employee", flex: 1, minWidth: 140 },
      { field: "designation", header: "New Position", flex: 1, minWidth: 160 },
      {
        field: "appointed_date",
        header: "Effective Date",
        width: 140,
        renderCell: (params: GridRenderCellParams<EmployeePromotion>) =>
          format(new Date(params.row.appointed_date), "MMM dd, yyyy"),
      },
      {
        field: "remark",
        header: "Remark",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<EmployeePromotion>) => params.row.remark || "-",
      },
      {
        field: "view",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<EmployeePromotion>) => (
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

  // Browse mode: a full-width table of every promotion record.
  const promotionTablePanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <TDataGrid<EmployeePromotion>
          rows={filtered}
          columns={promotionColumns}
          loading={isLoading}
          onRowClick={(row) => handleSelectItem(row)}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSize={25}
          emptyMessage="No promotions found"
          autoHeight={false}
          height="100%"
        />
      </Box>
    </Box>
  );

  // Detail mode: a narrow left panel showing only the current promotion
  // record (or the "New Promotion" placeholder while creating) plus a
  // "Back to Promotions" link that returns to the table.
  const singlePromotionPanel = (
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
          onClick={handleBackToPromotions}
          sx={{ textTransform: "none" }}
        >
          Back to Promotions
        </Button>
      </Box>
      {isCreating ? (
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ bgcolor: "action.disabledBackground" }}>
              <TrendingUpIcon color="primary" />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              New Promotion
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
                <TrendingUpIcon color="primary" />
              </Avatar>
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0 }}>
                <span>{selectedItem.employee_id} → {selectedItem.designation}</span>
              </Box>
            </Box>
          }
        />
      )}
    </Paper>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Promotions", href: "/hr/promotions" },
          ...(selectedItem || isCreating ? [{ label: isCreating ? "New Promotion" : `#${selectedItem?.id}` }] : [])]}
        title={selectedItem ? `${selectedItem.employee_id} → ${selectedItem.designation}` : ""}
        titleIcon={<TrendingUpIcon color="primary" />}
        isCreating={isCreating} createTitle="New Promotion" noSelectionTitle="Select a Promotion"
      />
      <ActionToolbar canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} hasSelectedItem={!!selectedItem}
        isCreating={isCreating} isEditing={isEditing} isSaving={isSaving} isFormValid={isFormValid}
        onNew={handleNew} onDelete={handleDelete} onSave={handleSave} onCancel={handleCancelPromotion} onEdit={handleStartEdit}
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!selectedItem && !isCreating ? (
          <EmptyState message="Select a promotion from the list or create a new one" />
        ) : isLoading && !isCreating ? (
          <TDetailSkeleton sections={2} fieldsPerSection={3} showHeader={false} showToolbar={false} />
        ) : (
          <>
            <FormSection title="Promotion Details" columns={2}>
              <TextField label="Employee ID" size="small" value={formData.employee_id} onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })} disabled={isDisabled} required />
              <TextField label="Designation" size="small" value={formData.designation} onChange={(e) => setFormData({ ...formData, designation: e.target.value })} disabled={isDisabled} required />
              <TextField label="Appointed Date" size="small" type="date" value={formData.appointed_date} onChange={(e) => setFormData({ ...formData, appointed_date: e.target.value })} disabled={isDisabled} InputLabelProps={{ shrink: true }} required />
              <Box sx={{ gridColumn: "1 / -1" }}>
                <TextField label="Remark" size="small" value={formData.remark || ""} onChange={(e) => setFormData({ ...formData, remark: e.target.value })} disabled={isDisabled} fullWidth multiline rows={3} />
              </Box>
            </FormSection>
            {selectedItem && !isCreating && !isEditing && (
              <FormSection title="Record Info" columns={2}>
                <Box><Typography variant="caption" color="text.secondary">Created</Typography><Typography variant="body2">{formatDateTimeReadable(selectedItem.created_at) || "-"}</Typography></Box>
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
        title="Promotions"
        onRefresh={refetch}
        isLoading={isLoading}
        {...(isPromotionDetailMode
          ? { masterPanel: singlePromotionPanel, detailPanel }
          : { children: promotionTablePanel })}
        headerActions={
          isPromotionDetailMode ? undefined : (
            <>
              {canCreate && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleNew}
                  sx={{ mr: 1 }}
                >
                  Add Promotion
                </Button>
              )}
              <TExportButton
                filename="promotions"
                headers={["Employee ID", "Designation", "Appointed Date", "Remark"]}
                rows={() =>
                  filtered.map((p) => [
                    p.employee_id || "",
                    p.designation || "",
                    p.appointed_date || "",
                    p.remark || "",
                  ])
                }
                disabled={filtered.length === 0}
              />
            </>
          )
        }
      />
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
