import apiClient from "@/api/client";
import type {
  Branch,
  BranchCreate,
  BranchUpdate,
  PaginatedResponse,
} from "@/api/types";

const ADDRESS_FIELDS = ["address_line1", "address_line2", "city", "state", "postal_code"] as const;

/**
 * Normalizes a create/update body: trims text, turns empty optional values
 * into null (EmailStr and the length-limited columns reject ""), and never
 * sends the legacy single-line `address` — the server derives it from the
 * structured fields.
 */
const cleanPayload = (data: BranchCreate | BranchUpdate): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...data };
  delete out.address;
  out.email = data.email?.trim() || null;
  out.contact_number = data.contact_number?.trim() || null;
  for (const field of ADDRESS_FIELDS) {
    if (field in data) out[field] = data[field]?.trim() || null;
  }
  if (typeof data.branch_name === "string") out.branch_name = data.branch_name.trim();
  if ("branch_code" in data && typeof data.branch_code === "string") out.branch_code = data.branch_code.trim();
  return out;
};

export const branchApi = {
  /**
   * `activeOnly` should be set for anything a user picks from (filters,
   * assignment pickers): deactivated branches must not be offered there.
   */
  getAll: async (page = 1, size = 100000, activeOnly = false): Promise<PaginatedResponse<Branch>> => {
    const response = await apiClient.get<PaginatedResponse<Branch>>(
      // Trailing slash matches the backend route; without it FastAPI answers with a 307 redirect.
      "/branches/",
      {
        params: activeOnly ? { page, size, active_only: true } : { page, size },
      }
    );
    return response.data;
  },

  getById: async (id: number): Promise<Branch> => {
    const response = await apiClient.get<Branch>(`/branches/${id}`);
    return response.data;
  },

  checkCodeExists: async (branchCode: string, excludeId?: number): Promise<boolean> => {
    try {
      const response = await apiClient.get(`/branches/check-code/${encodeURIComponent(branchCode)}`, {
        params: excludeId ? { exclude_id: excludeId } : undefined,
      });
      return response.data.exists;
    } catch {
      return false;
    }
  },

  checkNameExists: async (branchName: string, excludeId?: number): Promise<boolean> => {
    try {
      const response = await apiClient.get(`/branches/check-name/${encodeURIComponent(branchName)}`, {
        params: excludeId ? { exclude_id: excludeId } : undefined,
      });
      return response.data.exists;
    } catch {
      return false;
    }
  },

  checkEmailExists: async (email: string, excludeId?: number): Promise<boolean> => {
    try {
      const response = await apiClient.get(`/branches/check-email/${encodeURIComponent(email)}`, {
        params: excludeId ? { exclude_id: excludeId } : undefined,
      });
      return response.data.exists;
    } catch {
      return false;
    }
  },

  create: async (data: BranchCreate): Promise<Branch> => {
    const response = await apiClient.post<Branch>("/branches/", cleanPayload(data));
    return response.data;
  },

  update: async (id: number, data: BranchUpdate): Promise<Branch> => {
    const response = await apiClient.put<Branch>(`/branches/${id}`, cleanPayload(data));
    return response.data;
  },
};
