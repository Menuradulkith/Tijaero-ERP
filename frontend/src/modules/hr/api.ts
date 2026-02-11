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
