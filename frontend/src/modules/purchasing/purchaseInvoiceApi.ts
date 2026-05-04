/**
 * Purchase Invoice Types & API
 * 
 * Standard ERP flow:
 * PO → GRN (stock received) → Purchase Invoice (liability) → Payment (settlement)
 */

import apiClient from "@/api/client";

// ─── TYPES ────────────────────────────────────────────────────────────────

export interface PurchaseInvoiceItem {
  id: number;
  purchase_invoice_id: number;
  grn_id: number;
  purchasing_order_id?: number;
  product_id?: number;
  quantity: number;
  unit_price: number;
  line_total: number;
  tax_amount: number;
  description?: string;
  created_at?: string;
  // Enriched
  grn_no?: string;
  po_no?: string;
  product_name?: string;
}

export interface PurchaseInvoiceItemCreate {
  grn_id: number;
  purchasing_order_id?: number;
  product_id?: number;
  quantity: number;
  unit_price: number;
  line_total: number;
  tax_amount?: number;
  description?: string;
}

export interface PurchaseInvoice {
  id: number;
  invoice_no: string;
  supplier_invoice_no: string;
  supplier_invoice_date: string;
  supplier_id: number;
  branch_code: string;
  received_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  status: string; // draft, verified, partially_paid, paid, cancelled
  payment_status: string; // unpaid, partial, paid
  created_by?: number;
  verified_by?: number;
  verified_date?: string;
  created_at?: string;
  updated_at?: string;
  supplier_name?: string;
  items: PurchaseInvoiceItem[];
  remarks?: string;
}

export interface PurchaseInvoiceListItem {
  id: number;
  invoice_no: string;
  supplier_invoice_no: string;
  supplier_invoice_date: string;
  supplier_id: number;
  branch_code: string;
  received_date: string;
  due_date: string;
  payment_type: string; // "credit" or "non_credit"
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  status: string;
  payment_status: string;
  created_at?: string;
  supplier_name?: string;
  days_overdue: number;
  is_overdue: boolean;
  advance_amount?: number;
  po_nos?: string; // Comma-separated PO numbers linked to this invoice
}

export interface PurchaseInvoiceCreate {
  supplier_invoice_no: string;
  supplier_invoice_date: string;
  supplier_id: number;
  branch_code: string;
  received_date: string;
  due_date: string;
  payment_type?: string; // "credit" or "non_credit"
  subtotal: number;
  tax_amount?: number;
  discount_amount?: number;
  total_amount: number;
  remarks?: string;
  items: PurchaseInvoiceItemCreate[];
}

export interface PurchaseInvoiceUpdate {
  supplier_invoice_no?: string;
  supplier_invoice_date?: string;
  received_date?: string;
  due_date?: string;
  subtotal?: number;
  tax_amount?: number;
  discount_amount?: number;
  total_amount?: number;
  remarks?: string;
  items?: PurchaseInvoiceItemCreate[];
}

export interface GRNInvoiceableProductDetail {
  product_id: number;
  product_name: string;
  po_item_id: number;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface GRNInvoiceableItem {
  grn_id: number;
  grn_no: string;
  grn_date: string;
  po_id: number;
  po_no: string;
  supplier_invoice_no?: string;
  total_received_qty: number;
  already_invoiced_qty: number;
  remaining_qty: number;
  total_received_amount: number;
  already_invoiced_amount: number;
  remaining_amount: number;
  branch_code: string;
  products: GRNInvoiceableProductDetail[];
}

export interface PaymentAllocationItem {
  purchase_invoice_id: number;
  allocated_amount: number;
}

export interface PaymentWithAllocationsCreate {
  supplier_id: number;
  payment_date: string;
  payment_method: string;
  payment_amount: number;
  reference_number?: string;
  bank_name?: string;
  branch_code: string;
  remarks?: string;
  allocations: PaymentAllocationItem[];
}

export interface PaymentResult {
  payment_id: number;
  payment_no: string;
  payment_amount: number;
  status: string;
  message: string;
}

// ─── API ──────────────────────────────────────────────────────────────────

export const purchaseInvoicesApi = {
  // List invoices with filters
  getAll: async (params?: {
    supplier_id?: number;
    branch_code?: string;
    status?: string;
    payment_status?: string;
    payment_type?: string;
    po_no?: string;
    date_from?: string;
    date_to?: string;
    overdue_only?: boolean;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<PurchaseInvoiceListItem[]>(
      "/purchasing/invoices",
      { params }
    );
    return response.data;
  },

  // Get single invoice with items
  getById: async (id: number) => {
    const response = await apiClient.get<PurchaseInvoice>(
      `/purchasing/invoices/${id}`
    );
    return response.data;
  },

  // Create invoice from GRN(s)
  create: async (data: PurchaseInvoiceCreate) => {
    const response = await apiClient.post<PurchaseInvoice>(
      "/purchasing/invoices",
      data
    );
    return response.data;
  },

  // Update draft invoice
  update: async (id: number, data: PurchaseInvoiceUpdate) => {
    const response = await apiClient.patch<PurchaseInvoice>(
      `/purchasing/invoices/${id}`,
      data
    );
    return response.data;
  },

  // Verify invoice (makes it payable)
  verify: async (id: number) => {
    const response = await apiClient.post<PurchaseInvoice>(
      `/purchasing/invoices/${id}/verify`
    );
    return response.data;
  },

  // Cancel invoice
  cancel: async (id: number) => {
    const response = await apiClient.post<PurchaseInvoice>(
      `/purchasing/invoices/${id}/cancel`
    );
    return response.data;
  },

  // Get GRNs that can be invoiced for a supplier
  getInvoiceableGRNs: async (supplierId: number, branchCode?: string) => {
    const params = branchCode ? { branch_code: branchCode } : {};
    const response = await apiClient.get<GRNInvoiceableItem[]>(
      `/purchasing/invoices/supplier/${supplierId}/invoiceable-grns`,
      { params }
    );
    return response.data;
  },

  // Get payable invoices for a supplier (verified + unpaid/partial)
  getPayableInvoices: async (supplierId: number) => {
    const response = await apiClient.get<PurchaseInvoiceListItem[]>(
      `/purchasing/invoices/supplier/${supplierId}/payable`
    );
    return response.data;
  },

  // Get all outstanding invoices across all suppliers (for report page)
  getOutstandingInvoices: async (params?: {
    supplier_id?: number;
    branch_code?: string;
    payment_type?: string;
  }) => {
    const response = await apiClient.get<PurchaseInvoiceListItem[]>(
      "/purchasing/invoices/outstanding",
      { params }
    );
    return response.data;
  },

  // Pay against invoices with allocations
  payInvoices: async (data: PaymentWithAllocationsCreate) => {
    const response = await apiClient.post<PaymentResult>(
      "/purchasing/invoices/pay",
      data
    );
    return response.data;
  },
};
