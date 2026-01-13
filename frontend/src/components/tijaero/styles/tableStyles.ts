/**
 * Modern Table Styles
 * 
 * Reusable table styling utilities for consistent modern look across the ERP.
 * Use these styles with MUI Table components for a unified appearance.
 * 
 * @example
 * ```tsx
 * import { modernTableStyles, modernTableHeaderSx, modernTableRowSx } from "@/components/tijaero/styles/tableStyles";
 * 
 * <TableContainer component={Paper} sx={modernTableStyles.container}>
 *   <Table size="small">
 *     <TableHead>
 *       <TableRow sx={modernTableStyles.headerRow}>
 *         <TableCell>Header</TableCell>
 *       </TableRow>
 *     </TableHead>
 *     <TableBody>
 *       <TableRow sx={modernTableStyles.bodyRow}>
 *         <TableCell>Data</TableCell>
 *       </TableRow>
 *     </TableBody>
 *   </Table>
 * </TableContainer>
 * ```
 */

import { SxProps, Theme } from "@mui/material";

/**
 * Complete modern table styles object
 */
export const modernTableStyles = {
  /** Container wrapper styles */
  container: {
    borderRadius: 2,
    overflow: "hidden",
    border: "1px solid",
    borderColor: "divider",
    boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  },

  /** Header row styles */
  headerRow: {
    bgcolor: "grey.50",
    "& .MuiTableCell-root": {
      fontWeight: 600,
      fontSize: "0.875rem",
      color: "text.primary",
      borderBottom: "2px solid",
      borderColor: "divider",
      py: 1.5,
      whiteSpace: "nowrap",
    },
  },

  /** Body row styles with hover and striping */
  bodyRow: {
    transition: "background-color 0.15s ease",
    "& .MuiTableCell-root": {
      fontSize: "0.875rem",
      borderColor: "grey.100",
      py: 1.25,
    },
    "&:hover": {
      bgcolor: "primary.50",
    },
    "&:nth-of-type(even)": {
      bgcolor: "grey.25",
    },
    "&:nth-of-type(even):hover": {
      bgcolor: "primary.50",
    },
  },

  /** Clickable body row styles */
  clickableRow: {
    cursor: "pointer",
    transition: "background-color 0.15s ease",
    "& .MuiTableCell-root": {
      fontSize: "0.875rem",
      borderColor: "grey.100",
      py: 1.25,
    },
    "&:hover": {
      bgcolor: "primary.50",
    },
    "&:nth-of-type(even)": {
      bgcolor: "grey.25",
    },
    "&:nth-of-type(even):hover": {
      bgcolor: "primary.50",
    },
  },

  /** Selected row styles */
  selectedRow: {
    bgcolor: "primary.100",
    "&:hover": {
      bgcolor: "primary.150",
    },
  },

  /** Footer/total row styles */
  footerRow: {
    bgcolor: "grey.100",
    "& .MuiTableCell-root": {
      fontWeight: 600,
      fontSize: "0.875rem",
      borderTop: "2px solid",
      borderColor: "divider",
      py: 1.5,
    },
  },

  /** Empty state cell */
  emptyCell: {
    py: 6,
    textAlign: "center",
    color: "text.secondary",
    fontSize: "0.875rem",
  },
} satisfies Record<string, SxProps<Theme>>;

/**
 * Get row style with optional selection state
 */
export const getRowStyle = (
  isSelected: boolean = false,
  isClickable: boolean = false
): SxProps<Theme> => ({
  ...modernTableStyles.bodyRow,
  ...(isClickable ? { cursor: "pointer" } : null),
  ...(isSelected ? modernTableStyles.selectedRow : null),
});

/**
 * Inline table wrapper component styles for Paper
 */
export const modernTableContainerSx: SxProps<Theme> = {
  borderRadius: 2,
  overflow: "hidden",
  border: "1px solid",
  borderColor: "divider",
  boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
};

/**
 * Header cell base style
 */
export const modernTableHeaderCellSx: SxProps<Theme> = {
  fontWeight: 600,
  fontSize: "0.875rem",
  bgcolor: "grey.50",
  borderBottom: "2px solid",
  borderColor: "divider",
  py: 1.5,
  whiteSpace: "nowrap",
};

/**
 * Body cell base style
 */
export const modernTableCellSx: SxProps<Theme> = {
  fontSize: "0.875rem",
  borderColor: "grey.100",
  py: 1.25,
};

/**
 * Currency cell style (right aligned)
 */
export const currencyCellSx: SxProps<Theme> = {
  ...modernTableCellSx,
  textAlign: "right",
  fontFamily: "monospace",
};

/**
 * Number cell style (right aligned)
 */
export const numberCellSx: SxProps<Theme> = {
  ...modernTableCellSx,
  textAlign: "right",
};

/**
 * Action cell style (for buttons/icons)
 */
export const actionCellSx: SxProps<Theme> = {
  ...modernTableCellSx,
  width: 50,
  textAlign: "center",
  px: 1,
};

export default modernTableStyles;
