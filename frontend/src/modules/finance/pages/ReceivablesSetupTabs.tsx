/**
 * Accounting Setup tab for receivables: write-off limits.
 *
 * Same layout as the other setup tabs: a full-height list of user groups with
 * their limit; a row opens a full-page detail where the limit is edited
 * (Edit → Save/Cancel). Groups come from user management, so there is no Add.
 */

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import SearchIcon from "@mui/icons-material/Search";
import { Alert, Box, Button, InputAdornment, TextField } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  ActionToolbar,
  DetailPanelHeader,
  FormSection,
  handleApiError,
  MasterDetailLayout,
  showSuccessToast,
  TCurrency,
  TDataGrid,
  type TDataGridColumn,
} from "@/components/tijaero";
import { writeOffsApi, type WriteOffLimit } from "@/modules/finance/api/receivables";
import { submitOnce } from "@/modules/finance/submitOnce";
import type { SetupTabLayout } from "./AccountingSetupPage";

const BREADCRUMBS = [
  { label: "Finance", href: "/finance" },
  { label: "Accounting Setup", href: "/finance/accounting-setup" },
  { label: "Write-off Limits" },
];

// ─── Write-off limits ────────────────────────────────────────────────────────
export function WriteOffLimitsTab({ canEdit, layout }: { canEdit: boolean; layout: SetupTabLayout }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const { data: limits, isLoading, refetch } = useQuery({ queryKey: ["write-off-limits"], queryFn: writeOffsApi.getLimits });

  const selected = (limits ?? []).find((l) => l.group_id === selectedId) ?? null;

  const save = useMutation({
    mutationFn: ({ groupId, amount }: { groupId: number; amount: number }) => writeOffsApi.setLimit(groupId, amount),
    onSuccess: (data) => {
      queryClient.setQueryData(["write-off-limits"], data);
      setEditing(false);
      showSuccessToast("Limit saved.");
    },
    onError: (err) => handleApiError(err, "Could not save the limit"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (limits ?? []).filter((l) => !q || l.group_name.toLowerCase().includes(q));
  }, [limits, search]);

  const columns: TDataGridColumn<WriteOffLimit>[] = [
    { field: "group_name", header: "User group", minWidth: 220, flex: 1 },
    {
      field: "max_amount",
      header: "Largest write-off",
      width: 200,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => <TCurrency value={Number(p.row.max_amount)} />,
    },
  ];

  const back = () => {
    setSelectedId(null);
    setEditing(false);
  };
  const value = editing ? draft : selected ? String(Number(selected.max_amount)) : "";
  const changed = !!selected && draft !== "" && Number(draft) !== Number(selected.max_amount);
  const MAX_LIMIT = 999999999.99;
  const draftError =
    draft.trim() === ""
      ? null
      : !/^\d+(\.\d{1,2})?$/.test(draft.trim())
        ? "Enter an amount of 0 or more with at most 2 decimals"
        : Number(draft) > MAX_LIMIT
          ? "The limit can be at most 999,999,999.99"
          : null;
  const valid = draft.trim() !== "" && !draftError;

  const detail = selected && (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[...BREADCRUMBS, { label: selected.group_name }]}
        title={selected.group_name}
        titleIcon={<MoneyOffIcon color="primary" />}
      />
      <ActionToolbar
        hasSelectedItem
        isCreating={false}
        isEditing={editing}
        isSaving={save.isPending}
        isFormValid={valid}
        canUpdate={canEdit}
        onEdit={
          canEdit
            ? () => {
                setDraft(String(Number(selected.max_amount)));
                setEditing(true);
              }
            : undefined
        }
        onSave={() =>
          // Nothing changed: just leave edit mode instead of re-saving the same limit.
          changed
            ? submitOnce("ReceivablesSetupTabs-save-1", save, { groupId: selected.group_id, amount: Number(draft) })
            : setEditing(false)
        }
        onCancel={() => setEditing(false)}
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        <FormSection title="Write-off Limit" columns={2}>
          <TextField label="User group" size="small" value={selected.group_name} disabled />
          <TextField
            label="Largest write-off"
            size="small"
            type="number"
            required
            value={value}
            disabled={!editing}
            onChange={(e) => setDraft(e.target.value)}
            error={editing && !!draftError}
            helperText={editing && draftError ? draftError : undefined}
            InputProps={{ startAdornment: <InputAdornment position="start">Rs.</InputAdornment> }}
            inputProps={{ min: 0, max: MAX_LIMIT, step: "0.01" }}
          />
        </FormSection>
        <Alert severity="info" variant="outlined">
          The largest amount a person in this user group may write off in one go. 0 means the group can&apos;t write off at
          all. A person in several groups gets the highest of their limits; administrators have no limit.
        </Alert>
      </Box>
    </Box>
  );

  return (
    <MasterDetailLayout
      title="Accounting Setup"
      {...layout}
      titleSlot={
        selected ? (
          <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={back} sx={{ textTransform: "none" }}>
            Back to Write-off Limits
          </Button>
        ) : (
          <TextField
            size="small"
            placeholder="Search user groups..."
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
        )
      }
      onRefresh={() => refetch()}
      isLoading={isLoading}
    >
      {detail || (
        <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
          <TDataGrid<WriteOffLimit>
            rows={filtered}
            columns={columns}
            getRowId={(l) => l.group_id}
            loading={isLoading}
            onRowClick={(l) => setSelectedId(l.group_id)}
            pageSizeOptions={[10, 25, 50, 100]}
            pageSize={25}
            emptyMessage="No user groups"
            autoHeight={false}
            height="100%"
          />
        </Box>
      )}
    </MasterDetailLayout>
  );
}
