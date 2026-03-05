import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fmtLKR } from "@/components/tijaero";
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import { reportingApi } from "@/modules/reporting/api";
import { FinanceReportRequest } from "@/modules/reporting/types";

export default function FinanceReportPage() {
  const [filters, setFilters] = useState<FinanceReportRequest>({
    start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    end_date: new Date().toISOString().split("T")[0],
    report_type: "summary",
  });

  const {
    data: report,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["finance-report", filters],
    queryFn: () => reportingApi.getFinanceReport(filters),
    enabled: false,
  });

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Finance Report
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            <TextField
              label="Start Date"
              type="date"
              fullWidth
              value={filters.start_date}
              onChange={(e) =>
                setFilters({ ...filters, start_date: e.target.value })
              }
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              label="End Date"
              type="date"
              fullWidth
              value={filters.end_date}
              onChange={(e) =>
                setFilters({ ...filters, end_date: e.target.value })
              }
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <Button
              variant="contained"
              fullWidth
              onClick={() => refetch()}
              disabled={isLoading}
              sx={{ height: "56px" }}
            >
              Generate Report
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {report && (
        <>
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography color="text.secondary" gutterBottom>
                    Total Income
                  </Typography>
                  <Typography
                    variant="h4"
                    fontWeight="bold"
                    color="success.main"
                  >
                    Rs. {report.total_income.toFixed(2)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography color="text.secondary" gutterBottom>
                    Total Expenses
                  </Typography>
                  <Typography variant="h4" fontWeight="bold" color="error.main">
                    Rs. {report.total_expenses.toFixed(2)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography color="text.secondary" gutterBottom>
                    Net Profit
                  </Typography>
                  <Typography
                    variant="h4"
                    fontWeight="bold"
                    color={
                      report.net_profit >= 0 ? "success.main" : "error.main"
                    }
                  >
                    Rs. {report.net_profit.toFixed(2)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography color="text.secondary" gutterBottom>
                    Bank Deposits
                  </Typography>
                  <Typography variant="h4" fontWeight="bold">
                    Rs. {report.bank_deposits.toFixed(2)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              Expenses by Category
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Category</TableCell>
                    <TableCell align="right">Amount (Rs.)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.expenses_by_category.map((expense, index) => (
                    <TableRow key={index}>
                      <TableCell>{expense.category}</TableCell>
                      <TableCell align="right">
                        {fmtLKR(expense.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </>
      )}
    </Box>
  );
}
