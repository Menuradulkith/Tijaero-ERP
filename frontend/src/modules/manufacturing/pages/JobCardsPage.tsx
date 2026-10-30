/**
 * JobCardsPage - shop-floor view of every open operation on released / in-progress
 * production orders (ERPNext "Job Card", Odoo "Work Orders", BC "Output Journal").
 * Operators book time and completed quantities against an operation from here.
 */

import AccessTimeIcon from "@mui/icons-material/AccessTime";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PrintIcon from "@mui/icons-material/Print";
import SearchIcon from "@mui/icons-material/Search";
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  MasterDetailLayout,
  TBranchFilter,
  TChip,
  TDataGrid,
  type TDataGridColumn,
  TPrintPreviewDialog,
  TStatusChip,
  useCrudMutation,
} from "@/components/tijaero";
import { usePermission } from "@/auth/permissions";
import { useReferenceData } from "@/hooks";
import { productionOrdersApi, shopFloorApi, workCentersApi } from "@/modules/manufacturing/api";
import type { JobCard, Operator, TimeLogInput } from "@/modules/manufacturing/types";
import { formatDate } from "@/utils/formatters";

type JobCardRow = JobCard & { id: number };

const fmtHours = (minutes: number | string) => `${(Number(minutes) / 60).toFixed(1)} h`;

interface TimeForm {
  employee_id: number | null;
  mode: "minutes" | "range";
  minutes: string;
  start_time: string;
  end_time: string;
  completed_quantity: string;
  complete_operation: boolean;
  remark: string;
}

const EMPTY_FORM: TimeForm = {
  employee_id: null,
  mode: "minutes",
  minutes: "",
  start_time: "",
  end_time: "",
  completed_quantity: "",
  complete_operation: false,
  remark: "",
};

