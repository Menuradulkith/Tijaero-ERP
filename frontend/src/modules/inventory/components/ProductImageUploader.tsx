/**
 * ProductImageUploader - Browse/preview/remove control for a product's
 * image, uploaded via POST /inventory/products/{id}/image.
 *
 * Mirrors SupplierLogoUploader (frontend/src/modules/purchasing/components)
 * so product images and supplier logos share the same upload UX.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, IconButton, Tooltip } from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import DeleteIcon from "@mui/icons-material/Delete";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import { showErrorToast, showSuccessToast, handleApiError } from "@/components/tijaero";
import { productsApi, productImageUrl } from "../api";
import { Product } from "../types";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

interface ProductImageUploaderProps {
  /** The saved product to upload/remove the image against. Omit while
   * creating a brand-new product that has no id yet — pass draftFile /
   * onDraftFileChange instead so the file is held locally and uploaded
   * once the product itself has been saved. */
  product?: Product;
  disabled?: boolean;
  onUpdated?: (product: Product) => void;
  /** Draft mode (no product id yet): the currently-selected local file. */
  draftFile?: File | null;
  /** Draft mode: called with the newly-picked file (or null on remove). */
  onDraftFileChange?: (file: File | null) => void;
}

export default function ProductImageUploader({
  product,
  disabled = false,
  onUpdated,
  draftFile,
  onDraftFileChange,
}: ProductImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const isDraftMode = !product;

  // The local preview belongs to one product only. Clear it when a different
  // product is shown, so product B never displays product A's in-flight or
  // failed upload, and remember which product is current so a late upload
  // response for A doesn't touch B's preview/spinner.
  const currentProductIdRef = useRef<number | undefined>(product?.id);
  useEffect(() => {
    currentProductIdRef.current = product?.id;
    setPreviewUrl(null);
    setUploading(false);
  }, [product?.id]);

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
    : (previewUrl ?? productImageUrl(product?.image_url));

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

    const productId = product!.id;
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setUploading(true);
    try {
      const updated = await productsApi.uploadImage(productId, file);
      // onUpdated guards its own selection; always let it run.
      onUpdated?.(updated);
      showSuccessToast("Image uploaded");
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to upload image"));
    } finally {
      // Hand display back to the saved image_url (the object URL is revoked
      // below, so keeping it as the preview would show a dead blob).
      if (currentProductIdRef.current === productId) {
        setPreviewUrl(null);
        setUploading(false);
      }
      URL.revokeObjectURL(objectUrl);
    }
  };

  const handleRemove = async () => {
    if (isDraftMode) {
      onDraftFileChange?.(null);
      return;
    }
    const productId = product!.id;
    setUploading(true);
    try {
      const updated = await productsApi.removeImage(productId);
      onUpdated?.(updated);
      showSuccessToast("Image removed");
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to remove image"));
    } finally {
      if (currentProductIdRef.current === productId) {
        setPreviewUrl(null);
        setUploading(false);
      }
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
            alt={`${product?.name || "Product"} image`}
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
          <Tooltip title="Remove image">
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
