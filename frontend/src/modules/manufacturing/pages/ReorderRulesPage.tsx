/**
 * ReorderRulesPage - min / max stock levels per product and branch (Odoo "Reordering
 * Rules", Business Central "Reorder Point"). MRP plans a purchase or production order
 * when the projected stock falls below the minimum, up to the maximum (the minimum when
 * no maximum), rounded up to the multiple.
 */

import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import SearchIcon from "@mui/icons-material/Search";
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  MasterDetailLayout,
  TBranchFilter,
  TChip,
  TConfirmDialog,
  TDataGrid,
  type TDataGridColumn,
  TStatusChip,
  useCrudMutation,
  useTConfirmDialog,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { useReferenceData, type ProductRef } from "@/hooks";
import { reorderRulesApi } from "@/modules/manufacturing/api";
import type { ReorderRule, ReorderRuleInput } from "@/modules/manufacturing/types";
import { suppliersApi } from "@/modules/purchasing/api";

interface RuleForm {
  product_id: number | null;
  branch_code: string;
  min_quantity: string;
  max_quantity: string;
  multiple_quantity: string;
  preferred_supplier_id: number | null;
  active: boolean;
}

const EMPTY_FORM: RuleForm = {
  product_id: null,
  branch_code: "",
  min_quantity: "",
  max_quantity: "",
  multiple_quantity: "1",
  preferred_supplier_id: null,
  active: true,
};

