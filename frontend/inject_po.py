import os

file_path = r'd:\Dev\TijaeroERP\frontend\src\modules\purchasing\pages\PurchaseOrdersPage.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add TEmailDialog import
content = content.replace(
    '  TPrintPreviewDialog,\n} from "@/components/tijaero";',
    '  TPrintPreviewDialog,\n  TEmailDialog,\n} from "@/components/tijaero";'
)

# 2. Add EmailIcon import
content = content.replace(
    '  FileDownload as DownloadIcon,\n} from "@mui/icons-material";',
    '  FileDownload as DownloadIcon,\n  Email as EmailIcon,\n} from "@mui/icons-material";'
)

# 3. Add emailDialogOpen state
content = content.replace(
    '  const [printDialogOpen, setPrintDialogOpen] = useState(false);\n  const [selectedPoIdForPrint',
    '  const [printDialogOpen, setPrintDialogOpen] = useState(false);\n  const [emailDialogOpen, setEmailDialogOpen] = useState(false);\n  const [selectedPoIdForPrint'
)

# 4. Add Email button
content = content.replace(
    '          selectedOrder && !isCreating && !isEditing ? (\n            <Box sx={{ display: "flex", gap: 1 }}>\n              <TPrintButton',
    '          selectedOrder && !isCreating && !isEditing ? (\n            <Box sx={{ display: "flex", gap: 1 }}>\n              <Tooltip title="Send via Email">\n                <Button size="small" variant="outlined" color="primary" startIcon={<EmailIcon />}\n                  onClick={() => setEmailDialogOpen(true)}>\n                  Email\n                </Button>\n              </Tooltip>\n              <TPrintButton'
)

# 5. Add TEmailDialog component
dialog_code = """
      {/* Email Dialog */}
      {selectedOrder && (
        <TEmailDialog
          open={emailDialogOpen}
          onClose={() => setEmailDialogOpen(false)}
          documentType="purchase-order"
          documentId={selectedOrder.id}
        />
      )}
    </MasterDetailLayout>
"""
content = content.replace('    </MasterDetailLayout>', dialog_code)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done")
