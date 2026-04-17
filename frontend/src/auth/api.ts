import apiClient from "@/api/client";
import type { LoginRequest, LoginResponse, User } from "@/api/types";

export const authApi = {
  login: async (credentials: LoginRequest): Promise<LoginResponse> => {
    const formData = new URLSearchParams();
    formData.append("username", credentials.username);
    formData.append("password", credentials.password);

    const response = await apiClient.post<LoginResponse>(
      "/auth/login",
      formData,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Skip-Auth-Intercept": "true",
          "X-Hide-Error-Toast": "true",
        },
      },
    );
    return response.data;
  },

  refreshToken: async (): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>(
      "/auth/refresh",
      {},
      {
        withCredentials: true,
        // Skip the interceptor for refresh calls to avoid infinite loops
        headers: { "X-Skip-Auth-Intercept": "true" },
      },
    );
    return response.data;
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await apiClient.get<User>("/users/me");
    return response.data;
  },
};
