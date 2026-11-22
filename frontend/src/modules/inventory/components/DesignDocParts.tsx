/** UI pieces shared by the Design Brief and Design Detail tabs. */
import type { ReactNode } from "react";
import { useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CancelIcon from "@mui/icons-material/Cancel";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import RejectIcon from "@mui/icons-material/ThumbDown";
import HistoryIcon from "@mui/icons-material/History";
import { TActivityHistoryPanel } from "@/components/tijaero/panels/TActivityHistoryPanel";
import { formatDateTimeReadable } from "@/utils/formatters";
import type { DesignBriefItemOption, DesignBriefStatus } from "../types";
import type { CategoryOption, ItemLine } from "./designDocUtils";

/** Category dropdown + Item search (only the chosen category's items). Fixed = shown read-only. */
export function CategoryItemFields({
  line,
  categories,
  itemOptions,
  optionsLoading,
  fixed,
  fixedNote,
  showErrors,
  onCategory,
  onItem,
}: {
  line: ItemLine;
  categories: CategoryOption[];
  itemOptions: DesignBriefItemOption[];
  optionsLoading: boolean;
  fixed?: boolean;
  /** Extra helper text for the fixed Item field, e.g. why it can't be changed. */
  fixedNote?: string;
  showErrors: boolean;
  onCategory: (id: number) => void;
  onItem: (o: DesignBriefItemOption | null) => void;
}) {
  if (fixed) {
    return (
      <>
        <TextField label="Category" size="small" fullWidth value={line.category_name} disabled helperText=" " />
        <TextField
          label="Item"
          size="small"
          fullWidth
          value={line.item_name}
          disabled
          helperText={`Item Code: ${line.item_code}${fixedNote ? ` · ${fixedNote}` : ""}`}
        />
      </>
    );
  }
  const catErr = showErrors && line.category_id == null ? "Select a category" : null;
  const itemErr = showErrors && line.material_id == null ? "Select an item" : null;
  return (
    <>
      <TextField
        select
        label="Category"
        required
        size="small"
        fullWidth
        value={line.category_id ?? ""}
        onChange={(e) => onCategory(Number(e.target.value))}
        error={!!catErr}
        helperText={catErr || "e.g. Tag, Sticker, Bag"}
        InputProps={{ endAdornment: optionsLoading ? <CircularProgress size={16} sx={{ mr: 3 }} /> : undefined }}
      >
        {categories.map((c) => (
          <MenuItem key={c.id} value={c.id}>
            {c.name}
          </MenuItem>
        ))}
      </TextField>
      <Autocomplete<DesignBriefItemOption>
        size="small"
        options={itemOptions}
        value={itemOptions.find((o) => o.id === line.material_id) ?? null}
        onChange={(_, o) => onItem(o)}
        disabled={line.category_id == null}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        getOptionLabel={(o) => o.name}
        filterOptions={(opts, { inputValue }) => {
          const q = inputValue.toLowerCase();
          return opts.filter((o) => o.name.toLowerCase().includes(q) || o.item_code.toLowerCase().includes(q));
        }}
        noOptionsText={optionsLoading ? "Loading..." : "No more items in this category"}
        renderOption={(props, o) => (
          <li {...props} key={o.id}>
            <Box sx={{ display: "flex", flexDirection: "column" }}>
              <Typography variant="body2">
                <b>{o.item_code}</b> — {o.name}
              </Typography>
              {(o.unit_dimensions || o.colour || o.design_required) && (
                <Typography variant="caption" color="text.secondary">
                  {[o.unit_dimensions, o.colour, o.design_required ? "Design required" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography>
              )}
            </Box>
          </li>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Item"
            required
            placeholder={line.category_id == null ? "Select a category first" : "Search by name or code"}
            error={!!itemErr}
            helperText={itemErr || (line.item_code ? `Item Code: ${line.item_code}` : " ")}
          />
        )}
      />
    </>
  );
}

interface DocLike {
  status: DesignBriefStatus;
  confirmed_by_name?: string | null;
  confirmed_at?: string | null;
  rejected_by_name?: string | null;
  rejected_at?: string | null;
  reject_reason?: string | null;
  created_by_name?: string | null;
  created_at?: string | null;
  updated_by_name?: string | null;
  updated_at?: string | null;
}

const when = (at?: string | null) => (at ? ` on ${formatDateTimeReadable(at)}` : "");

/** Confirmed (locked) / rejected / last-rejected notice. */
export function DocStatusAlerts({
  doc,
  noun,
  canEdit,
  editing,
}: {
  doc: DocLike | null | undefined;
  noun: string;
  canEdit: boolean;
  editing: boolean;
}) {
  if (!doc) return null;
  if (doc.status === "confirmed") {
    return (
      <Alert severity="success" icon={<LockOutlinedIcon />}>
        Confirmed by <b>{doc.confirmed_by_name || "-"}</b>
        {when(doc.confirmed_at)}. This {noun} is locked and can no longer be changed.
      </Alert>
    );
  }
  if (doc.status === "rejected") {
    return (
      <Alert severity="error">
        Rejected by <b>{doc.rejected_by_name || "-"}</b>
        {when(doc.rejected_at)}: {doc.reject_reason}
        {canEdit && !editing && ` — edit and save the ${noun} to send it back to Draft.`}
      </Alert>
    );
  }
  if (doc.reject_reason && !editing) {
    return (
      <Alert severity="info">
        Last rejected by {doc.rejected_by_name || "-"}
        {when(doc.rejected_at)}: {doc.reject_reason}
      </Alert>
    );
  }
  return null;
}

export function AuditCaption({
  doc,
  history,
}: {
  doc: DocLike;
  /** Adds a "History" link opening the document's activity history. */
  history?: { entityType: string; entityId: number };
}) {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
      <Typography variant="caption" color="text.secondary">
        Created by {doc.created_by_name || "-"}
        {when(doc.created_at)} · Last updated by {doc.updated_by_name || "-"}
        {when(doc.updated_at)}
      </Typography>
      {history && (
        <>
          <Button
            size="small"
            startIcon={<HistoryIcon fontSize="small" />}
            onClick={() => setOpen(true)}
            sx={{ py: 0, minHeight: 0, textTransform: "none" }}
          >
            History
          </Button>
          <TActivityHistoryPanel
            open={open}
            onClose={() => setOpen(false)}
            entityType={history.entityType}
            entityId={history.entityId}
          />
        </>
      )}
    </Box>
  );
}

/** Card holding the lines table: title + count on the left, "Add Item" on the right while editing. */
export function LinesCard({
  title,
  icon,
  count,
  editing,
  onAdd,
  disabled,
  hint,
  children,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  editing: boolean;
  onAdd: () => void;
  disabled?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Box
        sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", gap: 1, borderBottom: 1, borderColor: "divider" }}
      >
        {icon}
        <Typography variant="subtitle1" fontWeight={600}>
          {title}
        </Typography>
        <Chip size="small" label={count} />
        {hint && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1, display: { xs: "none", md: "block" } }}>
            {hint}
          </Typography>
        )}
        {editing && (
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onAdd}
            disabled={disabled}
            sx={{ ml: "auto" }}
          >
            Add Item
          </Button>
        )}
      </Box>
      {children}
    </Paper>
  );
}

