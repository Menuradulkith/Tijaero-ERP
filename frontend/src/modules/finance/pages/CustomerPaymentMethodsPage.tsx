/**
 * Customer Payment Methods Page
 *
 * Entry point to the customer payment method registers: Bank Deposits, Card
 * Payments, Cheque Payments, Credit Notes, Credit Payments and Cash Payments.
 * Cash payments are recorded directly in sales invoices and tracked through
 * the cashbook.
 *
 * Same layout as the purchasing / sales list pages: a full-height list with a
 * search box; clicking a row opens that method's register page.
 */

import {
  AccountBalance as BankIcon,
  Payment as CardIcon,
  Receipt as ChequeIcon,
  CreditScore as CreditNoteIcon,
  CreditScore as CreditPaymentIcon,
  LocalAtm as CashIcon,
} from "@mui/icons-material";
import SearchIcon from "@mui/icons-material/Search";
import { Box, InputAdornment, TextField, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { MasterDetailLayout, TDataGrid, type TDataGridColumn } from "@/components/tijaero";

interface PaymentMethodRow {
  id: string;
  title: string;
  description: string;
  icon: JSX.Element;
  path: string;
  color: "primary" | "success" | "warning" | "info" | "error" | "secondary";
}

const paymentMethods: PaymentMethodRow[] = [
  {
    id: "bank-deposits",
    title: "Bank Deposits",
    description: "Manage bank deposit records and verifications",
    icon: <BankIcon fontSize="small" />,
    path: "/finance/customer-payment-methods/bank-deposits",
    color: "primary",
  },
  {
    id: "card-payments",
    title: "Card Payments",
    description: "Track credit and debit card transactions",
    icon: <CardIcon fontSize="small" />,
    path: "/finance/customer-payment-methods/card-payments",
    color: "success",
  },
  {
    id: "cheque-payments",
    title: "Cheque Payments",
    description: "Manage cheque payments and clearances",
    icon: <ChequeIcon fontSize="small" />,
    path: "/finance/customer-payment-methods/cheque-payments",
    color: "warning",
  },
  {
    id: "credit-notes",
    title: "Credit Notes",
    description: "Issue and track credit notes for customers",
    icon: <CreditNoteIcon fontSize="small" />,
    path: "/finance/customer-payment-methods/credit-notes",
    color: "info",
  },
  {
    id: "credit-payments",
    title: "Credit Payments",
    description: "Manage customer credit terms and balances",
    icon: <CreditPaymentIcon fontSize="small" />,
    path: "/finance/customer-payment-methods/credit-payments",
    color: "secondary",
  },
  {
    id: "cash-payments",
    title: "Cash Payments",
    description: "View cash payments received from sales invoices",
    icon: <CashIcon fontSize="small" />,
    path: "/finance/customer-payment-methods/cash-payments",
    color: "error",
  },
];

export default function CustomerPaymentMethodsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return paymentMethods.filter((m) => !q || m.title.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
  }, [search]);

  const columns: TDataGridColumn<PaymentMethodRow>[] = [
    {
      field: "title",
      header: "Payment Method",
      minWidth: 220,
      flex: 1,
      renderCell: (p) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: "100%" }}>
          <Box sx={{ display: "flex", color: `${p.row.color}.main` }}>{p.row.icon}</Box>
          <Typography variant="body2" fontWeight={600}>
            {p.row.title}
          </Typography>
        </Box>
      ),
    },
    { field: "description", header: "Description", minWidth: 280, flex: 2 },
  ];

  return (
    <MasterDetailLayout
      title="Customer Payment Methods"
      titleSlot={
        <TextField
          size="small"
          placeholder="Search payment methods..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" color="action" />
              </InputAdornment>
            ),
          }}
          sx={{ width: 240, flexShrink: 0 }}
        />
      }
    >
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, pb: 1, display: "block" }}>
          Open a payment method to manage its records. Cash payments are logged directly from sales invoices.
        </Typography>
        <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
          <TDataGrid<PaymentMethodRow>
            rows={filtered}
            columns={columns}
            onRowClick={(m) => navigate(m.path)}
            pageSizeOptions={[10, 25]}
            pageSize={10}
            emptyMessage="No payment method matches the search"
            autoHeight={false}
            height="100%"
          />
        </Box>
      </Box>
    </MasterDetailLayout>
  );
}
