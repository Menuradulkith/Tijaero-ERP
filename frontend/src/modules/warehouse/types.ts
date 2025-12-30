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
}

export interface ItemTransferNoteCreate {
  item_transfer_note: string;
  remark?: string;
  created_date: string;
  from_location_id: number;
  to_location_id: number;
  branch_code: string;
  approval_id?: number;
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
}

export interface ItemTransferNoteItemCreate {
  product_id: number;
  barcode?: string;
  branch_code: string;
  remark?: string;
  item_recieved: boolean;
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
