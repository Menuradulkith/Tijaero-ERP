// Item Transfer Note Types
export interface ItemTransferNote {
  id: number;
  item_transfer_note: string;
  remark?: string;
  created_date: string;
  from_location_id: number;
  to_location_id: number;
  branch_code: string;
  added_date: string;
  approval_id?: number;
  status: string;  // pending, approved, dispatched, in_transit, partially_received, received, rejected, cancelled
  // Extended properties from relationships
  from_location_name?: string;
  to_location_name?: string;
}

export interface ItemTransferNoteCreate {
  item_transfer_note: string;
  remark?: string;
  created_date: string;
  from_location_id: number;
  to_location_id: number;
  branch_code: string;
  approval_id?: number;
  status?: string;
}

export interface ItemTransferNoteWithItems extends ItemTransferNote {
  items: ItemTransferNoteItem[];
  approved_records?: ItemTransferNoteApproved[];
  from_location_name?: string;
  to_location_name?: string;
}

// Item Transfer Note Item Types
export interface ItemTransferNoteItem {
  id: number;
  product_id: number;
  barcode?: string;
  branch_code: string;
  remark?: string;
  item_recieved: boolean;
  itemtransfernote_id: number;
  created_date: string;
  // Extended properties
  product_name?: string;
  product_item_code?: string;
}

export interface ItemTransferNoteItemCreate {
  product_id: number;
  barcode?: string;
  branch_code: string;
  remark?: string;
  item_recieved?: boolean;
  itemtransfernote_id: number;
}

// Item Transfer Note Approved Types
export interface ItemTransferNoteApproved {
  id: number;
  item_transfer_note_id: number;
  approved_status: number;
  approval_note?: string;
  approved_user_id?: number;
  approved_date?: string;
}

export interface ItemTransferNoteApprovedCreate {
  item_transfer_note_id: number;
  approved_status: number;
  approval_note?: string;
  approved_user_id?: number;
}

// Item Receive Note Types
export interface ItemReceiveNote {
  id: number;
  item_transfer_note_id: number;
  received_approval_status: number;
  received_note?: string;
  recieved_user?: number;
  recieved_date?: string;
}

export interface ItemReceiveNoteCreate {
  item_transfer_note_id: number;
  received_approval_status: number;
  received_note?: string;
  recieved_user?: number;
}

// Barcode Validation Types
export interface BarcodeValidationRequest {
  barcode: string;
  from_location_id: number;
  branch_code?: string;
}

export interface BarcodeValidationResponse {
  valid: boolean;
  barcode: string;
  message: string;
  sales_stock_id?: number;
  product_id?: number;
  product_name?: string;
  current_location_id?: number;
  current_location_name?: string;
  current_status?: string;
  cost_price?: number;
}

// Receive Items Types
export interface ReceiveItemsRequest {
  barcodes: string[];
  received_note?: string;
  received_user_id?: number;
}

export interface ReceivedItemResult {
  barcode: string;
  success: boolean;
  message: string;
  product_name?: string;
}

export interface ReceiveItemsResponse {
  transfer_note_id: number;
  total_items: number;
  received_items: number;
  pending_items: number;
  results: ReceivedItemResult[];
  all_received: boolean;
}

// Transfer Note Status Response
export interface TransferNoteStatusResponse {
  transfer_note_id: number;
  transfer_note_number: string;
  status: string;
  total_items: number;
  received_items: number;
  pending_items: number;
  from_location_name?: string;
  to_location_name?: string;
  created_date: string;
  approval_status?: number;
  can_dispatch: boolean;
  can_receive: boolean;
}

// Transfer Note Status Constants
export const TRANSFER_NOTE_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  DISPATCHED: "dispatched",
  IN_TRANSIT: "in_transit",
  PARTIALLY_RECEIVED: "partially_received",
  RECEIVED: "received",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
} as const;

export type TransferNoteStatusType = typeof TRANSFER_NOTE_STATUS[keyof typeof TRANSFER_NOTE_STATUS];

