import apiClient from "../../api/client";

export interface Permission {
  id: number;
  name: string;
  resource: string;
  action: string;
  description?: string;
}

export interface Group {
  id: number;
  name: string;
  permissions: Permission[];
}

export interface GroupCreate {
  name: string;
  permission_ids: number[];
}

export interface GroupUpdate {
  name?: string;
  permission_ids?: number[];
}

export const groupsApi = {
  // Get all groups
  getGroups: async (): Promise<Group[]> => {
    const response = await apiClient.get("/groups");
    return response.data;
  },

  // Get group by ID
  getGroup: async (id: number): Promise<Group> => {
    const response = await apiClient.get(`/groups/${id}`);
    return response.data;
  },

  // Create group
  createGroup: async (group: GroupCreate): Promise<Group> => {
    const response = await apiClient.post("/groups", group);
    return response.data;
  },

  // Update group
  updateGroup: async (id: number, group: GroupUpdate): Promise<Group> => {
    const response = await apiClient.put(`/groups/${id}`, group);
    return response.data;
  },

  // Delete group
  deleteGroup: async (id: number): Promise<void> => {
    await apiClient.delete(`/groups/${id}`);
  },
};

export const permissionsApi = {
  // Get all permissions
  getPermissions: async (): Promise<Permission[]> => {
    const response = await apiClient.get("/permissions");
    return response.data;
  },
};
