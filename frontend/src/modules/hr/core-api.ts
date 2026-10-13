/** Core HR API: masters, leave policy, employee master and sub-records, HR reports. */
import apiClient from "@/api/client";

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

interface Versioned {
  id: number;
  version?: string | null;
  created_at?: string;
  updated_at?: string;
}

// ───────────── organisation ─────────────
export interface Department extends Versioned {
  code: string;
  name: string;
  parent_id: number | null;
  parent_name?: string | null;
  head_employee_id: number | null;
  head_name?: string | null;
  description: string | null;
  active: boolean;
  employee_count: number;
}
export type DepartmentInput = Pick<Department, "code" | "name" | "parent_id" | "head_employee_id" | "description" | "active"> & { expected_version?: string | null };

export interface Designation extends Versioned {
  name: string;
  department_id: number | null;
  department_name?: string | null;
  grade: string | null;
  description: string | null;
  active: boolean;
  employee_count: number;
}
export type DesignationInput = Pick<Designation, "name" | "department_id" | "grade" | "description" | "active"> & { expected_version?: string | null };

export interface EmploymentType extends Versioned {
  name: string;
  description: string | null;
  default_probation_months: number;
  has_end_date: boolean;
  epf_etf_applicable: boolean;
  active: boolean;
  employee_count: number;
}
export type EmploymentTypeInput = Pick<EmploymentType, "name" | "description" | "default_probation_months" | "has_end_date" | "epf_etf_applicable" | "active"> & { expected_version?: string | null };

// ───────────── time ─────────────
export interface Shift extends Versioned {
  name: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  break_minutes: number;
  work_minutes: number;
  half_day_minutes: number;
  weekly_off_days: string;
  is_default: boolean;
  active: boolean;
  employee_count: number;
}
export type ShiftInput = Pick<Shift, "name" | "start_time" | "end_time" | "grace_minutes" | "break_minutes" | "work_minutes" | "half_day_minutes" | "weekly_off_days" | "is_default" | "active"> & { expected_version?: string | null };

export interface HolidayList extends Versioned {
  name: string;
  year: number;
  is_default: boolean;
  active: boolean;
  holiday_count: number;
  employee_count: number;
}
export type HolidayListInput = Pick<HolidayList, "name" | "year" | "is_default" | "active"> & { expected_version?: string | null };

export type HolidayType = "public" | "poya" | "mercantile" | "bank" | "company" | "other";
export interface Holiday {
  id: number;
  holiday_list_id: number;
  holiday_date: string;
  name: string;
  holiday_type: HolidayType;
}
export type HolidayInput = Pick<Holiday, "holiday_date" | "name" | "holiday_type">;

// ───────────── leave ─────────────
export interface LeaveType extends Versioned {
  code: string;
  name: string;
  description: string | null;
  annual_entitlement: number;
  accrual: "none" | "monthly";
  carry_forward_max: number;
  is_paid: boolean;
  allow_half_day: boolean;
  allow_negative_balance: boolean;
  max_consecutive_days: number | null;
  min_service_months: number;
  applicable_gender: "all" | "male" | "female";
  document_required_after_days: number | null;
  count_holidays: boolean;
  active: boolean;
}
export type LeaveTypeInput = Omit<LeaveType, keyof Versioned> & { expected_version?: string | null };

export interface LeaveAllocation extends Versioned {
  employee_pk: number;
  employee_id: string | null;
  employee_name: string | null;
  leave_type_id: number;
  leave_type_code: string | null;
  leave_type_name: string | null;
  year: number;
  allocated: number;
  carried_forward: number;
  adjustment: number;
  remarks: string | null;
  total: number;
  used: number;
  pending: number;
  balance: number;
}
export interface LeaveBalanceRow {
  leave_type_id: number;
  code: string;
  name: string;
  is_paid: boolean;
  entitlement: number;
  carried_forward: number;
  adjustment: number;
  total: number;
  used: number;
  pending: number;
  balance: number;
  accrued_to_date: number | null;
}

