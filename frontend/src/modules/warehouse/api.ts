import apiClient from "@/api/client";
import {
  ItemTransferNote,
  ItemTransferNoteCreate,
  ItemTransferNoteWithItems,
  ItemTransferNoteItem,
  ItemTransferNoteItemCreate,
  ItemTransferNoteApproved,
  ItemTransferNoteApprovedCreate,
  ItemReceiveNote,
  ItemReceiveNoteCreate,
  BarcodeValidationRequest,
  BarcodeValidationResponse,
  ReceiveItemsRequest,
  ReceiveItemsResponse,
  TransferNoteStatusResponse,
} from "./types";

// Item Transfer Notes API
export const transferNotesApi = {
  getAll: async (params?: {
    branch_code?: string;
    from_location_id?: number;
    to_location_id?: number;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<ItemTransferNote[]>(
      "/warehouse/transfer-notes",
      { params }
    );
    return response.data;
  },

  getById: async (id: number): Promise<ItemTransferNoteWithItems> => {
    const response = await apiClient.get<ItemTransferNote>(
      `/warehouse/transfer-notes/${id}`
    );
    // Also fetch items for this transfer note
    const itemsResponse = await apiClient.get<ItemTransferNoteItem[]>(
      `/warehouse/transfer-notes/${id}/items`
    );
    // Try to get approval status
    let approved_records: ItemTransferNoteApproved[] = [];
    try {
      const approvalResponse = await apiClient.get<ItemTransferNoteApproved>(
        `/warehouse/transfer-notes/${id}/approval`
      );
      if (approvalResponse.data) {
        approved_records = [approvalResponse.data];
      }
    } catch {
      // No approval record exists yet
    }
    return {
      ...response.data,
      items: itemsResponse.data,
      approved_records,
    };
  },

  create: async (data: ItemTransferNoteCreate) => {
    const response = await apiClient.post<ItemTransferNote>(
      "/warehouse/transfer-notes",
      data
    );
    return response.data;
  },

  update: async (id: number, data: Partial<ItemTransferNoteCreate>) => {
    const response = await apiClient.put<ItemTransferNote>(
      `/warehouse/transfer-notes/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/warehouse/transfer-notes/${id}`);
  },
};

// Transfer Note Items API
export const transferNoteItemsApi = {
  getAll: async (transferNoteId: number) => {
    const response = await apiClient.get<ItemTransferNoteItem[]>(
      `/warehouse/transfer-notes/${transferNoteId}/items`
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<ItemTransferNoteItem>(
      `/warehouse/transfer-note-items/${id}`
    );
    return response.data;
  },

  create: async (data: ItemTransferNoteItemCreate) => {
    const response = await apiClient.post<ItemTransferNoteItem>(
      "/warehouse/transfer-note-items",
      data
    );
    return response.data;
  },

  update: async (id: number, data: ItemTransferNoteItemCreate) => {
    const response = await apiClient.put<ItemTransferNoteItem>(
      `/warehouse/transfer-note-items/${id}`,
      data
    );
    return response.data;
  },

  markAsReceived: async (id: number) => {
    const response = await apiClient.patch<ItemTransferNoteItem>(
      `/warehouse/transfer-note-items/${id}/receive`
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/warehouse/transfer-note-items/${id}`);
  },
};

// Transfer Note Approvals API
export const transferNoteApprovalsApi = {
  getById: async (id: number) => {
    const response = await apiClient.get<ItemTransferNoteApproved>(
      `/warehouse/transfer-note-approvals/${id}`
    );
    return response.data;
  },

  getByTransferNote: async (transferNoteId: number) => {
    const response = await apiClient.get<ItemTransferNoteApproved>(
      `/warehouse/transfer-notes/${transferNoteId}/approval`
    );
    return response.data;
  },

  create: async (data: ItemTransferNoteApprovedCreate) => {
    const response = await apiClient.post<ItemTransferNoteApproved>(
      "/warehouse/transfer-note-approvals",
      data
    );
    return response.data;
  },

  update: async (id: number, data: ItemTransferNoteApprovedCreate) => {
    const response = await apiClient.put<ItemTransferNoteApproved>(
      `/warehouse/transfer-note-approvals/${id}`,
      data
    );
    return response.data;
  },
};

// Receive Notes API
export const receiveNotesApi = {
  getAll: async (params?: {
    approved_status?: number;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<ItemReceiveNote[]>(
      "/warehouse/receive-notes",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<ItemReceiveNote>(
      `/warehouse/receive-notes/${id}`
    );
    return response.data;
  },

  getByTransferNote: async (transferNoteId: number) => {
    const response = await apiClient.get<ItemReceiveNote>(
      `/warehouse/transfer-notes/${transferNoteId}/receive-note`
    );
    return response.data;
  },

  create: async (data: ItemReceiveNoteCreate) => {
    const response = await apiClient.post<ItemReceiveNote>(
      "/warehouse/receive-notes",
      data
    );
    return response.data;
  },

  update: async (id: number, data: ItemReceiveNoteCreate) => {
    const response = await apiClient.put<ItemReceiveNote>(
      `/warehouse/receive-notes/${id}`,
      data
    );
    return response.data;
  },

  receiveItems: async (transferNoteId: number, data: ReceiveItemsRequest) => {
    const response = await apiClient.post<ReceiveItemsResponse>(
      `/warehouse/transfer-notes/${transferNoteId}/receive-items`,
      data
    );
    return response.data;
  },
};

// Transfer Notes Workflow API
export const transferWorkflowApi = {
  validateBarcode: async (data: BarcodeValidationRequest) => {
    const response = await apiClient.post<BarcodeValidationResponse>(
      "/warehouse/transfer-notes/validate-barcode",
      data
    );
    return response.data;
  },

  dispatch: async (transferNoteId: number) => {
    const response = await apiClient.post<ItemTransferNote>(
      `/warehouse/transfer-notes/${transferNoteId}/dispatch`
    );
    return response.data;
  },

  getStatus: async (transferNoteId: number) => {
    const response = await apiClient.get<TransferNoteStatusResponse>(
      `/warehouse/transfer-notes/${transferNoteId}/status`
    );
    return response.data;
  },
};
