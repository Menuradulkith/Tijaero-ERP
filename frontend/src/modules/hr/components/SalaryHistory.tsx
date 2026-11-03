/**
 * SalaryHistory — effective-dated salary revisions of one employee (newest first).
 * Payroll pays the revision in force on the last day of the month.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Chip, IconButton, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

import { fmtLKR, handleApiError, showErrorToast, showSuccessToast } from "@/components/tijaero";
import { salaryRevisionsApi } from "@/modules/hr/api";
import { formatDate } from "@/utils/formatters";

interface Props {
  employeeId: string;
  canDelete?: boolean;
}

export default function SalaryHistory({ employeeId, canDelete }: Props) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["salary-revisions", employeeId],
    queryFn: () => salaryRevisionsApi.list(employeeId),
    enabled: !!employeeId,
  });
  const del = useMutation({
    mutationFn: (id: number) => salaryRevisionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-revisions", employeeId] });
      showSuccessToast("Salary revision removed");
    },
    onError: (e) => showErrorToast(handleApiError(e, "Failed to remove revision")),
  });

  if (isLoading) return <Typography variant="body2" color="text.secondary">Loading…</Typography>;
  if (!rows.length) return <Typography variant="body2" color="text.secondary">No salary history yet</Typography>;

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Effective from</TableCell>
            <TableCell>Reason</TableCell>
            <TableCell align="right">Basic</TableCell>
            <TableCell align="right">Allowances</TableCell>
            <TableCell align="right">Total</TableCell>
            <TableCell align="right">Change</TableCell>
            <TableCell>Remarks</TableCell>
            {canDelete && <TableCell />}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            const allowances = r.allowances.reduce((s, a) => s + Number(a.amount || 0), 0);
            const change = r.change == null ? null : Number(r.change);
            return (
              <TableRow key={r.id}>
                <TableCell>{formatDate(r.effective_from)}</TableCell>
                <TableCell><Chip size="small" label={r.reason} variant="outlined" sx={{ textTransform: "capitalize" }} /></TableCell>
                <TableCell align="right">{fmtLKR(r.basic_salary)}</TableCell>
                <TableCell align="right">{fmtLKR(allowances)}</TableCell>
                <TableCell align="right"><strong>{fmtLKR(r.total)}</strong></TableCell>
                <TableCell align="right" sx={{ color: change == null ? undefined : change >= 0 ? "success.main" : "error.main" }}>
                  {change == null ? "-" : `${change >= 0 ? "+" : ""}${fmtLKR(change)}${r.change_percent != null ? ` (${r.change_percent}%)` : ""}`}
                </TableCell>
                <TableCell>{r.remarks || "-"}</TableCell>
                {canDelete && (
                  <TableCell padding="checkbox">
                    {rows.length > 1 && (
                      <Tooltip title="Remove (only before payroll has used it)">
                        <IconButton size="small" aria-label="Remove revision" onClick={() => del.mutate(r.id)} disabled={del.isPending}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
