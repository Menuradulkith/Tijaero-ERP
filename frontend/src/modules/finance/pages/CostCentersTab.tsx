/**
 * Accounting Setup → Cost Centers: the departments whose income and costs are
 * tracked separately, and each branch's default.
 *
 * Same layout as the other setup tabs: full-height list with search and status
 * filter; a row opens a full-page detail (Edit → Save/Cancel, Activate /
 * Deactivate); "Add Cost Center" opens the same form for a new one.
 */

import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import BlockIcon from "@mui/icons-material/Block";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import HubIcon from "@mui/icons-material/Hub";
import SearchIcon from "@mui/icons-material/Search";
import { Alert, Box, Button, Checkbox, FormControlLabel, InputAdornment, MenuItem, TextField } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  ActionToolbar,
  DetailPanelHeader,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  showSuccessToast,
  TChip,
  TDataGrid,
  type TDataGridColumn,
  TSearchableSelect,
  TStatusChip,
  useRecordParam,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { costCentersApi, type CostCenter, type CostCenterInput } from "@/modules/finance/api/costCenters";
import { submitOnce } from "@/modules/finance/submitOnce";
import type { SetupTabLayout } from "./AccountingSetupPage";

interface BranchOption {
  branch_code: string;
  branch_name: string;
}

const EMPTY: CostCenterInput = { code: "", name: "", branch_code: "", is_branch_default: false, description: "" };

