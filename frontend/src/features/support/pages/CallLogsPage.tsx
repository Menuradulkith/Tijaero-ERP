import { Box, Typography, Paper } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";

export default function CallLogsPage() {
  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "contact_person", headerName: "Contact", width: 150 },
    { field: "comment", headerName: "Comment", width: 300 },
    {
      field: "date",
      headerName: "Date",
      width: 180,
      valueFormatter: (value) =>
        value ? new Date(value).toLocaleString() : "-",
    },
  ];

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Customer Call Logs
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Track customer call history and communications
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
