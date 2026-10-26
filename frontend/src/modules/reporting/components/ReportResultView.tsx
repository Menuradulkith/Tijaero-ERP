import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Checkbox,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from "@mui/material";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import type { ReportRunResult, ReportTable, ReportView } from "../center-api";
import { formatValue, NUMERIC_COLUMN_TYPES as NUMERIC } from "../format";

interface Props {
  result: ReportRunResult;
  view: ReportView;
  onViewChange: (view: ReportView) => void;
}

/** Headline metrics and the report's tables, with per-table sort and column choice. */
export default function ReportResultView({ result, view, onViewChange }: Props) {
  const setTableView = (key: string, patch: { hidden?: string[]; sort?: { key: string; dir: "asc" | "desc" } | null }) =>
    onViewChange({ ...view, tables: { ...(view.tables ?? {}), [key]: { ...(view.tables?.[key] ?? {}), ...patch } } });

  return (
    <Stack spacing={2}>
      {result.metrics.length > 0 && (
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
          {result.metrics.map((m) => (
            <Paper key={m.label} variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4 }}>
                {m.label}
              </Typography>
              <Typography variant="h6" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {formatValue(m.value, m.type)}
              </Typography>
            </Paper>
          ))}
        </Box>
      )}
      {result.notes.map((n) => (
        <Alert key={n} severity="info">
          {n}
        </Alert>
      ))}
      {result.tables.map((t) => (
        <ResultTable
          key={t.key}
          table={t}
          hidden={view.tables?.[t.key]?.hidden ?? []}
          sort={view.tables?.[t.key]?.sort ?? null}
          onHiddenChange={(hidden) => setTableView(t.key, { hidden })}
          onSortChange={(sort) => setTableView(t.key, { sort })}
        />
      ))}
    </Stack>
  );
}

function ResultTable({
  table,
  hidden,
  sort,
  onHiddenChange,
  onSortChange,
}: {
  table: ReportTable;
  hidden: string[];
  sort: { key: string; dir: "asc" | "desc" } | null;
  onHiddenChange: (hidden: string[]) => void;
  onSortChange: (sort: { key: string; dir: "asc" | "desc" } | null) => void;
}) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const columns = table.columns.filter((c) => !hidden.includes(c.key));

  const rows = useMemo(() => {
    if (!sort) return table.rows;
    const col = table.columns.find((c) => c.key === sort.key);
    if (!col) return table.rows;
    const numeric = NUMERIC.includes(col.type);
    const sign = sort.dir === "desc" ? -1 : 1;
    return [...table.rows].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return sign * (numeric ? Number(x) - Number(y) : String(x).localeCompare(String(y)));
    });
  }, [table, sort]);

  const toggleSort = (key: string) => {
    if (sort?.key !== key) onSortChange({ key, dir: "asc" });
    else if (sort.dir === "asc") onSortChange({ key, dir: "desc" });
    else onSortChange(null);
  };

  return (
    <Paper variant="outlined">
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1 }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
          {table.title}
          <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
            {table.rows.length.toLocaleString()} {table.rows.length === 1 ? "row" : "rows"}
          </Typography>
        </Typography>
        {table.columns.length > 1 && (
          <Tooltip title="Columns">
            <IconButton size="small" onClick={(e) => setMenuAnchor(e.currentTarget)} aria-label={`Choose columns for ${table.title}`}>
              <ViewColumnIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
          {table.columns.map((c) => {
            const shown = !hidden.includes(c.key);
            return (
              <MenuItem
                key={c.key}
                dense
                disabled={shown && columns.length === 1}
                onClick={() => onHiddenChange(shown ? [...hidden, c.key] : hidden.filter((h) => h !== c.key))}
              >
                <Checkbox size="small" checked={shown} sx={{ p: 0.5, mr: 1 }} />
                <ListItemText primary={c.label} />
              </MenuItem>
            );
          })}
        </Menu>
      </Stack>
      {table.rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>
          No data for these filters.
        </Typography>
      ) : (
        <>
          <TableContainer sx={{ maxHeight: 560 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {columns.map((c) => (
                    <TableCell key={c.key} align={NUMERIC.includes(c.type) ? "right" : "left"} sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                      <TableSortLabel
                        active={sort?.key === c.key}
                        direction={sort?.key === c.key ? sort.dir : "asc"}
                        onClick={() => toggleSort(c.key)}
                      >
                        {c.label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((r, i) => (
                  <TableRow key={i} hover>
                    {columns.map((c) => (
                      <TableCell
                        key={c.key}
                        align={NUMERIC.includes(c.type) ? "right" : "left"}
                        sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: c.type === "text" ? "normal" : "nowrap" }}
                      >
                        {formatValue(r[c.key], c.type)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
              {table.totals && (
                <TableFooter>
                  <TableRow>
                    {columns.map((c, i) => (
                      <TableCell
                        key={c.key}
                        align={NUMERIC.includes(c.type) ? "right" : "left"}
                        sx={{ fontWeight: 700, color: "text.primary", fontSize: "0.875rem", fontVariantNumeric: "tabular-nums" }}
                      >
                        {i === 0 && !(c.key in table.totals!) ? "Total" : c.key in table.totals! ? formatValue(table.totals![c.key], c.type) : ""}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </TableContainer>
          {table.rows.length > 25 && (
            <TablePagination
              component="div"
              count={rows.length}
              page={page}
              rowsPerPage={rowsPerPage}
              rowsPerPageOptions={[25, 50, 100, 500]}
              onPageChange={(_, p) => setPage(p)}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(Number(e.target.value));
                setPage(0);
              }}
            />
          )}
        </>
      )}
    </Paper>
  );
}