// ───────────── employee ─────────────
export type EmployeeStatus = "active" | "probation" | "notice_period" | "resigned" | "terminated" | "retired" | "inactive";

export interface EmployeeListItem {
  id: number;
  user_id: number;
  employee_id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
  status: EmployeeStatus;
  department_id: number | null;
  department_name: string | null;
  designation_id: number | null;
  designation_name: string | null;
  employment_type_id: number | null;
  employment_type_name: string | null;
  branch_code: string | null;
  date_of_joining: string | null;
  reports_to_id: number | null;
  reports_to_name: string | null;
  profile_picture_path: string | null;
}

export interface EmployeeProfile {
  name_with_initials: string | null;
  nic: string | null;
  passport_no: string | null;
  marital_status: string | null;
  nationality: string | null;
  religion: string | null;
  blood_group: string | null;
  date_of_birth: string | null;
  gender: string | null;
  personal_email: string | null;
  mobile_phone: string | null;
  home_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  district: string | null;
  postal_code: string | null;
  permanent_address: string | null;
  department_id: number | null;
  designation_id: number | null;
  employment_type_id: number | null;
  branch_code: string | null;
  reports_to_id: number | null;
  grade: string | null;
  work_location: string | null;
  shift_id: number | null;
  holiday_list_id: number | null;
  date_of_joining: string | null;
  probation_end_date: string | null;
  confirmation_date: string | null;
  contract_end_date: string | null;
  notice_period_days: number | null;
  retirement_date: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  epf_no: string | null;
  etf_no: string | null;
  tin_no: string | null;
}

export interface EmployeeDetail extends EmployeeListItem, EmployeeProfile {
  version?: string | null;
  shift_name: string | null;
  service_years: number | null;
  resignation_date: string | null;
  last_working_date: string | null;
  exit_type: string | null;
  exit_reason: string | null;
  sensitive_hidden: boolean;
  counts: Record<string, number>;
}

export type EmployeeCreateInput = Partial<EmployeeProfile> & { user_id: number; employee_id: string };
export type EmployeeUpdateInput = Partial<EmployeeProfile> & { expected_version?: string | null };

export interface SeparationInput {
  exit_type: "resignation" | "termination" | "retirement" | "end_of_contract" | "death" | "other";
  resignation_date?: string | null;
  last_working_date: string;
  exit_reason?: string | null;
  deactivate_user?: boolean;
  expected_version?: string | null;
}

export interface EmergencyContact { id: number; employee_pk: number; name: string; relationship_type: string; phone: string; alt_phone: string | null; address: string | null; is_primary: boolean }
export interface Dependent { id: number; employee_pk: number; name: string; relationship_type: string; date_of_birth: string | null; nic: string | null; gender: string | null; is_beneficiary: boolean; remarks: string | null }
export interface Education { id: number; employee_pk: number; level: string; qualification: string; institution: string; field_of_study: string | null; start_year: number | null; end_year: number | null; grade: string | null }
export interface Experience { id: number; employee_pk: number; company: string; designation: string; from_date: string; to_date: string | null; last_salary: number | null; reason_for_leaving: string | null; reference_name: string | null; reference_contact: string | null }
export interface EmployeeDocument { id: number; employee_pk: number; doc_type: string; title: string; doc_number: string | null; issue_date: string | null; expiry_date: string | null; file_path: string | null; file_name: string | null; remarks: string | null; expired: boolean; expires_in_days: number | null }
export interface OnboardingTask { id: number; employee_pk: number; category: "onboarding" | "offboarding"; title: string; description: string | null; responsible: string | null; due_date: string | null; status: "pending" | "in_progress" | "done" | "skipped"; completed_date: string | null; sort_order: number }

export type SubKind = "emergency-contacts" | "dependents" | "education" | "experience" | "documents" | "tasks";

