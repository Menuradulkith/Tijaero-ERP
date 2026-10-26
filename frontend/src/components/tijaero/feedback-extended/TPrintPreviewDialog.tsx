import CloseIcon from "@mui/icons-material/Close";
import PrintIcon from "@mui/icons-material/Print";
import {
    Box,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Switch,
    TextField,
    Typography,
} from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import apiClient from "@/api/client";
import { useAuthStore } from "@/state/authStore";
import { TButton } from "../base/TButton";
import { getReportUrl, TPrintDocumentType } from "../base/TPrintButton";

interface PrintTemplateOption {
    id: number;
    name: string;
    branch_code: string | null;
    show_header: boolean;
    show_discount: boolean;
    show_signatures: boolean;
}

interface PrintTemplatesForDocument {
    default_template_id: number | null;
    show_header: boolean;
    show_discount: boolean;
    show_signatures: boolean;
    templates: PrintTemplateOption[];
}

export interface TPrintPreviewDialogProps {
    open: boolean;
    onClose: () => void;
    documentType: TPrintDocumentType;
    documentId: number;
    title?: string;
}

export const TPrintPreviewDialog: React.FC<TPrintPreviewDialogProps> = ({
    open,
    onClose,
    documentType,
    documentId,
    title = "Print Preview",
}) => {
    const [showHeader, setShowHeader] = useState(false);
    const [showDiscount, setShowDiscount] = useState(true);
    const [showSignatures, setShowSignatures] = useState(false);
    const [customRemarks, setCustomRemarks] = useState("");
    const [templates, setTemplates] = useState<PrintTemplateOption[]>([]);
    const [templateId, setTemplateId] = useState<number | "">("");
    const token = useAuthStore((s) => s.token);

    // Start from the print template's section switches (Settings → Print Templates).
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        apiClient
            .get<PrintTemplatesForDocument>("/reporting/print-templates/for-document", {
                params: { document_type: documentType, document_id: documentId },
            })
            .then(({ data }) => {
                if (cancelled) return;
                setTemplates(data.templates);
                setTemplateId(data.default_template_id ?? "");
                // No template configured: keep this dialog's own starting switches.
                if (data.default_template_id === null) return;
                setShowHeader(data.show_header);
                setShowDiscount(data.show_discount);
                setShowSignatures(data.show_signatures);
            })
            .catch(() => {
                // Older backend or no access to templates: keep the built-in switches.
            });
        return () => {
            cancelled = true;
        };
    }, [open, documentType, documentId]);

    const handleTemplateChange = (value: number | "") => {
        setTemplateId(value);
        const t = templates.find((x) => x.id === value);
        if (t) {
            setShowHeader(t.show_header);
            setShowDiscount(t.show_discount);
            setShowSignatures(t.show_signatures);
        }
    };

    const reportUrl = useMemo(() => {
        const baseUrl = getReportUrl(documentType, documentId);
        // Parse the URL to add more query parameters
        const urlObj = new URL(baseUrl, 'http://localhost');
        
        // Add additional parameters (token is already in baseUrl from getReportUrl)
        urlObj.searchParams.append("show_header", String(showHeader));
        urlObj.searchParams.append("show_discount", String(showDiscount));
        urlObj.searchParams.append("show_signatures", String(showSignatures));
        if (templateId !== "") urlObj.searchParams.append("template_id", String(templateId));
        if (customRemarks) urlObj.searchParams.append("custom_remarks", customRemarks);

        urlObj.searchParams.append("t", Date.now().toString());

        // Return relative path
        return urlObj.pathname + urlObj.search;
    }, [documentType, documentId, showHeader, showDiscount, showSignatures, templateId, customRemarks, token]);

    const handlePrint = () => {
        const printUrl = new URL(reportUrl, window.location.origin);
        printUrl.pathname = `${printUrl.pathname}/pdf`;
        window.open(printUrl.toString().replace(window.location.origin, ""), "_blank");
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="lg"
            fullWidth
            PaperProps={{
                sx: { height: "90vh", display: "flex", flexDirection: "column" },
            }}
        >
            <DialogTitle
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    py: 1.5,
                    px: 2,
                    bgcolor: "grey.50",
                    borderBottom: 1,
                    borderColor: "divider"
                }}
            >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <PrintIcon color="primary" />
                    <Typography variant="h6" component="div">
                        {title}
                    </Typography>
                </Box>
                <IconButton onClick={onClose} size="small">
                    <CloseIcon />
                </IconButton>
            </DialogTitle>

            <DialogContent sx={{ p: 0, display: "flex", flex: 1, overflow: "hidden" }}>

                {/* Left Sidebar: Controls */}
                <Box
                    sx={{
                        width: 320,
                        borderRight: 1,
                        borderColor: "divider",
                        bgcolor: "background.paper",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "auto"
                    }}
                >
                    {templates.length > 1 && (
                        <Box sx={{ p: 2, pb: 0 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel>Layout</InputLabel>
                                <Select
                                    label="Layout"
                                    value={templateId}
                                    onChange={(e) => handleTemplateChange(e.target.value as number | "")}
                                >
                                    {templates.map((t) => (
                                        <MenuItem key={t.id} value={t.id}>
                                            {t.name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Box>
                    )}

                    <Box sx={{ p: 2 }}>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            Display Options
                        </Typography>

                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={showHeader}
                                        onChange={(e) => setShowHeader(e.target.checked)}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2">Show Letterhead / Background</Typography>}
                            />

                            {(documentType === "quotation" || documentType === "invoice") && (
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={showDiscount}
                                            onChange={(e) => setShowDiscount(e.target.checked)}
                                            size="small"
                                        />
                                    }
                                    label={<Typography variant="body2">Show Discounts</Typography>}
                                />
                            )}

                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={showSignatures}
                                        onChange={(e) => setShowSignatures(e.target.checked)}
                                        size="small"
                                    />
                                }
                                label={<Typography variant="body2">Show Signatures</Typography>}
                            />
                        </Box>
                    </Box>

                    <Divider />

                    <Box sx={{ p: 2 }}>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                            Content
                        </Typography>
                        <TextField
                            label="Additional Remarks"
                            multiline
                            rows={4}
                            fullWidth
                            size="small"
                            value={customRemarks}
                            onChange={(e) => setCustomRemarks(e.target.value)}
                            placeholder="Add temporary notes to this print..."
                            helperText="These notes will appear at the bottom of the document"
                        />
                    </Box>
                </Box>

                {/* Right Pane: Preview */}
                <Box sx={{ flex: 1, bgcolor: "grey.100", p: 2, display: "flex", flexDirection: "column" }}>
                    <Paper
                        elevation={3}
                        sx={{
                            flex: 1,
                            width: "100%",
                            height: "100%",
                            overflow: "hidden",
                            borderRadius: 1
                        }}
                    >
                        <iframe
                            src={reportUrl}
                            width="100%"
                            height="100%"
                            style={{ border: "none" }}
                            title="Print Preview"
                        />
                    </Paper>
                </Box>

            </DialogContent>

            <DialogActions sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: "divider" }}>
                <TButton variant="text" onClick={onClose}>
                    Cancel
                </TButton>
                <TButton
                    variant="primary"
                    startIcon={<PrintIcon />}
                    onClick={handlePrint}
                >
                    Print / Save as PDF
                </TButton>
            </DialogActions>
        </Dialog>
    );
};

export default TPrintPreviewDialog;
