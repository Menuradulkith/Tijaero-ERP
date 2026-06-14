/**
 * Notification system types (user-based + branch-based delivery).
 *
 * `id` is the per-user *recipient* id — it is what the client uses to mark a
 * notification read or delete it, so each user only ever acts on their own copy.
 */

export type NotificationType = "info" | "success" | "warning" | "error";

export type NotificationCategory =
  | "system"
  | "sales"
  | "purchasing"
  | "inventory"
  | "warehouse"
  | "finance"
  | "hr"
  | "support"
  | "approvals";

export interface AppNotification {
  /** Recipient row id (per-user delivery) — used for read/delete actions. */
  id: number;
  /** Underlying notification (content) id. */
  notification_id: number;
  title: string;
  message: string;
  notification_type: NotificationType;
  category: NotificationCategory | string;
  action_url?: string | null;
  extra_data?: Record<string, unknown> | null;
  branch_code?: string | null;
  is_read: boolean;
  created_date: string;
  read_date?: string | null;
}

export interface NotificationStats {
  total: number;
  unread: number;
  read: number;
}

/** Admin/manual send payload (superuser only). */
export interface NotificationCreate {
  title: string;
  message: string;
  notification_type?: NotificationType;
  category?: NotificationCategory | string;
  action_url?: string;
  extra_data?: Record<string, unknown>;
  user_ids?: number[];
  branch_codes?: string[];
  broadcast?: boolean;
}
