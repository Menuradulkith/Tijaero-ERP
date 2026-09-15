/**
 * UserAvatarUploader - Browse/preview/remove control for a user's profile
 * picture, uploaded via POST /users/{id}/profile-picture.
 */
import { useRef, useState } from "react";
import { Avatar, Box, Button, IconButton, Tooltip } from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import DeleteIcon from "@mui/icons-material/Delete";
import { showErrorToast, showSuccessToast, handleApiError } from "@/components/tijaero";
import { usersApi } from "../api";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

// The API client's baseURL includes /api/v1; uploaded files are served from
// the plain origin at /uploads, so strip /api/v1 the same way other
// uploaders (e.g. SupplierLogoUploader) do.
const API_ORIGIN = (
  import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1"
).replace(/\/api\/v1$/, "");

export function profilePictureUrl(path?: string): string | undefined {
  return path ? `${API_ORIGIN}/uploads/${path}` : undefined;
}

interface UserAvatarUploaderProps {
  user: { id: number; profile_picture_path?: string; username: string };
  disabled?: boolean;
  /** Called with the new profile_picture_path (null after removal) so the caller can update its own state. */
  onUpdated?: (profilePicturePath: string | null) => void;
}

export default function UserAvatarUploader({ user, disabled = false, onUpdated }: UserAvatarUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const currentUrl = previewUrl ?? profilePictureUrl(user.profile_picture_path);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      showErrorToast("Unsupported image type. Use PNG, JPEG, WEBP, or SVG.");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setUploading(true);
    try {
      const updated = await usersApi.uploadProfilePicture(user.id, file);
      onUpdated?.(updated.profile_picture_path ?? null);
      showSuccessToast("Profile picture uploaded");
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to upload profile picture"));
      setPreviewUrl(null);
    } finally {
      URL.revokeObjectURL(objectUrl);
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setUploading(true);
    try {
      await usersApi.removeProfilePicture(user.id);
      setPreviewUrl(null);
      onUpdated?.(null);
      showSuccessToast("Profile picture removed");
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to remove profile picture"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
      <Avatar src={currentUrl} sx={{ width: 64, height: 64, fontSize: "1.5rem" }}>
        {!currentUrl && (user.username?.[0]?.toUpperCase() || "U")}
      </Avatar>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
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
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
        >
          Change Picture
        </Button>
        {currentUrl && (
          <Tooltip title="Remove picture">
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
