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
  gender?: string;
  date_joined?: string;
  birthdate?: string;
}

export interface PasswordChange {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export interface CompanySettings {
  id: number;
  company_name: string;
  company_address: string;
  company_telephone_number?: string;
  company_fax_number?: string;
  company_email: string;
  company_logo_id?: number;
  depreciation_rate: number;
  number_of_annual_leaves: number;
  number_of_casual_leaves: number;
  number_of_medical_leaves: number;
  amex_card_surcharge: number;
  visa_card_surcharge: number;
  master_card_surcharge: number;
  fiscal_year_start: string;
  default_currency: string;
  tax_registration_number?: string;
}

export interface CompanySettingsUpdate extends Partial<
  Omit<CompanySettings, "id">
> {}
