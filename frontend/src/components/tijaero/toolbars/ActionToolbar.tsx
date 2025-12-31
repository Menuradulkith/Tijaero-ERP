/**
 * ActionToolbar - Tijaero-style action toolbar component
 * 
 * Provides a consistent toolbar with:
 * - Add new button
 * - Duplicate button
 * - Delete button
 * - Save/Cancel buttons (when editing)
 * - Edit button (when viewing)
 * - Custom actions
 */

import React from "react";
import {
  Box,
  Button,
  IconButton,
  Tooltip,
  Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import CancelIcon from "@mui/icons-material/Cancel";
import EditIcon from "@mui/icons-material/Edit";
import { ActionToolbarProps } from "../types";

export const ActionToolbar: React.FC<ActionToolbarProps> = ({
  canCreate = true,
  canUpdate = true,
  canDelete = true,
  canDuplicate = true,
  hasSelectedItem,
  hasSelection,
  isCreating,
  isEditing,
  isSaving = false,
  isFormValid = true,
  saveDisabled,
  onNew,
  onAdd,
  onDuplicate,
  onDelete,
  onSave,
  onCancel,
  onEdit,
  startActions,
  endActions,
  customActions,
  showDivider = true,
  sx,
}) => {
  // Support both hasSelectedItem and hasSelection
  const hasItem = hasSelectedItem ?? hasSelection ?? false;
  // Support both onNew and onAdd
  const handleAdd = onNew ?? onAdd;
  // Support both isFormValid and saveDisabled (inverted)
  const canSave = saveDisabled !== undefined ? !saveDisabled : isFormValid;
  // Support both endActions and customActions
  const customEnd = endActions ?? customActions;

  return (
    <Box
      sx={{
        p: 1,
        display: "flex",
        gap: 1,
        borderBottom: 1,
        borderColor: "divider",
        flexWrap: "wrap",
        alignItems: "center",
        ...sx,
      }}
    >
      {/* Custom Start Actions */}
      {startActions}

      {/* Add New Button */}
      {canCreate && handleAdd && (
        <Tooltip title="Add New">
          <IconButton size="small" onClick={handleAdd} color="primary">
            <AddIcon />
          </IconButton>
        </Tooltip>
      )}

      {/* Duplicate Button */}
      {canDuplicate && onDuplicate && (
        <Tooltip title="Duplicate">
          <span>
            <IconButton
              size="small"
              disabled={!hasItem || isCreating}
              onClick={onDuplicate}
            >
              <ContentCopyIcon />
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Delete Button */}
      {canDelete && onDelete && (
        <Tooltip title="Delete">
          <span>
            <IconButton
              size="small"
              disabled={!hasItem || isCreating}
              onClick={onDelete}
              color="error"
            >
              <DeleteIcon />
            </IconButton>
          </span>
        </Tooltip>
      )}

      {/* Divider */}
      {showDivider && (isEditing || isCreating || (!isEditing && !isCreating && hasItem && canUpdate)) && (
        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
      )}

      {/* Save/Cancel Buttons (Edit/Create Mode) */}
      {(isEditing || isCreating) && (
        <>
          {onSave && (
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<SaveIcon />}
              onClick={onSave}
              disabled={!canSave || isSaving}
            >
              {isSaving ? "Saving..." : "Save"}
            </Button>
          )}
          {onCancel && (
            <Button
              size="small"
              variant="contained"
              color="error"
              startIcon={<CancelIcon />}
              onClick={onCancel}
            >
              {isCreating ? "Cancel New" : "Cancel"}
            </Button>
          )}
        </>
      )}

      {/* Edit Button (View Mode) */}
      {!isEditing && !isCreating && hasItem && canUpdate && onEdit && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<EditIcon />}
          onClick={onEdit}
        >
          Edit
        </Button>
      )}

      {/* Custom End Actions */}
      {customEnd}
    </Box>
  );
};

export default ActionToolbar;
