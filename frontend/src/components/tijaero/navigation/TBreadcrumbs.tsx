/**
 * TBreadcrumbs - Standardized breadcrumbs navigation
 * 
 * Provides consistent breadcrumb navigation with icons.
 * 
 * @example
 * ```tsx
 * <TBreadcrumbs
 *   items={[
 *     { label: "Home", href: "/" },
 *     { label: "Orders", href: "/orders" },
 *     { label: "ORD-001" },
 *   ]}
 * />
 * ```
 */

import React from "react";
import {
  Breadcrumbs,
  Link,
  Typography,
  Box,
} from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";

export interface TBreadcrumbItem {
  /** Breadcrumb label */
  label: string;
  /** Link href (optional - if not provided, renders as text) */
  href?: string;
  /** Custom icon */
  icon?: React.ReactNode;
  /** Click handler (alternative to href) */
  onClick?: () => void;
}

export interface TBreadcrumbsProps {
  /** Breadcrumb items */
  items: TBreadcrumbItem[];
  /** Show home icon on first item */
  showHomeIcon?: boolean;
  /** Separator icon */
  separator?: React.ReactNode;
  /** Max items before collapsing */
  maxItems?: number;
  /** Custom styles */
  sx?: Record<string, unknown>;
}

export const TBreadcrumbs: React.FC<TBreadcrumbsProps> = ({
  items,
  showHomeIcon = true,
  separator,
  maxItems,
  sx,
}) => {
  return (
    <Breadcrumbs
      separator={separator || <NavigateNextIcon fontSize="small" />}
      maxItems={maxItems}
      sx={{
        "& .MuiBreadcrumbs-li": {
          display: "flex",
          alignItems: "center",
        },
        ...sx,
      }}
    >
      {items.map((item, index) => {
        const isFirst = index === 0;
        const isLast = index === items.length - 1;
        const showIcon = isFirst && showHomeIcon;

        const content = (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {item.icon || (showIcon && <HomeIcon fontSize="small" />)}
            {item.label}
          </Box>
        );

        // Last item or no href - render as text
        if (isLast || (!item.href && !item.onClick)) {
          return (
            <Typography
              key={index}
              color={isLast ? "text.primary" : "text.secondary"}
              sx={{
                display: "flex",
                alignItems: "center",
                fontWeight: isLast ? 500 : 400,
              }}
            >
              {content}
            </Typography>
          );
        }

        // Clickable link
        return (
          <Link
            key={index}
            href={item.href}
            onClick={(e) => {
              if (item.onClick) {
                e.preventDefault();
                item.onClick();
              }
            }}
            color="inherit"
            underline="hover"
            sx={{
              display: "flex",
              alignItems: "center",
              cursor: "pointer",
            }}
          >
            {content}
          </Link>
        );
      })}
    </Breadcrumbs>
  );
};

export default TBreadcrumbs;
