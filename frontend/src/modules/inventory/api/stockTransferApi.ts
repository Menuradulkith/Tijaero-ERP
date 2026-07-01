/**
 * Stock Transfer API Client
 * Handles all stock transfer operations
 */

import apiClient from '@/api/client';

export interface StockTransferRequest {
  reason?: string;
  location_id?: number;
  approve?: boolean;
}

export interface StockTransferResponse {
  success: boolean;
  message: string;
  transfer_id: number;
  company_asset_id?: number;
  sales_stock_id?: number;
  barcode: string;
  product_id: number;
}

export interface StockTransferHistoryItem {
  id: number;
  transfer_type: string;
  source_table: string;
  source_id: number;
  source_barcode?: string;
  destination_table: string;
  destination_id?: number;
  destination_barcode?: string;
  product_id: number;
  branch_code: string;
  reason?: string;
  status: string;
  initiated_at: string;
  completed_at?: string;
  created_at: string;
}

export interface StockTransferHistoryResponse {
  total: number;
  skip: number;
  limit: number;
  transfers: StockTransferHistoryItem[];
}

export interface TransferReversal {
  reverse_reason: string;
}

/**
 * Transfer a sales stock item to company assets
 */
export const transferSalesStockToCompanyAsset = async (
  id: number,
  request: StockTransferRequest
): Promise<StockTransferResponse> => {
  const response = await apiClient.post(
    `/inventory/stock-transfers/sales-stock/${id}/transfer-to-company-assets`,
    request
  );
  return response.data;
};

/**
 * Transfer a company asset to sales stock
 */
export const transferCompanyAssetToSalesStock = async (
  id: number,
  request: StockTransferRequest
): Promise<StockTransferResponse> => {
  const response = await apiClient.post(
    `/inventory/stock-transfers/company-assets/${id}/transfer-to-sales-stock`,
    request
  );
  return response.data;
};

/**
 * Get stock transfer history with optional filtering
 */
export const getStockTransferHistory = async (
  filters?: {
    start_date?: string;
    end_date?: string;
    transfer_type?: string;
    status?: string;
    branch_code?: string;
    initiated_by?: number;
    product_id?: number;
    skip?: number;
    limit?: number;
  }
): Promise<StockTransferHistoryResponse> => {
  const response = await apiClient.get('/inventory/stock-transfers/history', {
    params: filters,
  });
  return response.data;
};

/**
 * Reverse a stock transfer
 */
export const reverseStockTransfer = async (
  transferId: number,
  request: TransferReversal
): Promise<{ success: boolean; message: string; transfer_id: number }> => {
  const response = await apiClient.post(
    `/inventory/stock-transfers/${transferId}/reverse`,
    request
  );
  return response.data;
};

/**
 * Get transfer details by ID
 */
export const getTransferDetails = async (
  transferId: number
): Promise<StockTransferHistoryItem> => {
  const response = await apiClient.get(
    `/inventory/stock-transfers/${transferId}`
  );
  return response.data;
};

export const stockTransferApi = {
  transferSalesStockToCompanyAsset,
  transferCompanyAssetToSalesStock,
  getStockTransferHistory,
  reverseStockTransfer,
  getTransferDetails,
};

export default stockTransferApi;
