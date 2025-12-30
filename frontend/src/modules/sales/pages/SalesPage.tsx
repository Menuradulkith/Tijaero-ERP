import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  IconButton,
  TextField,
  InputAdornment,
  Chip,
} from "@mui/material";
import {
  Add as AddIcon,
  Visibility as ViewIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
} from "@mui/icons-material";
import { salesApi } from "../api";
import { Invoice } from "../types";
import SalesOrderDialog from "../components/SalesOrderDialog";
import { usePermission } from "@/auth/permissions";
import { toast } from "react-hot-toast";
import { format } from "date-fns";

export default function SalesPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const canCreate = usePermission("sales", "create");
  const canView = usePermission("sales", "view");
  const canDelete = usePermission("sales", "delete");

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["sales", searchQuery],
    queryFn: () =>
      searchQuery ? salesApi.search(searchQuery) : salesApi.getAll(),
  });

  const deleteMutation = useMutation({
    mutationFn: salesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      toast.success("Sales order deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete sales order");
    },
  });

  const handleCreate = () => {
    setSelectedInvoice(null);
    setDialogOpen(true);
  };

  const handleView = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this sales order?")) {
      deleteMutation.mutate(id);
    }
  };

  const calculateTotal = (invoice: Invoice) => {
    return (
      invoice.cash_amount +
      invoice.card_visa_amount +
      invoice.card_mastercard_amount +
      invoice.card_amex_amount +
      invoice.cheque_amount +
      invoice.bank_transfer_amount +
      invoice.credit_amount
    );
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4">Sales Orders</Typography>
        {canCreate && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleCreate}
          >
            Create Sales Order
          </Button>
        )}
      </Box>

      <Paper sx={{ mb: 3, p: 2 }}>
        <TextField
          fullWidth
          placeholder="Search sales orders by invoice number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Invoice No</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Branch</TableCell>
              <TableCell>Payment Method</TableCell>
              <TableCell>Total Amount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : invoices?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  No sales orders found
                </TableCell>
              </TableRow>
            ) : (
              invoices?.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>{invoice.invoice_no}</TableCell>
                  <TableCell>
                    {format(new Date(invoice.created_date), "MMM dd, yyyy")}
                  </TableCell>
                  <TableCell>{invoice.branch_code}</TableCell>
                  <TableCell>
                    <Chip label={invoice.payment_method} size="small" />
                  </TableCell>
                  <TableCell>${calculateTotal(invoice).toFixed(2)}</TableCell>
                  <TableCell>
                    <Chip
                      label={invoice.status ? "Active" : "Inactive"}
                      size="small"
                      color={invoice.status ? "success" : "default"}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {canView && (
                      <IconButton
                        size="small"
                        onClick={() => handleView(invoice)}
                      >
                        <ViewIcon />
                      </IconButton>
                    )}
                    {canDelete && (
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDelete(invoice.id)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <SalesOrderDialog
        open={dialogOpen}
        invoice={selectedInvoice}
        onClose={() => setDialogOpen(false)}
      />
    </Box>
  );
}