export default function ReorderRulesPage() {
  const queryClient = useQueryClient();
  const canEdit = usePermission("mrp", "update");
  const confirmDialog = useTConfirmDialog();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [editing, setEditing] = useState<ReorderRule | "new" | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);

  const { filteredBranches, defaultBranchCode, data: refData } = useReferenceData(["branches", "products"], { productsLimit: 2000 });
  const branches = filteredBranches || [];
  const products: ProductRef[] = useMemo(() => (refData?.products || []).filter((p) => p.active !== false), [refData]);

  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) setFilterBranch(defaultBranchCode);
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["reorder-rules", filterBranch],
    queryFn: () => reorderRulesApi.getAll({ branch_code: filterBranch || undefined }),
    enabled: branchResolved,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers", "active"],
    queryFn: () => suppliersApi.getAll({ active: true }),
    enabled: !!editing,
  });

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rules.filter(
      (r) => !q || (r.product_name || "").toLowerCase().includes(q) || (r.product_code || "").toLowerCase().includes(q)
    );
  }, [rules, searchQuery]);

  const invalidate = [["reorder-rules"], ["mrp"], ["manufacturing-dashboard"]];
  const createMutation = useCrudMutation({
    mutationFn: reorderRulesApi.create,
    invalidateQueryKeys: invalidate,
    successMessage: "Reordering rule created",
    errorMessage: "Failed to create reordering rule",
    onSuccess: () => setEditing(null),
  });
  const updateMutation = useCrudMutation({
    mutationFn: reorderRulesApi.update,
    invalidateQueryKeys: invalidate,
    successMessage: "Reordering rule updated",
    errorMessage: "Failed to update reordering rule",
    onSuccess: () => setEditing(null),
  });
  const deleteMutation = useCrudMutation({
    mutationFn: reorderRulesApi.delete,
    invalidateQueryKeys: invalidate,
    successMessage: "Reordering rule deleted",
    errorMessage: "Failed to delete reordering rule",
  });

  const openNew = () => {
    setForm({ ...EMPTY_FORM, branch_code: filterBranch || defaultBranchCode || "" });
    setEditing("new");
  };

  const openEdit = (rule: ReorderRule) => {
    setForm({
      product_id: rule.product_id,
      branch_code: rule.branch_code,
      min_quantity: String(rule.min_quantity),
      max_quantity: rule.max_quantity != null ? String(rule.max_quantity) : "",
      multiple_quantity: String(rule.multiple_quantity),
      preferred_supplier_id: rule.preferred_supplier_id ?? null,
      active: rule.active,
    });
    setEditing(rule);
  };

  const handleDelete = async (rule: ReorderRule) => {
    const ok = await confirmDialog.confirm({
      title: "Delete Reordering Rule",
      message: `Delete the rule for "${rule.product_name}" in ${rule.branch_code}? MRP stops planning stock for it.`,
      confirmText: "Delete",
      confirmColor: "error",
    });
    if (ok) deleteMutation.mutate(rule.id);
  };

  const min = Number(form.min_quantity);
  const max = form.max_quantity === "" ? null : Number(form.max_quantity);
  const formError =
    !form.product_id ? "Choose a product"
      : !form.branch_code ? "Choose a branch"
        : form.min_quantity === "" || !(min >= 0) ? "Enter a minimum of 0 or more"
          : max !== null && !(max >= min) ? "Maximum cannot be below the minimum"
            : !(Number(form.multiple_quantity) >= 1) ? "Multiple must be at least 1"
              : null;

  const handleSave = () => {
    if (formError || !form.product_id) return;
    const data: ReorderRuleInput = {
      product_id: form.product_id,
      branch_code: form.branch_code,
      min_quantity: Math.floor(min),
      max_quantity: max === null ? null : Math.floor(max),
      multiple_quantity: Math.floor(Number(form.multiple_quantity)),
      preferred_supplier_id: form.preferred_supplier_id,
      active: form.active,
    };
    if (editing === "new") createMutation.mutate(data);
    else if (editing) {
      const { product_id: _p, branch_code: _b, ...changes } = data;
      updateMutation.mutate({ id: editing.id, data: changes });
    }
  };

  const columns: TDataGridColumn<ReorderRule>[] = useMemo(
    () => [
      {
        field: "product_name",
        header: "Product",
        flex: 1,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<ReorderRule>) => (
          <Box sx={{ lineHeight: 1.2, py: 0.5 }}>
            <Typography variant="body2" fontWeight={600} noWrap>{params.row.product_name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {params.row.product_code}{params.row.is_manufactured ? " · manufactured" : ""}
            </Typography>
          </Box>
        ),
      },
      { field: "branch_code", header: "Branch", width: 130 },
      { field: "min_quantity", header: "Min", width: 90, type: "number" },
      {
        field: "max_quantity",
        header: "Max",
        width: 90,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<ReorderRule>) => params.row.max_quantity ?? "-",
      },
      { field: "multiple_quantity", header: "Multiple", width: 90, type: "number" },
      {
        field: "on_hand_quantity",
        header: "On Hand",
        width: 130,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<ReorderRule>) => (
          <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="flex-end" sx={{ width: "100%" }}>
            {params.row.below_minimum && <TChip label="Below min" size="small" color="error" />}
            <Typography variant="body2">{params.row.on_hand_quantity}</Typography>
          </Stack>
        ),
      },
      {
        field: "preferred_supplier_name",
        header: "Preferred Supplier",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<ReorderRule>) => params.row.preferred_supplier_name || "-",
      },
      {
        field: "active",
        header: "Status",
        width: 110,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<ReorderRule>) => (
          <TStatusChip status={params.row.active} statusMap="activeInactive" size="small" />
        ),
      },
      {
        field: "actions",
        header: "",
        width: 96,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<ReorderRule>) =>
          canEdit ? (
            <Box>
              <Tooltip title="Edit">
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); openEdit(params.row); }}>
                  <EditIcon fontSize="small" color="action" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDelete(params.row); }}>
                  <DeleteIcon fontSize="small" color="error" />
                </IconButton>
              </Tooltip>
            </Box>
          ) : null,
      },
    ],
    [canEdit] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      <MasterDetailLayout
        title="Reordering Rules"
        titleSlot={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 200, flexShrink: 0 }}
            />
            <Box sx={{ width: 150, flexShrink: 0 }}>
              <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
            </Box>
          </Box>
        }
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["reorder-rules"] })}
        isLoading={isLoading}
        headerActions={
          canEdit ? (
            <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openNew} sx={{ mr: 1 }}>
              Add Reordering Rule
            </Button>
          ) : undefined
        }
      >
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
            <TDataGrid<ReorderRule>
              rows={rows}
              columns={columns}
              loading={isLoading}
              onRowClick={(row) => (canEdit ? openEdit(row) : undefined)}
              pageSizeOptions={[10, 25, 50, 100]}
              pageSize={25}
              emptyMessage="No reordering rules — add one to keep a minimum stock of an item"
              autoHeight={false}
              height="100%"
            />
          </Box>
        </Box>
      </MasterDetailLayout>

      <Dialog open={!!editing} onClose={saving ? undefined : () => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing === "new" ? "New Reordering Rule" : "Edit Reordering Rule"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Autocomplete<ProductRef>
              size="small"
              options={products}
              disabled={editing !== "new"}
              getOptionLabel={(p) => `${p.name} (${p.item_code})`}
              value={products.find((p) => p.id === form.product_id) || null}
              onChange={(_, v) => setForm({ ...form, product_id: v?.id ?? null })}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              renderInput={(params) => <TextField {...params} label="Product" required />}
            />
            <TextField
              select
              size="small"
              label="Branch"
              required
              disabled={editing !== "new"}
              value={form.branch_code}
              onChange={(e) => setForm({ ...form, branch_code: e.target.value })}
            >
              {branches.map((b) => (
                <MenuItem key={b.branch_code} value={b.branch_code}>{b.branch_code} - {b.branch_name}</MenuItem>
              ))}
            </TextField>
            <Stack direction="row" spacing={1.5}>
              <TextField size="small" type="number" label="Minimum" required fullWidth value={form.min_quantity}
                onChange={(e) => setForm({ ...form, min_quantity: e.target.value })} inputProps={{ min: 0 }}
                helperText="Plan when projected stock falls below" />
              <TextField size="small" type="number" label="Maximum" fullWidth value={form.max_quantity}
                onChange={(e) => setForm({ ...form, max_quantity: e.target.value })} inputProps={{ min: 0 }}
                helperText="Order up to (optional)" />
              <TextField size="small" type="number" label="Multiple" required fullWidth value={form.multiple_quantity}
                onChange={(e) => setForm({ ...form, multiple_quantity: e.target.value })} inputProps={{ min: 1 }}
                helperText="Round orders up to" />
            </Stack>
            <Autocomplete
              size="small"
              options={suppliers}
              getOptionLabel={(o) => o.company_name || ""}
              value={suppliers.find((sp) => sp.id === form.preferred_supplier_id) || null}
              onChange={(_, v) => setForm({ ...form, preferred_supplier_id: v?.id ?? null })}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              renderInput={(params) => (
                <TextField {...params} label="Preferred Supplier" helperText="Purchased items only; defaults to the supplier catalog" />
              )}
            />
            <FormControlLabel
              control={<Switch checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />}
              label="Active"
            />
            {formError && (
              <Typography variant="caption" color="error">{formError}</Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !!formError}>Save</Button>
        </DialogActions>
      </Dialog>
      <TConfirmDialog {...confirmDialog.dialogProps} />
    </>
  );
}
