/**
 * TFormActions - Standardized form action buttons
 * 
 * Action buttons for form pages with consistent styling.
 * 
 * @example
 * ```tsx
 * <TFormActions
 *   onSave={handleSubmit}
 *   onCancel={handleCancel}
 *   isSaving={mutation.isPending}
 *   saveDisabled={!isValid}
 * />
 * ```
 */

import React from "react";
import { Box, Divider } from "@mui/material";
import { TButton } from "../base/TButton";
import { TIconButton } from "../base/TIconButton";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import CancelIcon from "@mui/icons-material/Cancel";
import EditIcon from "@mui/icons-material/Edit";

export interface TFormActionsProps {
  /** Mode: edit, create, or view */
  mode?: "edit" | "create" | "view";
  /** Can create new items */
  canCreate?: boolean;
  /** Can update items */
  canUpdate?: boolean;
  /** Can delete items */
  canDelete?: boolean;
  /** Can duplicate items */
  canDuplicate?: boolean;
  /** Has selected item */
  hasSelection?: boolean;
  /** Saving in progress */
  isSaving?: boolean;
  /** Save button disabled */
  saveDisabled?: boolean;
  /** Callbacks */
  onNew?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  onEdit?: () => void;
  /** Custom actions at start */
  startActions?: React.ReactNode;
  /** Custom actions at end */
  endActions?: React.ReactNode;
  /** Compact mode (icon buttons only for CRUD) */
  compact?: boolean;
  /** Position */
  position?: "top" | "bottom" | "inline";
  /** Custom styles */
  sx?: Record<string, unknown>;
}

export const TFormActions: React.FC<TFormActionsProps> = ({
  mode = "view",
  canCreate = true,
  canUpdate = true,
  canDelete = true,
  canDuplicate = false,
  hasSelection = false,
  isSaving = false,
  saveDisabled = false,
  onNew,
  onDuplicate,
  onDelete,
  onSave,
  onCancel,
  onEdit,
  startActions,
  endActions,
  compact = true,
  position = "top",
  sx,
}) => {
  const isEditing = mode === "edit" || mode === "create";

  const containerSx = {
    display: "flex",
    alignItems: "center",
    gap: 1,
    p: position === "inline" ? 0 : 1,
    borderBottom: position === "top" ? 1 : 0,
    borderTop: position === "bottom" ? 1 : 0,
    borderColor: "divider",
    flexWrap: "wrap",
    ...sx,
  };

  return (
    <Box sx={containerSx}>
      {/* Custom Start Actions */}
      {startActions}

      {/* Create New */}
      {canCreate && onNew && (
        compact ? (
          <TIconButton tooltip="Add New" color="primary" onClick={onNew}>
            <AddIcon />
          </TIconButton>
        ) : (
          <TButton variant="primary" startIcon={<AddIcon />} onClick={onNew}>
            New
          </TButton>
        )
      )}

      {/* Duplicate */}
      {canDuplicate && onDuplicate && (
        compact ? (
          <TIconButton
            tooltip="Duplicate"
            onClick={onDuplicate}
            disabled={!hasSelection || mode === "create"}
          >
            <ContentCopyIcon />
          </TIconButton>
        ) : (
          <TButton
            variant="outlined"
            startIcon={<ContentCopyIcon />}
            onClick={onDuplicate}
            disabled={!hasSelection || mode === "create"}
          >
            Duplicate
          </TButton>
        )
      )}

      {/* Delete */}
      {canDelete && onDelete && (
        compact ? (
          <TIconButton
            tooltip="Delete"
            color="danger"
            onClick={onDelete}
            disabled={!hasSelection || mode === "create"}
          >
            <DeleteIcon />
          </TIconButton>
        ) : (
          <TButton
            variant="danger"
            startIcon={<DeleteIcon />}
            onClick={onDelete}
            disabled={!hasSelection || mode === "create"}
          >
            Delete
          </TButton>
        )
      )}

      {/* Divider between CRUD and Edit/Save actions */}
      {isEditing && (onNew || onDuplicate || onDelete) && (
        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
      )}

      {/* Edit Mode: Save/Cancel */}
      {isEditing && (
        <>
          {onSave && (
            <TButton
              variant="success"
              startIcon={<SaveIcon />}
              onClick={onSave}
              loading={isSaving}
              disabled={saveDisabled}
            >
              {isSaving ? "Saving..." : "Save"}
            </TButton>
          )}
          {onCancel && (
            <TButton
              variant="danger"
              startIcon={<CancelIcon />}
              onClick={onCancel}
            >
              Cancel
            </TButton>
          )}
        </>
      )}

      {/* View Mode: Edit button */}
      {mode === "view" && hasSelection && canUpdate && onEdit && (
        <TButton variant="outlined" startIcon={<EditIcon />} onClick={onEdit}>
          Edit
        </TButton>
      )}

      {/* Spacer */}
      <Box sx={{ flex: 1 }} />

      {/* Custom End Actions */}
      {endActions}
    </Box>
  );
};

export default TFormActions;
