/**
 * Generic CRUD API factory for TijaeroERP frontend modules.
 *
 * Eliminates the repeated getAll / getById / create / update / delete
 * boilerplate across module API files.
 *
 * Usage:
 *   const locationsApi = createCrudApi<Location, LocationCreate, Partial<LocationCreate>>("/common/locations");
 *
 *   // Then use:
 *   locationsApi.getAll({ skip: 0, limit: 50 });
 *   locationsApi.getById(1);
 *   locationsApi.create({ name: "Main", branch_code: "HQ" });
 *   locationsApi.update(1, { name: "Updated" });
 *   locationsApi.delete(1);
 */

import apiClient from "./client";

export interface CrudApi<T, TCreate = Partial<T>, TUpdate = Partial<T>> {
  getAll: (params?: Record<string, unknown>) => Promise<T[]>;
  getById: (id: number) => Promise<T>;
  create: (data: TCreate) => Promise<T>;
  update: (id: number, data: TUpdate) => Promise<T>;
  delete: (id: number) => Promise<void>;
}

export function createCrudApi<
  T,
  TCreate = Partial<T>,
  TUpdate = Partial<T>,
>(basePath: string): CrudApi<T, TCreate, TUpdate> {
  // Ensure basePath starts with / and doesn't end with /
  const path = basePath.startsWith("/") ? basePath : `/${basePath}`;
  const cleanPath = path.endsWith("/") ? path.slice(0, -1) : path;

  return {
    getAll: async (params?: Record<string, unknown>) => {
      const response = await apiClient.get<T[]>(cleanPath, { params });
      return response.data;
    },

    getById: async (id: number) => {
      const response = await apiClient.get<T>(`${cleanPath}/${id}`);
      return response.data;
    },

    create: async (data: TCreate) => {
      const response = await apiClient.post<T>(cleanPath, data);
      return response.data;
    },

    update: async (id: number, data: TUpdate) => {
      const response = await apiClient.put<T>(`${cleanPath}/${id}`, data);
      return response.data;
    },

    delete: async (id: number) => {
      await apiClient.delete(`${cleanPath}/${id}`);
    },
  };
}

export default createCrudApi;
