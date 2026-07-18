export interface DateRangeFilter {
  start_date: string;
  end_date: string;
}

export interface SalesReportRequest extends DateRangeFilter {
  branch_code?: string;
  customer_id?: number;
  product_id?: number;
}

export interface SalesReportResponse {
  total_sales: number;
  total_orders: number;
  total_customers: number;
  average_order_value: number;
  top_products: Array<{
    product_name: string;
    quantity_sold: number;
    revenue: number;
  }>;
  sales_by_date: Array<{
    date: string;
    orders: number;
    revenue: number;
  }>;
  sales_by_branch: Array<{
    branch_code: string;
    orders: number;
    revenue: number;
  }>;
}

export interface FinanceReportRequest extends DateRangeFilter {
  report_type: string;
}

export interface FinanceReportResponse {
  total_income: number;
  total_expenses: number;
  net_profit: number;
  bank_deposits: number;
  card_payments: number;
  cheque_payments: number;
  expenses_by_category: Array<{
    category: string;
    amount: number;
  }>;
  monthly_summary: Array<{
    month: number;
    income: number;
  }>;
}

export interface InventoryReportRequest {
  branch_code?: string;
  category?: string;
  low_stock_threshold?: number;
}

export interface InventoryReportResponse {
  total_products: number;
  total_stock_value: number;
  low_stock_items: Array<{
    product_name: string;
    item_code: string;
    cost_price: number;
  }>;
  stock_by_category: Array<{
    category_id: number;
    count: number;
  }>;
  stock_by_branch: Array<any>;
}

export interface HRReportRequest extends DateRangeFilter {
  department?: string;
}

export interface HRReportResponse {
  total_employees: number;
  total_payroll: number;
  total_reimbursements: number;
  total_deductions: number;
  payroll_by_month: Array<any>;
  department_summary: Array<any>;
}

export interface WarehouseReportRequest extends DateRangeFilter {
  warehouse_id?: number;
}

export interface WarehouseReportResponse {
  total_transfers: number;
  total_receives: number;
  pending_approvals: number;
  transfer_by_status: Array<any>;
  warehouse_activity: Array<any>;
}

export interface SupportReportRequest extends DateRangeFilter {
  branch_code?: string;
  job_type?: string;
}

export interface SupportReportResponse {
  total_tickets: number;
  open_tickets: number;
  closed_tickets: number;
  total_warranty_claims: number;
  tickets_by_type: Array<{
    job_type: string;
    count: number;
  }>;
  tickets_by_status: Array<any>;
  average_resolution_time?: number;
}

export interface DashboardMetrics {
  total_sales_today: number;
  total_sales_month: number;
  total_orders_today: number;
  total_orders_month: number;
  total_customers: number;
  total_products: number;
  low_stock_items: number;
  pending_approvals: number;
  open_support_tickets: number;
  recent_activities: Array<any>;
}

export interface QuickStats {
  period: string;
  start_date: string;
  end_date: string;
  sales: {
    total_sales: number;
    total_orders: number;
    average_order_value: number;
  };
  finance: {
    total_income: number;
    total_expenses: number;
    net_profit: number;
  };
}

// ── Branch Daily Summary ──────────────────────────────────────────────────────

export interface BranchOption {
  branch_code: string;
  branch_name: string;
}

export interface BranchDailySummary {
  branch_code: string;
  branch_name: string;
  start_date: string;
  end_date: string;
  sales: {
    invoice_count: number;
    cash: number;
    card: number;
    bank_transfer: number;
    credit: number;
    cheque: number;
    other: number;
    total_gross: number;
    details: Array<{
      invoice_no: string;
      total: number;
      cash: number;
      card: number;
      bank: number;
      credit: number;
      cheque: number;
    }>;
  };
  returns: {
    total_refunds: number;
    details: Array<{
      return_no: string;
      total_refund: number;
    }>;
  };
  net_sales: number;
  purchasing: {
    po_count: number;
    total_value: number;
    by_status: Record<string, number>;
    details: Array<{
      po_no: string;
      status: string;
      value: number;
    }>;
  };
  cash_banking: {
    total_banked: number;
    banking_details: Array<{
      time: string;
      amount: number;
    }>;
    money_in: number;
    inflow_details: Array<{
      time: string;
      type: string;
      source_table: string;
      source_id: number;
      amount: number;
    }>;
    money_out: number;
    outflow_details: Array<{
      time: string;
      type: string;
      source_table: string;
      source_id: number;
      amount: number;
    }>;
    cash_in_hand_eod: number;
    petty_cash_balance: number;
  };
  expenses: {
    total: number;
    details: Array<{
      expense_no: string;
      type: string;
      vendor: string;
      amount: number;
    }>;
  };
  vouchers: {
    total: number;
    details: Array<{
      voucher_no: string;
      type: string;
      amount: number;
    }>;
  };
}
