/**
 * WriteOffsPage — take amounts customers will not pay off their account.
 *
 * Pick an open credit invoice, enter the amount and a reason. The amount moves
 * from Trade Debtors to "Bad debts & write-offs", the invoice balance drops as
 * if it were paid, and the customer's available credit goes back up. Each user
 * may write off up to their group's limit (Accounting Setup → Write-off Limits).
 * A write-off made by mistake can be reversed.
 *
 * Same layout as the purchasing / sales pages: a full-width list with filters,
 * a full-page detail with breadcrumb and actions, and a full-page create form.
 */

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import MoneyOffIcon from "@mui/icons-material/MoneyOff";
import SearchIcon from "@mui/icons-material/Search";
import UndoIcon from "@mui/icons-material/Undo";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  MenuItem,
  TextField,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { usePermission } from "@/auth/permissions";
import {
  ActionToolbar,
  DetailPanelHeader,
  FormSection,
  getStatusProps,
  handleApiError,
  MasterDetailLayout,
  showSuccessToast,
  TBranchFilter,
  TDataGrid,
  type TDataGridColumn,
  TRemarkField,
  TSearchableSelect,
  TStatusChip,
} from "@/components/tijaero";
import { useReferenceData } from "@/hooks";
import { customersApi, type OutstandingDocumentItem } from "@/modules/customers/api";
import { writeOffsApi, type WriteOff } from "@/modules/finance/api/receivables";
import { submitOnce } from "@/modules/finance/submitOnce";
import { invalidateLedgerQueries } from "@/modules/finance/ledgerQueries";

const fmt = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "posted" reads better as "Written off" on this page.
const chipStatus = (w: WriteOff) => (w.status === "posted" ? "written_off" : w.status);

const STATUS_OPTIONS = [
  { value: "posted", label: "Written off", color: "warning" as const },
  { value: "reversed", label: "Reversed", color: "default" as const },
];

const BREADCRUMBS = [
  { label: "Finance", href: "/finance" },
  { label: "Customer Write-offs", href: "/finance/write-offs" },
];

