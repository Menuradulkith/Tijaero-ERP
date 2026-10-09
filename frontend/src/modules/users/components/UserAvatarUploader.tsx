/**
 * UserAvatarUploader - Browse/preview/remove control for a user's profile
 * picture, uploaded via POST /users/{id}/profile-picture. Same layout as the
 * supplier logo control: while creating a brand-new user (no id yet) the
 * picked file is held locally (draftFile) and uploaded once the user is saved.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, IconButton, Tooltip } from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import DeleteIcon from "@mui/icons-material/Delete";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
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
  /** The saved user to upload/remove the picture against. Omit while
   * creating a new user - pass draftFile / onDraftFileChange instead. */
  user?: { id: number; profile_picture_path?: string; username: string };
  disabled?: boolean;
  /** Called with the new profile_picture_path (null after removal) so the caller can update its own state. */
  onUpdated?: (profilePicturePath: string | null) => void;
  /** Draft mode (no user id yet): the currently-selected local file. */
  draftFile?: File | null;
  /** Draft mode: called with the newly-picked file (or null on remove). */
  onDraftFileChange?: (file: File | null) => void;
}

export default function UserAvatarUploader({
  user,
  disabled = false,
  onUpdated,
  draftFile,
  onDraftFileChange,
}: UserAvatarUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const isDraftMode = !user;

  // The local preview belongs to one user only: clear it when a different
  // user is shown, and remember which one is current so a late response for
  // one user does not touch another user's preview/spinner.
  const currentUserIdRef = useRef<number | undefined>(user?.id);
  useEffect(() => {
    currentUserIdRef.current = user?.id;
    setPreviewUrl(null);
    setUploading(false);
  }, [user?.id]);

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
    : (previewUrl ?? profilePictureUrl(user?.profile_picture_path) ?? null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      showErrorToast("Unsupported image type. Use PNG, JPEG, WEBP, or SVG.");
      return;
    }

    if (isDraftMode) {
      onDraftFileChange?.(file);
      return;
    }

    const userId = user!.id;
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setUploading(true);
    try {
      const updated = await usersApi.uploadProfilePicture(userId, file);
      onUpdated?.(updated.profile_picture_path ?? null);
      showSuccessToast("Profile picture uploaded");
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to upload profile picture"));
    } finally {
      // Hand display back to the saved path (the object URL is revoked below).
      if (currentUserIdRef.current === userId) {
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
    const userId = user!.id;
    setUploading(true);
    try {
      await usersApi.removeProfilePicture(userId);
      onUpdated?.(null);
      showSuccessToast("Profile picture removed");
    } catch (err) {
      showErrorToast(handleApiError(err, "Failed to remove profile picture"));
    } finally {
      if (currentUserIdRef.current === userId) {
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
            alt={`${user?.username || "User"} profile picture`}
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
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
        >
          Browse
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
