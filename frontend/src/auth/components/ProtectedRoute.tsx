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

  // Check authentication first
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If permission is required, check it
  if (resource && action) {
    const hasAccess = hasPermission(user, resource, action);
    if (!hasAccess) {
      return <PermissionDenied />;
    }
  }

  return <>{children}</>;
}
