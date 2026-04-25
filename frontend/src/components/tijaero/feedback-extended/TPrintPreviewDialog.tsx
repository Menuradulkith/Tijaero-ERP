import CloseIcon from "@mui/icons-material/Close";
import PrintIcon from "@mui/icons-material/Print";
import {
    Box,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControlLabel,
    IconButton,
    Paper,
    Switch,
    TextField,
    Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";
import { useAuthStore } from "@/state/authStore";
import { TButton } from "../base/TButton";
import { getReportUrl, TPrintDocumentType } from "../base/TPrintButton";

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
    const token = useAuthStore((s) => s.token);

    const reportUrl = useMemo(() => {
        const baseUrl = getReportUrl(documentType, documentId);
        const params = new URLSearchParams();

        if (token) params.append("token", token);
        if (!showHeader) params.append("show_header", "false");
        if (!showDiscount) params.append("show_discount", "false");
        if (!showSignatures) params.append("show_signatures", "false");
        if (customRemarks) params.append("custom_remarks", customRemarks);

        params.append("t", Date.now().toString());

        const queryString = params.toString();
        return queryString ? `${baseUrl}?${queryString}` : baseUrl;
    }, [documentType, documentId, showHeader, showDiscount, showSignatures, customRemarks, token]);

    const handlePrint = () => {
        const printUrl = new URL(reportUrl);
        printUrl.pathname = `${printUrl.pathname}/pdf`;
        window.open(printUrl.toString(), "_blank");
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
                                label={<Typography variant="body2">Show Background</Typography>}
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
