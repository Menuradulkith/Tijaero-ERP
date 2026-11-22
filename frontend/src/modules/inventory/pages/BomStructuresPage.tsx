/**
 * BomStructuresPage - every product's BOM Structure in one place (Product Catalogs › BOM).
 *
 * List: server-paged table, newest change first, with search (product code / name), a status filter
 * that shows the count per status, sortable columns and CSV export of all matching rows.
 * Detail (/product-catalogs/boms/:productId): the same BOM Structure editor as the product page's
 * tab (Edit / Save / Cancel, Confirm / Reject), a Routing view (each step as an operation at a work
 * center: times, lead time and cost per unit for a batch quantity), plus a Material Summary that totals each item over
 * all steps (with scrap), like a summarized BOM. BOMs are created only on the product page's
 * BOM Structure tab; a product without one shows a link there instead of an editor.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { GridPaginationModel, GridRenderCellParams } from "@mui/x-data-grid";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePermission } from "@/auth/permissions";
import {
  ActionToolbar,
  DetailPanelHeader,
  MasterDetailLayout,
  TDataGrid,
  type TDataGridColumn,
  TTabs,
  fmtLKR,
} from "@/components/tijaero";
import { useCurrencyStore } from "@/state/currencyStore";
import { fetchAllPages } from "@/utils/fetchAllPages";
import { formatDateTimeReadable } from "@/utils/formatters";
import { bomStructureApi, productsApi } from "../api";
import { useProductBomStructure } from "../components/ProductBomStructure";
import type { BomStructure, BomStructureListRow, DesignBriefStatus } from "../types";

const LIST_KEY = "product-bom-structures";
const BASE = "/product-catalogs/boms";

const STATUS: Record<DesignBriefStatus, { label: string; color: "warning" | "success" | "error" }> = {
  draft: { label: "Draft", color: "warning" },
  confirmed: { label: "Confirmed", color: "success" },
  rejected: { label: "Rejected", color: "error" },
};
const FILTERS: { value: DesignBriefStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "rejected", label: "Rejected" },
];

const fmtNum = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
const minutesLabel = (n?: number | null) => (n == null ? "-" : `${fmtNum(n)} min`);

export default function BomStructuresPage() {
  const { productId: idParam } = useParams();
  const productId = idParam && /^\d+$/.test(idParam) ? Number(idParam) : null;
  return productId ? <BomDetail productId={productId} /> : <BomList />;
}

// ─── List ─────────────────────────────────────────────────────────────────────

function BomList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<DesignBriefStatus | null>(null);
  const [paging, setPaging] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [sort, setSort] = useState<{ field: string; sort: "asc" | "desc" } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  // A new search or filter starts again on page 1.
  useEffect(() => setPaging((p) => ({ ...p, page: 0 })), [q, status]);

  const query = { q, status, sort_by: sort?.field, order: sort?.sort };
  const { data, isLoading, isError } = useQuery({
    queryKey: [LIST_KEY, query, paging.page, paging.pageSize],
    queryFn: () => bomStructureApi.getPage({ ...query, page: paging.page, size: paging.pageSize }),
    placeholderData: (prev) => prev,
  });
  const counts = data?.counts;

  const columns: TDataGridColumn<BomStructureListRow>[] = useMemo(
    () => [
      {
        field: "product_code",
        header: "Product Code",
        width: 140,
        renderCell: (p: GridRenderCellParams<BomStructureListRow>) => (
          <Typography variant="body2" fontWeight={600}>
            {p.row.product_code}
          </Typography>
        ),
      },
      {
        field: "product_name",
        header: "Product",
        flex: 1,
        minWidth: 220,
        renderCell: (p: GridRenderCellParams<BomStructureListRow>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {p.row.product_name}
            </Typography>
            {!p.row.product_active && <Chip size="small" label="Inactive" variant="outlined" />}
          </Box>
        ),
      },
      { field: "category_name", header: "Category", width: 160, hideOnMobile: true },
      {
        field: "status",
        header: "Status",
        width: 120,
        align: "center",
        headerAlign: "center",
        renderCell: (p: GridRenderCellParams<BomStructureListRow>) => (
          <Chip size="small" label={STATUS[p.row.status].label} color={STATUS[p.row.status].color} />
        ),
      },
      { field: "step_count", header: "Steps", width: 90, type: "number" },
      { field: "material_count", header: "Materials", width: 105, type: "number" },
      {
        field: "total_minutes",
        header: "Time / Unit",
        width: 115,
        align: "right",
        headerAlign: "right",
        hideOnMobile: true,
        renderCell: (p: GridRenderCellParams<BomStructureListRow>) => minutesLabel(p.row.total_minutes),
      },
      {
        field: "updated_at",
        header: "Last Updated",
        width: 200,
        hideOnMobile: true,
        renderCell: (p: GridRenderCellParams<BomStructureListRow>) => (
          <Box sx={{ lineHeight: 1.3, py: 0.5 }}>
            <Typography variant="body2">{formatDateTimeReadable(p.row.updated_at)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {p.row.updated_by_name || "-"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "confirmed_at",
        header: "Confirmed",
        width: 200,
        hideOnMobile: true,
        renderCell: (p: GridRenderCellParams<BomStructureListRow>) =>
          p.row.confirmed_at ? (
            <Box sx={{ lineHeight: 1.3, py: 0.5 }}>
              <Typography variant="body2">{formatDateTimeReadable(p.row.confirmed_at)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {p.row.confirmed_by_name || "-"}
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              -
            </Typography>
          ),
      },
      {
        field: "open",
        header: "",
        width: 56,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: () => (
          <Tooltip title="Open">
            <OpenInNewIcon fontSize="small" color="action" />
          </Tooltip>
        ),
      },
    ],
    [],
  );

  const exportAll = () =>
    fetchAllPages((page) => bomStructureApi.getPage({ ...query, page, size: 200 })).then((rows) =>
      rows.map((r) => ({
        ...r,
        status: STATUS[r.status].label as DesignBriefStatus,
        category_name: r.category_name || "-",
        total_minutes: r.total_minutes ?? null,
        updated_at: `${formatDateTimeReadable(r.updated_at)} ${r.updated_by_name || ""}`.trim(),
        confirmed_at: r.confirmed_at
          ? `${formatDateTimeReadable(r.confirmed_at)} ${r.confirmed_by_name || ""}`.trim()
          : "",
      })),
    );

  return (
    <>
      <MasterDetailLayout
        title="BOM"
        titleSlot={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search product code or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              inputProps={{ maxLength: 255, "aria-label": "Search BOMs" }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 260, maxWidth: "100%", "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
            />
            <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }} role="group" aria-label="Filter by status">
              {FILTERS.map((f) => {
                const n = counts ? (f.value ? counts[f.value] : counts.all) : undefined;
                const selected = status === f.value;
                return (
                  <Chip
                    key={f.label}
                    label={n == null ? f.label : `${f.label} (${n})`}
                    color={selected ? (f.value ? STATUS[f.value].color : "primary") : "default"}
                    variant={selected ? "filled" : "outlined"}
                    onClick={() => setStatus(f.value)}
                    aria-pressed={selected}
                  />
                );
              })}
            </Box>
            {(search || status) && (
              <Button
                size="small"
                onClick={() => {
                  setSearch("");
                  setStatus(null);
                }}
                sx={{ textTransform: "none" }}
              >
                Clear
              </Button>
            )}
          </Box>
        }
        onRefresh={() => queryClient.invalidateQueries({ queryKey: [LIST_KEY] })}
      >
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
            <TDataGrid<BomStructureListRow>
              rows={data?.items ?? []}
              columns={columns}
              loading={isLoading}
              serverPagination={{
                rowCount: data?.total ?? 0,
                paginationModel: paging,
                onPaginationModelChange: setPaging,
              }}
              onServerSortChange={setSort}
              exportAllRows={exportAll}
              exportFileName="bom-structures"
              onRowClick={(row) => navigate(`${BASE}/${row.product_id}`)}
              pageSizeOptions={[10, 25, 50, 100]}
              pageSize={25}
              emptyMessage={
                isError
                  ? "Could not load the BOMs. Use refresh to try again."
                  : q || status
                    ? "No BOMs match the search or filter"
                    : "No BOMs yet. They are created on a product's BOM Structure tab."
              }
              autoHeight={false}
              height="100%"
            />
          </Box>
        </Box>
      </MasterDetailLayout>
    </>
  );
}

// ─── Detail ───────────────────────────────────────────────────────────────────

type Section = "structure" | "routing" | "summary";

function BomDetail({ productId }: { productId: number }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canUpdate = usePermission("products", "update");
  const [section, setSection] = useState<Section>("structure");

  const {
    data: product,
    isLoading: productLoading,
    isError: productError,
  } = useQuery({
    queryKey: ["product", productId],
    queryFn: () => productsApi.getById(productId),
    retry: false,
  });
  const { data: structure, isLoading: structureLoading } = useQuery({
    queryKey: ["product-bom-structure", productId],
    queryFn: () => bomStructureApi.get(productId),
    enabled: !!product,
  });
  // This page never creates a BOM: only an existing one can be edited here.
  const bom = useProductBomStructure(product ? productId : null, canUpdate && !!structure);
  const noBom = !!product && !structureLoading && structure === null;

  useEffect(() => {
    if (bom.editing) setSection("structure");
  }, [bom.editing]);

  const back = () => navigate(BASE);

  const backButton = (
    <Tooltip title={bom.editing ? "Save or cancel your changes first" : ""}>
      <span>
        <Button
          size="small"
          startIcon={<ArrowBackIcon fontSize="small" />}
          onClick={back}
          disabled={bom.editing}
          sx={{ textTransform: "none" }}
        >
          Back to BOM
        </Button>
      </span>
    </Tooltip>
  );

  if (productLoading) {
    return (
      <MasterDetailLayout title="BOM" titleSlot={backButton}>
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress size={28} />
        </Box>
      </MasterDetailLayout>
    );
  }
  if (productError || !product) {
    return (
      <MasterDetailLayout title="BOM" titleSlot={backButton}>
        <Box sx={{ p: 2 }}>
          <Alert severity="error" action={<Button onClick={back}>Back</Button>}>
            This product could not be found.
          </Alert>
        </Box>
      </MasterDetailLayout>
    );
  }

  const openProduct = (
    <Button
      size="small"
      variant="outlined"
      startIcon={<OpenInNewIcon fontSize="small" />}
      onClick={() => navigate(`/product-catalogs?focus=${productId}&section=bomStructure`)}
      disabled={bom.editing}
    >
      Open Product
    </Button>
  );

  return (
    <MasterDetailLayout
      title="BOM"
      titleSlot={backButton}
      onRefresh={() =>
        bom.editing
          ? undefined
          : Promise.all([
              queryClient.invalidateQueries({ queryKey: ["product-bom-structure", productId] }),
              queryClient.invalidateQueries({ queryKey: ["product", productId] }),
            ])
      }
    >
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <DetailPanelHeader
          icon={<AccountTreeOutlinedIcon color="primary" />}
          breadcrumbs={[
            { label: "Product Catalogs", href: "/product-catalogs" },
            { label: "BOM", href: BASE },
            { label: product.item_code },
          ]}
          title={`${product.item_code} - ${product.name}`}
          chips={[
            ...(bom.statusChip ? [bom.statusChip] : []),
            ...(product.active ? [] : [{ label: "Product inactive", color: "default" as const }]),
          ]}
          tabsSlot={
            <TTabs
              tabs={[
                { id: "structure", label: "Structure" },
                { id: "routing", label: "Routing", disabled: bom.editing || !structure },
                { id: "summary", label: "Material Summary", disabled: bom.editing || !structure },
              ]}
              activeTab={section}
              onChange={(id) => setSection(id as Section)}
              appearance="segmented"
              showDivider={false}
              sx={{ mx: 2, my: 1 }}
            />
          }
        />
        <ActionToolbar
          canCreate={false}
          canUpdate={bom.canEdit}
          isCreating={false}
          isEditing={bom.editing}
          hasSelection
          onEdit={bom.startEdit}
          onSave={bom.save}
          onCancel={bom.cancelEdit}
          isSaving={bom.isSaving}
          startActions={openProduct}
          endActions={bom.decisionActions}
        />
        <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
          {noBom ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
              <AccountTreeOutlinedIcon color="disabled" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="h6" gutterBottom>
                No BOM for this product
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                BOMs are created on the product&apos;s BOM Structure tab.
              </Typography>
              <Button
                variant="contained"
                size="small"
                startIcon={<OpenInNewIcon fontSize="small" />}
                onClick={() => navigate(`/product-catalogs?focus=${productId}&section=bomStructure`)}
              >
                Go to Product
              </Button>
            </Paper>
          ) : section === "routing" && structure ? (
            <RoutingView structure={structure} />
          ) : section === "summary" && structure ? (
            <MaterialSummary structure={structure} />
          ) : (
            bom.panel
          )}
        </Box>
      </Box>
    </MasterDetailLayout>
  );
}

// ─── Material Summary (summarized BOM: each item totalled over all steps) ────

interface SummaryRow {
  material_id: number;
  item_code: string;
  item_name: string;
  category_name: string;
  uom: string;
  quantity: number;
  withScrap: number;
  steps: string[];
  subAssembly: boolean;
}

function MaterialSummary({ structure }: { structure: BomStructure }) {
  const rows = useMemo(() => {
    const map = new Map<number, SummaryRow>();
    structure.steps.forEach((s, i) => {
      for (const m of s.materials) {
        const row =
          map.get(m.material_id) ??
          ({
            material_id: m.material_id,
            item_code: m.item_code,
            item_name: m.item_name,
            category_name: m.category_name || "-",
            uom: m.unit_of_measure || "",
            quantity: 0,
            withScrap: 0,
            steps: [],
            subAssembly: false,
          } satisfies SummaryRow);
        row.quantity += m.quantity;
        row.withScrap += m.quantity * (1 + (m.scrap_pct || 0) / 100);
        row.steps.push(`${i + 1}. ${s.name}`);
        row.subAssembly ||= !!m.sub_structure;
        map.set(m.material_id, row);
      }
    });
    return [...map.values()].sort((a, b) => a.item_code.localeCompare(b.item_code));
  }, [structure]);

  const lines = structure.steps.reduce((n, s) => n + s.materials.length, 0);
  const minutes = structure.steps.reduce((n, s) => n + (s.minutes_per_unit ?? 0), 0);
  const stats = [
    { label: "Steps", value: String(structure.steps.length) },
    { label: "Material lines", value: String(lines) },
    { label: "Distinct items", value: String(rows.length) },
    { label: "Time per unit", value: minutes ? minutesLabel(minutes) : "-" },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
        {stats.map((s) => (
          <Paper key={s.label} variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              {s.label}
            </Typography>
            <Typography variant="h6" fontWeight={600}>
              {s.value}
            </Typography>
          </Paper>
        ))}
      </Box>
      <Paper variant="outlined">
        <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Materials per Product
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Each item totalled over all steps, for one unit of the product. &quot;With scrap&quot; adds the scrap % of
            each line.
          </Typography>
        </Box>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>
            No materials in this BOM structure.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item Code</TableCell>
                  <TableCell>Item</TableCell>
                  <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>Category</TableCell>
                  <TableCell align="right">Qty / Product</TableCell>
                  <TableCell align="right">With Scrap</TableCell>
                  <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>Used In</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.material_id} hover>
                    <TableCell sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>{r.item_code}</TableCell>
                    <TableCell>
                      {r.item_name}
                      {r.subAssembly && (
                        <Chip size="small" label="Sub-assembly" variant="outlined" color="info" sx={{ ml: 1 }} />
                      )}
                    </TableCell>
                    <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>{r.category_name}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      {fmtNum(r.quantity)} {r.uom}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      {fmtNum(r.withScrap)} {r.uom}
                    </TableCell>
                    <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>
                      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                        {r.steps.map((s) => (
                          <Chip key={s} size="small" label={s} />
                        ))}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
}

// ─── Routing (each step is an operation at a work center) ─────────────────────

interface RoutingRow {
  op: number;
  name: string;
  center: BomStructure["steps"][number]["work_center"];
  setup: number;
  run: number;
  workers: number;
  move: number;
  /** Elapsed minutes for the batch: (setup + run × qty ÷ capacity) ÷ efficiency + move. */
  elapsed: number;
  labour: number;
  overhead: number;
  outside: number;
}