/**
 * One line as its own card: number + item code in the header (Remove while editing), the line's
 * fields below — the same fields in view mode (read-only) and edit mode.
 */
export function LineCard({
  index,
  line,
  editing,
  onRemove,
  children,
}: {
  index: number;
  line: ItemLine;
  editing: boolean;
  onRemove?: () => void;
  children: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
        <Box
          sx={{
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: "50%",
            bgcolor: "primary.main",
            color: "primary.contrastText",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {index + 1}
        </Box>
        {line.material_id != null ? (
          <Typography variant="body2" fontWeight={600}>
            {line.item_code}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            New item — pick a category and item
          </Typography>
        )}
        <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1 }}>
          {editing && onRemove && (
            <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={onRemove}>
              Remove
            </Button>
          )}
        </Box>
      </Box>
      {children}
    </Paper>
  );
}

/** The brief text a line came from, shown read-only. */
export function BriefBox({ text }: { text: string }) {
  return (
    <Box
      sx={{
        mb: 2,
        px: 1.5,
        py: 1,
        bgcolor: "action.hover",
        borderRadius: 1,
        borderLeft: 3,
        borderColor: "primary.light",
      }}
    >
      <Typography variant="caption" color="text.secondary">
        Brief
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {text}
      </Typography>
    </Box>
  );
}

/** "Open" icon inside a (read-only) link field. */
export function OpenLinkAdornment({ url, title }: { url: string; title: string }) {
  if (!url) return null;
  return (
    <InputAdornment position="end">
      <Tooltip title={title}>
        <IconButton size="small" component="a" href={url} target="_blank" rel="noopener noreferrer" aria-label={title}>
          <OpenInNewIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </InputAdornment>
  );
}

/** Centered empty state inside a LinesCard. */
export function EmptyLines({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <Box sx={{ py: 5, px: 2, textAlign: "center", color: "text.secondary" }}>
      <Box sx={{ "& svg": { fontSize: 40, color: "text.disabled" } }}>{icon}</Box>
      <Typography variant="subtitle1" color="text.primary" sx={{ mt: 1 }}>
        {title}
      </Typography>
      <Typography variant="body2">{text}</Typography>
    </Box>
  );
}

/** Same reject dialog as the Quotations page: reason required. */
export function RejectReasonDialog({
  open,
  title,
  reason,
  onReasonChange,
  onClose,
  onSubmit,
  pending,
  placeholder,
}: {
  open: boolean;
  title: string;
  reason: string;
  onReasonChange: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
  placeholder: string;
}) {
  return (
    <Dialog open={open} onClose={() => !pending && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <RejectIcon color="error" />
          {title}
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          A reason is required. It can then be edited and confirmed again.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          size="small"
          multiline
          rows={3}
          label="Rejection Reason"
          required
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          inputProps={{ maxLength: 1000 }}
          placeholder={placeholder}
        />
      </DialogContent>
      <DialogActions>
        <Button
          aria-label="Cancel"
          title="Cancel"
          sx={{ minWidth: 36, px: 1 }}
          variant="contained"
          color="error"
          onClick={onClose}
          disabled={pending}
        >
          <CancelIcon fontSize="small" />
        </Button>
        <Button variant="contained" color="error" onClick={onSubmit} disabled={!reason.trim() || pending}>
          {pending ? "Rejecting..." : "Reject"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
