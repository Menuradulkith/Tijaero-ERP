export interface Employee {
  id: number;
  user_id: number;
  employee_id: string;
  created_at: string;
  updated_at: string;
}

export interface EmployeeCreate {
  user_id: number;
  employee_id: string;
}

export interface EmployeeUpdate {
  employee_id?: string;
}
