import apiClient from "@/api/client";
import { Employee, EmployeeCreate, EmployeeUpdate } from "./types";

export const employeesApi = {
  getAll: async (skip = 0, limit = 100) => {
    const response = await apiClient.get<Employee[]>("/employees/", {
      params: { skip, limit },
    });
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
