/**
 * Cheque register status + actions, shown on a cheque's detail view:
 * In hand -> Deposited (confirming its bank deposit) -> Cleared | Bounced.
 */

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { usePermission } from "@/auth/permissions";
import { TChip, handleApiError, showSuccessToast } from "@/components/tijaero";
import { CHEQUE_STATUS_LABEL, chequeActionsApi, type ChequeStatus } from "@/modules/finance/api/receivables";
import { submitOnce } from "@/modules/finance/submitOnce";
import { invalidateLedgerQueries } from "@/modules/finance/ledgerQueries";

export interface ChequeRegisterFields {
  id: number;
  status?: ChequeStatus | string | null;
  status_date?: string | null;
  bounce_reason?: string | null;
  payment_for?: string | null;
  invoice_no?: string | null;
  amount?: number | string;
}

const chequeStatusColor = (s?: string | null): "default" | "info" | "success" | "error" =>
  s === "deposited" ? "info" : s === "cleared" ? "success" : s === "bounced" ? "error" : "default";

export function ChequeStatusChip({ status }: { status?: string | null }) {
  const s = (status || "received") as ChequeStatus;
  return <TChip size="small" color={chequeStatusColor(s)} label={CHEQUE_STATUS_LABEL[s] ?? s} />;
}

export default function ChequeStatusSection({ cheque, onChanged }: { cheque: ChequeRegisterFields; onChanged?: () => void }) {
  const queryClient = useQueryClient();
  const canAct = usePermission("journal_entries", "create");
  const [bouncing, setBouncing] = useState(false);
  const [reason, setReason] = useState("");
  const status = (cheque.status || "received") as ChequeStatus;
  const linked = cheque.payment_for === "Sales Invoice" || cheque.payment_for === "Credit Settlement";

  const done = (msg: string) => {
    showSuccessToast(msg);
    queryClient.invalidateQueries({ queryKey: ["chequePayments"] });
    invalidateLedgerQueries(queryClient);
    queryClient.invalidateQueries({ queryKey: ["cheque-payments"] });
    onChanged?.();
  };
  const clear = useMutation({
    mutationFn: () => chequeActionsApi.clear(cheque.id),
    onSuccess: () => done("Cheque marked cleared."),
    onError: (err) => handleApiError(err, "Could not mark the cheque cleared"),
  });
  const bounce = useMutation({
    mutationFn: () => chequeActionsApi.bounce(cheque.id, reason),
    onSuccess: () => {
      setBouncing(false);
      done(`Cheque marked bounced. ${cheque.invoice_no ?? "The invoice"} is owed by the customer again.`);
    },
    onError: (err) => handleApiError(err, "Could not mark the cheque bounced"),
  });

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexGrow: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Status:
          </Typography>
          <ChequeStatusChip status={status} />
          {cheque.status_date && (
            <Typography variant="caption" color="text.secondary">
              since {cheque.status_date}
            </Typography>
          )}
        </Stack>
        {canAct && status === "deposited" && (
          <Button size="small" variant="outlined" color="success" disabled={clear.isPending} onClick={() => submitOnce("ChequeStatusSection-clear-1", clear)}>
            Mark cleared
          </Button>
        )}
        {canAct && status !== "bounced" && linked && (
          <Button size="small" variant="outlined" color="error" onClick={() => setBouncing(true)}>
            Bounced…
          </Button>
        )}
      </Stack>
      {status === "received" && (
        <Typography variant="caption" color="text.secondary">
          Still in hand. It becomes “Deposited” when its bank deposit is confirmed on the Bank Deposits page.
        </Typography>
      )}
      {status === "bounced" && cheque.bounce_reason && (
        <Alert severity="error" sx={{ mt: 1 }}>
          Bounced: {cheque.bounce_reason}. The amount was put back on the customer&apos;s account.
        </Alert>
      )}
      {bouncing && (
        <Dialog open onClose={() => setBouncing(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Cheque bounced?</DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2" mb={2}>
              The bank returned this cheque unpaid. The customer will owe {cheque.invoice_no ?? "the invoice"} again and
              the money comes off {status === "received" ? "cheques in hand" : "the bank account"} in the books.
            </Typography>
            <TextField
              label="Reason (from the bank)"
              size="small"
              fullWidth
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. insufficient funds"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setBouncing(false)}>Cancel</Button>
            <Button variant="contained" color="error" disabled={!reason.trim() || bounce.isPending} onClick={() => submitOnce("ChequeStatusSection-bounce-2", bounce)}>
              Mark bounced
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}