const fmtMinutes = (m: number) => {
  if (!m) return "0 min";
  const h = Math.floor(m / 60);
  const rest = Math.round(m - h * 60);
  return h ? `${h} h${rest ? ` ${rest} min` : ""}` : `${fmtNum(Math.round(m * 100) / 100)} min`;
};

// Same formulas as Manufacturing BOMs: work minutes = (setup + run × qty) ÷ efficiency, costed at the
// center's hourly rates (labour × workers); an outside center charges its cost per unit instead.
function routingRows(structure: BomStructure, qty: number): RoutingRow[] {
  return structure.steps.map((s, i) => {
    const wc = s.work_center;
    const setup = s.setup_minutes ?? 0;
    const run = s.minutes_per_unit ?? 0;
    const move = s.move_minutes ?? 0;
    const workers = s.workers ?? 1;
    const eff = (wc?.efficiency_pct || 100) / 100;
    const cap = Math.max(wc?.capacity || 1, 1);
    const work = (setup + run * qty) / eff;
    const outside = wc?.is_outside ? (s.outside_unit_cost ?? 0) * qty : 0;
    return {
      op: (i + 1) * 10,
      name: s.name,
      center: wc ?? null,
      setup,
      run,
      workers,
      move,
      elapsed: (setup + (run * qty) / cap) / eff + move,
      labour: wc && !wc.is_outside ? (work / 60) * wc.labor_rate_per_hour * workers : 0,
      overhead: wc && !wc.is_outside ? (work / 60) * wc.overhead_rate_per_hour : 0,
      outside,
    };
  });
}

