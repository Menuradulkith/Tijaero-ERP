import apiClient from "@/api/client";
import {
  SalaryDeduction,
  SalaryDeductionCreate,
  Reimbursement,
  ReimbursementCreate,
  ReimbursementApprove,
  ReimbursementReject,
  ReimbursementVerify,
  ReimbursementPayment,
  EmployeePayroll,
  EmployeePayrollCreate,
  EmployeeSalaryProfile,
  EmployeeSalaryProfileCreate,
  EmployeePromotion,
  EmployeePromotionCreate,
  EmployeeAsset,
  EmployeeAssetCreate,
  PayrollBatch,
  PayrollRunRequest,
  PayrollBatchApprove,
  PayrollBatchReject,
  PayrollBatchProcessPayment,
  PayrollBatchProcessStatutory,
  MonthlyBranchSalesSummary,
  MonthlyBranchSalesSummaryWithCommissions,
  GenerateSalesSummaryRequest,
  FinalizeSummaryRequest,
  SalesOfficerCommission,
  ApproveCommissionRequest,
  RejectCommissionRequest,
  BulkApproveCommissionsRequest,
  CommissionDashboardStats,
  SalesSummaryFilter,
  SalesCommissionFilter,
  Attendance,
  AttendanceCreate,
  AttendanceCheckIn,
  AttendanceCheckOut,
  AttendanceSummary,
  Leave,
  LeaveCreate,
  LeaveApprove,
  LeaveReject,
  LeaveBalance,
  Employee,
  EmployeeCreate,
  EmployeeUpdate,
  HRStatistics,
} from "./types";

