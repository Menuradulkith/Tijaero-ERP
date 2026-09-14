/**
 * SupplierLogoUploader - Browse/preview/remove control for a supplier's
 * company logo, uploaded via POST /purchasing/suppliers/{id}/logo.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, IconButton, Tooltip, Typography } from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import DeleteIcon from "@mui/icons-material/Delete";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import { showErrorToast, showSuccessToast, handleApiError } from "@/components/tijaero";
import { suppliersApi } from "@/modules/purchasing/api";
import { Supplier } from "@/modules/purchasing/types";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

// The API client's baseURL includes /api/v1; uploaded files are served from
// the plain origin at /uploads, so strip /api/v1 the same way TPrintButton does.
const API_ORIGIN = (
  import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1"
).replace(/\/api\/v1$/, "");

function logoUrl(logoPath?: string): string | null {
  return logoPath ? `${API_ORIGIN}/uploads/${logoPath}` : null;
}

interface SupplierLogoUploaderProps {
  /** The saved supplier to upload/remove the logo against. Omit while
   * creating a brand-new supplier that has no id yet — pass draftFile /
   * onDraftFileChange instead so the file is held locally and uploaded
   * once the supplier itself has been saved. */
  supplier?: Supplier;
  disabled?: boolean;
  onUpdated?: (supplier: Supplier) => void;
  /** Draft mode (no supplier id yet): the currently-selected local file. */
  draftFile?: File | null;
  /** Draft mode: called with the newly-picked file (or null on remove). */
  onDraftFileChange?: (file: File | null) => void;
}

export default function SupplierLogoUploader({
  supplier,
  disabled = false,
  onUpdated,
  draftFile,
  onDraftFileChange,
}: SupplierLogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const isDraftMode = !supplier;

  // In draft mode, derive the preview straight from the picked File so it
  // survives re-renders without needing a separately-tracked object URL.
  const draftPreviewUrl = useMemo(
    () => (draftFile ? URL.createObjectURL(draftFile) : null),
    [draftFile]
  );
  useEffect(() => {
    return () => {
      if (draftPreviewUrl) URL.revokeObjectURL(draftPreviewUrl);
    };
  }, [draftPreviewUrl]);

  const currentUrl = isDraftMode
    ? draftPreviewUrl
    : (previewUrl ?? logoUrl(supplier?.logo_path));

  const handleBrowseClick = () => {
    inputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      showErrorToast("Unsupported image type. Use PNG, JPEG, WEBP, or SVG.");
      return;
    }

    if (isDraftMode) {
      onDraftFileChange?.(file);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setUploading(true);
    try {
      const updated = await suppliersApi.uploadLogo(supplier!.id, file);
      onUpdated?.(updated);
      showSuccessToast("Logo uploaded");
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to upload logo"));
      setPreviewUrl(null);
    } finally {
      URL.revokeObjectURL(objectUrl);
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (isDraftMode) {
      onDraftFileChange?.(null);
      return;
    }
    setUploading(true);
    try {
      const updated = await suppliersApi.removeLogo(supplier!.id);
      setPreviewUrl(null);
      onUpdated?.(updated);
      showSuccessToast("Logo removed");
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to remove logo"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        p: 2,
      }}
    >
      <Box
        sx={{
          flex: 1,
          height: 96,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "action.hover",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        {currentUrl ? (
          <Box
            component="img"
            src={currentUrl}
            alt={`${supplier?.company_name || "Company"} logo`}
            sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          />
        ) : (
          <ImageOutlinedIcon sx={{ fontSize: 48, color: "text.disabled" }} />
        )}
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={ALLOWED_TYPES.join(",")}
          onChange={handleFileChange}
        />
        <Button
          variant="outlined"
          size="small"
          startIcon={<FolderOpenIcon />}
          onClick={handleBrowseClick}
          disabled={disabled || uploading}
        >
          Browse
        </Button>
        {currentUrl && (
          <Tooltip title="Remove logo">
            <span>
              <IconButton size="small" onClick={handleRemove} disabled={disabled || uploading}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}
