import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/state/authStore";
import { hasPermission } from "@/auth/permissions";
import { PermissionDenied } from "./PermissionGuard";

interface ProtectedRouteProps {
  children: React.ReactNode;
  resource?: string;
  action?: string;
}

export default function ProtectedRoute({
  children,
  resource,
  action,
}: ProtectedRouteProps) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  // isAuthenticated is pre-populated from localStorage synchronously in
  // authStore.ts, so this check is correct on the very first render after
  // a page refresh — no redirect-on-refresh.
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // A forced password reset (set by an admin, e.g. after unblocking a
  // locked-out account) traps the user on the Settings page — where they can
  // change their password — until they do. Every other route redirects back.
  if (user?.must_change_password && location.pathname !== "/settings") {
    return <Navigate to="/settings" state={{ from: location }} replace />;
  }

  // If permission is required, check it (skipped while a password reset is
  // pending, so it can never be blocked by a missing "settings" permission).
  if (resource && action && !user?.must_change_password) {
    const hasAccess = hasPermission(user, resource, action);
    if (!hasAccess) {
      return <PermissionDenied />;
    }
  }

  return <>{children}</>;
}