// Salary Deductions API
export const salaryDeductionsApi = {
  getAll: async (params?: {
    employee_id?: number;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<SalaryDeduction[]>("/hr/deductions", {
      params,
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<SalaryDeduction>(
      `/hr/deductions/${id}`
    );
    return response.data;
  },

  create: async (data: SalaryDeductionCreate) => {
    const response = await apiClient.post<SalaryDeduction>(
      "/hr/deductions",
      data
    );
    return response.data;
  },

  update: async (id: number, data: SalaryDeductionCreate) => {
    const response = await apiClient.put<SalaryDeduction>(
      `/hr/deductions/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/hr/deductions/${id}`);
  },
};

// Reimbursements API
export const reimbursementsApi = {
  getAll: async (params?: {
    employee_id?: string;
    branch_code?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<Reimbursement[]>(
      "/hr/reimbursements",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Reimbursement>(
      `/hr/reimbursements/${id}`
    );
    return response.data;
  },

  create: async (data: ReimbursementCreate) => {
    const response = await apiClient.post<Reimbursement>(
      "/hr/reimbursements",
      data
    );
    return response.data;
  },

  update: async (id: number, data: Partial<ReimbursementCreate>) => {
    const response = await apiClient.patch<Reimbursement>(
      `/hr/reimbursements/${id}`,
      data
    );
    return response.data;
  },

  approve: async (id: number, data: ReimbursementApprove) => {
    const response = await apiClient.post<Reimbursement>(
      `/hr/reimbursements/${id}/approve`,
      data
    );
    return response.data;
  },

  reject: async (id: number, data: ReimbursementReject) => {
    const response = await apiClient.post<Reimbursement>(
      `/hr/reimbursements/${id}/reject`,
      data
    );
    return response.data;
  },

  verify: async (id: number, data: ReimbursementVerify) => {
    const response = await apiClient.post<Reimbursement>(
      `/hr/reimbursements/${id}/verify`,
      data
    );
    return response.data;
  },

  processPayment: async (id: number, data: ReimbursementPayment) => {
    const response = await apiClient.post<Reimbursement>(
      `/hr/reimbursements/${id}/pay`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/hr/reimbursements/${id}`);
  },
};

// Payroll API
export const payrollApi = {
  getAll: async (params?: {
    employee_id?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<EmployeePayroll[]>("/hr/payroll", {
      params,
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<EmployeePayroll>(`/hr/payroll/${id}`);
    return response.data;
  },

  create: async (data: EmployeePayrollCreate) => {
    const response = await apiClient.post<EmployeePayroll>("/hr/payroll", data);
    return response.data;
  },

  update: async (id: number, data: EmployeePayrollCreate) => {
    const response = await apiClient.put<EmployeePayroll>(
      `/hr/payroll/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/hr/payroll/${id}`);
  },
};

// Payroll Batch API (workflow)
export const payrollBatchApi = {
  getAll: async (params?: {
    payroll_month?: number;
    payroll_year?: number;
    status?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<PayrollBatch[]>("/hr/payroll/batches", {
      params,
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<PayrollBatch>(
      `/hr/payroll/batches/${id}`
    );
    return response.data;
  },

  run: async (data: PayrollRunRequest) => {
    const response = await apiClient.post<PayrollBatch>(
      "/hr/payroll/run",
      data
    );
    return response.data;
  },

  submit: async (id: number) => {
    const response = await apiClient.post<PayrollBatch>(
      `/hr/payroll/batches/${id}/submit`
    );
    return response.data;
  },

  approve: async (id: number, data: PayrollBatchApprove) => {
    const response = await apiClient.post<PayrollBatch>(
      `/hr/payroll/batches/${id}/approve`,
      data
    );
    return response.data;
  },

  reject: async (id: number, data: PayrollBatchReject) => {
    const response = await apiClient.post<PayrollBatch>(
      `/hr/payroll/batches/${id}/reject`,
      data
    );
    return response.data;
  },

  processPayment: async (id: number, data: PayrollBatchProcessPayment) => {
    const response = await apiClient.post<PayrollBatch>(
      `/hr/payroll/batches/${id}/process-payment`,
      data
    );
    return response.data;
  },

  processStatutory: async (id: number, data: PayrollBatchProcessStatutory) => {
    const response = await apiClient.post<PayrollBatch>(
      `/hr/payroll/batches/${id}/process-statutory`,
      data
    );
    return response.data;
  },

  complete: async (id: number) => {
    const response = await apiClient.post<PayrollBatch>(
      `/hr/payroll/batches/${id}/complete`
    );
    return response.data;
  },

  cancel: async (id: number) => {
    const response = await apiClient.post<PayrollBatch>(
      `/hr/payroll/batches/${id}/cancel`
    );
    return response.data;
  },
};

// Salary Profiles API
export const salaryProfilesApi = {
  getAll: async () => {
    const response = await apiClient.get<EmployeeSalaryProfile[]>(
      "/hr/salary-profiles"
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<EmployeeSalaryProfile>(
      `/hr/salary-profiles/${id}`
    );
    return response.data;
  },

  getByEmployeeId: async (employeeId: string) => {
    const response = await apiClient.get<EmployeeSalaryProfile>(
      `/hr/employees/${employeeId}/salary-profile`
    );
    return response.data;
  },

  create: async (data: EmployeeSalaryProfileCreate) => {
    const response = await apiClient.post<EmployeeSalaryProfile>(
      "/hr/salary-profiles",
      data
    );
    return response.data;
  },

  update: async (id: number, data: EmployeeSalaryProfileCreate) => {
    const response = await apiClient.put<EmployeeSalaryProfile>(
      `/hr/salary-profiles/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/hr/salary-profiles/${id}`);
  },
};

// Promotions API
export const promotionsApi = {
  getAll: async (params?: {
    employee_id?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<EmployeePromotion[]>(
      "/hr/promotions",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<EmployeePromotion>(
      `/hr/promotions/${id}`
    );
    return response.data;
  },

  create: async (data: EmployeePromotionCreate) => {
    const response = await apiClient.post<EmployeePromotion>(
      "/hr/promotions",
      data
    );
    return response.data;
  },

  update: async (id: number, data: EmployeePromotionCreate) => {
    const response = await apiClient.put<EmployeePromotion>(
      `/hr/promotions/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/hr/promotions/${id}`);
  },
};

// Employee Assets API
export const employeeAssetsApi = {
  getAll: async (params?: {
    employee_id?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<EmployeeAsset[]>(
      "/hr/employee-assets",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<EmployeeAsset>(
      `/hr/employee-assets/${id}`
    );
    return response.data;
  },

  create: async (data: EmployeeAssetCreate) => {
    const response = await apiClient.post<EmployeeAsset>(
      "/hr/employee-assets",
      data
    );
    return response.data;
  },

  update: async (id: number, data: EmployeeAssetCreate) => {
    const response = await apiClient.put<EmployeeAsset>(
      `/hr/employee-assets/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/hr/employee-assets/${id}`);
  },
};

// =============================================================================
// Sales Commission API - Scenario 28A
// =============================================================================

// Monthly Branch Sales Summary API
export const salesSummaryApi = {
  // Generate monthly summary for branch(es)
  generate: async (data: GenerateSalesSummaryRequest) => {
    const response = await apiClient.post<MonthlyBranchSalesSummary[]>(
      "/hr/sales-commissions/summaries/generate",
      data
    );
    return response.data;
  },

  // List all summaries with optional filters
  getAll: async (params?: SalesSummaryFilter) => {
    const response = await apiClient.get<MonthlyBranchSalesSummary[]>(
      "/hr/sales-commissions/summaries",
      { params }
    );
    return response.data;
  },

  // Get a single summary with its commissions
  getById: async (id: number) => {
    const response = await apiClient.get<MonthlyBranchSalesSummaryWithCommissions>(
      `/hr/sales-commissions/summaries/${id}`
    );
    return response.data;
  },

  // Finalize a summary (step 2 in workflow)
  finalize: async (id: number, data?: FinalizeSummaryRequest) => {
    const response = await apiClient.post<MonthlyBranchSalesSummary>(
      `/hr/sales-commissions/summaries/${id}/finalize`,
      data || {}
    );
    return response.data;
  },

  // Calculate commissions for a finalized summary (step 3)
  calculateCommissions: async (id: number, commissionPercentage?: number) => {
    const params = commissionPercentage ? { commission_percentage: commissionPercentage } : undefined;
    const response = await apiClient.post<SalesOfficerCommission[]>(
      `/hr/sales-commissions/summaries/${id}/calculate-commissions`,
      null,
      { params }
    );
    return response.data;
  },
};

// Sales Officer Commission API
export const salesCommissionApi = {
  // List all commissions with optional filters
  getAll: async (params?: SalesCommissionFilter) => {
    const response = await apiClient.get<SalesOfficerCommission[]>(
      "/hr/sales-commissions/commissions",
      { params }
    );
    return response.data;
  },

  // Get a single commission
  getById: async (id: number) => {
    const response = await apiClient.get<SalesOfficerCommission>(
      `/hr/sales-commissions/commissions/${id}`
    );
    return response.data;
  },

  // Approve a commission
  approve: async (id: number, data?: ApproveCommissionRequest) => {
    const response = await apiClient.post<SalesOfficerCommission>(
      `/hr/sales-commissions/commissions/${id}/approve`,
      data || {}
    );
    return response.data;
  },

  // Bulk approve commissions
  bulkApprove: async (data: BulkApproveCommissionsRequest) => {
    const response = await apiClient.post<SalesOfficerCommission[]>(
      "/hr/sales-commissions/commissions/bulk-approve",
      data
    );
    return response.data;
  },

  // Reject a commission
  reject: async (id: number, data: RejectCommissionRequest) => {
    const response = await apiClient.post<SalesOfficerCommission>(
      `/hr/sales-commissions/commissions/${id}/reject`,
      data
    );
    return response.data;
  },

  // Get approved commissions ready for payroll
  getPayrollReady: async (fiscalYear: number, fiscalMonth: number, employeeId?: number) => {
    const params: Record<string, unknown> = { fiscal_year: fiscalYear, fiscal_month: fiscalMonth };
    if (employeeId) params.employee_id = employeeId;
    const response = await apiClient.get<SalesOfficerCommission[]>(
      "/hr/sales-commissions/payroll-ready",
      { params }
    );
    return response.data;
  },

  // Mark commission as paid
  markPaid: async (id: number, payrollId: number) => {
    const response = await apiClient.post<SalesOfficerCommission>(
      `/hr/sales-commissions/commissions/${id}/mark-paid`,
      null,
      { params: { payroll_id: payrollId } }
    );
    return response.data;
  },

  // Get dashboard statistics
  getDashboardStats: async () => {
    const response = await apiClient.get<CommissionDashboardStats>(
      "/hr/sales-commissions/dashboard/stats"
    );
    return response.data;
  },
};

// Append handled by editor

// ─── Attendance API ────────────────────────────────────────────────────────────
export const attendanceApi = {
  getAll: async (params?: {
    employee_id?: string;
    branch_code?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<Attendance[]>("/hr/attendance", { params });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Attendance>(`/hr/attendance/${id}`);
    return response.data;
  },

  create: async (data: AttendanceCreate) => {
    const response = await apiClient.post<Attendance>("/hr/attendance", data);
    return response.data;
  },

  update: async (id: number, data: Partial<AttendanceCreate>) => {
    const response = await apiClient.put<Attendance>(`/hr/attendance/${id}`, data);
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/hr/attendance/${id}`);
  },

  checkIn: async (data: AttendanceCheckIn) => {
    const response = await apiClient.post<Attendance>("/hr/attendance/check-in", data);
    return response.data;
  },

  checkOut: async (data: AttendanceCheckOut) => {
    const response = await apiClient.post<Attendance>("/hr/attendance/check-out", data);
    return response.data;
  },

  summary: async (params: {
    date_from: string;
    date_to: string;
    employee_id?: string;
    branch_code?: string;
  }) => {
    const response = await apiClient.get<AttendanceSummary>("/hr/attendance/summary", { params });
    return response.data;
  },
};

// ─── Leaves API ────────────────────────────────────────────────────────────────
export const leavesApi = {
  getAll: async (params?: {
    employee_id?: string;
    leave_type?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<Leave[]>("/hr/leaves", { params });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Leave>(`/hr/leaves/${id}`);
    return response.data;
  },

  create: async (data: LeaveCreate) => {
    const response = await apiClient.post<Leave>("/hr/leaves", data);
    return response.data;
  },

  update: async (id: number, data: Partial<LeaveCreate>) => {
    const response = await apiClient.put<Leave>(`/hr/leaves/${id}`, data);
    return response.data;
  },

  approve: async (id: number, data: LeaveApprove) => {
    const response = await apiClient.post<Leave>(`/hr/leaves/${id}/approve`, data);
    return response.data;
  },

  reject: async (id: number, data: LeaveReject) => {
    const response = await apiClient.post<Leave>(`/hr/leaves/${id}/reject`, data);
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/hr/leaves/${id}`);
  },

  balance: async (employee_id: string, year?: number) => {
    const response = await apiClient.get<LeaveBalance>(
      `/hr/leaves/balance/${employee_id}`,
      { params: year ? { year } : undefined }
    );
    return response.data;
  },
};

// ─── Employees Master API ──────────────────────────────────────────────────────
export const employeesApi = {
  getAll: async (params?: { skip?: number; limit?: number }) => {
    const response = await apiClient.get<Employee[]>("/employees/", { params });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Employee>(`/employees/${id}`);
    return response.data;
  },

  create: async (data: EmployeeCreate) => {
    const response = await apiClient.post<Employee>("/employees/", data);
    return response.data;
  },

  update: async (id: number, data: EmployeeUpdate) => {
    const response = await apiClient.put<Employee>(`/employees/${id}`, data);
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/employees/${id}`);
  },
};

// HR Dashboard Statistics API — server-side aggregated KPI counts
export const hrStatisticsApi = {
  getStatistics: async () => {
    const response = await apiClient.get<HRStatistics>("/hr/statistics");
    return response.data;
  },
};