export default function JobCardsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canLogTime = usePermission("shop_floor", "update");

  const [searchQuery, setSearchQuery] = useState("");
  const [filterBranch, setFilterBranch] = useState<string | null>(null);
  const [filterWorkCenter, setFilterWorkCenter] = useState<number | "">("");
  const [includeCompleted, setIncludeCompleted] = useState(false);

  const { filteredBranches, defaultBranchCode } = useReferenceData(["branches"]);
  const branches = filteredBranches || [];

  useEffect(() => {
    if (defaultBranchCode && filterBranch === null) setFilterBranch(defaultBranchCode);
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchResolved = defaultBranchCode === undefined || filterBranch !== null;

  const { data: cards = [], isLoading } = useQuery({
    queryKey: ["job-cards", filterBranch, filterWorkCenter, includeCompleted],
    queryFn: () =>
      shopFloorApi.getJobCards({
        branch_code: filterBranch || undefined,
        work_center_id: filterWorkCenter || undefined,
        include_completed: includeCompleted,
      }),
    enabled: branchResolved,
  });

  const { data: workCenters = [] } = useQuery({
    queryKey: ["work-centers", "active"],
    queryFn: () => workCentersApi.getAll({ active: true }),
  });

  const { data: operators = [] } = useQuery({
    queryKey: ["manufacturing-operators"],
    queryFn: () => shopFloorApi.getOperators(),
  });

  const rows: JobCardRow[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cards
      .filter(
        (c) =>
          !q ||
          c.order_no.toLowerCase().includes(q) ||
          (c.product_name || "").toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.work_center_code || "").toLowerCase().includes(q)
      )
      .map((c) => ({ ...c, id: c.operation_id }));
  }, [cards, searchQuery]);

  const [printOrder, setPrintOrder] = useState<{ id: number; no: string } | null>(null);

  // ── Log time dialog ──
  const [logCard, setLogCard] = useState<JobCard | null>(null);
  const [form, setForm] = useState<TimeForm>(EMPTY_FORM);

  const openLog = (card: JobCard) => {
    setForm(EMPTY_FORM);
    setLogCard(card);
  };

  const logMutation = useCrudMutation({
    mutationFn: productionOrdersApi.logTime,
    invalidateQueryKeys: [
      ["job-cards"],
      ["production-orders"],
      ["production-order-activity"],
      ["manufacturing-dashboard"],
      ["work-centers"],
      ["journal-entries"],
      ["general-ledger"],
      ["trial-balance"],
    ],
    successMessage: "Time logged",
    errorMessage: "Failed to log time",
    onSuccess: () => setLogCard(null),
  });

  const minutesValid =
    form.mode === "minutes"
      ? Number(form.minutes) > 0
      : !!form.start_time && !!form.end_time && new Date(form.end_time) > new Date(form.start_time);

  const handleLog = () => {
    if (!logCard || !minutesValid) return;
    const data: TimeLogInput = {
      operation_id: logCard.operation_id,
      employee_id: form.employee_id,
      completed_quantity: Math.max(0, Math.floor(Number(form.completed_quantity) || 0)),
      complete_operation: form.complete_operation,
      remark: form.remark.trim() || null,
      ...(form.mode === "minutes"
        ? { minutes: Number(form.minutes) }
        : { start_time: form.start_time, end_time: form.end_time }),
    };
    logMutation.mutate({ id: logCard.order_id, data });
  };

  const columns: TDataGridColumn<JobCardRow>[] = useMemo(
    () => [
      {
        field: "order_no",
        header: "Order",
        width: 170,
        renderCell: (params: GridRenderCellParams<JobCardRow>) => (
          <Typography variant="body2" fontWeight={600}>{params.row.order_no}</Typography>
        ),
      },
      {
        field: "product_name",
        header: "Product",
        flex: 1,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<JobCardRow>) => (
          <Box sx={{ lineHeight: 1.2, py: 0.5 }}>
            <Typography variant="body2" noWrap>{params.row.product_name}</Typography>
            <Typography variant="caption" color="text.secondary">{params.row.product_code}</Typography>
          </Box>
        ),
      },
      {
        field: "name",
        header: "Operation",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<JobCardRow>) => `${params.row.sequence} · ${params.row.name}`,
      },
      {
        field: "work_center_code",
        header: "Work Center",
        width: 150,
        renderCell: (params: GridRenderCellParams<JobCardRow>) => params.row.work_center_code || "-",
      },
      {
        field: "progress",
        header: "Time (actual / planned)",
        width: 190,
        sortable: false,
        renderCell: (params: GridRenderCellParams<JobCardRow>) => {
          const planned = Number(params.row.planned_minutes);
          const actual = Number(params.row.actual_minutes);
          const pct = planned > 0 ? Math.min((actual / planned) * 100, 100) : 0;
          return (
            <Box sx={{ width: "100%" }}>
              <Typography variant="caption">
                {fmtHours(actual)} / {fmtHours(planned)}
              </Typography>
              <LinearProgress variant="determinate" value={pct} color={actual > planned ? "warning" : "primary"}
                sx={{ height: 6, borderRadius: 3 }} />
            </Box>
          );
        },
      },
      {
        field: "completed_quantity",
        header: "Qty Done",
        width: 100,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<JobCardRow>) =>
          `${params.row.completed_quantity} / ${params.row.planned_quantity}`,
      },
      {
        field: "planned_end_date",
        header: "Due",
        width: 130,
        renderCell: (params: GridRenderCellParams<JobCardRow>) => (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="body2" color={params.row.is_late ? "error.main" : undefined}>
              {formatDate(params.row.planned_end_date)}
            </Typography>
            {params.row.is_late && <TChip label="Late" size="small" color="error" />}
          </Stack>
        ),
      },
      {
        field: "priority",
        header: "Priority",
        width: 100,
        renderCell: (params: GridRenderCellParams<JobCardRow>) => (
          <TStatusChip status={params.row.priority} statusMap="priority" size="small" />
        ),
      },
      {
        field: "status",
        header: "Status",
        width: 120,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<JobCardRow>) => (
          <TStatusChip status={params.row.status} statusMap="operationStatus" size="small" />
        ),
      },
      {
        field: "actions",
        header: "",
        width: 132,
        sortable: false,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<JobCardRow>) => (
          <Box>
            {canLogTime && params.row.status !== "completed" && (
              <Tooltip title="Log time">
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); openLog(params.row); }}>
                  <AccessTimeIcon fontSize="small" color="primary" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Print job card">
              <IconButton size="small" onClick={(e) => {
                e.stopPropagation();
                setPrintOrder({ id: params.row.order_id, no: params.row.order_no });
              }}>
                <PrintIcon fontSize="small" color="action" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Open production order">
              <IconButton size="small" onClick={(e) => {
                e.stopPropagation();
                navigate(`/manufacturing/orders?order=${params.row.order_id}`);
              }}>
                <OpenInNewIcon fontSize="small" color="action" />
              </IconButton>
            </Tooltip>
          </Box>
        ),
      },
    ],
    [canLogTime, navigate]
  );

  return (
    <>
      <MasterDetailLayout
        title="Job Cards"
        titleSlot={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
            <TextField
              size="small"
              placeholder="Search job cards..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 190, flexShrink: 0 }}
            />
            <TextField
              select
              size="small"
              value={filterWorkCenter}
              onChange={(e) => setFilterWorkCenter(e.target.value === "" ? "" : Number(e.target.value))}
              sx={{ width: 190, flexShrink: 0 }}
              SelectProps={{ displayEmpty: true }}
            >
              <MenuItem value="">All Work Centers</MenuItem>
              {workCenters.map((wc) => (
                <MenuItem key={wc.id} value={wc.id}>{wc.code} - {wc.name}</MenuItem>
              ))}
            </TextField>
            <Box sx={{ width: 150, flexShrink: 0 }}>
              <TBranchFilter branches={branches} value={filterBranch} onChange={setFilterBranch} label="" placeholder="All Branches" size="small" />
            </Box>
            <FormControlLabel
              control={<Checkbox size="small" checked={includeCompleted} onChange={(e) => setIncludeCompleted(e.target.checked)} />}
              label={<Typography variant="body2">Show completed</Typography>}
            />
            {(searchQuery || filterBranch || filterWorkCenter) && (
              <Button size="small" onClick={() => { setSearchQuery(""); setFilterBranch(null); setFilterWorkCenter(""); }}
                sx={{ textTransform: "none" }}>
                Clear
              </Button>
            )}
          </Box>
        }
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["job-cards"] })}
        isLoading={isLoading}
      >
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
            <TDataGrid<JobCardRow>
              rows={rows}
              columns={columns}
              loading={isLoading}
              onRowClick={(row) => (canLogTime && row.status !== "completed" ? openLog(row) : undefined)}
              pageSizeOptions={[10, 25, 50, 100]}
              pageSize={25}
              emptyMessage="No open operations — release a production order to put its operations on the shop floor"
              autoHeight={false}
              height="100%"
            />
          </Box>
        </Box>
      </MasterDetailLayout>

      {printOrder && (
        <TPrintPreviewDialog
          open={!!printOrder}
          onClose={() => setPrintOrder(null)}
          documentType="job-card"
          documentId={printOrder.id}
          title={`Job Card: ${printOrder.no}`}
        />
      )}

      {/* Log time dialog */}
      <Dialog open={!!logCard} onClose={() => setLogCard(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Log Time
          {logCard && (
            <Typography variant="body2" color="text.secondary">
              {logCard.order_no} · {logCard.sequence} {logCard.name} ({logCard.work_center_code})
            </Typography>
          )}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Autocomplete<Operator>
              size="small"
              options={operators}
              getOptionLabel={(o) => `${o.name} (${o.employee_id})`}
              value={operators.find((o) => o.id === form.employee_id) || null}
              onChange={(_, v) => setForm({ ...form, employee_id: v?.id ?? null })}
              renderInput={(params) => <TextField {...params} label="Operator" placeholder="Optional" />}
            />
            <TextField
              select
              size="small"
              label="Time entry"
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value as TimeForm["mode"] })}
            >
              <MenuItem value="minutes">Minutes worked</MenuItem>
              <MenuItem value="range">Start and end time</MenuItem>
            </TextField>
            {form.mode === "minutes" ? (
              <TextField
                size="small"
                type="number"
                label="Minutes"
                required
                value={form.minutes}
                onChange={(e) => setForm({ ...form, minutes: e.target.value })}
                inputProps={{ min: 1, step: 1 }}
              />
            ) : (
              <Stack direction="row" spacing={1.5}>
                <TextField
                  size="small"
                  type="datetime-local"
                  label="Start"
                  required
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  value={form.start_time}
                  onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                />
                <TextField
                  size="small"
                  type="datetime-local"
                  label="End"
                  required
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  value={form.end_time}
                  onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                  error={!!form.start_time && !!form.end_time && !minutesValid}
                  helperText={!!form.start_time && !!form.end_time && !minutesValid ? "End must be after start" : undefined}
                />
              </Stack>
            )}
            <TextField
              size="small"
              type="number"
              label="Completed quantity"
              value={form.completed_quantity}
              onChange={(e) => setForm({ ...form, completed_quantity: e.target.value })}
              inputProps={{ min: 0, step: 1 }}
              helperText={logCard ? `${logCard.completed_quantity} of ${logCard.planned_quantity} done so far` : undefined}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.complete_operation}
                  onChange={(e) => setForm({ ...form, complete_operation: e.target.checked })}
                />
              }
              label="Mark this operation complete"
            />
            <TextField
              size="small"
              label="Remark"
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
              inputProps={{ maxLength: 255 }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLogCard(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleLog} disabled={!minutesValid || logMutation.isPending}>
            Log Time
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
