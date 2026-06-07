import { settingsApi } from "@/modules/settings/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"];
export const NOTIFICATIONS_STATS_QUERY_KEY = ["notifications", "stats"];

export function useNotifications(unreadOnly = false, skip = 0, limit = 50) {
  const queryClient = useQueryClient();

  const notificationsQuery = useQuery({
    queryKey: [...NOTIFICATIONS_QUERY_KEY, { unreadOnly, skip, limit }],
    queryFn: () => settingsApi.getNotifications(unreadOnly, skip, limit),
    refetchInterval: 60000, // Refetch every minute
    refetchIntervalInBackground: false, // Don't poll when tab is not visible
  });

  const statsQuery = useQuery({
    queryKey: NOTIFICATIONS_STATS_QUERY_KEY,
    queryFn: () => settingsApi.getNotificationStats(),
    refetchInterval: 60000,
    refetchIntervalInBackground: false, // Don't poll when tab is not visible
  });

  const markAsReadMutation = useMutation({
    mutationFn: (id: number) => settingsApi.markAsRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      queryClient.invalidateQueries({
        queryKey: NOTIFICATIONS_STATS_QUERY_KEY,
      });
    },
    onError: (error: Error) => {
      console.error(error);
      toast.error("Failed to mark notification as read");
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: () => settingsApi.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      queryClient.invalidateQueries({
        queryKey: NOTIFICATIONS_STATS_QUERY_KEY,
      });
      toast.success("All notifications marked as read");
    },
    onError: (error: Error) => {
      console.error(error);
      toast.error("Failed to mark all notifications as read");
    },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: (id: number) => settingsApi.deleteNotification(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      queryClient.invalidateQueries({
        queryKey: NOTIFICATIONS_STATS_QUERY_KEY,
      });
      // Keep delete quite or subtle, but let's use a toast so the user knows it worked
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
