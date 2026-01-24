/**
 * useBranchFilter - Hook for filtering data based on user's assigned branches.
 * 
 * This hook provides branch-based access control on the frontend to match
 * the backend's branch filtering. Users can only see/select branches they
 * have been assigned to. Superusers have access to all branches.
 * 
 * ERP Best Practice: Users are assigned to specific branches and should only
 * access data from those branches. This prevents cross-branch data leakage
 * and enforces proper data segmentation in multi-branch operations.
 * 
 * @example
 * // Get branches the user has access to
 * const { filterBranches, getUserBranchCodes, canAccessBranch } = useBranchFilter();
 * 
 * // Filter a list of branches for dropdown
 * const accessibleBranches = filterBranches(allBranches);
 * 
 * // Check if user can access a specific branch
 * if (canAccessBranch("HQ")) { ... }
 */

import { useAuthStore } from "@/state/authStore";
import { useMemo, useCallback } from "react";
import type { Branch } from "@/api/types";

/**
 * Hook for filtering branches based on user's assigned access.
 * Superusers have access to all branches.
 * Regular users can only access their assigned branches.
 */
export function useBranchFilter() {
  const user = useAuthStore((state) => state.user);

  /**
   * Get the list of branch codes the user has access to.
   * Returns empty array for superusers (meaning all branches).
   */
  const getUserBranchCodes = useMemo((): string[] => {
    if (!user) return [];
    if (user.is_superuser) return []; // Empty means all branches for superusers
    return user.branches?.map((b) => b.branch_code) || [];
  }, [user]);

  /**
   * Check if the current user is a superuser with access to all branches.
   */
  const hasAllBranchAccess = useMemo((): boolean => {
    return user?.is_superuser === true;
  }, [user]);

  /**
   * Check if user can access a specific branch.
   */
  const canAccessBranch = useCallback(
    (branchCode: string): boolean => {
      if (!user) return false;
      if (user.is_superuser) return true;
      return user.branches?.some((b) => b.branch_code === branchCode) ?? false;
    },
    [user]
  );

  /**
   * Filter a list of branches to only include those the user has access to.
   * Works with both BranchRef (from reference data) and Branch (from API types).
   */
  const filterBranches = useCallback(
    <T extends { branch_code: string }>(branches: T[]): T[] => {
      if (!user) return [];
      if (user.is_superuser) return branches; // Superusers see all branches
      if (!user.branches || user.branches.length === 0) return [];

      const allowedCodes = new Set(user.branches.map((b) => b.branch_code));
      return branches.filter((branch) => allowedCodes.has(branch.branch_code));
    },
    [user]
  );

  /**
   * Get the user's default/first branch code.
   * Useful for pre-selecting a branch in forms.
   */
  const getDefaultBranchCode = useMemo((): string | undefined => {
    if (!user) return undefined;
    if (user.is_superuser) return undefined; // Let superusers choose
    return user.branches?.[0]?.branch_code;
  }, [user]);

  /**
   * Get the user's assigned branches directly.
   */
  const userBranches = useMemo((): Branch[] => {
    if (!user) return [];
    return user.branches || [];
  }, [user]);

  return {
    /** Get list of branch codes user can access (empty for superusers) */
    getUserBranchCodes,
    /** True if user is superuser with all-branch access */
    hasAllBranchAccess,
    /** Check if user can access a specific branch */
    canAccessBranch,
    /** Filter a list of branches to only those user can access */
    filterBranches,
    /** Get user's default/first branch code */
    getDefaultBranchCode,
    /** Get user's assigned branches directly */
    userBranches,
    /** The current user object */
    user,
  };
}

export default useBranchFilter;
