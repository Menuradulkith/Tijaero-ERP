/**
 * TSectionNav - Vertical section navigation for long detail/edit forms
 *
 * Renders a list of clickable section labels; the caller is responsible for
 * conditionally rendering the matching section's content alongside it (this
 * component only tracks/reports which section is active, it never touches
 * content). Meant for pages whose detail panel has several distinct groups
 * of fields (e.g. Main / Address / Contact Person / Payment) where only one
 * group should be visible at a time, replacing a long stack of always-visible
 * FormSections.
 *
 * On narrow screens (below the `sm` breakpoint) the list becomes a
 * horizontal scrollable row instead of a left-side column, so the caller's
 * wrapping layout should also switch to a column flex direction at the same
 * breakpoint (see `SuppliersPage.tsx` for the reference usage).
 *
 * @example
 * ```tsx
 * <TSectionNav
 *   items={[
 *     { key: "main", label: "Main" },
 *     { key: "address", label: "Address" },
 *   ]}
 *   activeKey={activeSection}
 *   onChange={setActiveSection}
 * />
 * ```
 */

import React from "react";
import { alpha, Box, Typography, useMediaQuery, useTheme, type SxProps, type Theme } from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

export interface TSectionNavItem {
  /** Stable identifier for this section */
  key: string;
  /** Display label */
  label: string;
  /** Optional icon shown before the label */
  icon?: React.ReactNode;
  /** Disable this item (not clickable) */
  disabled?: boolean;
}

export interface TSectionNavProps {
  /** Section items to list */
  items: TSectionNavItem[];
  /** Currently active section key (null when none of the items is active, e.g. a "default" view is showing instead) */
  activeKey: string | null;
  /** Change handler */
  onChange: (key: string) => void;
  /** Width of the nav column on desktop (default 168). Ignored by the "inline" variant. */
  width?: number | string;
  /** Custom styles for the root element */
  sx?: SxProps<Theme>;
  /**
   * "sidebar" (default): a full-height column/row nav meant to sit beside a
   * detail panel's content, with its own border and a bold+background active state.
   * "inline": a compact plain-link-style vertical list meant to be embedded
   * inside another surface (e.g. a colored/selected list item) — no border,
   * every item styled as a link (primary color), active item just bolder.
   */
  variant?: "sidebar" | "inline";
}

export const TSectionNav: React.FC<TSectionNavProps> = ({
  items,
  activeKey,
  onChange,
  width = 168,
  sx,
  variant = "sidebar",
}) => {
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down("sm")) && variant === "sidebar";

  if (variant === "inline") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, ...sx }}>
        {items.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <Box
              key={item.key}
              onClick={(e) => {
                e.stopPropagation();
                if (!item.disabled) onChange(item.key);
              }}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1,
                py: 0.75,
                borderRadius: 1.5,
                cursor: item.disabled ? "default" : "pointer",
                userSelect: "none",
                color: item.disabled ? "text.disabled" : isActive ? "primary.main" : "text.primary",
                bgcolor: isActive ? alpha(theme.palette.primary.main, 0.08) : "transparent",
                transition: "background-color 0.15s, color 0.15s",
                "&:hover": item.disabled
                  ? undefined
                  : {
                      bgcolor: isActive ? alpha(theme.palette.primary.main, 0.08) : "action.hover",
                      color: "primary.main",
                    },
              }}
            >
              {item.icon && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    color: item.disabled ? "text.disabled" : isActive ? "primary.main" : "text.secondary",
                    "& svg": { fontSize: "1.15rem" },
                  }}
                >
                  {item.icon}
                </Box>
              )}
              <Typography
                component="span"
                sx={{ flex: 1, fontSize: "0.875rem", fontWeight: isActive ? 600 : 500, color: "inherit" }}
              >
                {item.label}
              </Typography>
              <ChevronRightIcon
                fontSize="small"
                sx={{
                  color: isActive ? "primary.main" : "action.disabled",
                  opacity: isActive ? 1 : 0.6,
                }}
              />
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: isNarrow ? "row" : "column",
        flexShrink: 0,
        width: isNarrow ? "100%" : width,
        overflowX: isNarrow ? "auto" : "visible",
        borderRight: isNarrow ? 0 : 1,
        borderBottom: isNarrow ? 1 : 0,
        borderColor: "divider",
        py: isNarrow ? 0.5 : 1,
        ...sx,
      }}
    >
      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <Box
            key={item.key}
            onClick={() => !item.disabled && onChange(item.key)}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1.5,
              py: 1,
              flexShrink: 0,
              whiteSpace: "nowrap",
              cursor: item.disabled ? "default" : "pointer",
              userSelect: "none",
              color: item.disabled
                ? "text.disabled"
                : isActive
                  ? "primary.main"
                  : "text.primary",
              fontWeight: isActive ? 700 : 500,
              fontSize: "0.875rem",
              bgcolor: isActive ? "action.selected" : "transparent",
              borderLeft: isNarrow ? 0 : 3,
              borderBottom: isNarrow ? 3 : 0,
              borderColor: isActive ? "primary.main" : "transparent",
              "&:hover": item.disabled
                ? undefined
                : { color: "primary.main", bgcolor: isActive ? "action.selected" : "action.hover" },
            }}
          >
            {item.icon}
            {item.label}
          </Box>
        );
      })}
    </Box>
  );
};

export default TSectionNav;
