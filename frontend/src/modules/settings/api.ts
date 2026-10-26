import apiClient from "@/api/client";
import * as types from "./types";

export const settingsApi = {
  // Notifications
  getNotifications: async (
    unreadOnly: boolean = false,
    skip: number = 0,
    limit: number = 50,
  ) => {
    const response = await apiClient.get<types.Notification[]>(
      "/settings/notifications",
      {
        params: { unread_only: unreadOnly, skip, limit },
      },
    );
    return response.data;
  },

  getNotificationStats: async () => {
    const response = await apiClient.get<types.NotificationStats>(
      "/settings/notifications/stats",
    );
    return response.data;
  },

  markAsRead: async (notificationId: number) => {
    const response = await apiClient.put<types.Notification>(
      `/settings/notifications/${notificationId}/read`,
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
      "/settings/preferences",
    );
    return response.data;
  },

  updatePreferences: async (preferences: types.UserPreferencesUpdate) => {
    const response = await apiClient.put<types.UserPreferences>(
      "/settings/preferences",
      preferences,
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
      passwordChange,
    );
    return response.data;
  },



  // Email Templates & Logs
  getEmailLogs: async () => {
    const response = await apiClient.get("/communication/email/logs");
    return response.data;
  },

  getEmailTemplates: async () => {
    const response = await apiClient.get("/communication/email/templates");
    return response.data;
  },

  updateEmailTemplate: async (id: number, data: { subject_template?: string; body_template?: string }) => {
    const response = await apiClient.put(`/communication/email/templates/${id}`, data);
    return response.data;
  },

  // Print Templates
  getPrintDocumentTypes: async () => {
    const response = await apiClient.get<types.PrintDocumentType[]>("/reporting/print-templates/document-types");
    return response.data;
  },

  getPrintTemplates: async (documentType?: string) => {
    const response = await apiClient.get<types.PrintTemplateSummary[]>("/reporting/print-templates", {
      params: documentType ? { document_type: documentType } : undefined,
    });
    return response.data;
  },

  getPrintTemplate: async (id: number) => {
    const response = await apiClient.get<types.PrintTemplateDetail>(`/reporting/print-templates/${id}`);
    return response.data;
  },

  createPrintTemplate: async (data: types.PrintTemplatePayload & { document_type: string; is_default: boolean }) => {
    const response = await apiClient.post<types.PrintTemplateDetail>("/reporting/print-templates", data);
    return response.data;
  },

  updatePrintTemplate: async (id: number, data: types.PrintTemplatePayload & { expected_version: number }) => {
    const response = await apiClient.put<types.PrintTemplateDetail>(`/reporting/print-templates/${id}`, data);
    return response.data;
  },

  deletePrintTemplate: async (id: number) => {
    await apiClient.delete(`/reporting/print-templates/${id}`);
  },

  setDefaultPrintTemplate: async (id: number, isDefault: boolean) => {
    const action = isDefault ? "set-default" : "unset-default";
    const response = await apiClient.post<types.PrintTemplateDetail>(`/reporting/print-templates/${id}/${action}`);
    return response.data;
  },

  getPrintTemplateVersions: async (id: number) => {
    const response = await apiClient.get<types.PrintTemplateVersion[]>(`/reporting/print-templates/${id}/versions`);
    return response.data;
  },

  restorePrintTemplateVersion: async (id: number, version: number) => {
    const response = await apiClient.post<types.PrintTemplateDetail>(
      `/reporting/print-templates/${id}/versions/${version}/restore`,
    );
    return response.data;
  },

  getPrintSampleDocuments: async (documentType: string) => {
    const response = await apiClient.get<types.PrintSampleDocument[]>("/reporting/print-templates/sample-documents", {
      params: { document_type: documentType },
    });
    return response.data;
  },

  /** Rendered HTML of an unsaved template against a real document. */
  previewPrintTemplate: async (
    data: types.PrintTemplatePayload & { document_type: string; document_id: number | null },
    signal?: AbortSignal,
  ) => {
    const response = await apiClient.post<string>("/reporting/print-templates/preview", data, {
      responseType: "text",
      signal,
    });
    return {
      html: response.data,
      fallbackError: (response.headers["x-print-template-fallback"] as string | undefined) ?? null,
    };
  },

  // Company logo (printed on documents and report exports)
  getCompanyLogo: async () => {
    const response = await apiClient.get<{ logo: string | null }>("/settings/company/logo");
    return response.data;
  },

  updateCompanyLogo: async (logo: string | null) => {
    const response = await apiClient.put<{ logo: string | null }>("/settings/company/logo", { logo });
    return response.data;
  },

  // Company Settings
  getCompanySettings: async () => {
    const response =
      await apiClient.get<types.CompanySettings>("/settings/company");
    return response.data;
  },

  updateCompanySettings: async (settings: types.CompanySettingsUpdate) => {
    const response = await apiClient.put<types.CompanySettings>(
      "/settings/company",
      settings,
    );
    return response.data;
  },

  // Currencies
  getCurrencies: async () => {
    const response = await apiClient.get<types.Currency[]>(
      "/settings/currencies",
    );
    return response.data;
  },

  createCurrency: async (data: types.CurrencyCreate) => {
    const response = await apiClient.post<types.Currency>(
      "/settings/currencies",
      data,
    );
    return response.data;
  },

  updateCurrency: async (id: number, data: types.CurrencyUpdate) => {
    const response = await apiClient.put<types.Currency>(
      `/settings/currencies/${id}`,
      data,
    );
    return response.data;
  },

  deleteCurrency: async (id: number) => {
    await apiClient.delete(`/settings/currencies/${id}`);
  },

  setActiveCurrency: async (code: string) => {
    const response = await apiClient.put<types.CompanySettings>(
      `/settings/currencies/active/${code}`,
    );
    return response.data;
  },

  // Timezones
  getTimezones: async () => {
    const response = await apiClient.get<types.TimezoneOption[]>(
      "/settings/timezones",
    );
    return response.data;
  },
};
