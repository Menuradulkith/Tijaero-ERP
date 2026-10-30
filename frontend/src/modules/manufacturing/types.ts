// Manufacturing types — mirror backend/app/modules/manufacturing/schemas.py.
// Decimal fields arrive as strings or numbers; read them with Number(...).

type Dec = number | string;

export type ProductionOrderStatus = "draft" | "released" | "in_progress" | "completed" | "closed" | "cancelled";
export type BOMStatus = "draft" | "active" | "archived";
export type OperationStatus = "pending" | "in_progress" | "completed";
export type IssueMethod = "manual" | "backflush";
export type Priority = "low" | "normal" | "high" | "urgent";

export const PRODUCTION_ORDER_STATUS_OPTIONS: { value: ProductionOrderStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "released", label: "Released" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];

export const BOM_STATUS_OPTIONS: { value: BOMStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

// ─────────────────────────── work centers ───────────────────────────
export interface WorkCenter {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  branch_code?: string | null;
  capacity: number;
  efficiency_pct: Dec;
  working_hours_per_day: Dec;
  labor_rate_per_hour: Dec;
  overhead_rate_per_hour: Dec;
  active: boolean;
  open_load_minutes: Dec;
  open_operations: number;
  created_at?: string;
  updated_at?: string;
}

export interface WorkCenterInput {
  code: string;
  name: string;
  description?: string | null;
  branch_code?: string | null;
  capacity: number;
  efficiency_pct: number;
  working_hours_per_day: number;
  labor_rate_per_hour: number;
  overhead_rate_per_hour: number;
  active: boolean;
}

// ─────────────────────────── BOMs ───────────────────────────
export interface BOMItem {
  id: number;
  sequence: number;
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  unit_of_measure?: string | null;
  quantity: Dec;
  scrap_pct: Dec;
  issue_method: IssueMethod;
  remark?: string | null;
  unit_cost: Dec;
  line_cost: Dec;
  is_manufactured: boolean;
}

export interface BOMOperation {
  id: number;
  sequence: number;
  name: string;
  work_center_id: number;
  work_center_code?: string | null;
  work_center_name?: string | null;
  setup_minutes: Dec;
  run_minutes: Dec;
  description?: string | null;
  labor_cost: Dec;
  overhead_cost: Dec;
}

export interface BOM {
  id: number;
  bom_no: string;
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  unit_of_measure?: string | null;
  product_cost_price: Dec;
  version: string;
  output_quantity: Dec;
  status: BOMStatus;
  is_default: boolean;
  description?: string | null;
  item_count: number;
  operation_count: number;
  material_cost: Dec;
  labor_cost: Dec;
  overhead_cost: Dec;
  total_cost: Dec;
  unit_cost: Dec;
  items: BOMItem[];
  operations: BOMOperation[];
  created_at?: string;
  updated_at?: string;
}

export interface BOMItemInput {
  sequence: number;
  product_id: number;
  quantity: number;
  scrap_pct: number;
  issue_method: IssueMethod;
  remark?: string | null;
}

export interface BOMOperationInput {
  sequence: number;
  name: string;
  work_center_id: number;
  setup_minutes: number;
  run_minutes: number;
  description?: string | null;
}

export interface BOMInput {
  product_id: number;
  version: string;
  output_quantity: number;
  description?: string | null;
  items: BOMItemInput[];
  operations: BOMOperationInput[];
}

export type BOMUpdateInput = Partial<Omit<BOMInput, "product_id">>;

// ─────────────────────────── production orders ───────────────────────────
export interface OrderMaterial {
  id: number;
  sequence: number;
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  unit_of_measure?: string | null;
  tracking_type?: string | null;
  quantity_per_unit: Dec;
  scrap_pct: Dec;
  required_quantity: number;
  issued_quantity: number;
  remaining_quantity: number;
  issue_method: IssueMethod;
  unit_cost: Dec;
  available_quantity: number;
  shortage_quantity: number;
}

export interface OrderOperation {
  id: number;
  sequence: number;
  name: string;
  work_center_id: number;
  work_center_code?: string | null;
  work_center_name?: string | null;
  planned_minutes: Dec;
  actual_minutes: Dec;
  completed_quantity: number;
  status: OperationStatus;
  labor_rate_per_hour: Dec;
  overhead_rate_per_hour: Dec;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ProductionOrder {
  id: number;
  order_no: string;
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  unit_of_measure?: string | null;
  tracking_type?: string | null;
  bom_id: number;
  bom_no?: string | null;
  bom_version?: string | null;
  branch_code: string;
  location_id?: number | null;
  location_name?: string | null;
  planned_quantity: number;
  produced_quantity: number;
  scrapped_quantity: number;
  progress_pct: Dec;
  planned_start_date: string;
  planned_end_date: string;
  actual_start_at?: string | null;
  actual_end_at?: string | null;
  priority: Priority;
  status: ProductionOrderStatus;
  is_late: boolean;
  source_reference?: string | null;
  quote_item_id?: number | null;
  quote_id?: number | null;
  quote_no?: string | null;
  customer_name?: string | null;
  remark?: string | null;
  cancel_reason?: string | null;
  standard_unit_cost: Dec;
  planned_material_cost: Dec;
  planned_labor_cost: Dec;
  planned_overhead_cost: Dec;
  planned_total_cost: Dec;
  actual_material_cost: Dec;
  actual_labor_cost: Dec;
  actual_overhead_cost: Dec;
  actual_total_cost: Dec;
  output_value: Dec;
  wip_balance: Dec;
  variance_amount?: Dec | null;
  material_status?: "ready" | "partial" | "shortage" | "issued" | null;
  released_at?: string | null;
  released_by_name?: string | null;
  closed_at?: string | null;
  created_by_name?: string | null;
  created_at?: string;
  updated_at?: string;
  materials: OrderMaterial[];
  operations: OrderOperation[];
}

export interface ProductionOrderPage {
  items: ProductionOrder[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface ProductionOrderInput {
  product_id: number;
  bom_id?: number | null;
  branch_code: string;
  location_id?: number | null;
  planned_quantity: number;
  planned_start_date: string;
  planned_end_date: string;
  priority: Priority;
  source_reference?: string | null;
  remark?: string | null;
}

export type ProductionOrderUpdateInput = Partial<Omit<ProductionOrderInput, "product_id" | "branch_code">>;

export interface MaterialMoveInput {
  lines: { material_id: number; quantity: number }[];
  remark?: string | null;
}

export interface OutputInput {
  quantity: number;
  scrap_quantity: number;
  batch_no?: string | null;
  expiry_date?: string | null;
  serial_numbers?: string[] | null;
  location_id?: number | null;
  remark?: string | null;
}

export interface TimeLogInput {
  operation_id: number;
  employee_id?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  minutes?: number | null;
  completed_quantity: number;
  complete_operation: boolean;
  remark?: string | null;
}

export interface MaterialTransaction {
  id: number;
  order_id: number;
  material_id: number;
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  transaction_type: "issue" | "return" | "backflush";
  quantity: number;
  unit_cost: Dec;
  total_cost: Dec;
  transaction_date: string;
  remark?: string | null;
  created_by_name?: string | null;
}

export interface ProductionOutput {
  id: number;
  order_id: number;
  quantity: number;
  scrap_quantity: number;
  batch_no?: string | null;
  expiry_date?: string | null;
  unit_cost: Dec;
  total_value: Dec;
  location_id?: number | null;
  location_name?: string | null;
  receipt_date: string;
  remark?: string | null;
  serial_numbers: string[];
  created_by_name?: string | null;
}

export interface TimeLog {
  id: number;
  order_id: number;
  operation_id: number;
  operation_name?: string | null;
  work_center_name?: string | null;
  employee_id?: number | null;
  employee_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  minutes: Dec;
  completed_quantity: number;
  labor_cost: Dec;
  overhead_cost: Dec;
  is_auto: boolean;
  remark?: string | null;
  created_at?: string | null;
  created_by_name?: string | null;
}

export interface OrderActivity {
  materials: MaterialTransaction[];
  outputs: ProductionOutput[];
  time_logs: TimeLog[];
}

// ─────────────────────────── shop floor / planning ───────────────────────────
export interface JobCard {
  operation_id: number;
  order_id: number;
  order_no: string;
  order_status: ProductionOrderStatus;
  priority: Priority;
  branch_code: string;
  product_name?: string | null;
  product_code?: string | null;
  planned_quantity: number;
  produced_quantity: number;
  planned_start_date: string;
  planned_end_date: string;
  is_late: boolean;
  sequence: number;
  name: string;
  work_center_id: number;
  work_center_code?: string | null;
  work_center_name?: string | null;
  planned_minutes: Dec;
  actual_minutes: Dec;
  completed_quantity: number;
  status: OperationStatus;
  started_at?: string | null;
}

export interface Operator {
  id: number;
  employee_id: string;
  name: string;
}

export interface MrpDemandSource {
  source_type: "quotation" | "production_order" | "planned" | "reorder";
  reference: string;
  document_id?: number | null;
  quantity: number;
  need_date?: string | null;
}

export interface MrpLine {
  product_id: number;
  branch_code: string;
  product_name: string;
  product_code: string;
  unit_of_measure?: string | null;
  is_manufactured: boolean;
  bom_id?: number | null;
  low_level_code: number;
  quote_demand: number;
  production_demand: number;
  planned_demand: number;
  total_demand: number;
  on_hand_quantity: number;
  on_order_quantity: number;
  in_production_quantity: number;
  min_quantity?: number | null;
  max_quantity?: number | null;
  projected_quantity: number;
  suggested_quantity: number;
  suggested_action?: "purchase" | "produce" | null;
  preferred_supplier_id?: number | null;
  preferred_supplier_name?: string | null;
  lead_time_days: number;
  unit_cost: Dec;
  suggested_value: Dec;
  need_by_date?: string | null;
  order_by_date?: string | null;
  demand_sources: MrpDemandSource[];
}

export interface MrpPurchaseInput {
  branch_code: string;
  expected_date?: string | null;
  lines: { product_id: number; quantity: number; supplier_id: number; unit_price?: number | null }[];
}

export interface MrpProduceInput {
  branch_code: string;
  priority: Priority;
  lines: { product_id: number; quantity: number; bom_id?: number | null; planned_start_date: string; planned_end_date: string }[];
}

export interface MrpFirmResult {
  documents: { id: number; number: string; [key: string]: unknown }[];
}

export interface ReorderRule {
  id: number;
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  unit_of_measure?: string | null;
  is_manufactured: boolean;
  branch_code: string;
  min_quantity: number;
  max_quantity?: number | null;
  multiple_quantity: number;
  preferred_supplier_id?: number | null;
  preferred_supplier_name?: string | null;
  active: boolean;
  on_hand_quantity: number;
  below_minimum: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ReorderRuleInput {
  product_id: number;
  branch_code: string;
  min_quantity: number;
  max_quantity?: number | null;
  multiple_quantity: number;
  preferred_supplier_id?: number | null;
  active: boolean;
}

export interface QuoteDemandLine {
  quote_item_id: number;
  quote_id: number;
  quote_no: string;
  quote_status: string;
  customer_name?: string | null;
  branch_code: string;
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  unit_of_measure?: string | null;
  quantity: number;
  ordered_quantity: number;
  in_production_quantity: number;
  remaining_quantity: number;
  item_status: string;
  expected_delivery_date?: string | null;
  valid_until?: string | null;
  has_bom: boolean;
}

export interface FromQuoteInput {
  quote_item_id: number;
  quantity?: number | null;
  bom_id?: number | null;
  location_id?: number | null;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  priority: Priority;
  remark?: string | null;
}

export interface ManufacturingDashboard {
  status_counts: { status: ProductionOrderStatus; count: number }[];
  open_orders: number;
  late_orders: number;
  wip_value: Dec;
  output_this_month: number;
  output_value_this_month: Dec;
  scrap_rate_pct: Dec;
  material_shortages: number;
  active_boms: number;
  active_work_centers: number;
  variance_this_month: Dec;
  work_center_load: {
    work_center_id: number;
    code: string;
    name: string;
    open_load_minutes: Dec;
    capacity_minutes_per_day: Dec;
    load_days: Dec;
    open_operations: number;
  }[];
  monthly_output: { month: string; quantity: number; value: Dec; scrap_quantity: number }[];
  upcoming_orders: ProductionOrder[];
  late_order_list: ProductionOrder[];
}