function ReverseDialog({ wo, onClose, onDone }: { wo: WriteOff; onClose: () => void; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const reverse = useMutation({
    mutationFn: () => writeOffsApi.reverse(wo.id, reason),
    onSuccess: () => {
      showSuccessToast(`${wo.write_off_no} reversed; ${wo.invoice_no} is owed again.`);
      queryClient.invalidateQueries({ queryKey: ["write-offs"] });
      invalidateLedgerQueries(queryClient);
      onDone();
    },
    onError: (err) => handleApiError(err, "Could not reverse the write-off"),
  });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Reverse {wo.write_off_no}?</DialogTitle>
      <DialogContent>
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          {wo.customer_name} will owe {fmt(wo.amount)} on {wo.invoice_no} again.
        </Alert>
        <TextField label="Why?" size="small" fullWidth required value={reason} onChange={(e) => setReason(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!reason.trim() || reverse.isPending}
          onClick={() => submitOnce("WriteOffsPage-reverse", reverse)}
        >
          Reverse
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function WriteOffsPage() {
  const queryClient = useQueryClient();
  const canWrite = usePermission("journal_entries", "create");
  const { filteredBranches } = useReferenceData();

  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<WriteOff | null>(null);
  const [creating, setCreating] = useState(false);
  const [reversing, setReversing] = useState(false);

  // create form
  const [doc, setDoc] = useState<OutstandingDocumentItem | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("small_balance");
  const [notes, setNotes] = useState("");

  const { data: rows, isLoading, refetch } = useQuery({ queryKey: ["write-offs"], queryFn: () => writeOffsApi.getAll() });
  const { data: setup } = useQuery({ queryKey: ["write-off-setup"], queryFn: writeOffsApi.setup, enabled: creating });
  const { data: outstanding, isLoading: loadingOutstanding } = useQuery({
    queryKey: ["outstanding-documents-for-write-off"],
    queryFn: () => customersApi.getOutstandingDocuments(),
    enabled: creating,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter(
      (w) =>
        (!branch || w.branch_code === branch) &&
        (!status || w.status === status) &&
        (!q || [w.write_off_no, w.customer_name, w.invoice_no].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [rows, search, branch, status]);

  const columns: TDataGridColumn<WriteOff>[] = [
    { field: "write_off_no", header: "Write-off No", minWidth: 150, flex: 1 },
    { field: "write_off_date", header: "Date", width: 120, type: "date" },
    { field: "customer_name", header: "Customer", minWidth: 180, flex: 1.4 },
    { field: "invoice_no", header: "Invoice", minWidth: 170, flex: 1 },
    { field: "branch_code", header: "Branch", width: 120 },
    { field: "reason_label", header: "Reason", minWidth: 160, flex: 1 },
    { field: "amount", header: "Amount", width: 130, type: "currency", align: "right", headerAlign: "right" },
    {
      field: "status",
      header: "Status",
      width: 130,
      renderCell: (p) => <TStatusChip status={chipStatus(p.row)} statusMap="financeDocument" />,
    },
  ];

  const resetForm = () => {
    setDoc(null);
    setAmount("");
    setReason("small_balance");
    setNotes("");
  };
  const back = () => {
    setSelected(null);
    setCreating(false);
    resetForm();
  };

  const save = useMutation({
    mutationFn: () =>
      writeOffsApi.create({ invoice_id: doc!.invoice_id, amount: Number(amount), reason, notes: notes || undefined }),
    onSuccess: (wo) => {
      showSuccessToast(`${wo.write_off_no}: ${fmt(wo.amount)} written off ${wo.invoice_no}.`);
      queryClient.invalidateQueries({ queryKey: ["write-offs"] });
      invalidateLedgerQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["outstanding-documents-for-write-off"] });
      resetForm();
      setCreating(false);
      setSelected(wo);
    },
    onError: (err) => handleApiError(err, "Could not write off"),
  });

  const limit = setup?.my_limit;
  const value = Number(amount);
  const open = doc ? Number(doc.balance_due) : 0;
  const overLimit = limit !== null && limit !== undefined && value > Number(limit);
  const valid = !!doc && value > 0 && value <= open && !overLimit;
  const detailMode = creating || !!selected;

  const createForm = (
    <>
      <FormSection title="Invoice" columns={1}>
        <Autocomplete
          options={outstanding?.items ?? []}
          loading={loadingOutstanding}
          value={doc}
          onChange={(_, v) => {
            setDoc(v);
            setAmount(v ? String(Number(v.balance_due)) : "");
          }}
          getOptionLabel={(d) => `${d.invoice_no} · ${d.customer_name} · owes ${fmt(d.balance_due)}`}
          isOptionEqualToValue={(a, b) => a.invoice_id === b.invoice_id}
          renderInput={(params) => (
            <TextField {...params} label="Invoice" placeholder="Search invoice no. or customer" size="small" required />
          )}
        />
      </FormSection>
      {doc && (
        <FormSection title="Invoice Details" columns={4}>
          <TextField label="Customer" size="small" value={doc.customer_name ?? ""} disabled />
          <TextField label="Invoice Date" size="small" value={doc.invoice_date ?? ""} disabled />
          <TextField
            label="Due Date"
            size="small"
            value={`${doc.due_date ?? ""}${doc.is_overdue ? ` (${doc.days_overdue} days overdue)` : ""}`}
            disabled
          />
          <TextField label="Still Open" size="small" value={fmt(doc.balance_due)} disabled />
        </FormSection>
      )}
      <FormSection title="Write-off" columns={2}>
        <TextField
          label="Amount to write off"
          size="small"
          type="number"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={!!doc && (value > open || overLimit)}
          helperText={
            overLimit
              ? `Your limit is ${fmt(limit)}. Ask a finance manager.`
              : doc && value > open
                ? `Only ${fmt(open)} is open.`
                : limit === null
                  ? "You have no write-off limit."
                  : limit !== undefined
                    ? `Your limit: ${fmt(limit)}`
                    : " "
          }
        />
        <TextField select label="Reason" size="small" required value={reason} onChange={(e) => setReason(e.target.value)}>
          {(setup?.reasons ?? []).map((r) => (
            <MenuItem key={r.value} value={r.value}>
              {r.label}
            </MenuItem>
          ))}
        </TextField>
      </FormSection>
      <FormSection title="Remarks" columns={1}>
        <TRemarkField label="Note (optional)" size="small" value={notes} onChange={(v) => setNotes(v)} multiline rows={2} />
      </FormSection>
      <Alert severity="info" variant="outlined">
        The customer will no longer owe this amount. It is booked as a cost (Bad debts &amp; write-offs). You can reverse
        it later if the customer pays after all.
      </Alert>
    </>
  );

  const viewDetail = selected && (
    <>
      <FormSection title="Write-off Information" columns={3}>
        <TextField label="Write-off No" size="small" value={selected.write_off_no} disabled />
        <TextField label="Date" size="small" value={selected.write_off_date} disabled />
        <TextField label="Branch" size="small" value={selected.branch_code ?? ""} disabled />
        <TextField label="Customer" size="small" value={selected.customer_name ?? ""} disabled />
        <TextField label="Invoice" size="small" value={selected.invoice_no ?? ""} disabled />
        <TextField label="Amount" size="small" value={fmt(selected.amount)} disabled />
      </FormSection>
      <FormSection title="Reason" columns={1}>
        <TextField label="Reason" size="small" value={selected.reason_label} disabled />
        <TRemarkField label="Note" size="small" value={selected.notes ?? ""} onChange={() => undefined} disabled multiline rows={2} />
      </FormSection>
      {selected.status === "reversed" && (
        <Alert severity="info" variant="outlined">
          This write-off was reversed: the customer owes the amount on {selected.invoice_no} again.
        </Alert>
      )}
    </>
  );

  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[...BREADCRUMBS, { label: creating ? "New Write-off" : selected?.write_off_no ?? "" }]}
        title={selected?.write_off_no ?? ""}
        titleIcon={<MoneyOffIcon color="primary" />}
        isCreating={creating}
        createTitle="New Write-off"
        noSelectionTitle="Select a write-off"
        chips={selected && !creating ? [getStatusProps(chipStatus(selected), "financeDocument")] : []}
      />
      <ActionToolbar
        hasSelectedItem={!!selected}
        isCreating={creating}
        isEditing={false}
        isSaving={save.isPending}
        isFormValid={valid}
        onSave={creating ? () => submitOnce("WriteOffsPage-save", save) : undefined}
        onCancel={creating ? back : undefined}
        endActions={
          canWrite && selected && !creating && selected.status === "posted" ? (
            <Button size="small" variant="outlined" startIcon={<UndoIcon />} onClick={() => setReversing(true)}>
              Reverse
            </Button>
          ) : undefined
        }
      />
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>{creating ? createForm : viewDetail}</Box>
    </Box>
  );

  const listPanel = (
    <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
      <TDataGrid<WriteOff>
        rows={filtered}
        columns={columns}
        loading={isLoading}
        onRowClick={(row) => setSelected(row)}
        pageSizeOptions={[10, 25, 50, 100]}
        pageSize={25}
        emptyMessage="Nothing written off yet"
        autoHeight={false}
        height="100%"
      />
    </Box>
  );

  return (
    <>
      <MasterDetailLayout
        title="Customer Write-offs"
        titleSlot={
          detailMode ? (
            <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={back} sx={{ textTransform: "none" }}>
              Back to Write-offs
            </Button>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <TextField
                size="small"
                placeholder="Search write-offs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 190, flexShrink: 0 }}
              />
              <Box sx={{ width: 150, flexShrink: 0 }}>
                <TBranchFilter branches={filteredBranches} value={branch} onChange={setBranch} label="" size="small" />
              </Box>
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
              {(search || branch || status) && (
                <Button
                  size="small"
                  onClick={() => {
                    setSearch("");
                    setBranch(null);
                    setStatus(null);
                  }}
                  sx={{ textTransform: "none" }}
                >
                  Clear
                </Button>
              )}
            </Box>
          )
        }
        headerActions={
          !detailMode && canWrite ? (
            <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setCreating(true)} sx={{ mr: 1 }}>
              Write off a Balance
            </Button>
          ) : undefined
        }
        onRefresh={() => refetch()}
        isLoading={isLoading}
      >
        {detailMode ? detailPanel : listPanel}
      </MasterDetailLayout>
      {reversing && selected && (
        <ReverseDialog
          wo={selected}
          onClose={() => setReversing(false)}
          onDone={() => {
            setReversing(false);
            setSelected({ ...selected, status: "reversed" });
          }}
        />
      )}
    </>
  );
}
