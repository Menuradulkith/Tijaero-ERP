/**
 * TDataCard - Standardized data display card
 * 
 * Displays labeled data fields in a structured card format.
 * Perfect for detail views and read-only data display.
 * 
 * @example
 * ```tsx
 * <TDataCard
 *   title="Order Information"
 *   fields={[
 *     { label: "Order Number", value: order.number },
 *     { label: "Date", value: order.date, type: "date" },
 *     { label: "Total", value: order.total, type: "currency" },
 *     { label: "Status", value: order.status, type: "status", statusMap: "orderStatus" },
 *   ]}
 * />
 * ```
 */

import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  Typography,
  Box,
  Divider,
  Grid,
  Skeleton,
} from "@mui/material";
import { TStatusChip, StatusMapName } from "../base/TStatusChip";
import { format } from "date-fns";

export interface TDataCardField {
  /** Field label */
  label: string;
  /** Field value */
  value: unknown;
  /** Value type */
  type?: "text" | "number" | "currency" | "date" | "datetime" | "boolean" | "status";
  /** Status map for status type */
  statusMap?: StatusMapName;
  /** Custom render function */
  render?: (value: unknown) => React.ReactNode;
  /** Hide if value is empty */
  hideIfEmpty?: boolean;
  /** Full width (spans 2 columns) */
  fullWidth?: boolean;
}

export interface TDataCardProps {
  /** Card title */
  title?: string;
  /** Title icon */
  icon?: React.ReactNode;
  /** Field definitions */
  fields: TDataCardField[];
  /** Number of columns */
  columns?: 1 | 2 | 3 | 4;
  /** Loading state */
  loading?: boolean;
  /** Card variant */
  variant?: "elevation" | "outlined";
  /** Header actions */
  actions?: React.ReactNode;
}

// Format value based on type
const formatFieldValue = (
  value: unknown,
  type?: TDataCardField["type"]
): React.ReactNode => {
  if (value === null || value === undefined || value === "") {
    return <Typography color="text.secondary">-</Typography>;
  }

  switch (type) {
    case "currency":
      const num = Number(value);
      if (isNaN(num)) return "-";
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(num);

    case "date":
      try {
        return format(new Date(String(value)), "MMM dd, yyyy");
      } catch {
        return "-";
      }

    case "datetime":
      try {
        return format(new Date(String(value)), "MMM dd, yyyy HH:mm");
      } catch {
        return "-";
      }

    case "number":
      const n = Number(value);
      return isNaN(n) ? "-" : n.toLocaleString();

    default:
      return String(value);
  }
};

export const TDataCard: React.FC<TDataCardProps> = ({
  title,
  icon,
  fields,
  columns = 2,
  loading = false,
  variant = "outlined",
  actions,
}) => {
  // Filter out empty fields if hideIfEmpty is true
  const visibleFields = fields.filter((field) => {
    if (!field.hideIfEmpty) return true;
    return field.value !== null && field.value !== undefined && field.value !== "";
  });

  // Calculate grid column span
  const getColSpan = (field: TDataCardField): number => {
    if (field.fullWidth) return 12;
    return Math.floor(12 / columns);
  };

  return (
    <Card variant={variant}>
      {title && (
        <>
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
            action={actions}
            sx={{ pb: 1 }}
          />
          <Divider />
        </>
      )}
      <CardContent>
        <Grid container spacing={2}>
          {visibleFields.map((field, index) => (
            <Grid item xs={12} sm={getColSpan(field)} key={index}>
              {/* Label */}
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                sx={{ mb: 0.5, fontWeight: 500 }}
              >
                {field.label}
              </Typography>

              {/* Value */}
              {loading ? (
                <Skeleton variant="text" width="60%" />
              ) : field.render ? (
                field.render(field.value)
              ) : field.type === "status" ? (
                <TStatusChip
                  status={String(field.value || "")}
                  statusMap={field.statusMap || "orderStatus"}
                />
              ) : field.type === "boolean" ? (
                <TStatusChip status={!!field.value} statusMap="yesNo" />
              ) : (
                <Typography variant="body2">
                  {formatFieldValue(field.value, field.type)}
                </Typography>
              )}
            </Grid>
          ))}
        </Grid>
      </CardContent>
    </Card>
  );
};

export default TDataCard;
