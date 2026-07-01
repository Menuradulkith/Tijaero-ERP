/**
 * Debtors API Integration
 * 
 * API calls for retrieving debtors data, customer debt details, 
 * and managing follow-ups
 */

import apiClient from "@/api/client";
import {
  DebtorSummary,
  CustomerDebtDetails,
  DebtorStatement,
  FollowupRecord,
  DebtorsReport,
  DebtorSummaryRequest,
  StatementFilters,
} from "../types/debtors";

const API_BASE = "/sales";

export const debtorsApi = {
  /**
   * Get summary of all debtors
   * Returns list of customers with outstanding credit balances
   */
  async getDebtorsList(
    filters?: DebtorSummaryRequest
  ): Promise<DebtorsReport> {
    const params: Record<string, any> = {};

    if (filters?.status_filter && filters.status_filter !== "all") {
      params.status = filters.status_filter;
    }
    if (filters?.min_outstanding) {
      params.min_outstanding = filters.min_outstanding;
    }
    if (filters?.max_outstanding) {
      params.max_outstanding = filters.max_outstanding;
    }
    if (filters?.sort_by) {
      params.sort_by = filters.sort_by;
    }
    if (filters?.sort_order) {
      params.sort_order = filters.sort_order;
    }
    if (filters?.skip) {
      params.skip = filters.skip;
    }
    if (filters?.limit) {
      params.limit = filters.limit;
    }

    const response = await apiClient.get<DebtorsReport>(
      `${API_BASE}/debtors`,
      { params }
    );
    return response.data;
  },

  /**
   * Get detailed debt information for a specific customer
   * Includes all invoices, payments, and outstanding amounts
   */
  async getCustomerDebtDetails(
    customerId: number
  ): Promise<CustomerDebtDetails> {
    const response = await apiClient.get<CustomerDebtDetails>(
      `${API_BASE}/customers/${customerId}/debt-details`
    );
    return response.data;
  },

  /**
   * Get customer statement/aging report
   * Shows payment history, aging breakdown, and credit utilization
   */
  async getCustomerStatement(
    filters: StatementFilters
  ): Promise<DebtorStatement> {
    const params: Record<string, any> = {
      customer_id: filters.customer_id,
    };

    if (filters.from_date) {
      params.from_date = filters.from_date;
    }
    if (filters.to_date) {
      params.to_date = filters.to_date;
    }
    if (filters.include_payments !== undefined) {
      params.include_payments = filters.include_payments;
    }

    const response = await apiClient.get<DebtorStatement>(
      `${API_BASE}/debtors/statement`,
      { params }
    );
    return response.data;
  },

  /**
   * Get aging breakdown for a customer
   * Returns invoices grouped by age (current, 30-60 days, 60-90 days, 90+ days)
   */
  async getCustomerAging(customerId: number) {
    const response = await apiClient.get(
      `${API_BASE}/customers/${customerId}/aging`
    );
    return response.data;
  },

  /**
   * Get follow-up history for a customer
   */
  async getFollowupHistory(customerId: number): Promise<FollowupRecord[]> {
    const response = await apiClient.get<FollowupRecord[]>(
      `${API_BASE}/customers/${customerId}/followups`
    );
    return response.data;
  },

  /**
   * Create or update a follow-up record
   */
  async saveFollowup(
    customerId: number,
    followup: FollowupRecord
  ): Promise<FollowupRecord> {
    if (followup.id) {
      const response = await apiClient.put<FollowupRecord>(
        `${API_BASE}/followups/${followup.id}`,
        followup
      );
      return response.data;
    } else {
      const response = await apiClient.post<FollowupRecord>(
        `${API_BASE}/customers/${customerId}/followups`,
        followup
      );
      return response.data;
    }
  },

  /**
   * Get debtors aging report
   * Summary of all debtors grouped by aging buckets
   */
  async getAgingReport(fromDate?: string, toDate?: string) {
    const params: Record<string, any> = {};
    if (fromDate) params.from_date = fromDate;
    if (toDate) params.to_date = toDate;

    const response = await apiClient.get(
      `${API_BASE}/debtors/aging-report`,
      { params }
    );
    return response.data;
  },

  /**
   * Export debtors data to CSV
   */
  async exportDebtorsCSV(filters?: DebtorSummaryRequest): Promise<Blob> {
    const params: Record<string, any> = {
      export: "csv",
    };

    if (filters?.status_filter && filters.status_filter !== "all") {
      params.status = filters.status_filter;
    }
    if (filters?.sort_by) {
      params.sort_by = filters.sort_by;
    }
    if (filters?.sort_order) {
      params.sort_order = filters.sort_order;
    }

    const response = await apiClient.get<Blob>(
      `${API_BASE}/debtors/export`,
      { params, responseType: "blob" }
    );
    return response.data;
  },

  /**
   * Record a payment for a customer
   */
  async recordPayment(
    customerId: number,
    data: {
      amount: number;
      payment_date: string;
      payment_method: string;
      reference_no?: string;
      notes?: string;
    }
  ) {
    const response = await apiClient.post(
      `${API_BASE}/customers/${customerId}/payments`,
      data
    );
    return response.data;
  },

  /**
   * Generate aging invoice with current balance
   * PDF/document showing invoice details with current outstanding amount and duration
   */
  async generateAgingInvoice(
    customerId: number,
    invoiceId?: number
  ): Promise<Blob> {
    const params: Record<string, any> = {};
    if (invoiceId) {
      params.invoice_id = invoiceId;
    }

    const response = await apiClient.get<Blob>(
      `${API_BASE}/debtors/${customerId}/aging-invoice`,
      { params, responseType: "blob" }
    );
    return response.data;
  },
};
