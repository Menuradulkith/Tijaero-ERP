/**
 * TPageHeader Component
 * 
 * Standardized page header with title, subtitle, breadcrumbs, and actions.
 * Provides consistent page headers across the entire ERP application.
 * 
 * @example Basic usage
 * ```tsx
 * <TPageHeader
 *   title="Purchase Orders"
 *   subtitle="Manage your purchase orders"
 * />
 * ```
 * 
 * @example With actions and breadcrumbs
 * ```tsx
 * <TPageHeader
 *   title="PO-2024-001"
 *   subtitle="Purchase Order Details"
 *   breadcrumbs={[
 *     { label: 'Purchasing', href: '/purchasing' },
 *     { label: 'Purchase Orders', href: '/purchasing/orders' },
 *     { label: 'PO-2024-001' }
 *   ]}
 *   actions={
 *     <>
 *       <TButton variant="outlined" onClick={handleEdit}>Edit</TButton>
 *       <TButton variant="contained" onClick={handleApprove}>Approve</TButton>
 *     </>
 *   }
 * />
 * ```
 * 
 * @example With icon and status
 * ```tsx
 * <TPageHeader
 *   title="Inventory Management"
 *   icon={<InventoryIcon />}
 *   status={<TStatusChip status="active" />}
 * />
 * ```
 */

import React from 'react';
import {
  Box,
  Typography,
  Skeleton,
  IconButton,
  Tooltip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';
import { TBreadcrumbs, type TBreadcrumbItem as BreadcrumbItem } from '../navigation/TBreadcrumbs';

export interface TPageHeaderProps {
  /** Page title */
  title: string;
  /** Optional subtitle or description */
  subtitle?: string;
  /** Icon to display before the title */
  icon?: React.ReactNode;
  /** Status chip or badge to display after the title */
  status?: React.ReactNode;
  /** Breadcrumb navigation items */
  breadcrumbs?: BreadcrumbItem[];
  /** Action buttons to display on the right */
  actions?: React.ReactNode;
  /** Show back button */
  showBackButton?: boolean;
  /** Custom back navigation handler */
  onBack?: () => void;
  /** Back button URL (alternative to onBack) */
  backTo?: string;
  /** Show loading skeleton */
  loading?: boolean;
  /** Additional content below the header */
  children?: React.ReactNode;
  /** Make header sticky */
  sticky?: boolean;
  /** Compact mode with less padding */
  compact?: boolean;
  /** Background color */
  bgcolor?: string;
  /** Custom styles */
  sx?: object;
}

export const TPageHeader: React.FC<TPageHeaderProps> = ({
  title,
  subtitle,
  icon,
  status,
  breadcrumbs,
  actions,
  showBackButton = false,
  onBack,
  backTo,
  loading = false,
  children,
  sticky = false,
  compact = false,
  bgcolor,
  sx,
}) => {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (backTo) {
      navigate(backTo);
    } else {
      navigate(-1);
    }
  };

  if (loading) {
    return (
      <Box
        sx={{
          mb: compact ? 2 : 3,
          ...(sticky && {
            position: 'sticky',
            top: 0,
            zIndex: 100,
            bgcolor: bgcolor || 'background.paper',
            py: 2,
          }),
          ...sx,
        }}
      >
        {breadcrumbs && (
          <Skeleton width={200} height={24} sx={{ mb: 1 }} />
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {showBackButton && (
            <Skeleton variant="circular" width={40} height={40} />
          )}
          <Box sx={{ flex: 1 }}>
            <Skeleton width={300} height={40} />
            {subtitle && <Skeleton width={200} height={24} sx={{ mt: 0.5 }} />}
          </Box>
          <Skeleton width={150} height={40} />
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        mb: compact ? 2 : 3,
        ...(sticky && {
          position: 'sticky',
          top: 0,
          zIndex: 100,
          bgcolor: bgcolor || 'background.paper',
          py: 2,
          borderBottom: 1,
          borderColor: 'divider',
        }),
        ...sx,
      }}
    >
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <TBreadcrumbs
          items={breadcrumbs}
          sx={{ mb: 1.5 }}
        />
      )}

      {/* Main header row */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        {/* Left side: Back button, icon, title, subtitle */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
          {showBackButton && (
            <Tooltip title="Go back">
              <IconButton
                onClick={handleBack}
                size="small"
                sx={{
                  bgcolor: 'action.hover',
                  '&:hover': {
                    bgcolor: 'action.selected',
                  },
                }}
              >
                <ArrowBackIcon />
              </IconButton>
            </Tooltip>
          )}

          {icon && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'primary.main',
                '& svg': {
                  fontSize: compact ? 28 : 32,
                },
              }}
            >
              {icon}
            </Box>
          )}

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Typography
                variant={compact ? 'h5' : 'h4'}
                component="h1"
                sx={{
                  fontWeight: 600,
                  color: 'text.primary',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {title}
              </Typography>
              {status}
            </Box>
            {subtitle && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                {subtitle}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Right side: Actions */}
        {actions && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexShrink: 0,
            }}
          >
            {actions}
          </Box>
        )}
      </Box>

      {/* Additional content */}
      {children && (
        <Box sx={{ mt: 2 }}>
          {children}
        </Box>
      )}
    </Box>
  );
};

export default TPageHeader;