// ───────────── reports ─────────────
export interface CountRow { key: string | number | null; label: string; count: number }
export interface Headcount {
  total: number;
  by_status: CountRow[];
  by_department: CountRow[];
  by_designation: CountRow[];
  by_employment_type: CountRow[];
  by_branch: CountRow[];
  by_gender: CountRow[];
}
export interface UpcomingRow { employee_pk: number; employee_id: string; name: string | null; date: string; years: number; days_to_go: number; branch_code: string | null }
export interface ExpiryRow { employee_pk: number; employee_id: string; name: string | null; date: string; days_left: number; doc_type?: string; title?: string }
export interface Expiring { contracts: ExpiryRow[]; probation: ExpiryRow[]; retirements: ExpiryRow[]; documents: ExpiryRow[] }
export interface LeaveSummary {
  year: number;
  by_type: { code: string; name: string; approved_days: number; pending_days: number; rejected_days: number; applications: number }[];
  on_leave_today: { employee_pk: number; employee_id: string; name: string | null; leave_type: string; from_date: string; to_date: string }[];
}
export interface Attrition {
  year: number;
  joiners: number;
  leavers: number;
  opening_headcount: number;
  closing_headcount: number;
  attrition_rate_percent: number;
  by_exit_type: { key: string; count: number }[];
  leaver_list: { employee_pk: number; employee_id: string; name: string | null; exit_type: string | null; last_working_date: string; reason: string | null }[];
}

const clean = <T extends object>(p?: T) =>
  p ? (Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T) : undefined;

function crud<T, I>(base: string) {
  return {
    list: async (params?: Record<string, unknown>) => (await apiClient.get<T[]>(base, { params: clean(params) })).data,
    create: async (data: I) => (await apiClient.post<T>(base, data)).data,
    update: async (id: number, data: I) => (await apiClient.put<T>(`${base}/${id}`, data)).data,
  };
}

export const hrOrgApi = {
  departments: crud<Department, DepartmentInput>("/hr/departments"),
  designations: crud<Designation, DesignationInput>("/hr/designations"),
  employmentTypes: crud<EmploymentType, EmploymentTypeInput>("/hr/employment-types"),
  shifts: crud<Shift, ShiftInput>("/hr/shifts"),
  holidayLists: crud<HolidayList, HolidayListInput>("/hr/holiday-lists"),
  leaveTypes: crud<LeaveType, LeaveTypeInput>("/hr/leave-types"),
  holidays: {
    list: async (listId: number) => (await apiClient.get<Holiday[]>(`/hr/holiday-lists/${listId}/holidays`)).data,
    create: async (listId: number, data: HolidayInput) => (await apiClient.post<Holiday>(`/hr/holiday-lists/${listId}/holidays`, data)).data,
    update: async (listId: number, id: number, data: HolidayInput) => (await apiClient.put<Holiday>(`/hr/holiday-lists/${listId}/holidays/${id}`, data)).data,
    remove: async (listId: number, id: number) => { await apiClient.delete(`/hr/holiday-lists/${listId}/holidays/${id}`); },
  },
};

export const leaveAllocationApi = {
  list: async (params: { year: number; employee_pk?: number; leave_type_id?: number; page?: number; size?: number }) =>
    (await apiClient.get<Page<LeaveAllocation>>("/hr/leave-allocations", { params: clean(params) })).data,
  create: async (data: { employee_pk: number; leave_type_id: number; year: number; allocated: number; carried_forward?: number; adjustment?: number; remarks?: string | null }) =>
    (await apiClient.post<LeaveAllocation>("/hr/leave-allocations", data)).data,
  update: async (id: number, data: { allocated: number; carried_forward: number; adjustment: number; remarks?: string | null; expected_version?: string | null }) =>
    (await apiClient.put<LeaveAllocation>(`/hr/leave-allocations/${id}`, data)).data,
  generate: async (data: { year: number; employee_pk?: number; carry_forward: boolean; overwrite: boolean }) =>
    (await apiClient.post<{ year: number; created: number; updated: number; skipped: number }>("/hr/leave-allocations/generate", data)).data,
  balances: async (employeePk: number, year?: number) =>
    (await apiClient.get<LeaveBalanceRow[]>(`/hr/employees/${employeePk}/leave-balances`, { params: clean({ year }) })).data,
};