const BREADCRUMBS = [
  { label: "Finance", href: "/finance" },
  { label: "Accounting Setup", href: "/finance/accounting-setup" },
  { label: "Cost Centers" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const toForm = (c: CostCenter): CostCenterInput => ({
  name: c.name,
  branch_code: c.branch_code ?? "",
  is_branch_default: c.is_branch_default,
  is_active: c.is_active,
  description: c.description ?? "",
});

export default function CostCentersTab({ canEdit, layout }: { canEdit: boolean; layout: SetupTabLayout }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<CostCenter | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CostCenterInput>(EMPTY);
  const { filteredBranches } = useReferenceData(["branches"]);
  const branches = (filteredBranches || []) as BranchOption[];
  const branchName = (code?: string | null) => branches.find((b) => b.branch_code === code)?.branch_name ?? code ?? "—";

  const { data: centers, isLoading, refetch } = useQuery({ queryKey: ["cost-centers"], queryFn: () => costCentersApi.getAll() });

  const afterSave = (saved: CostCenter) => {
    queryClient.invalidateQueries({ queryKey: ["cost-centers"] });
    setCreating(false);
    setEditing(false);
    setSelected(saved);
    setForm(toForm(saved));
  };

  const save = useMutation({
    mutationFn: () => (creating ? costCentersApi.create(form) : costCentersApi.update((selected as CostCenter).id, form)),
    onSuccess: (saved) => {
      showSuccessToast("Cost center saved.");
      afterSave(saved);
    },
    onError: (err) => handleApiError(err, "Could not save the cost center"),
  });

  const toggleActive = useMutation({
    mutationFn: (c: CostCenter) => costCentersApi.update(c.id, { is_active: !c.is_active }),
    onSuccess: (saved) => {
      showSuccessToast(saved.is_active ? "Cost center activated." : "Cost center deactivated.");
      afterSave(saved);
    },
    onError: (err) => handleApiError(err, "Could not save the cost center"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (centers ?? []).filter(
      (c) =>
        (!status || (status === "active") === c.is_active) &&
        (!q || [c.code, c.name, c.description, c.branch_code].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [centers, search, status]);

  const columns: TDataGridColumn<CostCenter>[] = [
    { field: "code", header: "Code", width: 130 },
    { field: "name", header: "Name", minWidth: 180, flex: 1.2 },
    { field: "description", header: "Description", minWidth: 200, flex: 1.5 },
    {
      field: "branch_code",
      header: "Branch",
      minWidth: 200,
      flex: 1,
      renderCell: (p) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: "100%" }}>
          {p.row.branch_code ? branchName(p.row.branch_code) : "Any branch"}
          {p.row.is_branch_default && <TChip size="small" color="primary" label="Branch default" />}
        </Box>
      ),
    },
    {
      field: "is_active",
      header: "Status",
      width: 110,
      renderCell: (p) => <TStatusChip status={p.row.is_active ? "active" : "inactive"} statusMap="financeDocument" />,
    },
  ];

  const back = () => {
    setSelected(null);
    setCreating(false);
    setEditing(false);
  };
  const detailMode = creating || !!selected;

  // Open record lives in the URL (?id= / ?new=1): browser Back returns to the list.
  useRecordParam({
    current: selected?.id,
    creating,
    items: centers,
    loading: isLoading,
    onOpen: (c) => {
      setCreating(false);
      setEditing(false);
      setSelected(c);
      setForm(toForm(c));
    },
    onClose: back,
    onNew: canEdit ? () => {
      setForm(EMPTY);
      setCreating(true);
    } : undefined,
  });
  const ro = !creating && !editing;
  const valid = !!form.name?.trim() && (!creating || !!form.code?.trim());

  const detail = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[...BREADCRUMBS, { label: creating ? "New Cost Center" : selected?.code ?? "" }]}
        title={selected ? `${selected.code} · ${selected.name}` : ""}
        titleIcon={<HubIcon color="primary" />}
        isCreating={creating}
        createTitle="New Cost Center"
        chips={selected && !creating ? [getStatusProps(selected.is_active ? "active" : "inactive", "financeDocument")] : []}
      />
      <ActionToolbar
        hasSelectedItem={!!selected}
        isCreating={creating}
        isEditing={editing}
        isSaving={save.isPending || toggleActive.isPending}
        isFormValid={valid}
        canUpdate={canEdit}
        onEdit={canEdit ? () => setEditing(true) : undefined}
        onSave={() => submitOnce("CostCentersTab-save-1", save)}
        onCancel={() => {
          if (creating) back();
          else {
            setEditing(false);
            if (selected) setForm(toForm(selected));
          }
        }}
        endActions={
          canEdit && selected && ro ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={selected.is_active ? <BlockIcon /> : <CheckCircleOutlineIcon />}
              disabled={toggleActive.isPending}
              onClick={() => submitOnce("CostCentersTab-active", toggleActive, selected)}
            >
              {selected.is_active ? "Deactivate" : "Activate"}
            </Button>
          ) : undefined
        }
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        <FormSection title="Cost Center" columns={2}>
          <TextField
            label="Code"
            size="small"
            required={creating}
            disabled={!creating}
            value={creating ? form.code ?? "" : selected?.code ?? ""}
            inputProps={{ maxLength: 20 }}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            helperText={creating ? "Short, e.g. RETAIL" : undefined}
          />
          <TextField label="Name" size="small" required disabled={ro} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} inputProps={{ maxLength: 100 }} />
        </FormSection>
        <FormSection title="Branch" columns={2}>
          <TextField
            select
            label="Branch"
            size="small"
            disabled={ro}
            value={form.branch_code ?? ""}
            onChange={(e) => setForm({ ...form, branch_code: e.target.value, is_branch_default: e.target.value ? form.is_branch_default : false })}
          >
            <MenuItem value="">Any branch</MenuItem>
            {branches.map((b) => (
              <MenuItem key={b.branch_code} value={b.branch_code}>
                {b.branch_name}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={
              <Checkbox
                checked={!!form.is_branch_default}
                disabled={ro || !form.branch_code}
                onChange={(e) => setForm({ ...form, is_branch_default: e.target.checked })}
              />
            }
            label="Use for this branch's automatic entries (sales, expenses…)"
          />
        </FormSection>
        <FormSection title="Description" columns={1}>
          <TextField
            label="Description"
            size="small"
            multiline
            minRows={2}
            disabled={ro}
            value={form.description ?? ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </FormSection>
        <Alert severity="info" variant="outlined">
          A cost center is a department or activity whose income and costs you want to see separately (for example Retail,
          Wholesale, Service). Income and expense lines carry one; a branch&apos;s default is used for automatic entries such as
          sales and expenses. See the results under Profit by Cost Center.
        </Alert>
      </Box>
    </Box>
  );

  return (
    <MasterDetailLayout
      title="Accounting Setup"
      {...layout}
      titleSlot={
        detailMode ? (
          <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={back} sx={{ textTransform: "none" }}>
            Back to Cost Centers
          </Button>
        ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search cost centers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 220, flexShrink: 0 }}
            />
            <Box sx={{ width: 150, flexShrink: 0 }}>
              <TSearchableSelect
                label=""
                value={status}
                onChange={(v) => setStatus(v as string | null)}
                options={STATUS_OPTIONS}
                showAllOption
                allOptionLabel="All Statuses"
                placeholder="Search status..."
                size="small"
              />
            </Box>
          </Box>
        )
      }
      headerActions={
        !detailMode && canEdit ? (
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => {
              setForm(EMPTY);
              setCreating(true);
            }}
            sx={{ mr: 1 }}
          >
            Add Cost Center
          </Button>
        ) : undefined
      }
      onRefresh={() => refetch()}
      isLoading={isLoading}
    >
      {detailMode ? (
        detail
      ) : (
        <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
          <TDataGrid<CostCenter>
            rows={filtered}
            columns={columns}
            loading={isLoading}
            onRowClick={(c) => {
              setSelected(c);
              setForm(toForm(c));
            }}
            pageSizeOptions={[10, 25, 50, 100]}
            pageSize={25}
            emptyMessage="No cost centers yet"
            autoHeight={false}
            height="100%"
          />
        </Box>
      )}
    </MasterDetailLayout>
  );
}
