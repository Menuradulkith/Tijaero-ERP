import apiClient from "@/api/client";

export interface BankTransferItem {
  id: number;
  product_id: number;
  quantity: number;
  selling_price: number;
  minimum_selling_price: number;
  warrenty_month: string;
  barcode?: string;
  discount_percent?: number;
  discount_amount?: number;
  line_total?: number;
  invoice_id: number;
  created_date: string;
}

export interface PendingBankTransfer {
  id: number;
  invoice_no: string;
  customer_name: string;
  customer_id: number;
  branch_code: string;
  bank_transfer_amount: number;
  bank_transfer_ref?: string;
  bank_name?: string;
  created_date: string;
  created_by_name?: string;
  bank_transfer_status: string;
  bank_transfer_verified_by_name?: string;
  bank_transfer_verified_at?: string;
  bank_transfer_rejection_reason?: string;
  grand_total: number;
  bank_deposit_id?: number;
  items?: BankTransferItem[];
  /** Source: "sales_order" or "credit_settlement" */
  source?: string;
  /** Settlement transaction ID (only for credit_settlement source) */
  settlement_transaction_id?: number;
}

export interface BankTransferConfirmationRequest {
  action: "verify" | "reject";
  rejection_reason?: string;
}

export interface BankTransferConfirmationResponse {
  success: boolean;
  message: string;
  invoice_no: string;
  status: string;
}

export const bankTransferApi = {
  /**
   * Get all pending bank transfers awaiting confirmation
   */
  getPending: async (branchCode?: string): Promise<PendingBankTransfer[]> => {
    const params = new URLSearchParams();
    if (branchCode) params.append("branch_code", branchCode);
    
    const response = await apiClient.get<PendingBankTransfer[]>(
      `/sales/bank-transfers/pending${params.toString() ? `?${params.toString()}` : ""}`
    );
    return response.data;
  },

  /**
   * Verify (approve) a bank transfer payment
   */
  verify: async (
    invoiceId: number
  ): Promise<BankTransferConfirmationResponse> => {
    const response = await apiClient.post<BankTransferConfirmationResponse>(
      `/sales/${invoiceId}/bank-transfer/verify`
    );
    return response.data;
  },

  /**
   * Reject a bank transfer payment
   */
  reject: async (
    invoiceId: number,
    reason?: string
  ): Promise<BankTransferConfirmationResponse> => {
    const response = await apiClient.post<BankTransferConfirmationResponse>(
      `/sales/${invoiceId}/bank-transfer/reject`,
      { reason }
    );
    return response.data;
  },

  /**
   * Confirm (verify or reject) a bank transfer payment (legacy)
   */
  confirm: async (
    invoiceId: number,
    request: BankTransferConfirmationRequest
  ): Promise<BankTransferConfirmationResponse> => {
    if (request.action === "verify") {
      return bankTransferApi.verify(invoiceId);
    } else {
      return bankTransferApi.reject(invoiceId, request.rejection_reason);
    }
  },

  /**
   * Verify a credit settlement bank transfer payment
   */
  verifyCreditSettlement: async (
    transactionId: number
  ): Promise<BankTransferConfirmationResponse> => {
    const response = await apiClient.post<BankTransferConfirmationResponse>(
      `/sales/credit-settlement/${transactionId}/bank-transfer/verify`
    );
    return response.data;
  },

  /**
   * Reject a credit settlement bank transfer payment
   */
  rejectCreditSettlement: async (
    transactionId: number,
    reason?: string
  ): Promise<BankTransferConfirmationResponse> => {
    const response = await apiClient.post<BankTransferConfirmationResponse>(
      `/sales/credit-settlement/${transactionId}/bank-transfer/reject`,
      { reason }
    );
    return response.data;
  },
};
