/**
 * OutstandingGRNsPage
 *
 * Shows all GRNs that have NOT yet been linked to a Supplier Voucher Payment
 * (Purchase Invoice). These represent goods received but not yet vouchered.
 *
 * Pattern follows SupplierPaymentReportPage's "Outstanding Invoices" tab.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from "@mui/material";
import AssessmentIcon from "@mui/icons-material/Assessment";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import PrintIcon from "@mui/icons-material/Print";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

import {
  DetailPanelHeader,
  fmtLKR,
  handleApiError,
  modernTableStyles,
  showErrorToast,
} from "@/components/tijaero";

import {
  purchaseInvoicesApi,
  OutstandingGRNItem,
} from "@/modules/purchasing/purchaseInvoiceApi";
import { suppliersApi } from "@/modules/purchasing/api";
import { useReferenceData } from "@/hooks";
import type { Supplier } from "@/modules/purchasing/types";

type SortDir = "asc" | "desc";
type SortField =
  | "grn_date"
  | "supplier_name"
  | "grn_no"
  | "po_no"
  | "remaining_amount"
  | "days_since_grn"
  | "branch_code";

export default function OutstandingGRNsPage() {
  const navigate = useNavigate();

  // Filters
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [selectedBranch, setSelectedBranch] = useState("all");

  // Data
  const [items, setItems] = useState<OutstandingGRNItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Sort
  const [sortField, setSortField] = useState<SortField>("days_since_grn");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { filteredBranches: branches = [] } = useReferenceData(["branches"]);

  // Load suppliers for filter dropdown
  useEffect(() => {
    suppliersApi
      .getAll({ active: true })
      .then(setSuppliers)
      .catch(() => {});
  }, []);

  // Fetch outstanding GRNs
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {};
      if (selectedSupplier) params.supplier_id = selectedSupplier.id;
      if (selectedBranch !== "all") params.branch_code = selectedBranch;
      const data = await purchaseInvoicesApi.getOutstandingGRNs(params as any);
      setItems(data);
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to load outstanding GRNs"));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [selectedSupplier, selectedBranch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Sort handler
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(
        field === "remaining_amount" || field === "days_since_grn" ? "desc" : "asc",
      );
    }
  };

  // Filter + sort
  const filteredItems = useMemo(() => {
    const rows = [...items];
    return rows.sort((a, b) => {
      let cmp = 0;
      if (sortField === "grn_date")
        cmp = (a.grn_date || "").localeCompare(b.grn_date || "");
      else if (sortField === "supplier_name")
        cmp = a.supplier_name.localeCompare(b.supplier_name);
      else if (sortField === "grn_no")
        cmp = a.grn_no.localeCompare(b.grn_no);
      else if (sortField === "po_no")
        cmp = (a.po_no || "").localeCompare(b.po_no || "");
      else if (sortField === "remaining_amount")
        cmp = a.remaining_amount - b.remaining_amount;
      else if (sortField === "days_since_grn")
        cmp = a.days_since_grn - b.days_since_grn;
      else if (sortField === "branch_code")
        cmp = (a.branch_code || "").localeCompare(b.branch_code || "");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, sortField, sortDir]);

  // Summary
  const summary = useMemo(() => {
    const totalAmount = filteredItems.reduce(
      (s, i) => s + i.remaining_amount,
      0,
    );
    const totalQty = filteredItems.reduce(
      (s, i) => s + i.total_received_qty,
      0,
    );
    const oldCount = filteredItems.filter((i) => i.days_since_grn > 30).length;
    const oldAmount = filteredItems
      .filter((i) => i.days_since_grn > 30)
      .reduce((s, i) => s + i.remaining_amount, 0);
    // Group by supplier
    const supplierSet = new Set(filteredItems.map((i) => i.supplier_id));
    return {
      totalAmount,
      totalQty,
      totalGRNs: filteredItems.length,
      supplierCount: supplierSet.size,
      oldCount,
      oldAmount,
    };
  }, [filteredItems]);

  // Reset
  const handleReset = () => {
    setSelectedSupplier(null);
    setSelectedBranch("all");
  };

  // CSV Export
  const handleExportCSV = () => {
    const headers = [
      "GRN No",
      "GRN Date",
      "PO No",
      "Supplier",
      "Supplier Invoice No",
      "Qty Received",
      "Amount (Rs.)",
      "Days Since GRN",
      "Branch",
    ];
    const rows = filteredItems.map((i) => [
      i.grn_no,
      i.grn_date ? new Date(i.grn_date).toLocaleDateString() : "",
      i.po_no,
      i.supplier_name,
      i.supplier_invoice_no || "",
      i.total_received_qty.toString(),
      i.remaining_amount.toFixed(2),
      i.days_since_grn.toString(),
      i.branch_code,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${c}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outstanding_grns_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Print
  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) {
      showErrorToast("Allow popups to print");
      return;
    }
    const supplierLabel = selectedSupplier
      ? selectedSupplier.full_name
      : "All Suppliers";
    const branchLabel =
      selectedBranch !== "all"
        ? branches.find((b) => b.branch_code === selectedBranch)?.branch_name ||
          selectedBranch
        : "All Branches";

    const rowsHtml = filteredItems
      .map(
        (i) => `
      <tr>
        <td style="font-family:monospace">${i.grn_no}</td>
        <td>${i.grn_date ? new Date(i.grn_date).toLocaleDateString() : "-"}</td>
        <td style="font-family:monospace">${i.po_no}</td>
        <td>${i.supplier_name}</td>
        <td>${i.supplier_invoice_no || "-"}</td>
        <td style="text-align:right">${i.total_received_qty}</td>
        <td style="text-align:right;font-weight:bold">${fmtLKR(i.remaining_amount)}</td>
        <td style="text-align:center;color:${i.days_since_grn > 30 ? "#c62828" : "#2e7d32"}">${i.days_since_grn}d</td>
        <td>${i.branch_code}</td>
      </tr>`,
      )
      .join("");

    win.document.write(`<!DOCTYPE html><html><head><title>Outstanding GRNs</title>
<style>body{font-family:Segoe UI,sans-serif;padding:20px;max-width:1100px;margin:0 auto}h1{color:#1976d2;border-bottom:2px solid #1976d2;padding-bottom:10px}
.meta{color:#666;font-size:13px;margin-bottom:20px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.sc{padding:12px;border:1px solid #ddd;border-radius:6px;text-align:center}.sc .lbl{font-size:10px;text-transform:uppercase;color:#888}
.sc .val{font-size:18px;font-weight:bold;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ddd;padding:6px 8px}
th{background:#1976d2;color:#fff;font-size:10px;text-transform:uppercase}tr:nth-child(even){background:#f9f9f9}@media print{body{padding:10px}}</style></head>
<body><h1>Outstanding GRNs (Not Yet Vouchered)</h1>
<div class="meta">${supplierLabel} | ${branchLabel} | Generated ${new Date().toLocaleString()}</div>
<div class="summary">
  <div class="sc"><div class="lbl">Total GRNs</div><div class="val" style="color:#1976d2">${summary.totalGRNs}</div></div>
  <div class="sc"><div class="lbl">Total Outstanding</div><div class="val" style="color:#ed6c02">Rs. ${fmtLKR(summary.totalAmount)}</div></div>
  <div class="sc"><div class="lbl">Suppliers</div><div class="val">${summary.supplierCount}</div></div>
  <div class="sc"><div class="lbl">&gt;30 Days Old</div><div class="val" style="color:#c62828">${summary.oldCount}</div></div>
</div>
<table><thead><tr><th>GRN No</th><th>GRN Date</th><th>PO No</th><th>Supplier</th><th>Supplier Invoice</th>
<th>Qty</th><th>Amount</th><th>Age</th><th>Branch</th></tr></thead>
<tbody>${rowsHtml}
<tr style="background:#f5f5f5;font-weight:bold"><td colspan="5" style="text-align:right">TOTAL:</td>
<td style="text-align:right">${summary.totalQty}</td><td style="text-align:right">Rs. ${fmtLKR(summary.totalAmount)}</td>
<td colspan="2"></td></tr>
</tbody></table>
<script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchasing", href: "/purchasing" },
          {
            label: "Supplier Voucher Payment",
            href: "/purchasing/invoices",
          },
          { label: "Outstanding GRNs" },
        ]}
        title="Outstanding GRNs"
        titleIcon={<AssessmentIcon color="primary" />}
        isCreating={false}
      />

      {/* Top bar */}
      <Box
        sx={{
          px: 2,
          pt: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Button
          size="small"
          variant="text"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate("/purchasing/invoices")}
        >
          Back to Voucher Payments
        </Button>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<DownloadIcon />}
            onClick={handleExportCSV}
            disabled={filteredItems.length === 0}
          >
            Export CSV
          </Button>
          <Button
            variant="contained"
            size="small"
            startIcon={<PrintIcon />}
            onClick={handlePrint}
            disabled={filteredItems.length === 0}
          >
            Print
          </Button>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {/* Filters */}
        <Paper sx={{ p: 2, mb: 2 }}>
          <Box
            sx={{
              display: "flex",
              gap: 2,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <Autocomplete
              size="small"
              options={suppliers}
              getOptionLabel={(o) =>
                o.company_name
                  ? `${o.full_name} (${o.company_name})`
                  : o.full_name
              }
              value={selectedSupplier}
              onChange={(_, v) => setSelectedSupplier(v)}
              renderInput={(params) => (
                <TextField {...params} label="Filter by Supplier" />
              )}
              sx={{ minWidth: 250 }}
            />
            <Autocomplete
              size="small"
              options={[
                { branch_code: "all", branch_name: "All Branches" },
                ...branches,
              ]}
              getOptionLabel={(o) =>
                o.branch_code === "all"
                  ? o.branch_name
                  : `${o.branch_name} (${o.branch_code})`
              }
              value={
                branches.find((b) => b.branch_code === selectedBranch) || {
                  branch_code: "all",
                  branch_name: "All Branches",
                }
              }
              onChange={(_, v) => setSelectedBranch(v?.branch_code || "all")}
              renderInput={(params) => (
                <TextField {...params} label="Filter by Branch" />
              )}
              sx={{ minWidth: 220 }}
              disableClearable
            />
            <Button size="small" variant="text" onClick={handleReset}>
              Reset
            </Button>
          </Box>
        </Paper>

        {/* Summary Cards */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Outstanding GRNs
                </Typography>
                <Typography variant="h5" color="primary.main">
                  {summary.totalGRNs}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Total Outstanding
                </Typography>
                <Typography variant="h6" color="warning.dark">
                  Rs. {fmtLKR(summary.totalAmount)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Suppliers
                </Typography>
                <Typography variant="h5">{summary.supplierCount}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined">
              <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  &gt;30 Days Old
                </Typography>
                <Typography
                  variant="h5"
                  color={
                    summary.oldCount > 0 ? "error.dark" : "success.dark"
                  }
                >
                  {summary.oldCount}
                </Typography>
                {summary.oldAmount > 0 && (
                  <Typography variant="caption" color="error.dark">
                    Rs. {fmtLKR(summary.oldAmount)}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Table */}
        <Paper sx={{ overflow: "hidden" }}>
          {loading ? (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                py: 6,
              }}
            >
              <CircularProgress />
            </Box>
          ) : filteredItems.length === 0 ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ py: 6, textAlign: "center" }}
            >
              No outstanding GRNs found
            </Typography>
          ) : (
            <TableContainer sx={{ maxHeight: "calc(100vh - 420px)" }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <TableSortLabel
                        active={sortField === "grn_no"}
                        direction={sortField === "grn_no" ? sortDir : "asc"}
                        onClick={() => handleSort("grn_no")}
                      >
                        GRN No
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortField === "grn_date"}
                        direction={
                          sortField === "grn_date" ? sortDir : "asc"
                        }
                        onClick={() => handleSort("grn_date")}
                      >
                        GRN Date
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortField === "po_no"}
                        direction={sortField === "po_no" ? sortDir : "asc"}
                        onClick={() => handleSort("po_no")}
                      >
                        PO No
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortField === "supplier_name"}
                        direction={
                          sortField === "supplier_name" ? sortDir : "asc"
                        }
                        onClick={() => handleSort("supplier_name")}
                      >
                        Supplier
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>Supplier Invoice</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell align="right">
                      <TableSortLabel
                        active={sortField === "remaining_amount"}
                        direction={
                          sortField === "remaining_amount" ? sortDir : "desc"
                        }
                        onClick={() => handleSort("remaining_amount")}
                      >
                        Amount (Rs.)
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="center">
                      <TableSortLabel
                        active={sortField === "days_since_grn"}
                        direction={
                          sortField === "days_since_grn" ? sortDir : "desc"
                        }
                        onClick={() => handleSort("days_since_grn")}
                      >
                        Age
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={sortField === "branch_code"}
                        direction={
                          sortField === "branch_code" ? sortDir : "asc"
                        }
                        onClick={() => handleSort("branch_code")}
                      >
                        Branch
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="center">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredItems.map((grn) => (
                    <TableRow key={grn.grn_id} hover>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: "monospace" }}
                        >
                          {grn.grn_no}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {grn.grn_date
                          ? new Date(grn.grn_date).toLocaleDateString()
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: "monospace" }}
                        >
                          {grn.po_no}
                        </Typography>
                      </TableCell>
                      <TableCell>{grn.supplier_name}</TableCell>
                      <TableCell>
                        {grn.supplier_invoice_no || (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                          >
                            -
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {grn.total_received_qty}
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight="bold" color="warning.main">
                          {fmtLKR(grn.remaining_amount)}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        {grn.days_since_grn > 30 ? (
                          <Chip
                            label={`${grn.days_since_grn}d`}
                            size="small"
                            color="error"
                            icon={<WarningAmberIcon />}
                            sx={{ fontWeight: "bold" }}
                          />
                        ) : (
                          <Chip
                            label={`${grn.days_since_grn}d`}
                            size="small"
                            color="success"
                          />
                        )}
                      </TableCell>
                      <TableCell>{grn.branch_code}</TableCell>
                      <TableCell align="center">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<ReceiptLongIcon />}
                          onClick={() =>
                            navigate("/purchasing/invoices", {
                              state: {
                                supplier_id: grn.supplier_id,
                                branch_code: grn.branch_code,
                                grn_id: grn.grn_id,
                              },
                            })
                          }
                          sx={{ textTransform: "none", fontSize: "0.75rem" }}
                        >
                          Create Voucher
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow
                    sx={{ bgcolor: "grey.100", "& td": { fontWeight: "bold" } }}
                  >
                    <TableCell colSpan={5} align="right">
                      Total:
                    </TableCell>
                    <TableCell align="right">{summary.totalQty}</TableCell>
                    <TableCell align="right">
                      <Typography fontWeight="bold" color="primary.main">
                        Rs. {fmtLKR(summary.totalAmount)}
                      </Typography>
                    </TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
