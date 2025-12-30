import apiClient from "@/api/client";
import * as types from "./types";

export const settingsApi = {
  // Notifications
  getNotifications: async (
    unreadOnly: boolean = false,
    skip: number = 0,
    limit: number = 50
  ) => {
    const response = await apiClient.get<types.Notification[]>(
      "/settings/notifications",
      {
        params: { unread_only: unreadOnly, skip, limit },
      }
    );
    return response.data;
  },

  getNotificationStats: async () => {
    const response = await apiClient.get<types.NotificationStats>(
      "/settings/notifications/stats"
    );
    return response.data;
  },

  markAsRead: async (notificationId: number) => {
    const response = await apiClient.put<types.Notification>(
      `/settings/notifications/${notificationId}/read`
    );
    return response.data;
  },

  markAllAsRead: async () => {
    const response = await apiClient.put("/settings/notifications/read-all");
    return response.data;
  },

  deleteNotification: async (notificationId: number) => {
    await apiClient.delete(`/settings/notifications/${notificationId}`);
  },

  // Preferences
  getPreferences: async () => {
    const response = await apiClient.get<types.UserPreferences>(
      "/settings/preferences"
    );
    return response.data;
  },

  updatePreferences: async (preferences: types.UserPreferencesUpdate) => {
    const response = await apiClient.put<types.UserPreferences>(
      "/settings/preferences",
      preferences
    );
    return response.data;
  },

  // Profile
  updateProfile: async (profile: types.ProfileUpdate) => {
    const response = await apiClient.put("/settings/profile", profile);
    return response.data;
  },

  changePassword: async (passwordChange: types.PasswordChange) => {
    const response = await apiClient.post(
      "/settings/change-password",
      passwordChange
    );
    return response.data;
  },
};
