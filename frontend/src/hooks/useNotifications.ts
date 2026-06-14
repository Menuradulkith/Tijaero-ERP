import { notificationsApi } from "@/modules/notifications/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"];
export const NOTIFICATIONS_STATS_QUERY_KEY = ["notifications", "stats"];

export interface UseNotificationsOptions {
  unreadOnly?: boolean;
  category?: string;
  skip?: number;
  limit?: number;
  /** Polling interval in ms (default 60s). */
  refetchInterval?: number;
}

/**
 * Central hook for the notification inbox (user-based + branch-based).
 *
 * Notifications are delivered server-side to the current user either directly
 * or via their branch; this hook just reads that inbox and exposes read/delete
 * actions. All read/delete operations use the per-user *recipient* id.
 */
export function useNotifications(options: UseNotificationsOptions = {}) {
  const {
    unreadOnly = false,
    category,
    skip = 0,
    limit = 50,
    refetchInterval = 60000,
  } = options;

  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_STATS_QUERY_KEY });
  };

  const notificationsQuery = useQuery({
    queryKey: [...NOTIFICATIONS_QUERY_KEY, { unreadOnly, category, skip, limit }],
    queryFn: () => notificationsApi.list({ unreadOnly, category, skip, limit }),
    refetchInterval,
    refetchIntervalInBackground: false,
  });

  const statsQuery = useQuery({
    queryKey: NOTIFICATIONS_STATS_QUERY_KEY,
    queryFn: () => notificationsApi.getStats(),
    refetchInterval,
    refetchIntervalInBackground: false,
  });

  const markAsReadMutation = useMutation({
    mutationFn: (recipientId: number) => notificationsApi.markAsRead(recipientId),
    onSuccess: invalidate,
    onError: (error: Error) => {
      console.error(error);
      toast.error("Failed to mark notification as read");
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(),
    onSuccess: () => {
      invalidate();
      toast.success("All notifications marked as read");
    },
    onError: (error: Error) => {
      console.error(error);
      toast.error("Failed to mark all notifications as read");
    },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: (recipientId: number) => notificationsApi.remove(recipientId),
    onSuccess: () => {
      invalidate();
      toast.success("Notification deleted");
    },
    onError: (error: Error) => {
      console.error(error);
      toast.error("Failed to delete notification");
    },
  });

  return {
    notifications: notificationsQuery.data || [],
    isLoading: notificationsQuery.isLoading,
    isError: notificationsQuery.isError,
    stats: statsQuery.data,
    markAsRead: markAsReadMutation.mutate,
    markAllAsRead: markAllAsReadMutation.mutate,
    deleteNotification: deleteNotificationMutation.mutate,
    isMarkingRead: markAsReadMutation.isPending,
    isMarkingAllRead: markAllAsReadMutation.isPending,
    isDeleting: deleteNotificationMutation.isPending,
    refetch: () => {
      notificationsQuery.refetch();
      statsQuery.refetch();
    },
  };
}
