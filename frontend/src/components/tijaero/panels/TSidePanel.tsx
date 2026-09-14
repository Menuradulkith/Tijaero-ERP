/**
 * TSidePanel - Right-side slide-in panel for create/edit/view forms
 *
 * A single panel that serves Add, Edit, and read-only View for a record,
 * matching the IFS Cloud "Add Supplier Contact" panel pattern: a full-height
 * drawer sliding in from the right, a title bar with a close (X) button,
 * scrollable sectioned content (pair with TFormSection), and a footer action
 * bar. Which mode is active is left to the caller — TSidePanel only renders
 * the chrome; disable fields yourself when `readOnly` is true.
 *
 * @example
 * ```tsx
 * <TSidePanel
 *   open={dialogOpen}
 *   onClose={handleClose}
 *   title={editing ? "Edit Contact Person" : "Add Contact Person"}
 *   onSubmit={handleSave}
 *   isSubmitting={saving}
 *   submitDisabled={!form.full_name}
 * >
 *   <TFormSection title="Contact" variant="plain" columns={3}>
 *     ...fields...
 *   </TFormSection>
 *   <TFormSection title="Communication Methods" variant="plain" columns={3}>
 *     ...fields...
 *   </TFormSection>
 * </TSidePanel>
 * ```
 */

import React from "react";
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Divider,
  Stack,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { TButton } from "../base/TButton";

export interface TSidePanelProps {
  /** Panel open state */
  open: boolean;
  /** Close handler (X button, backdrop click, Cancel) */
  onClose: () => void;
  /** Panel title, e.g. "Add Contact Person" / "Edit Contact Person" / "Contact Person Details" */
  title: string;
  /** Submit handler. Omit to render the panel as read-only (view mode) with no Save button. */
  onSubmit?: () => void;
  /** Submit button loading state */
  isSubmitting?: boolean;
  /** Submit button disabled state */
  submitDisabled?: boolean;
  /** Submit button text */
  submitText?: string;
  /** Cancel/Close button text */
  cancelText?: string;
  /** Panel width */
  width?: number | string;
  /** Panel content — pair with TFormSection for the sectioned/grouped layout */
  children: React.ReactNode;
  /** Custom footer actions (overrides the default Cancel/Save pair) */
  actions?: React.ReactNode;
  /** Extra actions rendered before the default Cancel/Save pair (e.g. an Edit button in view mode) */
  extraActions?: React.ReactNode;
}

export const TSidePanel: React.FC<TSidePanelProps> = ({
  open,
  onClose,
  title,
  onSubmit,
  isSubmitting = false,
  submitDisabled = false,
  submitText = "Save",
  cancelText = "Cancel",
  width = 480,
  children,
  actions,
  extraActions,
}) => {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      // Explicit z-index above the floating chat-agent launcher (which sets
      // zIndex: theme.zIndex.drawer + 2, see features/chat-agent/ChatWidget.tsx)
      // so this panel's footer buttons are never obscured by it.
      sx={{ zIndex: (t) => t.zIndex.drawer + 10 }}
    >
      <Box
        sx={{
          width: { xs: "100vw", sm: width },
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
        role="presentation"
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 3,
            py: 2,
          }}
        >
          <Typography variant="h6" fontWeight={600}>
            {title}
          </Typography>
          <IconButton size="small" onClick={onClose} disabled={isSubmitting} aria-label="close">
            <CloseIcon />
          </IconButton>
        </Box>
        <Divider />

        {/* Scrollable sectioned content */}
        <Box sx={{ flex: 1, overflowY: "auto", px: 3, py: 2 }}>
          <Stack spacing={2}>{children}</Stack>
        </Box>

        <Divider />

        {/* Footer */}
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, px: 3, py: 2 }}>
          {actions || (
            <>
              {extraActions}
              <TButton variant="secondary" onClick={onClose} disabled={isSubmitting}>
                {cancelText}
              </TButton>
              {onSubmit && (
                <TButton
                  variant="primary"
                  onClick={onSubmit}
                  loading={isSubmitting}
                  disabled={submitDisabled}
                >
                  {submitText}
                </TButton>
              )}
            </>
          )}
        </Box>
      </Box>
    </Drawer>
  );
};

export default TSidePanel;
