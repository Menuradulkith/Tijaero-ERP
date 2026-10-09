/**
 * Contact persons of a business customer (buyer, accountant, ...).
 *
 * Two modes, like the Suppliers page:
 *  - existing customer (`customerId` set): each add/edit/delete saves
 *    immediately through the API;
 *  - new customer (no `customerId`): rows are kept as drafts in the parent
 *    (`drafts` / `onDraftsChange`) and saved together with the customer.
 */

import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  FormSection,
  isValidPhone,
  normalizePhone,
  showErrorToast,
  TPhoneField,
  showSuccessToast,
  TChip,
  TITLE_CHOICES,
} from "@/components/tijaero";
import { customersApi } from "@/modules/customers/api";
import type {
  CustomerContactPerson,
  CustomerContactPersonCreate,
} from "@/modules/customers/types";

const EMPTY_FORM: CustomerContactPersonCreate = {
  title: "",
  full_name: "",
  designation: "",
  email: "",
  phone: "",
  is_primary: false,
};

const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

const errorDetail = (err: unknown, fallback: string): string => {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
};

interface Props {
  /** Set for an existing customer; omit while creating a new one. */
  customerId?: number;
  canEdit: boolean;
  /** Draft rows for a customer that has not been saved yet. */
  drafts?: CustomerContactPersonCreate[];
  onDraftsChange?: (drafts: CustomerContactPersonCreate[]) => void;
}

// A row in the table: a saved contact, or a draft identified by its index.
type Row = CustomerContactPersonCreate & { key: string; saved?: CustomerContactPerson };

export default function CustomerContactPersons({
  customerId,
  canEdit,
  drafts = [],
  onDraftsChange,
}: Props) {
  const queryClient = useQueryClient();
  const queryKey = ["customer-contact-persons", customerId];
  const isDraftMode = customerId === undefined;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [form, setForm] = useState<CustomerContactPersonCreate>(EMPTY_FORM);

  const { data: contacts = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => customersApi.getContactPersons(customerId as number),
    enabled: !isDraftMode,
  });

  const rows: Row[] = isDraftMode
    ? drafts.map((d, i) => ({ ...d, key: `draft-${i}` }))
    : contacts.map((c) => ({ ...c, key: `saved-${c.id}`, saved: c }));

  const closeDialog = () => setDialogOpen(false);

  const saveMutation = useMutation({
    mutationFn: (data: CustomerContactPersonCreate) =>
      editingRow?.saved
        ? customersApi.updateContactPerson(customerId as number, editingRow.saved.id, data)
        : customersApi.createContactPerson(customerId as number, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      showSuccessToast(editingRow ? "Contact person updated" : "Contact person added");
      closeDialog();
    },
    onError: (err) => showErrorToast(errorDetail(err, "Failed to save contact person")),
  });

  const deleteMutation = useMutation({
    mutationFn: (contactId: number) =>
      customersApi.deleteContactPerson(customerId as number, contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      showSuccessToast("Contact person removed");
    },
    onError: (err) => showErrorToast(errorDetail(err, "Failed to remove contact person")),
  });

  const openAdd = () => {
    setEditingRow(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (row: Row) => {
    setEditingRow(row);
    setForm({
      title: row.title || "",
      full_name: row.full_name,
      designation: row.designation || "",
      email: row.email || "",
      phone: normalizePhone(row.phone),
      is_primary: !!row.is_primary,
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!isDraftMode) {
      saveMutation.mutate(form);
      return;
    }
    // Drafts: keep exactly one primary, and make the first row primary.
    const index = editingRow ? rows.findIndex((r) => r.key === editingRow.key) : -1;
    let next = drafts.map((d) => ({ ...d }));
    if (index >= 0) next[index] = form;
    else next.push(form);
    const primaryIdx = form.is_primary
      ? (index >= 0 ? index : next.length - 1)
      : next.findIndex((d) => d.is_primary);
    next = next.map((d, i) => ({ ...d, is_primary: i === (primaryIdx >= 0 ? primaryIdx : 0) }));
    onDraftsChange?.(next);
    closeDialog();
  };

  const handleDelete = (row: Row) => {
    if (!window.confirm(`Remove ${row.full_name} from this customer's contact persons?`)) return;
    if (row.saved) {
      deleteMutation.mutate(row.saved.id);
      return;
    }
    const next = drafts.filter((_, i) => `draft-${i}` !== row.key);
    if (next.length && !next.some((d) => d.is_primary)) next[0] = { ...next[0], is_primary: true };
    onDraftsChange?.(next);
  };

  const emailInvalid = !!form.email && !EMAIL_PATTERN.test(form.email);
  const canSave =
    form.full_name.trim().length > 0 &&
    !!form.title &&
    !!form.phone?.trim() &&
    !emailInvalid &&
    isValidPhone(form.phone) &&
    !saveMutation.isPending;

  return (
    <FormSection title="Contact Persons" columns={1}>
      {isDraftMode && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          Contact persons added here will be saved together with the customer.
        </Alert>
      )}
      {canEdit && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1.5 }}>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={openAdd}>
            Add Contact Person
          </Button>
        </Box>
      )}

      {!isDraftMode && isLoading ? (
        <Typography variant="body2" color="text.secondary">
          Loading…
        </Typography>
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No contact persons added yet.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Designation</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Phone</TableCell>
              {canEdit && <TableCell align="right" />}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key} hover>
                <TableCell>
                  {[r.title, r.full_name].filter(Boolean).join(" ")}{" "}
                  {r.is_primary && <TChip label="Primary" size="small" color="primary" />}
                </TableCell>
                <TableCell>{r.designation || "—"}</TableCell>
                <TableCell>{r.email || "—"}</TableCell>
                <TableCell>{r.phone || "—"}</TableCell>
                {canEdit && (
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openEdit(r)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Remove">
                      <IconButton size="small" onClick={() => handleDelete(r)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRow ? "Edit Contact Person" : "Add Contact Person"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 2, mt: 1 }}>
            <TextField
              label="Title"
              size="small"
              select
              required
              value={form.title ?? ""}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            >
              <MenuItem value="">—</MenuItem>
              {TITLE_CHOICES.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Full Name"
              size="small"
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
            <TextField
              label="Designation"
              size="small"
              value={form.designation ?? ""}
              onChange={(e) => setForm({ ...form, designation: e.target.value })}
              sx={{ gridColumn: "1 / -1" }}
            />
            <TextField
              label="Email"
              size="small"
              type="email"
              value={form.email ?? ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              error={emailInvalid}
              helperText={emailInvalid ? "Invalid email address" : undefined}
            />
            <TPhoneField
              label="Contact No"
              required
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
            />
            <FormControlLabel
              sx={{ gridColumn: "1 / -1" }}
              control={
                <Switch
                  checked={!!form.is_primary}
                  onChange={(e) => setForm({ ...form, is_primary: e.target.checked })}
                />
              }
              label="Primary contact"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" disabled={!canSave} onClick={handleSave}>
            {editingRow ? "Update" : "Add"}
          </Button>
        </DialogActions>
      </Dialog>
    </FormSection>
  );
}
