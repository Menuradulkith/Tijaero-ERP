import apiClient from "@/api/client";
import type { LoginRequest, LoginResponse, User } from "@/api/types";

// ─── Standard auth ───────────────────────────────────────────────────────────

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

// ─── Passcode types ───────────────────────────────────────────────────────────

export interface PasscodeLoginRequest {
  username: string;
  passcode: string;
}

export interface PasscodeStatus {
  has_passcode: boolean;
  locked_out: boolean;
  failed_attempts: number;
  expires_at: string | null;
  is_expired: boolean;
  days_until_expiry: number | null;
}

/** Structured error payload returned by the backend for passcode failures. */
export interface PasscodeErrorDetail {
  code: "PASSCODE_EXPIRED" | "PASSCODE_LOCKED" | "PASSCODE_INVALID" | "USER_INACTIVE";
  message: string;
  attempts_remaining?: number;
}

// ─── Passcode API ─────────────────────────────────────────────────────────────

export const passcodeApi = {
  /** Authenticate with username + 6-digit passcode. */
  login: async (body: PasscodeLoginRequest): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>(
      "/auth/passcode-login",
      body,
      {
        headers: {
          "X-Skip-Auth-Intercept": "true",
          "X-Hide-Error-Toast": "true",
        },
      },
    );
    return response.data;
  },

  /** Set or change the current user's passcode. Requires authentication. */
  setPasscode: async (passcode: string, confirm_passcode: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>("/auth/passcode", {
      passcode,
      confirm_passcode,
    });
    return response.data;
  },

  /** Get the current user's passcode status. */
  getStatus: async (): Promise<PasscodeStatus> => {
    const response = await apiClient.get<PasscodeStatus>("/auth/passcode/status");
    return response.data;
  },

  /** Remove the current user's active passcode. */
  deletePasscode: async (): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ message: string }>("/auth/passcode");
    return response.data;
  },
};
