import apiClient from "@/api/client";
import {
  ConvertToInvoiceRequest,
  ConvertToInvoiceResponse,
  CreatePartialSORequest,
  CreatePOFromQuoteRequest,
  CreatePOFromQuoteResponse,
  CreateRevisionRequest,
  CreateRevisionResponse,
  CustomerApprovalRequest,
  QuoteStatus,
  QuoteType,
  RejectQuoteRequest,
  SalesQuote,
  SalesQuoteCreate,
  SalesQuoteList,
  SalesQuoteStatusUpdate,
  SalesQuoteUpdate,
  SalesQuoteWithItems,
  StockAvailabilityResponse,
  ToggleProformaRequest,
  ToggleProformaResponse
} from "./quotation-types";

const BASE_URL = "/sales/quotes";

export const quotationApi = {
  // ==================== List & Search ====================

  /**
   * Get all quotes with filtering and pagination
   */
  getAll: async (params?: {
    quote_type?: QuoteType;
    status?: QuoteStatus;
    customer_id?: number;
    sale_rep_id?: number;
    branch_code?: string;
    search?: string;
    page?: number;
    per_page?: number;
  }): Promise<SalesQuoteList> => {
    const response = await apiClient.get<SalesQuoteList>(`${BASE_URL}/`, { params });
    return response.data;
  },

  /**
   * Get quotations only (estimates)
   */
  getQuotations: async (params?: {
    status?: QuoteStatus;
    page?: number;
    per_page?: number;
  }): Promise<SalesQuoteList> => {
    const response = await apiClient.get<SalesQuoteList>(`${BASE_URL}/quotations`, { params });
    return response.data;
  },

  /**
   * Get proforma invoices only (exact pricing)
   */
  getProformaInvoices: async (params?: {
    status?: QuoteStatus;
    page?: number;
    per_page?: number;
  }): Promise<SalesQuoteList> => {
    const response = await apiClient.get<SalesQuoteList>(`${BASE_URL}/proforma`, { params });
    return response.data;
  },

  /**
   * Get quotes expiring within specified days
   */
  getExpiring: async (days: number = 7): Promise<SalesQuote[]> => {
    const response = await apiClient.get<SalesQuote[]>(`${BASE_URL}/expiring`, {
      params: { days },
    });
    return response.data;
  },

  // ==================== CRUD Operations ====================

  /**
   * Get quote by ID with items
   */
  getById: async (id: number): Promise<SalesQuoteWithItems> => {
    const response = await apiClient.get<SalesQuoteWithItems>(`${BASE_URL}/${id}`);
    return response.data;
  },

  /**
   * Create a new quote (quotation or proforma)
   */
  create: async (data: SalesQuoteCreate): Promise<SalesQuoteWithItems> => {
    const response = await apiClient.post<SalesQuoteWithItems>(`${BASE_URL}/`, data);
    return response.data;
  },

  /**
   * Create a new quotation (estimate) - shorthand
   */
  createQuotation: async (data: SalesQuoteCreate): Promise<SalesQuoteWithItems> => {
    const response = await apiClient.post<SalesQuoteWithItems>(`${BASE_URL}/quotation`, data);
    return response.data;
  },

  /**
   * Create a new proforma invoice (exact) - shorthand
   */
  createProforma: async (data: SalesQuoteCreate): Promise<SalesQuoteWithItems> => {
    const response = await apiClient.post<SalesQuoteWithItems>(`${BASE_URL}/proforma`, data);
    return response.data;
  },

  /**
   * Update an existing quote
   */
  update: async (id: number, data: SalesQuoteUpdate): Promise<SalesQuoteWithItems> => {
    const response = await apiClient.put<SalesQuoteWithItems>(`${BASE_URL}/${id}`, data);
    return response.data;
  },

  /**
   * Mark selected quote items as procurement (PO/ITN)
   */
  markItemsProcurement: async (id: number, item_ids: number[]): Promise<SalesQuoteWithItems> => {
    const response = await apiClient.post<SalesQuoteWithItems>(
      `${BASE_URL}/${id}/items/procurement`,
      { item_ids }
    );
    return response.data;
  },

  /**
   * Delete a quote (only drafts can be deleted)
   */
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`${BASE_URL}/${id}`);
  },

  // ==================== Status Management ====================

  /**
   * Update quote status
   */
  updateStatus: async (id: number, data: SalesQuoteStatusUpdate): Promise<SalesQuote> => {
    const response = await apiClient.patch<SalesQuote>(`${BASE_URL}/${id}/status`, data);
    return response.data;
  },

  /**
   * Submit quote for approval
   */
  submitForApproval: async (id: number): Promise<SalesQuote> => {
    const response = await apiClient.post<SalesQuote>(`${BASE_URL}/${id}/submit`);
    return response.data;
  },

  /**
   * Approve a quote
   */
  approve: async (id: number): Promise<SalesQuote> => {
    const response = await apiClient.post<SalesQuote>(`${BASE_URL}/${id}/approve`);
    return response.data;
  },

  /**
   * Reject a quote
   */
  reject: async (id: number, reason?: string): Promise<SalesQuote> => {
    const response = await apiClient.post<SalesQuote>(`${BASE_URL}/${id}/reject`, null, {
      params: { reason },
    });
    return response.data;
  },

  /**
   * Mark quote as sent to customer
   */
  markAsSent: async (id: number): Promise<SalesQuote> => {
    const response = await apiClient.post<SalesQuote>(`${BASE_URL}/${id}/send`);
    return response.data;
  },

  /**
   * Mark quote as accepted by customer
   */
  markAsAccepted: async (id: number): Promise<SalesQuote> => {
    const response = await apiClient.post<SalesQuote>(`${BASE_URL}/${id}/accept`);
    return response.data;
  },

  /**
   * Cancel a quote
   */
  cancel: async (id: number, reason?: string): Promise<SalesQuote> => {
    const response = await apiClient.post<SalesQuote>(`${BASE_URL}/${id}/cancel`, null, {
      params: { reason },
    });
    return response.data;
  },

  // ==================== New Workflow Actions ====================

  /**
   * Submit quotation to customer
   */
  submitToCustomer: async (id: number): Promise<SalesQuote> => {
    const response = await apiClient.post<SalesQuote>(`${BASE_URL}/${id}/submit-to-customer`);
    return response.data;
  },

  /**
   * Mark quote as under review by customer
   */
  markUnderReview: async (id: number): Promise<SalesQuote> => {
    const response = await apiClient.post<SalesQuote>(`${BASE_URL}/${id}/under-review`);
    return response.data;
  },

  /**
   * Toggle proforma invoice status
   */
  toggleProforma: async (id: number, data: ToggleProformaRequest): Promise<ToggleProformaResponse> => {
    const response = await apiClient.post<ToggleProformaResponse>(
      `${BASE_URL}/${id}/toggle-proforma`,
      data
    );
    return response.data;
  },

  /**
   * Record customer approval
   */
  customerApprove: async (id: number, data?: CustomerApprovalRequest): Promise<SalesQuote> => {
    const response = await apiClient.post<SalesQuote>(
      `${BASE_URL}/${id}/customer-approve`,
      data
    );
    return response.data;
  },

  /**
   * Reject a quote with options (reason + cancel linked PO)
   */
  rejectWithOptions: async (id: number, data?: RejectQuoteRequest): Promise<SalesQuote> => {
    const response = await apiClient.post<SalesQuote>(
      `${BASE_URL}/${id}/reject-quote`,
      data
    );
    return response.data;
  },

  // ==================== Conversion ====================

  /**
   * Convert quote/proforma to invoice
   */
  convertToInvoice: async (
    id: number,
    data: ConvertToInvoiceRequest
  ): Promise<ConvertToInvoiceResponse> => {
    const response = await apiClient.post<ConvertToInvoiceResponse>(
      `${BASE_URL}/${id}/convert`,
      data
    );
    return response.data;
  },

  // ==================== Stock Availability ====================

  /**
   * Check stock availability for all items in a quote
   */
  checkStockAvailability: async (id: number): Promise<StockAvailabilityResponse> => {
    const response = await apiClient.get<StockAvailabilityResponse>(
      `${BASE_URL}/${id}/stock-availability`
    );
    return response.data;
  },

  // ==================== Create PO from Quotation ====================

  /**
   * Create a Purchasing Order from an accepted/approved quotation
   */
  createPOFromQuote: async (
    id: number,
    data: CreatePOFromQuoteRequest
  ): Promise<CreatePOFromQuoteResponse> => {
    const response = await apiClient.post<CreatePOFromQuoteResponse>(
      `${BASE_URL}/${id}/create-po`,
      data
    );
    return response.data;
  },

  // ==================== Revision ====================

  /**
   * Create a new revision of a quotation
   */
  createRevision: async (
    id: number,
    data?: CreateRevisionRequest
  ): Promise<CreateRevisionResponse> => {
    const response = await apiClient.post<CreateRevisionResponse>(
      `${BASE_URL}/${id}/revise`,
      data
    );
    return response.data;
  },

  // ==================== Partial SO & Item Cancellation ====================

  /**
   * Create a Sales Order from selected/partial items of a quotation
   */
  createPartialSO: async (id: number, data: CreatePartialSORequest): Promise<any> => {
    const response = await apiClient.post<any>(`${BASE_URL}/${id}/partial-so`, data);
    return response.data;
  },

  /**
   * Mark quote items as so_created after a Sales Order is saved from the SO page.
   * product_ids: the product IDs included in the SO.
   */
  markItemsSoCreated: async (quoteId: number, productIds: number[]): Promise<SalesQuoteWithItems> => {
    const response = await apiClient.post<SalesQuoteWithItems>(
      `${BASE_URL}/${quoteId}/mark-so-created`,
      productIds
    );
    return response.data;
  },

  /**
   * Cancel a single item on a quotation
   */
  cancelItem: async (quoteId: number, itemId: number, reason?: string): Promise<SalesQuoteWithItems> => {
    const response = await apiClient.post<SalesQuoteWithItems>(
      `${BASE_URL}/${quoteId}/items/${itemId}/cancel`,
      { reason }
    );
    return response.data;
  },

  // ==================== Maintenance ====================

  /**
   * Mark all expired quotes as expired
   */
  markExpired: async (): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(`${BASE_URL}/mark-expired`);
    return response.data;
  },
};

export default quotationApi;
