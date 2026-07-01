/**
 * TExportButton - Financial Table CSV Export Button
 * 
 * Provides a button to export table data to CSV format.
 * Supports customizable headers and data transformation.
 */

import { Box, Button, Menu, MenuItem, Tooltip } from "@mui/material";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import { useState, useCallback } from "react";
import { exportToCSV } from "@/utils/csvExport";

export interface ExportOptions {
  filename: string;
  headers: string[];
  rows: any[][];
}

interface TExportButtonProps {
  /** Export configuration */
  exportOptions: ExportOptions;
  /** Button label (default: "Export") */
  label?: string;
  /** Whether button is disabled */
  disabled?: boolean;
  /** Callback after export */
  onExport?: () => void;
  /** Size of button */
  size?: "small" | "medium" | "large";
  /** Variant of button */
  variant?: "text" | "outlined" | "contained";
}

export function TExportButton({
  exportOptions,
  label = "Export",
  disabled = false,
  onExport,
  size = "small",
  variant = "outlined",
}: TExportButtonProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleExport = useCallback((format: "csv") => {
    try {
      if (format === "csv") {
        exportToCSV(exportOptions);
        onExport?.();
      }
      handleClose();
    } catch (error) {
      console.error("Export failed:", error);
    }
  }, [exportOptions, onExport]);

  return (
    <>
      <Tooltip title={`Export to ${label}`}>
        <Button
          size={size}
          variant={variant}
          startIcon={<FileDownloadIcon />}
          onClick={handleClick}
          disabled={disabled || (exportOptions.rows?.length ?? 0) === 0}
        >
          {label}
        </Button>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
      >
        <MenuItem onClick={() => handleExport("csv")}>
          📄 CSV Format
        </MenuItem>
      </Menu>
    </>
  );
}

export default TExportButton;