export const employeeCoreApi = {
  paged: async (params: {
    q?: string; department_id?: number; designation_id?: number; employment_type_id?: number; branch_code?: string; status?: string;
    sort_by?: string; order?: "asc" | "desc"; page?: number; size?: number;
  }) => (await apiClient.get<Page<EmployeeListItem>>("/employees/paged", { params: clean(params) })).data,
  get: async (id: number) => (await apiClient.get<EmployeeDetail>(`/employees/${id}`)).data,
  create: async (data: EmployeeCreateInput) => (await apiClient.post<EmployeeDetail>("/employees/", data)).data,
  update: async (id: number, data: EmployeeUpdateInput) => (await apiClient.put<EmployeeDetail>(`/employees/${id}`, data)).data,
  confirm: async (id: number, date?: string) => (await apiClient.post<EmployeeDetail>(`/employees/${id}/confirm`, null, { params: clean({ confirmation_date: date }) })).data,
  separate: async (id: number, data: SeparationInput) => (await apiClient.post<EmployeeDetail>(`/employees/${id}/separate`, data)).data,
  reinstate: async (id: number) => (await apiClient.post<EmployeeDetail>(`/employees/${id}/reinstate`)).data,
  applyChecklist: async (id: number, category: "onboarding" | "offboarding") => (await apiClient.post<{ created: number }>(`/employees/${id}/checklist/${category}`)).data,
  sub: {
    list: async <T>(id: number, kind: SubKind) => (await apiClient.get<T[]>(`/employees/${id}/${kind}`)).data,
    create: async <T>(id: number, kind: SubKind, data: object) => (await apiClient.post<T>(`/employees/${id}/${kind}`, data)).data,
    update: async <T>(id: number, kind: SubKind, rowId: number, data: object) => (await apiClient.put<T>(`/employees/${id}/${kind}/${rowId}`, data)).data,
    remove: async (id: number, kind: SubKind, rowId: number) => { await apiClient.delete(`/employees/${id}/${kind}/${rowId}`); },
  },
  setTaskStatus: async (id: number, taskId: number, status: OnboardingTask["status"]) =>
    (await apiClient.patch<OnboardingTask>(`/employees/${id}/tasks/${taskId}/status`, { status })).data,
  uploadDocument: async (id: number, docId: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return (await apiClient.post<EmployeeDocument>(`/employees/${id}/documents/${docId}/file`, fd, { headers: { "Content-Type": "multipart/form-data" } })).data;
  },
  downloadDocument: async (id: number, docId: number, fileName: string) => {
    const res = await apiClient.get<Blob>(`/employees/${id}/documents/${docId}/file`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "document";
    a.click();
    URL.revokeObjectURL(url);
  },
};

export const hrReportsApi = {
  headcount: async () => (await apiClient.get<Headcount>("/hr/reports/headcount")).data,
  birthdays: async (days = 30) => (await apiClient.get<UpcomingRow[]>("/hr/reports/birthdays", { params: { days } })).data,
  anniversaries: async (days = 30) => (await apiClient.get<UpcomingRow[]>("/hr/reports/anniversaries", { params: { days } })).data,
  expiring: async (days = 60) => (await apiClient.get<Expiring>("/hr/reports/expiring", { params: { days } })).data,
  leaveSummary: async (year?: number) => (await apiClient.get<LeaveSummary>("/hr/reports/leave-summary", { params: clean({ year }) })).data,
  attrition: async (year?: number) => (await apiClient.get<Attrition>("/hr/reports/attrition", { params: clean({ year }) })).data,
};
