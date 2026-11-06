// Manufacturing types — mirror backend/app/modules/manufacturing/schemas.py.
// Decimal fields arrive as strings or numbers; read them with Number(...).

type Dec = number | string;

export type ProductionOrderStatus = "draft" | "released" | "in_progress" | "completed" | "closed" | "cancelled";
export type BOMStatus = "draft" | "active" | "archived";
export type OperationStatus = "pending" | "in_progress" | "completed";
export type IssueMethod = "manual" | "backflush";
export type Priority = "low" | "normal" | "high" | "urgent";
export type ScrapReason = "burnt" | "damaged" | "quality_fail" | "expired" | "machine_fault" | "other";
export const SCRAP_REASONS: { value: ScrapReason; label: string }[] = [
  { value: "burnt", label: "Burnt / over-cooked" },
  { value: "damaged", label: "Damaged" },
  { value: "quality_fail", label: "Failed quality" },
  { value: "expired", label: "Expired" },
  { value: "machine_fault", label: "Machine fault" },
  { value: "other", label: "Other" },
];
/** none | on_hold | passed | failed | partly_passed */
export type QcStatus = "none" | "on_hold" | "passed" | "failed" | "partly_passed";

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
  /** Outside work: another company does this step (costed per unit on the BOM operation). */
  is_outside: boolean;
  supplier_id?: number | null;
  supplier_name?: string | null;
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
  is_outside: boolean;
  supplier_id?: number | null;
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
  is_outside: boolean;
  outside_unit_cost: Dec;
  outside_cost: Dec;
}

export interface BOMByProduct {
  id: number;
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  unit_of_measure?: string | null;
  quantity: Dec;
  unit_cost: Dec;
  line_value: Dec;
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
  /** An order may produce up to this % more than planned. */
  overproduction_pct: Dec;
  item_count: number;
  operation_count: number;
  material_cost: Dec;
  labor_cost: Dec;
  overhead_cost: Dec;
  outside_cost: Dec;
  /** Value of the by-products, taken off the main product's cost. */
  byproduct_value: Dec;
  total_cost: Dec;
  unit_cost: Dec;
  items: BOMItem[];
  operations: BOMOperation[];
  by_products: BOMByProduct[];
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
  /** Outside work centers: the subcontractor's price per unit. */
  outside_unit_cost: number;
}

export interface BOMByProductInput {
  product_id: number;
  quantity: number;
}

export interface BOMInput {
  product_id: number;
  version: string;
  output_quantity: number;
  description?: string | null;
  overproduction_pct: number;
  items: BOMItemInput[];
  operations: BOMOperationInput[];
  by_products: BOMByProductInput[];
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
  is_outside: boolean;
  supplier_id?: number | null;
  supplier_name?: string | null;
  outside_unit_cost: Dec;
  outside_quantity: number;
}

export interface OrderByProduct {
  id: number;
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  unit_of_measure?: string | null;
  quantity_per_unit: Dec;
  /** At the good units recorded so far */
  expected_quantity: number;
  received_quantity: number;
  unit_cost: Dec;
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
  overproduction_pct: Dec;
  /** Most good + scrap units the order can take (planned + tolerance). */
  max_quantity: number;
  /** good / (good + scrap); null until something is recorded */
  yield_pct?: Dec | null;
  scrap_value: Dec;
  /** Good units waiting for a quality decision */
  qc_on_hold_quantity: number;
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
  actual_outside_cost: Dec;
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
  by_products: OrderByProduct[];
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
  /** Required when scrap_quantity > 0 */
  scrap_reason?: ScrapReason | null;
  by_products?: { byproduct_id: number; quantity: number }[];
}

export interface QcDecisionInput {
  output_id: number;
  passed_quantity: number;
  failed_quantity: number;
  /** Required when units fail */
  remark?: string | null;
}

export interface OutsideReceiptInput {
  operation_id: number;
  quantity: number;
  /** Defaults to quantity x the operation's per-unit price */
  amount?: number | null;
  bill_reference?: string | null;
  remark?: string | null;
  /** Also raise a pending expense for the subcontractor's bill */
  create_expense: boolean;
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
  scrap_reason?: ScrapReason | null;
  qc_status: QcStatus;
  qc_passed_quantity: number;
  qc_failed_quantity: number;
  by_products?: { byproduct_id: number; product_id: number; product_name?: string | null; quantity: number; unit_cost: string; value: string }[] | null;
  byproduct_value: Dec;
}

export interface OutsideReceipt {
  id: number;
  operation_id: number;
  operation_name?: string | null;
  supplier_id?: number | null;
  supplier_name?: string | null;
  quantity: number;
  amount: Dec;
  bill_reference?: string | null;
  expense_id?: number | null;
  expense_no?: string | null;
  receipt_date: string;
  remark?: string | null;
  created_by_name?: string | null;
}

export interface QcResult {
  id: number;
  output_id: number;
  batch_no?: string | null;
  passed_quantity: number;
  failed_quantity: number;
  failed_value: Dec;
  remark?: string | null;
  decided_at: string;
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
  outside_receipts: OutsideReceipt[];
  qc_results: QcResult[];
}

// ─────────────────────────── batch traceability ───────────────────────────
export interface TraceLot {
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  batch_no?: string | null;
  expiry_date?: string | null;
  quantity: number;
}

export interface TraceOrder {
  order_id: number;
  order_no: string;
  branch_code: string;
  product_name?: string | null;
  status: ProductionOrderStatus;
  finished_batches: TraceLot[];
  components: TraceLot[];
}

export interface TraceResult {
  batch_no: string;
  /** "finished": made here; "component": used as a raw material */
  found_as: ("finished" | "component")[];
  orders: TraceOrder[];
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
  /** Done by a subcontractor: no time logging here */
  is_outside?: boolean;
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
