/**
 * QuickCreateLookupDialog - create a category, brand, product type or HS code without
 * leaving the item form. Used by the "Add ..." buttons on the Products page and the
 * Materials Item Catalog page. The caller passes the create call and gets the new
 * record back to select it. Asks for a name (for an HS code: the code) and a description.
 */
import { useEffect, useState } from "react";
import { TextField } from "@mui/material";
import { TFormDialog, handleApiError, showSuccessToast } from "@/components/tijaero";

export type LookupKind = "category" | "brand" | "product_type" | "hs_code";

const KIND_TEXT: Record<LookupKind, { label: string; field: string; help: string; maxLength: number }> = {
  category: { label: "Category", field: "Category Name", help: "The code is generated automatically", maxLength: 255 },
  brand: { label: "Brand", field: "Brand Name", help: "The code is generated automatically", maxLength: 255 },
  product_type: { label: "Product Type", field: "Product Type Name", help: "e.g. Laptop, Accessory", maxLength: 120 },
  hs_code: { label: "HS Code", field: "HS Code", help: "4-12 digits, dots allowed (e.g. 8471.30.10)", maxLength: 20 },
};

interface QuickCreateLookupDialogProps<T> {
  open: boolean;
  kind: LookupKind;
  onClose: () => void;
  /** Saves { name, description } and resolves to the created record. */
  create: (data: { name: string; description?: string }) => Promise<T>;
  /** Called with the created record (the caller selects it in the form). */
  onCreated: (record: T) => void;
}

export default function QuickCreateLookupDialog<T>({
  open,
  kind,
  onClose,
  create,
  onCreated,
}: QuickCreateLookupDialogProps<T>) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const text = KIND_TEXT[kind];
  const label = text.label;

  // Start empty each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError("");
    }
  }, [open]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const record = await create({ name: name.trim(), description: description.trim() || undefined });
      showSuccessToast(`${label} "${name.trim()}" created`);
      onCreated(record);
      onClose();
    } catch (err: unknown) {
      setError(handleApiError(err, `Failed to create ${label.toLowerCase()}`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <TFormDialog
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={`New ${label}`}
      onSubmit={handleSubmit}
      isSubmitting={saving}
      submitDisabled={!name.trim()}
      submitText="Create"
      maxWidth="xs"
      fullWidth
      columns={1}
    >
      <TextField
        autoFocus
        required
        size="small"
        label={text.field}
        value={name}
        onChange={(e) => setName(e.target.value)}
        inputProps={{ maxLength: text.maxLength }}
        error={!!error}
        helperText={error || text.help}
      />
      <TextField
        size="small"
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        multiline
        minRows={2}
        inputProps={{ maxLength: 1000 }}
      />
    </TFormDialog>
  );
}