function RoutingView({ structure }: { structure: BomStructure }) {
  const currency = useCurrencyStore((s) => s.symbol);
  const [qtyText, setQtyText] = useState("1");
  const qty = Number(qtyText);
  const qtyOk = Number.isInteger(qty) && qty >= 1 && qty <= 1_000_000;
  const rows = useMemo(() => routingRows(structure, qtyOk ? qty : 1), [structure, qty, qtyOk]);
  const q = qtyOk ? qty : 1;

  const sum = (f: (r: RoutingRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const labour = sum((r) => r.labour);
  const overhead = sum((r) => r.overhead);
  const outside = sum((r) => r.outside);
  const lead = sum((r) => r.elapsed);
  // Working days: each operation's elapsed time over its center's working hours per day.
  const days = sum((r) => r.elapsed / (60 * (r.center?.working_hours_per_day || 8)));
  const money = (n: number) => `${currency} ${fmtLKR(n)}`;
  const uncosted = rows.filter((r) => !r.center).length;

  const stats = [
    { label: "Operations", value: String(rows.length) },
    {
      label: `Lead time (${fmtNum(q)} unit${q === 1 ? "" : "s"})`,
      value: fmtMinutes(lead),
      sub: `≈ ${fmtNum(Math.round(days * 100) / 100)} working days`,
    },
    {
      label: "Routing cost / unit",
      value: money((labour + overhead + outside) / q),
      sub: `For the batch: ${money(labour + overhead + outside)}`,
    },
    {
      label: "Labour · Overhead · Outside / unit",
      value: `${fmtLKR(labour / q)} · ${fmtLKR(overhead / q)} · ${fmtLKR(outside / q)}`,
    },
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <TextField
          label="Batch quantity"
          size="small"
          type="number"
          value={qtyText}
          onChange={(e) => setQtyText(e.target.value)}
          inputProps={{ min: 1, step: 1, "aria-label": "Batch quantity" }}
          error={!qtyOk}
          helperText={qtyOk ? "Units made in one run" : "Whole number, 1 or more"}
          sx={{ width: 180 }}
        />
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 240 }}>
          Times and costs use each work center&apos;s current efficiency, capacity and hourly rates (Manufacturing ›
          Work Centers). Setup is once per batch; run time is per unit.
        </Typography>
      </Box>

      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
        {stats.map((s) => (
          <Paper key={s.label} variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              {s.label}
            </Typography>
            <Typography variant="h6" fontWeight={600}>
              {s.value}
            </Typography>
            {s.sub && (
              <Typography variant="caption" color="text.secondary">
                {s.sub}
              </Typography>
            )}
          </Paper>
        ))}
      </Box>

      {uncosted > 0 && (
        <Alert severity="info">
          {uncosted} operation{uncosted === 1 ? " has" : "s have"} no work center, so{" "}
          {uncosted === 1 ? "it is" : "they are"} not costed. Add a work center in the step to include it.
        </Alert>
      )}

      <Paper variant="outlined">
        <TableContainer>
          <Table size="small" aria-label="Routing operations">
            <TableHead>
              <TableRow>
                <TableCell>Op</TableCell>
                <TableCell>Operation</TableCell>
                <TableCell>Work Center</TableCell>
                <TableCell align="right">Setup</TableCell>
                <TableCell align="right">Run / Unit</TableCell>
                <TableCell align="right" sx={{ display: { xs: "none", md: "table-cell" } }}>
                  Workers
                </TableCell>
                <TableCell align="right" sx={{ display: { xs: "none", md: "table-cell" } }}>
                  Move / Wait
                </TableCell>
                <TableCell align="right">Time for Batch</TableCell>
                <TableCell align="right">Cost / Unit</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.op} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{r.op}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>
                    {r.center ? (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                        <span>
                          {r.center.code} — {r.center.name}
                        </span>
                        {r.center.is_outside && <Chip size="small" label="Outside" color="info" variant="outlined" />}
                        {!r.center.active && <Chip size="small" label="Inactive" variant="outlined" />}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{fmtMinutes(r.setup)}</TableCell>
                  <TableCell align="right">{fmtMinutes(r.run)}</TableCell>
                  <TableCell align="right" sx={{ display: { xs: "none", md: "table-cell" } }}>
                    {r.workers}
                  </TableCell>
                  <TableCell align="right" sx={{ display: { xs: "none", md: "table-cell" } }}>
                    {fmtMinutes(r.move)}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    {fmtMinutes(r.elapsed)}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    {r.center ? fmtLKR((r.labour + r.overhead + r.outside) / q) : "-"}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} sx={{ fontWeight: 600 }}>
                  Total
                </TableCell>
                <TableCell align="right">{fmtMinutes(sum((r) => r.setup))}</TableCell>
                <TableCell align="right">{fmtMinutes(sum((r) => r.run))}</TableCell>
                <TableCell sx={{ display: { xs: "none", md: "table-cell" } }} />
                <TableCell align="right" sx={{ display: { xs: "none", md: "table-cell" } }}>
                  {fmtMinutes(sum((r) => r.move))}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  {fmtMinutes(lead)}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  {money((labour + overhead + outside) / q)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
