import apiClient from "../../api/client";

export interface User {
  id: number;
  username: string;
  email?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  gender?: string;
  birthdate?: string;
  occupation?: string;
  phone_number?: string;
  profile_picture_path?: string;
  employee_id: string;
  is_active: boolean;
  is_superuser: boolean;
  is_staff: boolean;
  verify: boolean;
  blocked: boolean;
  must_change_password: boolean;
  date_joined: string;
  last_login?: string;
  branches: BranchSimple[];
  primary_branch?: BranchSimple;
  groups: Group[];
  created_at: string;
  updated_at: string;
}

export interface UserList {
  id: number;
  username: string;
  email?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  gender?: string;
  birthdate?: string;
  phone_number?: string;
  profile_picture_path?: string;
  date_joined: string;
  last_login?: string;
  is_active: boolean;
  is_superuser: boolean;
  is_staff: boolean;
  blocked: boolean;
  must_change_password: boolean;
  employee_id: string;
  occupation?: string;
  branches: BranchSimple[];
  primary_branch?: BranchSimple;
  groups: GroupSimple[];
  created_at?: string;
  updated_at?: string;
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
  email?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  gender?: string;
  birthdate?: string;
  date_joined?: string;
  occupation?: string;
  phone_number?: string;
  employee_id: string;
  is_active: boolean;
  is_staff: boolean;
  branch_ids: number[];
  primary_branch_id?: number;
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
  date_joined?: string;
  occupation?: string;
  phone_number?: string;
  password?: string;
  is_active?: boolean;
  is_staff?: boolean;
  branch_ids?: number[];
  primary_branch_id?: number;
  group_ids?: number[];
}

export const usersApi = {
  // Get all users
  getUsers: async (page = 1, size = 100000): Promise<UserList[]> => {
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

  // Check if email exists
  checkEmailExists: async (email: string): Promise<boolean> => {
    try {
      const response = await apiClient.get(`/users/check-email/${encodeURIComponent(email)}`);
      return response.data.exists;
    } catch {
      return false;
    }
  },

  // Check if employee ID exists
  checkEmployeeIdExists: async (employeeId: string): Promise<boolean> => {
    try {
      const response = await apiClient.get(`/users/check-employee-id/${employeeId}`);
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

  // Clear a user's blocked flag
  unblockUser: async (id: number): Promise<User> => {
    const response = await apiClient.post(`/users/${id}/unblock`);
    return response.data;
  },

  // Require the user to set a new password on next login
  forcePasswordReset: async (id: number): Promise<User> => {
    const response = await apiClient.post(`/users/${id}/force-password-reset`);
    return response.data;
  },

  // Upload/replace a user's profile picture
  uploadProfilePicture: async (id: number, file: File): Promise<User> => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiClient.post(`/users/${id}/profile-picture`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  },

  // Remove a user's profile picture
  removeProfilePicture: async (id: number): Promise<User> => {
    const response = await apiClient.delete(`/users/${id}/profile-picture`);
    return response.data;
  },
};
