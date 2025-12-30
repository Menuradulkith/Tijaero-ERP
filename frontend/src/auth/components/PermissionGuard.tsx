import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Box, Typography, Button } from "@mui/material";
import LockIcon from "@mui/icons-material/Lock";
import { useAuthStore } from "@/state/authStore";
import { hasPermission, hasAnyPermission } from "@/auth/permissions";

interface PermissionGuardProps {
  children: ReactNode;
  resource: string;
  action: string;
  fallback?: ReactNode;
  redirectTo?: string;
  requireAll?: boolean;
  permissions?: Array<{ resource: string; action: string }>;
}

/**
 * PermissionGuard - Protects content based on user permissions
 *
 * Usage:
 * 1. Single permission:
 *    <PermissionGuard resource="customers" action="view">
 *      <CustomerList />
 *    </PermissionGuard>
 *
 * 2. Multiple permissions (any):
 *    <PermissionGuard permissions={[PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.CUSTOMER_CREATE]}>
 *      <CustomerPage />
 *    </PermissionGuard>
 *
 * 3. With custom fallback:
 *    <PermissionGuard resource="users" action="delete" fallback={<div>No access</div>}>
 *      <DeleteButton />
 *    </PermissionGuard>
 *
 * 4. With redirect:
 *    <PermissionGuard resource="admin" action="view" redirectTo="/dashboard">
 *      <AdminPanel />
 *    </PermissionGuard>
 */
export default function PermissionGuard({
  children,
  resource,
  action,
  fallback,
  redirectTo,
  requireAll = false,
  permissions,
}: PermissionGuardProps) {
  const user = useAuthStore((state) => state.user);

  // Check permissions
  let hasAccess = false;

  if (permissions && permissions.length > 0) {
    // Multiple permissions check
    if (requireAll) {
      hasAccess = permissions.every((perm) =>
        hasPermission(user, perm.resource, perm.action)
      );
    } else {
      hasAccess = hasAnyPermission(user, permissions);
    }
  } else if (resource && action) {
    // Single permission check
    hasAccess = hasPermission(user, resource, action);
  }

  // If user has access, render children
  if (hasAccess) {
    return <>{children}</>;
  }

  // If redirect is specified, redirect
  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }

  // If custom fallback is provided, render it
  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  // Default fallback - show nothing (hide the component)
  return null;
}

/**
 * PermissionDenied - Default permission denied message
 */
export function PermissionDenied() {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "400px",
        textAlign: "center",
        p: 4,
      }}
    >
      <LockIcon sx={{ fontSize: 80, color: "text.secondary", mb: 2 }} />
      <Typography variant="h5" gutterBottom>
        Access Denied
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        You don't have permission to access this resource.
      </Typography>
      <Button variant="contained" href="/dashboard">
        Go to Dashboard
      </Button>
    </Box>
  );
}

/**
 * Hook to check permissions in components
 */
export function usePermission(resource: string, action: string): boolean {
  const user = useAuthStore((state) => state.user);
  return hasPermission(user, resource, action);
}

/**
 * Hook to check multiple permissions
 */
export function usePermissions(
  permissions: Array<{ resource: string; action: string }>,
  requireAll = false
): boolean {
  const user = useAuthStore((state) => state.user);

  if (requireAll) {
    return permissions.every((perm) =>
      hasPermission(user, perm.resource, perm.action)
    );
  }

  return hasAnyPermission(user, permissions);
}
