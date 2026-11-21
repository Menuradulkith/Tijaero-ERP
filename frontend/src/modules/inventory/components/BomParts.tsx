/** UI pieces for the product BOM Structure tab. */
import { Fragment, useState, type ReactNode } from "react";
import { Box, Button, Chip, Collapse, IconButton, Paper, Tooltip, Typography } from "@mui/material";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { BomStep, BomSubStructure } from "../types";

const STATUS_LABEL = { draft: "Draft", confirmed: "Confirmed", rejected: "Rejected" } as const;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));

/** Overview: the steps as a flow (1 Cutting → 2 Sewing → 3 Packing) plus totals. */
export function ProcessFlow({ steps }: { steps: { name: string; minutes: number | null; materialCount: number }[] }) {
  const totalMinutes = steps.reduce((s, st) => s + (st.minutes ?? 0), 0);
  const anyMinutes = steps.some((st) => st.minutes != null);
  const materials = steps.reduce((s, st) => s + st.materialCount, 0);
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
        <AccountTreeOutlinedIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600}>
          Process Flow
        </Typography>
        <Box sx={{ ml: "auto", display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Chip size="small" label={`${steps.length} step${steps.length === 1 ? "" : "s"}`} />
          <Chip size="small" label={`${materials} material line${materials === 1 ? "" : "s"}`} />
          {anyMinutes && <Chip size="small" label={`${fmt(totalMinutes)} min per unit`} />}
        </Box>
      </Box>
      {steps.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No steps yet.
        </Typography>
      ) : (
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
          {steps.map((st, i) => (
            <Fragment key={i}>
              {i > 0 && <ChevronRightIcon fontSize="small" sx={{ color: "text.disabled", mx: 0.25 }} />}
              <Chip
                variant="outlined"
                color="primary"
                avatar={
                  <Box
                    component="span"
                    sx={{
                      bgcolor: "primary.main",
                      color: "primary.contrastText !important",
                      borderRadius: "50%",
                      fontSize: "11px !important",
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {i + 1}
                  </Box>
                }
                label={st.name || "Unnamed step"}
              />
            </Fragment>
          ))}
        </Box>
      )}
    </Paper>
  );
}

/** One step as its own card: number + name in the header, move / remove while editing. */
export function StepCard({
  index,
  count,
  name,
  editing,
  onMoveUp,
  onMoveDown,
  onRemove,
  children,
}: {
  index: number;
  count: number;
  name: string;
  editing: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
        <Box
          sx={{
            width: 30,
            height: 30,
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
        <Typography variant="subtitle1" fontWeight={600} sx={{ minWidth: 0 }} noWrap>
          {name.trim() || `Step ${index + 1}`}
        </Typography>
        {editing && (
          <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.5 }}>
            <Tooltip title="Move up">
              <span>
                <IconButton
                  size="small"
                  onClick={onMoveUp}
                  disabled={index === 0}
                  aria-label={`Move step ${index + 1} up`}
                >
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Move down">
              <span>
                <IconButton
                  size="small"
                  onClick={onMoveDown}
                  disabled={index === count - 1}
                  aria-label={`Move step ${index + 1} down`}
                >
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={onRemove}>
              Remove Step
            </Button>
          </Box>
        )}
      </Box>
      {children}
    </Paper>
  );
}

/** Read-only steps / materials of a sub-assembly, nested (multi-level). */
function SubSteps({ steps, depth }: { steps: BomStep[]; depth: number }) {
  if (!steps.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        No steps.
      </Typography>
    );
  }
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {steps.map((st, i) => (
        <Box key={st.id}>
          <Typography variant="body2" fontWeight={600}>
            {i + 1}. {st.name}
            {st.work_area ? ` · ${st.work_area}` : ""}
            {st.minutes_per_unit != null ? ` · ${fmt(st.minutes_per_unit)} min/unit` : ""}
          </Typography>
          {st.materials.map((m) => (
            <Box key={m.id} sx={{ pl: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {m.item_code} — {m.item_name} × {fmt(m.quantity)} {m.unit_of_measure || ""}
                {m.scrap_pct ? ` (+${fmt(m.scrap_pct)}% scrap)` : ""}
              </Typography>
              {m.sub_structure && <SubAssembly sub={m.sub_structure} depth={depth + 1} />}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

/** "Sub-assembly" toggle under a material that is another product with its own BOM Structure. */
export function SubAssembly({ sub, depth = 1 }: { sub: BomSubStructure; depth?: number }) {
  const [open, setOpen] = useState(false);
  const n = sub.steps.length;
  return (
    <Box sx={{ mt: 0.5 }}>
      <Button
        size="small"
        onClick={() => setOpen((o) => !o)}
        startIcon={<AccountTreeOutlinedIcon fontSize="small" />}
        endIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        sx={{ textTransform: "none" }}
      >
        Sub-assembly: {sub.product_code} — {sub.product_name} ({n} step{n === 1 ? "" : "s"}, {STATUS_LABEL[sub.status]})
      </Button>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ ml: 1.5, pl: 1.5, py: 1, borderLeft: 2, borderColor: "primary.light" }}>
          <SubSteps steps={sub.steps} depth={depth} />
        </Box>
      </Collapse>
    </Box>
  );
}
