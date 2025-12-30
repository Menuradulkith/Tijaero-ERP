import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { SalesReportRequest } from "@/modules/reporting/types";

export default function SalesReportPage() {
  const [filters, setFilters] = useState<SalesReportRequest>({
    start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    end_date: new Date().toISOString().split("T")[0],
  });

  const {
    data: report,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["sales-report", filters],
    queryFn: () => reportingApi.getSalesReport(filters),
    enabled: false,
  });

  const handleGenerate = () => {
    refetch();
  };

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Sales Report
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Report Filters
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={3}>
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
          <Grid item xs={12} sm={6} md={3}>
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
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              label="Branch Code (Optional)"
              fullWidth
              value={filters.branch_code || ""}
              onChange={(e) =>
                setFilters({ ...filters, branch_code: e.target.value })
              }
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Button
              variant="contained"
              fullWidth
              onClick={handleGenerate}
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
                    Total Sales
                  </Typography>
                  <Typography variant="h4" fontWeight="bold">
                    ${report.total_sales.toFixed(2)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography color="text.secondary" gutterBottom>
                    Total Orders
                  </Typography>
                  <Typography variant="h4" fontWeight="bold">
                    {report.total_orders}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography color="text.secondary" gutterBottom>
                    Total Customers
                  </Typography>
                  <Typography variant="h4" fontWeight="bold">
                    {report.total_customers}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Card>
                <CardContent>
                  <Typography color="text.secondary" gutterBottom>
                    Avg Order Value
                  </Typography>
                  <Typography variant="h4" fontWeight="bold">
                    ${report.average_order_value.toFixed(2)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Top Products
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Product Name</TableCell>
                    <TableCell align="right">Quantity Sold</TableCell>
                    <TableCell align="right">Revenue</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.top_products.map((product, index) => (
                    <TableRow key={index}>
                      <TableCell>{product.product_name}</TableCell>
                      <TableCell align="right">
                        {product.quantity_sold}
                      </TableCell>
                      <TableCell align="right">
                        ${product.revenue.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Sales by Branch
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Branch Code</TableCell>
                    <TableCell align="right">Orders</TableCell>
                    <TableCell align="right">Revenue</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {report.sales_by_branch.map((branch, index) => (
                    <TableRow key={index}>
                      <TableCell>{branch.branch_code}</TableCell>
                      <TableCell align="right">{branch.orders}</TableCell>
                      <TableCell align="right">
                        ${branch.revenue.toFixed(2)}
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
