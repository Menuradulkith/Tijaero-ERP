/**
 * TInfoCard - Standardized information card component
 * 
 * Used for displaying grouped information with a title and content area.
 * 
 * @example
 * ```tsx
 * <TInfoCard title="Customer Details" icon={<PersonIcon />}>
 *   <Typography>John Doe</Typography>
 *   <Typography>john@example.com</Typography>
 * </TInfoCard>
 * ```
 */

import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardActions,
  Typography,
  Box,
  Collapse,
  IconButton,
  Divider,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

export interface TInfoCardProps {
  /** Card title */
  title: string;
  /** Title icon */
  icon?: React.ReactNode;
  /** Subtitle */
  subtitle?: string;
  /** Card content */
  children: React.ReactNode;
  /** Collapsible card */
  collapsible?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  /** Actions to show in header */
  headerActions?: React.ReactNode;
  /** Footer actions */
  footerActions?: React.ReactNode;
  /** Elevation */
  elevation?: number;
  /** Loading state */
  loading?: boolean;
  /** Variant */
  variant?: "elevation" | "outlined";
  /** No padding in content */
  noPadding?: boolean;
}

export const TInfoCard: React.FC<TInfoCardProps> = ({
  title,
  icon,
  subtitle,
  children,
  collapsible = false,
  defaultCollapsed = false,
  headerActions,
  footerActions,
  elevation = 1,
  loading: _loading = false,
  variant = "elevation",
  noPadding = false,
}) => {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  const toggleCollapse = () => {
    if (collapsible) {
      setCollapsed(!collapsed);
    }
  };

  return (
    <Card
      elevation={variant === "outlined" ? 0 : elevation}
      variant={variant}
      sx={{ height: "100%" }}
    >
      <CardHeader
        avatar={
          icon && (
            <Box sx={{ color: "primary.main", display: "flex" }}>{icon}</Box>
          )
        }
        title={
          <Typography variant="subtitle1" fontWeight={600}>
            {title}
          </Typography>
        }
        subheader={subtitle}
        action={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {headerActions}
            {collapsible && (
              <IconButton size="small" onClick={toggleCollapse}>
                {collapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
              </IconButton>
            )}
          </Box>
        }
        sx={{
          cursor: collapsible ? "pointer" : "default",
          pb: 1,
        }}
        onClick={collapsible ? toggleCollapse : undefined}
      />

      <Collapse in={!collapsed}>
        <Divider />
        <CardContent sx={{ pt: 2, ...(noPadding && { p: 0, "&:last-child": { pb: 0 } }) }}>
          {children}
        </CardContent>

        {footerActions && (
          <>
            <Divider />
            <CardActions sx={{ justifyContent: "flex-end", px: 2 }}>
              {footerActions}
            </CardActions>
          </>
        )}
      </Collapse>
    </Card>
  );
};

export default TInfoCard;
