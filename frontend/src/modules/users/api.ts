import apiClient from "../../api/client";

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  gender: string;
  birthdate: string;
  occupation: string;
  employee_id: string;
  is_active: boolean;
  is_superuser: boolean;
  is_staff: boolean;
  verify: boolean;
  blocked: boolean;
  date_joined: string;
  branches: BranchSimple[];
  groups: Group[];
  created_at: string;
  updated_at: string;
}

export interface UserList {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_superuser: boolean;
  is_staff: boolean;
  employee_id: string;
  occupation: string;
  branches: BranchSimple[];
  groups: GroupSimple[];
}

export interface GroupSimple {
  id: number;
  name: string;
}

export interface BranchSimple {
  id: number;
  branch_name: string;
  branch_code: string;
}

export interface Group {
  id: number;
  name: string;
  permissions: Permission[];
}

export interface Permission {
  id: number;
  name: string;
  resource: string;
  action: string;
  description?: string;
}

export interface UserCreate {
  username: string;
  password: string;
  email: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  gender: string;
  birthdate: string;
  occupation: string;
  employee_id: string;
  is_active: boolean;
  is_staff: boolean;
  branch_ids: number[];
  group_ids: number[];
}

export interface UserUpdate {
  email?: string;
  username?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  gender?: string;
  birthdate?: string;
  occupation?: string;
  password?: string;
  is_active?: boolean;
  is_staff?: boolean;
  branch_ids?: number[];
  group_ids?: number[];
}

export const usersApi = {
  // Get all users
  getUsers: async (page = 1, size = 100): Promise<UserList[]> => {
    const response = await apiClient.get(
      `/users?skip=${(page - 1) * size}&limit=${size}`
    );
    return response.data;
  },

  // Check if username exists
  checkUsernameExists: async (username: string): Promise<boolean> => {
    try {
      const response = await apiClient.get(`/users/check-username/${username}`);
      return response.data.exists;
    } catch {
      return false;
    }
  },

  // Get current user
  getCurrentUser: async (): Promise<User> => {
    const response = await apiClient.get("/users/me");
    return response.data;
  },

  // Get user by ID
  getUser: async (id: number): Promise<User> => {
    const response = await apiClient.get(`/users/${id}`);
    return response.data;
  },

  // Create user
  createUser: async (user: UserCreate): Promise<User> => {
    const response = await apiClient.post("/users", user);
    return response.data;
  },

  // Update user
  updateUser: async (id: number, user: UserUpdate): Promise<User> => {
    const response = await apiClient.put(`/users/${id}`, user);
    return response.data;
  },

  // Delete user
  deleteUser: async (id: number): Promise<void> => {
    await apiClient.delete(`/users/${id}`);
  },
};
