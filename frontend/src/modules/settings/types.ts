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
  default_tax_rate: number;
  tax_inclusive_pricing: boolean;
  hide_service_charge: boolean;
  amex_card_surcharge: number;
  visa_card_surcharge: number;
  master_card_surcharge: number;
  fiscal_year_start: string;
  default_currency: string;
  default_timezone: string;
  tax_registration_number?: string;
  company_website?: string | null;
  business_registration_number?: string | null;
  bank_name?: string | null;
  bank_branch?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_swift_code?: string | null;
  /** The logo itself comes from GET /settings/company/logo. */
  has_company_logo?: boolean;
}

export interface CompanySettingsUpdate extends Partial<
  Omit<CompanySettings, "id" | "has_company_logo">
> {}

/** Company details printed on documents (Company Settings → Documents). */
export interface CompanyDocumentDetails {
  company_website: string;
  business_registration_number: string;
  bank_name: string;
  bank_branch: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_swift_code: string;
}

export interface Currency {
  id: number;
  code: string;
  name: string;
  symbol: string;
  is_active: boolean;
}

export interface CurrencyCreate {
  code: string;
  name: string;
  symbol: string;
  is_active?: boolean;
}

export type CurrencyUpdate = Partial<Omit<CurrencyCreate, "code">>;

export interface TimezoneOption {
  name: string;
  offset: string;
}

// ─── Print templates ─────────────────────────────────────────────────────────

export type PaperSize = "A4" | "A5" | "Letter" | "Legal" | "80mm";
export type Orientation = "portrait" | "landscape";

export interface PrintLayoutSettings {
  show_header: boolean;
  show_discount: boolean;
  show_signatures: boolean;
  logo: string | null;
  primary_color: string | null;
  company_name: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  header_text: string | null;
  terms: string | null;
  bank_details: string | null;
  footer_text: string | null;
  /** "standard" or one of the document type's alternative layouts (e.g. "preprinted"). */
  layout_style: string;
  show_amount_in_words: boolean;
  show_bank_details: boolean;
}

export interface PrintDocumentType {
  key: string;
  label: string;
  required_fields: string[];
  supports_discount: boolean;
  layouts: { key: string; label: string }[];
  has_id: boolean;
}

export interface PrintTemplateSummary {
  id: number;
  document_type: string;
  name: string;
  branch_code: string | null;
  paper_size: PaperSize | null;
  orientation: Orientation;
  is_default: boolean;
  is_active: boolean;
  has_custom_html: boolean;
  version: number;
  updated_at: string | null;
  updated_by: number | null;
}

export interface PrintTemplateDetail extends PrintTemplateSummary {
  settings: PrintLayoutSettings;
  custom_html: string | null;
}

export interface PrintTemplatePayload {
  name: string;
  branch_code: string | null;
  paper_size: PaperSize | null;
  orientation: Orientation;
  settings: PrintLayoutSettings;
  custom_html: string | null;
  is_active: boolean;
}

export interface PrintTemplateVersion {
  version: number;
  created_at: string;
  created_by: number | null;
  snapshot: Partial<PrintTemplatePayload>;
}

export interface PrintSampleDocument {
  id: number;
  number: string;
  branch_code: string | null;
}
