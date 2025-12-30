export interface Notification {
  id: number;
  user_id: number;
  title: string;
  message: string;
  notification_type: "info" | "success" | "warning" | "error";
  is_read: boolean;
  created_date: string;
  read_date?: string;
  action_url?: string;
  metadata?: Record<string, any>;
}

export interface NotificationStats {
  total: number;
  unread: number;
  read: number;
}

export interface UserPreferences {
  id: number;
  user_id: number;
  theme: "light" | "dark";
  language: string;
  timezone: string;
  notifications_enabled: boolean;
  email_notifications: boolean;
  desktop_notifications: boolean;
  default_branch?: string;
  items_per_page: number;
  date_format: string;
  currency_format: string;
  updated_date: string;
}

export interface UserPreferencesUpdate {
  theme?: "light" | "dark";
  language?: string;
  timezone?: string;
  notifications_enabled?: boolean;
  email_notifications?: boolean;
  desktop_notifications?: boolean;
  default_branch?: string;
  items_per_page?: number;
  date_format?: string;
  currency_format?: string;
}

export interface ProfileUpdate {
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  email?: string;
  occupation?: string;
  birthdate?: string;
}

export interface PasswordChange {
  current_password: string;
  new_password: string;
  confirm_password: string;
}
