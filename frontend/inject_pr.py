import os

file_path = r'd:\Dev\TijaeroERP\frontend\src\modules\purchasing\pages\PurchaseReturnsPage.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add TEmailDialog import
content = content.replace(
    '  TPrintPreviewDialog,\n} from "@/components/tijaero";',
    '  TPrintPreviewDialog,\n  TEmailDialog,\n} from "@/components/tijaero";'
)

# 2. Add EmailIcon import
content = content.replace(
    '  ThumbDown as RejectIcon,\n} from "@mui/icons-material";',
    '  ThumbDown as RejectIcon,\n  Email as EmailIcon,\n} from "@mui/icons-material";'
)

# 3. Add emailDialogOpen state
content = content.replace(
    '  const [printDialogOpen, setPrintDialogOpen] = useState(false);\n  const [selectedReturnForPrint, setSelectedReturnForPrint]',
    '  const [printDialogOpen, setPrintDialogOpen] = useState(false);\n  const [emailDialogOpen, setEmailDialogOpen] = useState(false);\n  const [selectedReturnForPrint, setSelectedReturnForPrint]'
)

# 4. Add Email button
content = content.replace(
    '          ) : selectedReturn && !isCreating && !isEditing ? (\n            <TPrintButton',
    '          ) : selectedReturn && !isCreating && !isEditing ? (\n            <>\n              <Tooltip title="Send via Email">\n                <Button size="small" variant="outlined" color="primary" startIcon={<EmailIcon />}\n                  onClick={() => setEmailDialogOpen(true)}>\n                  Email\n                </Button>\n              </Tooltip>\n              <TPrintButton'
)
content = content.replace(
    'onClick={() => handlePrint(selectedReturn.id)}\n            />\n          ) : undefined',
    'onClick={() => handlePrint(selectedReturn.id)}\n            />\n            </>\n          ) : undefined'
)

# 5. Add TEmailDialog component
dialog_code = """
      {/* Email Dialog */}
      {selectedReturn && (
        <TEmailDialog
          open={emailDialogOpen}
          onClose={() => setEmailDialogOpen(false)}
          documentType="purchase-return"
          documentId={selectedReturn.id}
        />
      )}
    </MasterDetailLayout>
"""
content = content.replace('    </MasterDetailLayout>', dialog_code)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Done PR")
