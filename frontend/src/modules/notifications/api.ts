import apiClient from "@/api/client";

import type {
  AppNotification,
  NotificationCreate,
  NotificationStats,
} from "./types";

/**
 * Notification API client.
 *
 * Endpoints are mounted at `/notifications` on the backend. All read/delete
 * operations act on the *recipient* id (the current user's copy).
 */
export const notificationsApi = {
  list: async (params?: {
    unreadOnly?: boolean;
    category?: string;
    skip?: number;
    limit?: number;
  }): Promise<AppNotification[]> => {
    const response = await apiClient.get<AppNotification[]>("/notifications", {
      params: {
        unread_only: params?.unreadOnly ?? false,
        category: params?.category,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 50,
      },
    });
    return response.data;
  },

  getStats: async (): Promise<NotificationStats> => {
    const response = await apiClient.get<NotificationStats>(
      "/notifications/stats",
    );
    return response.data;
  },

  markAsRead: async (recipientId: number): Promise<AppNotification> => {
    const response = await apiClient.post<AppNotification>(
      `/notifications/${recipientId}/read`,
    );
    return response.data;
  },

  markAllAsRead: async (): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      "/notifications/read-all",
    );
    return response.data;
  },

  remove: async (recipientId: number): Promise<void> => {
    await apiClient.delete(`/notifications/${recipientId}`);
  },

  /** Superuser-only: send a manual/announcement notification. */
  send: async (payload: NotificationCreate): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      "/notifications",
      payload,
    );
    return response.data;
  },

  /**
   * Superuser-only: scan stock and notify each branch about products at or
   * below `threshold` available units. Returns a summary message.
   */
  runLowStockAlerts: async (
    threshold = 5,
  ): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      "/notifications/alerts/low-stock",
      null,
      { params: { threshold } },
    );
    return response.data;
  },

  /**
   * Superuser-only: notify each branch about its unpaid customer invoices
   * (outstanding receivables). Returns a summary message.
   */
  runOutstandingPaymentAlerts: async (): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      "/notifications/alerts/outstanding-payments",
    );
    return response.data;
  },
};

export default notificationsApi;
