import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  Chip,
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { settingsApi } from "../api";
import { showErrorToast } from "@/components/tijaero";
import { formatDateTimeReadable } from "@/utils/formatters";

export default function EmailLogsSettings() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getEmailLogs();
      setLogs(data);
    } catch (error) {
      console.error(error);
      showErrorToast("Failed to load email logs");
    } finally {
      setLoading(false);
    }
  };

  const columns: GridColDef[] = [
    { 
      field: "created_date", 
      headerName: "Queued At", 
      width: 170,
      valueFormatter: (value: any) => value ? formatDateTimeReadable(value) : ""
    },
    { field: "document_type", headerName: "Type", width: 150 },
    { field: "document_id", headerName: "ID", width: 90 },
    { field: "sender_name", headerName: "Sent By", width: 150 },
    { field: "to_email", headerName: "To", width: 200 },
    { field: "subject", headerName: "Subject", width: 250 },
    { 
      field: "status", 
      headerName: "Status", 
      width: 120,
      renderCell: (params) => {
        const status = params.value;
        const color = status === "sent" ? "success" : status === "failed" ? "error" : "default";
        return <Chip label={status} color={color} size="small" />;
      }
    },
    { 
      field: "sent_at", 
      headerName: "Sent At", 
      width: 170,
      valueFormatter: (value: any) => value ? formatDateTimeReadable(value) : ""
    },
    { field: "error_message", headerName: "Error", width: 200 },
  ];

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Email Logs
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Audit trail of all emails sent by the system via background workers.
      </Typography>

      <Card>
        <CardContent sx={{ height: 600 }}>
          <DataGrid
            rows={logs}
            columns={columns}
            disableRowSelectionOnClick
            pageSizeOptions={[10, 25, 50]}
            initialState={{
              pagination: { paginationModel: { pageSize: 25 } },
              sorting: {
                sortModel: [{ field: "created_date", sort: "desc" }],
              },
            }}
          />
        </CardContent>
      </Card>
    </Box>
  );
}
