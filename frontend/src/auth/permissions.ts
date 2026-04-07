import { User } from "@/api/types";
import { useAuthStore } from "@/state/authStore";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Permission constants — must match backend app/auth/rbac.py Permissions
 * ═══════════════════════════════════════════════════════════════════════
 */
export const PERMISSIONS = {
  // ── Customer permissions ──────────────────────────────────────────
  CUSTOMER_VIEW: { resource: "customers", action: "view" },
  CUSTOMER_CREATE: { resource: "customers", action: "create" },
  CUSTOMER_UPDATE: { resource: "customers", action: "update" },
  CUSTOMER_DELETE: { resource: "customers", action: "delete" },

  // ── Sales permissions ─────────────────────────────────────────────
  SALES_VIEW: { resource: "sales", action: "view" },
  SALES_CREATE: { resource: "sales", action: "create" },
  SALES_UPDATE: { resource: "sales", action: "update" },
  SALES_DELETE: { resource: "sales", action: "delete" },
  SALES_APPROVE: { resource: "sales", action: "approve" },
  SALES_MANAGE: { resource: "sales", action: "manage" },

  // ── Purchasing permissions ────────────────────────────────────────
  PURCHASING_VIEW: { resource: "purchasing", action: "view" },
  PURCHASING_CREATE: { resource: "purchasing", action: "create" },
  PURCHASING_UPDATE: { resource: "purchasing", action: "update" },
  PURCHASING_DELETE: { resource: "purchasing", action: "delete" },
  PURCHASING_APPROVE: { resource: "purchasing", action: "approve" },

  // ── Inventory / Products permissions ──────────────────────────────
  INVENTORY_VIEW: { resource: "inventory", action: "view" },
  INVENTORY_CREATE: { resource: "inventory", action: "create" },
  INVENTORY_UPDATE: { resource: "inventory", action: "update" },
  INVENTORY_DELETE: { resource: "inventory", action: "delete" },

  // ── Finance permissions ───────────────────────────────────────────
  FINANCE_VIEW: { resource: "finance", action: "view" },
  FINANCE_CREATE: { resource: "finance", action: "create" },
  FINANCE_UPDATE: { resource: "finance", action: "update" },
  FINANCE_DELETE: { resource: "finance", action: "delete" },
  FINANCE_APPROVE: { resource: "finance", action: "approve" },

  // ── HR permissions ────────────────────────────────────────────────
  HR_VIEW: { resource: "hr", action: "view" },
  HR_CREATE: { resource: "hr", action: "create" },
  HR_UPDATE: { resource: "hr", action: "update" },
  HR_DELETE: { resource: "hr", action: "delete" },
  HR_APPROVE: { resource: "hr", action: "approve" },

  // ── Warehouse / Sales Stock permissions ───────────────────────────
  WAREHOUSE_VIEW: { resource: "warehouse", action: "view" },
  WAREHOUSE_CREATE: { resource: "warehouse", action: "create" },
  WAREHOUSE_UPDATE: { resource: "warehouse", action: "update" },
  WAREHOUSE_DELETE: { resource: "warehouse", action: "delete" },
  WAREHOUSE_APPROVE: { resource: "warehouse", action: "approve" },

  // ── Support permissions ───────────────────────────────────────────
  SUPPORT_VIEW: { resource: "support", action: "view" },
  SUPPORT_CREATE: { resource: "support", action: "create" },
  SUPPORT_UPDATE: { resource: "support", action: "update" },
  SUPPORT_DELETE: { resource: "support", action: "delete" },

  // ── Reporting permissions ─────────────────────────────────────────
  REPORTING_VIEW: { resource: "reporting", action: "view" },
  REPORTING_GENERATE: { resource: "reporting", action: "generate" },

  // ── Dashboard permissions ─────────────────────────────────────────
  DASHBOARD_VIEW: { resource: "dashboard", action: "view" },

  // ── User management permissions ───────────────────────────────────
  USER_VIEW: { resource: "users", action: "view" },
  USER_CREATE: { resource: "users", action: "create" },
  USER_UPDATE: { resource: "users", action: "update" },
  USER_DELETE: { resource: "users", action: "delete" },

  // ── Group / Role management permissions ───────────────────────────
  GROUP_VIEW: { resource: "groups", action: "view" },
  GROUP_CREATE: { resource: "groups", action: "create" },
  GROUP_UPDATE: { resource: "groups", action: "update" },
  GROUP_DELETE: { resource: "groups", action: "delete" },

  // ── Branch permissions ────────────────────────────────────────────
  BRANCH_VIEW: { resource: "branches", action: "view" },
  BRANCH_CREATE: { resource: "branches", action: "create" },
  BRANCH_UPDATE: { resource: "branches", action: "update" },
  BRANCH_DELETE: { resource: "branches", action: "delete" },

  // ── Common / Reference Data permissions ───────────────────────────
  COMMON_VIEW: { resource: "common", action: "view" },
  COMMON_CREATE: { resource: "common", action: "create" },
  COMMON_UPDATE: { resource: "common", action: "update" },
  COMMON_DELETE: { resource: "common", action: "delete" },

  // ── Settings permissions ──────────────────────────────────────────
  SETTINGS_VIEW: { resource: "settings", action: "view" },
  SETTINGS_UPDATE: { resource: "settings", action: "update" },
} as const;

