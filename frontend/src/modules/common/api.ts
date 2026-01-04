import apiClient from "@/api/client";

// Location Types
export interface Location {
  id: number;
  name: string;
  created_date: string;
}

export interface LocationCreate {
  name: string;
}

// Locations API
export const locationsApi = {
  getAll: async () => {
    const response = await apiClient.get<Location[]>("/common/locations");
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Location>(`/common/locations/${id}`);
    return response.data;
  },

  create: async (data: LocationCreate) => {
    const response = await apiClient.post<Location>("/common/locations", data);
    return response.data;
  },

  update: async (id: number, data: LocationCreate) => {
    const response = await apiClient.put<Location>(
      `/common/locations/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/common/locations/${id}`);
  },
};

// Country Types
export interface Country {
  id: number;
  name: string;
  iso: string;
  iso3: string;
  currency_code?: string;
  currency_name?: string;
  phone?: string;
}

// Countries API
export const countriesApi = {
  getAll: async () => {
    const response = await apiClient.get<Country[]>("/common/countries");
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Country>(`/common/countries/${id}`);
    return response.data;
  },
};

// Approval Types
export interface Approval {
  id: number;
  approval_for?: string;
  status?: string;
  status_changed_by?: number;
  next_approval_group?: string;
  next_user_to_approve?: number;
  remark?: string;
}

export interface ApprovalCreate {
  approval_for: string;
  status?: string;
  remark?: string;
}

// Approvals API
export const approvalsApi = {
  getById: async (id: number) => {
    const response = await apiClient.get<Approval>(`/common/approvals/${id}`);
    return response.data;
  },

  create: async (data: ApprovalCreate) => {
    const response = await apiClient.post<Approval>("/common/approvals", data);
    return response.data;
  },

  update: async (id: number, data: Partial<ApprovalCreate>) => {
    const response = await apiClient.patch<Approval>(
      `/common/approvals/${id}`,
      data
    );
    return response.data;
  },
};
