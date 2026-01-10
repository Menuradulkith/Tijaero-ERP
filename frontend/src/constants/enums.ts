/**
 * Centralized Enums for TijaeroERP Frontend
 * These should match backend enums for consistency
 */

// Order Status
export enum OrderStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  ON_HOLD = 'on_hold',
}

// Payment Status
export enum PaymentStatus {
  UNPAID = 'unpaid',
  PARTIAL = 'partial',
  PAID = 'paid',
  OVERDUE = 'overdue',
  REFUNDED = 'refunded',
}

// Payment Methods
export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  CHEQUE = 'cheque',
  BANK_TRANSFER = 'bank_transfer',
  CREDIT = 'credit',
  MOBILE_PAYMENT = 'mobile_payment',
}

// Invoice Status
export enum InvoiceStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  SENT = 'sent',
  PAID = 'paid',
  PARTIAL = 'partial',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

// Purchase Order Status
export enum PurchaseOrderStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  APPROVED = 'approved',
  ORDERED = 'ordered',
  PARTIALLY_RECEIVED = 'partially_received',
  RECEIVED = 'received',
  CANCELLED = 'cancelled',
}

// Transfer Status
export enum TransferStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  APPROVED = 'approved',
  IN_TRANSIT = 'in_transit',
  RECEIVED = 'received',
  CANCELLED = 'cancelled',
}

// Leave Status
export enum LeaveStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

// Attendance Status
export enum AttendanceStatus {
  PRESENT = 'present',
  ABSENT = 'absent',
  LATE = 'late',
  HALF_DAY = 'half_day',
  ON_LEAVE = 'on_leave',
  HOLIDAY = 'holiday',
}

// User Roles
export enum UserRole {
  SUPERADMIN = 'superadmin',
  ADMIN = 'admin',
  MANAGER = 'manager',
  STAFF = 'staff',
  VIEWER = 'viewer',
}

// Approval Status
export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REVISION_REQUIRED = 'revision_required',
}

// Support Ticket Status
export enum SupportTicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  WAITING_CUSTOMER = 'waiting_customer',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

// Status Color Mappings for UI
export const STATUS_COLORS: Record<string, string> = {
  // Success states
  completed: 'green',
  paid: 'green',
  approved: 'green',
  resolved: 'green',
  received: 'green',
  present: 'green',
  
  // Warning states
  pending: 'yellow',
  partial: 'yellow',
  processing: 'yellow',
  in_transit: 'yellow',
  in_progress: 'yellow',
  waiting_customer: 'yellow',
  
  // Danger states
  cancelled: 'red',
  rejected: 'red',
  overdue: 'red',
  absent: 'red',
  refunded: 'red',
  
  // Neutral states
  draft: 'gray',
  on_hold: 'gray',
  
  // Info states
  confirmed: 'blue',
  sent: 'blue',
  ordered: 'blue',
};
