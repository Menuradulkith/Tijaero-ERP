import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  TextField,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Card,
  CardContent,
  CircularProgress,
  Alert,
} from "@mui/material";
import { settingsApi } from "../api";
import { showSuccessToast, showErrorToast } from "@/components/tijaero";

export default function EmailTemplatesSettings() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDocType, setSelectedDocType] = useState<string>("");
  const [formData, setFormData] = useState({
    subject_template: "",
    body_template: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getEmailTemplates();
      setTemplates(data);
      if (data.length > 0) {
        handleSelectTemplate(data[0].document_type, data);
      }
    } catch (error) {
      console.error(error);
      showErrorToast("Failed to load email templates");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTemplate = (docType: string, templateList: any[] = templates) => {
    setSelectedDocType(docType);
    const tmpl = templateList.find(t => t.document_type === docType);
    if (tmpl) {
      setFormData({
        subject_template: tmpl.subject_template,
        body_template: tmpl.body_template,
      });
    }
  };

  const handleSave = async () => {
    const tmpl = templates.find(t => t.document_type === selectedDocType);
    if (!tmpl) return;

    try {
      setSaving(true);
      const updated = await settingsApi.updateEmailTemplate(tmpl.id, formData);
      setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t));
      showSuccessToast("Template saved successfully");
    } catch (error) {
      console.error(error);
      showErrorToast("Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box maxWidth="md">
      <Typography variant="h6" gutterBottom>
        Email Templates
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Configure the default subject and body for computer-generated emails sent from the system.
      </Typography>

      <Card sx={{ mb: 4 }}>
        <CardContent>
          <FormControl fullWidth sx={{ mb: 3 }}>
            <InputLabel>Document Type</InputLabel>
            <Select
              value={selectedDocType}
              label="Document Type"
              onChange={(e) => handleSelectTemplate(e.target.value)}
            >
              {templates.map(t => (
                <MenuItem key={t.id} value={t.document_type}>
                  {t.document_type.replace("-", " ").toUpperCase()}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Alert severity="info" sx={{ mb: 3 }}>
            Available dynamic tags: {"{document_id}"}, {"{customer_name}"}, {"{supplier_name}"}
          </Alert>

          <TextField
            fullWidth
            label="Subject Template"
            value={formData.subject_template}
            onChange={(e) => setFormData(prev => ({ ...prev, subject_template: e.target.value }))}
            sx={{ mb: 3 }}
          />

          <TextField
            fullWidth
            label="Body Template"
            multiline
            rows={10}
            value={formData.body_template}
            onChange={(e) => setFormData(prev => ({ ...prev, body_template: e.target.value }))}
            sx={{ mb: 3 }}
          />

          <Box display="flex" justifyContent="flex-end">
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Template"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
