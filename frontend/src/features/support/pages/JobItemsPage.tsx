import { Box, Typography, Paper } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";

export default function JobItemsPage() {
  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "fault_type", headerName: "Fault Type", width: 150 },
    { field: "job_status", headerName: "Status", width: 120 },
    { field: "product_id", headerName: "Product ID", width: 120 },
    { field: "quantity", headerName: "Quantity", width: 100 },
  ];

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Job Items
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Track job items and tasks for support tickets
      </Typography>
      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={[]}
          columns={columns}
          pageSizeOptions={[10, 25, 50]}
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
          }}
        />
      </Paper>
    </Box>
  );
}
