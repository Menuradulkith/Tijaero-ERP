import { useQuery } from "@tanstack/react-query";
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Button,
} from "@mui/material";
import { reportingApi } from "@/modules/reporting/api";

export default function InventoryReportPage() {
  const {
    data: report,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["inventory-report"],
    queryFn: () => reportingApi.getInventoryReport({}),
    enabled: false,
  });

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Inventory Report
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Button
          variant="contained"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          Generate Report
        </Button>
      </Paper>

      {report && (
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6} md={4}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Total Products
                </Typography>
                <Typography variant="h4" fontWeight="bold">
                  {report.total_products}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Total Stock Value
                </Typography>
                <Typography variant="h4" fontWeight="bold">
                  ${report.total_stock_value.toFixed(2)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Low Stock Items
                </Typography>
                <Typography variant="h4" fontWeight="bold">
                  {report.low_stock_items.length}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
