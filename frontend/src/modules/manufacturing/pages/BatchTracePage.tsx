/**
 * BatchTracePage - batch traceability for recalls.
 *
 * Enter a batch number: when it is a finished batch made here the page shows which
 * component lots went into it (backward trace); when it is a raw-material lot it shows
 * every production order and finished batch that used it (forward trace).
 */

import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { EmptyState, FormSection, MasterDetailLayout, modernTableStyles, TChip, TStatusChip } from "@/components/tijaero";
import { productionOrdersApi } from "@/modules/manufacturing/api";
import type { TraceLot, TraceOrder } from "@/modules/manufacturing/types";
import { formatDate } from "@/utils/formatters";

function LotTable({ lots, empty, highlight }: { lots: TraceLot[]; empty: string; highlight: string }) {
  const hl = highlight.trim().toLowerCase();
  return (
    <Paper variant="outlined" sx={{ overflow: "auto", borderRadius: 3 }}>
      <Table size="small">
        <TableHead>
          <TableRow sx={modernTableStyles.headerRow}>
            <TableCell>Product</TableCell>
            <TableCell>Batch</TableCell>
            <TableCell>Expiry</TableCell>
            <TableCell align="right">Qty</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lots.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} sx={modernTableStyles.emptyCell}>{empty}</TableCell>
            </TableRow>
          ) : (
            lots.map((l, i) => {
              const match = !!hl && (l.batch_no || "").toLowerCase() === hl;
              return (
                <TableRow key={`${l.product_id}-${l.batch_no || ""}-${i}`} sx={{ ...modernTableStyles.bodyRow, ...(match ? { bgcolor: "action.selected" } : {}) }}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{l.product_name || "-"}</Typography>
                    <Typography variant="caption" color="text.secondary">{l.product_code}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={match ? 700 : undefined}>{l.batch_no || "-"}</Typography>
                  </TableCell>
                  <TableCell>{l.expiry_date ? formatDate(l.expiry_date) : "-"}</TableCell>
                  <TableCell align="right">{l.quantity}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}

export default function BatchTracePage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [batchNo, setBatchNo] = useState("");

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["manufacturing-trace", batchNo],
    queryFn: () => productionOrdersApi.trace(batchNo),
    enabled: !!batchNo,
    staleTime: 0,
  });

  const runSearch = () => {
    const v = input.trim();
    if (!v) return;
    if (v === batchNo) refetch();
    else setBatchNo(v);
  };

  const openOrder = (o: TraceOrder) => navigate(`/manufacturing/orders?order=${o.order_id}`);
  const foundAs = data?.found_as || [];

  return (
    <MasterDetailLayout
      title="Batch Trace"
      icon={<ManageSearchIcon />}
      titleSlot={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
          <TextField
            size="small"
            placeholder="Batch number..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
            inputProps={{ maxLength: 100 }}
            sx={{ width: 240, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
          />
          <Button variant="contained" size="small" onClick={runSearch} disabled={!input.trim() || isFetching}>
            Trace
          </Button>
          {batchNo && (
            <Button size="small" sx={{ textTransform: "none" }} onClick={() => { setInput(""); setBatchNo(""); }}>
              Clear
            </Button>
          )}
        </Box>
      }
      onRefresh={batchNo ? () => refetch() : undefined}
      isLoading={isFetching}
    >
      <Box sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {!batchNo ? (
          <EmptyState
            message="Enter a batch number to trace it. For a finished batch you see the component lots that went into it; for a raw-material lot you see every production order and finished batch that used it — the list to pull back in a recall."
          />
        ) : isError ? (
          <Alert severity="error">Could not trace batch "{batchNo}". Use refresh to try again.</Alert>
        ) : !data ? (
          <Typography variant="body2" color="text.secondary">Tracing {batchNo}...</Typography>
        ) : (
          <>
            <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 3, display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="body1" fontWeight={700}>Batch {data.batch_no}</Typography>
              {foundAs.length === 0 ? (
                <TChip size="small" label="Not found" color="default" />
              ) : (
                <>
                  {foundAs.includes("finished") && <TChip size="small" color="success" label="Finished goods (made here)" />}
                  {foundAs.includes("component") && <TChip size="small" color="info" label="Component (used in production)" />}
                </>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ ml: "auto" }}>
                {data.orders.length} production order(s)
              </Typography>
            </Paper>

            {data.orders.length === 0 ? (
              <EmptyState message={`No production order made or used batch "${data.batch_no}" in your branches.`} />
            ) : (
              data.orders.map((o, idx) => (
                <FormSection
                  key={o.order_id}
                  title={`${o.order_no} — ${o.product_name || ""}`}
                  columns={2}
                  isLast={idx === data.orders.length - 1}
                  titleAction={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="caption" color="text.secondary">{o.branch_code}</Typography>
                      <TStatusChip status={o.status} statusMap="productionOrder" size="small" />
                      <Tooltip title="Open production order">
                        <IconButton size="small" onClick={() => openOrder(o)}>
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  }
                >
                  <Box sx={{ gridColumn: "1 / -1" }}>
                    <Link component="button" variant="body2" onClick={() => openOrder(o)} underline="hover">
                      Open {o.order_no}
                    </Link>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Finished batches</Typography>
                    <LotTable lots={o.finished_batches} empty="No output recorded" highlight={data.batch_no} />
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Component lots</Typography>
                    <LotTable lots={o.components} empty="No components issued" highlight={data.batch_no} />
                  </Box>
                </FormSection>
              ))
            )}
          </>
        )}
      </Box>
    </MasterDetailLayout>
  );
}
