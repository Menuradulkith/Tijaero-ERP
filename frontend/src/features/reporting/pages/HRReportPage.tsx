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
} from "@mui/material";
import { reportingApi } from "@/modules/reporting/api";
import { HRReportRequest } from "@/modules/reporting/types";

export default function HRReportPage() {
  const [filters, setFilters] = useState<HRReportRequest>({
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
    queryKey: ["hr-report", filters],
    queryFn: () => reportingApi.getHRReport(filters),
    enabled: false,
  });

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        HR Report
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
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Total Employees
                </Typography>
                <Typography variant="h4" fontWeight="bold">
                  {report.total_employees}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Total Payroll
                </Typography>
                <Typography variant="h4" fontWeight="bold">
                  ${report.total_payroll.toFixed(2)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Reimbursements
                </Typography>
                <Typography variant="h4" fontWeight="bold">
                  ${report.total_reimbursements.toFixed(2)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>
                  Deductions
                </Typography>
                <Typography variant="h4" fontWeight="bold">
                  ${report.total_deductions.toFixed(2)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