// ═══════════════════════════════════════════════════════════════════════
// Permission checking helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Check if user has a specific permission
 */
export function hasPermission(
  user: User | null,
  resource: string,
  action: string,
): boolean {
  if (!user) return false;

  // Superusers have all permissions
  if (user.is_superuser) return true;

  // Check direct user permissions
  if (user.permissions) {
    for (const permission of user.permissions) {
      if (permission.resource === resource && permission.action === action) {
        return true;
      }
    }
  }

  // Check group permissions
  if (user.groups) {
    for (const group of user.groups) {
      for (const permission of group.permissions) {
        if (permission.resource === resource && permission.action === action) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(
  user: User | null,
  permissions: Array<{ resource: string; action: string }>,
): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  return permissions.some((perm) =>
    hasPermission(user, perm.resource, perm.action),
  );
}

/**
 * Check if user has all of the specified permissions
 */
export function hasAllPermissions(
  user: User | null,
  permissions: Array<{ resource: string; action: string }>,
): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  return permissions.every((perm) =>
    hasPermission(user, perm.resource, perm.action),
  );
}

/**
 * Get user's permissions as a flat list
 */
export function getUserPermissions(user: User | null): string[] {
  if (!user) return [];
  if (user.is_superuser) return ["*:*"]; // Superuser has all permissions

  const permissions = new Set<string>();

  // Add direct permissions
  if (user.permissions) {
    user.permissions.forEach((perm) => {
      permissions.add(`${perm.resource}:${perm.action}`);
    });
  }

  // Add group permissions
  if (user.groups) {
    user.groups.forEach((group) => {
      group.permissions.forEach((perm) => {
        permissions.add(`${perm.resource}:${perm.action}`);
      });
    });
  }

  return Array.from(permissions);
}

// ═══════════════════════════════════════════════════════════════════════
// Module-level access control
// ═══════════════════════════════════════════════════════════════════════

/**
 * Module-to-permission mapping for route guards and sidebar visibility.
 * Maps each route prefix to the VIEW permission required to access it.
 */
export const MODULE_PERMISSIONS: Record<
  string,
  { resource: string; action: string }
> = {
  "/dashboard": PERMISSIONS.DASHBOARD_VIEW,
  "/sales": PERMISSIONS.SALES_VIEW,
  "/purchasing": PERMISSIONS.PURCHASING_VIEW,
  "/product-catalogs": PERMISSIONS.INVENTORY_VIEW,
  "/finance": PERMISSIONS.FINANCE_VIEW,
  "/hr": PERMISSIONS.HR_VIEW,
  "/warehouse": PERMISSIONS.WAREHOUSE_VIEW,
  "/support": PERMISSIONS.SUPPORT_VIEW,
  "/reporting": PERMISSIONS.REPORTING_VIEW,
  "/branches": PERMISSIONS.BRANCH_VIEW,
  "/users": PERMISSIONS.USER_VIEW,
  "/roles": PERMISSIONS.GROUP_VIEW,
  "/settings": PERMISSIONS.SETTINGS_VIEW,
  "/company-settings": PERMISSIONS.SETTINGS_VIEW,
};

/**
 * Check if a user has access to a specific module by its path prefix.
 */
export function hasModuleAccess(
  user: User | null,
  modulePath: string,
): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  const perm = MODULE_PERMISSIONS[modulePath];
  if (!perm) return true; // No permission defined → public
  return hasPermission(user, perm.resource, perm.action);
}

/**
 * Check if user has access to ANY module at all.
 * Used to decide whether to show the dashboard.
 */
export function hasAnyModuleAccess(user: User | null): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;

  return Object.values(MODULE_PERMISSIONS).some((perm) =>
    hasPermission(user, perm.resource, perm.action),
  );
}

// ═══════════════════════════════════════════════════════════════════════
// React hooks
// ═══════════════════════════════════════════════════════════════════════

/**
 * React hook to check if current user has a specific permission
 */
export function usePermission(resource: string, action: string): boolean {
  const user = useAuthStore((state) => state.user);
  return hasPermission(user, resource, action);
}

/**
 * React hook to check if the current user has access to ANY module.
 */
export function useHasAnyAccess(): boolean {
  const user = useAuthStore((state) => state.user);
  return hasAnyModuleAccess(user);
}

/**
 * React hook to check if the current user has access to a specific module path.
 */
export function useModuleAccess(modulePath: string): boolean {
  const user = useAuthStore((state) => state.user);
  return hasModuleAccess(user, modulePath);
}
