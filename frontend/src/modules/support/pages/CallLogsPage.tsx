import { Box, Paper } from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { TPageHeader } from "@/components/tijaero";

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
      <TPageHeader
        title="Customer Call Logs"
        subtitle="Track customer call history and communications"
      />
      <Paper sx={{ height: 600 }}>
        <DataGrid
          rows={[]}
          columns={columns}
          pageSizeOptions={[10, 25, 50, 100]}
          initialState={{
            pagination: { paginationModel: { pageSize: 10 } },
          }}
        />
      </Paper>
    </Box>
  );
}
