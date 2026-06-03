/**
 * Customer Agent Commission Types
 */

// =============================================================================
// Commission Types
// =============================================================================

export interface CustomerAgentCommission {
  id: number;
  invoice_id: number;
  customer_agent_id: number;
  represented_customer_id: number;
  invoice_amount: number;
  commission_type: 'PERCENT' | 'AMOUNT';
  commission_rate?: number;
  commission_amount: number;
  status: 'pending' | 'approved' | 'paid' | 'cancelled';
  approved_by?: number;
  approved_date?: string;
  remarks?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CustomerAgentCommissionWithDetails extends CustomerAgentCommission {
  agent_name?: string;
  customer_name?: string;
  invoice_no?: string;
  total_paid?: number;
}

export interface CustomerAgentCommissionCreate {
  invoice_id: number;
  customer_agent_id: number;
  represented_customer_id: number;
  invoice_amount: number;
  commission_type: 'PERCENT' | 'AMOUNT';
  commission_rate?: number;
  commission_amount: number;
  remarks?: string;
}

export interface CustomerAgentCommissionUpdate {
  commission_type?: 'PERCENT' | 'AMOUNT';
  commission_rate?: number;
  commission_amount?: number;
  status?: string;
  remarks?: string;
}

export interface CommissionListResponse {
  items: CustomerAgentCommissionWithDetails[];
  total: number;
}

// =============================================================================
// Commission Payment Types
// =============================================================================

export interface CommissionPaymentItem {
  id: number;
  payment_id: number;
  commission_id: number;
  paid_amount: number;
  created_at?: string;
}

export interface CommissionPaymentItemWithDetails extends CommissionPaymentItem {
  invoice_no?: string;
  invoice_amount?: number;
  commission_amount?: number;
  commission_status?: string;
}

export interface CommissionPaymentItemCreate {
  commission_id: number;
  paid_amount: number;
}

export interface CustomerAgentCommissionPayment {
  id: number;
  payment_no: string;
  customer_agent_id: number;
  payment_date: string;
  payment_method: string;
  payment_amount: number;
  reference_number?: string;
  bank_name?: string;
  branch_code: string;
  remarks?: string;
  status: 'pending' | 'verified' | 'cancelled';
  verified_by?: number;
  verified_date?: string;
  created_by?: number;
  created_at?: string;
}

export interface CustomerAgentCommissionPaymentWithItems extends CustomerAgentCommissionPayment {
  items: CommissionPaymentItemWithDetails[];
  agent_name?: string;
}

export interface CustomerAgentCommissionPaymentCreate {
  customer_agent_id: number;
  payment_date: string;
  payment_method: string;
  payment_amount: number;
  reference_number?: string;
  bank_name?: string;
  branch_code: string;
  remarks?: string;
  items: CommissionPaymentItemCreate[];
}

// =============================================================================
// Summary Types
// =============================================================================

export interface AgentCommissionSummary {
  agent_id: number;
  agent_name: string;
  total_commissions: number;
  pending_amount: number;
  approved_amount: number;
  paid_amount: number;
  total_invoices: number;
  pending_count: number;
  approved_count: number;
  paid_count: number;
}

// =============================================================================
// Constants
// =============================================================================

export const COMMISSION_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const COMMISSION_TYPE_OPTIONS = [
  { value: 'PERCENT', label: 'Percentage (%)' },
  { value: 'AMOUNT', label: 'Fixed Amount (Rs.)' },
];

export const PAYMENT_METHOD_OPTIONS = [
  { value: 'Cash', label: 'Cash' },
  { value: 'Bank Transfer', label: 'Bank Transfer' },
  { value: 'Cheque', label: 'Cheque' },
];

export const PAYMENT_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'cancelled', label: 'Cancelled' },
];
