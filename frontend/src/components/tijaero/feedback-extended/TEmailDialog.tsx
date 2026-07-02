import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  CircularProgress,
  Box,
  Alert,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import apiClient from "@/api/client";
import { showSuccessToast, showErrorToast, showWarningToast } from "@/components/tijaero";

export interface TEmailDialogProps {
  open: boolean;
  onClose: () => void;
  documentType: string;
  documentId: number;
}

export function TEmailDialog({
  open,
  onClose,
  documentType,
  documentId,
}: TEmailDialogProps) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  
  const [formData, setFormData] = useState({
    to_email: "",
    cc_email: "",
    subject: "",
    body: "",
  });

  useEffect(() => {
    if (open) {
      setLoading(true);
      apiClient
        .get(`/communication/email-draft/${documentType}/${documentId}`)
        .then((res) => {
          setFormData({
            to_email: res.data.to_email || "",
            cc_email: res.data.cc_email || "",
            subject: res.data.subject || "",
            body: res.data.body || "",
          });
        })
        .catch((err) => {
          console.error(err);
          showErrorToast("Failed to load email draft");
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, documentType, documentId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSend = () => {
    if (!formData.to_email) {
      showWarningToast("To Email is required");
      return;
    }
    setSending(true);
    apiClient
      .post("/communication/email/send", {
        document_type: documentType,
        document_id: documentId,
        to_email: formData.to_email,
        cc_email: formData.cc_email || null,
        subject: formData.subject,
        body: formData.body,
      })
      .then(() => {
        showSuccessToast("Email queued for sending");
        onClose();
      })
      .catch((err) => {
        console.error(err);
        showErrorToast("Failed to send email");
      })
      .finally(() => {
        setSending(false);
      });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Send {documentType.replace('-', ' ').toUpperCase()} via Email</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        ) : (
          <Box display="flex" flexDirection="column" gap={2}>
            <Alert severity="info" sx={{ mb: 1 }}>
              The document will be automatically attached as a PDF.
            </Alert>
            <TextField
              label="To Email"
              name="to_email"
              type="email"
              fullWidth
              value={formData.to_email}
              onChange={handleChange}
              required
            />
            <TextField
              label="Cc Email (Optional)"
              name="cc_email"
              type="email"
              fullWidth
              value={formData.cc_email}
              onChange={handleChange}
            />
            <TextField
              label="Subject"
              name="subject"
              fullWidth
              value={formData.subject}
              onChange={handleChange}
              required
            />
            <TextField
              label="Body"
              name="body"
              multiline
              rows={8}
              fullWidth
              value={formData.body}
              onChange={handleChange}
              required
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="primary"
          startIcon={sending ? <CircularProgress size={20} /> : <SendIcon />}
          onClick={handleSend}
          disabled={loading || sending || !formData.to_email}
        >
          Send Email
        </Button>
      </DialogActions>
    </Dialog>
  );
}
