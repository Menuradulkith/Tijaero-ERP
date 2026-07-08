import { useAuthStore } from "@/state/authStore";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { toast } from "react-hot-toast";
import { handleApiError } from "@/utils/errorHandling";
import { showErrorToast } from "@/components/tijaero/feedback-extended/toast";

// Create axios instance with performance-optimized configuration
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // Crucial for sending and receiving HttpOnly cookies
  timeout: 30000,
});

// Track whether a token refresh is in progress to avoid concurrent refreshes
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (token) {
      prom.resolve(token);
    } else {
      prom.reject(error);
    }
  });
  failedQueue = [];
}

// Request interceptor — attach access token
apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor — auto-refresh on 401
apiClient.interceptors.response.use(
  (response) => {
    // Optionally handle generic success messages here if desired mapped by custom headers
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
      headers?: Record<string, string>;
    };

    // Skip refresh logic for the refresh endpoint itself, or if already retried
    const isRefreshCall =
      originalRequest?.headers?.["X-Skip-Auth-Intercept"] === "true";
    const requestUrl = originalRequest?.url || "";
    const isLoginCall = requestUrl.includes("/auth/login");

    // Hide default toast if requested
    const hideErrorToast =
      originalRequest?.headers?.["X-Hide-Error-Toast"] === "true";

    if (
      error.response?.status === 401 &&
      !originalRequest?._retry &&
      !isRefreshCall &&
      !isLoginCall
    ) {
      if (isRefreshing) {
        // Another refresh is in progress — queue this request
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return apiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // The HttpOnly cookie will automatically be sent by the browser
        const response = await axios.post(
          `${apiClient.defaults.baseURL}/auth/refresh`,
          {},
          {
            withCredentials: true,
            headers: { "Content-Type": "application/json" },
          },
        );

        const { access_token } = response.data;
        useAuthStore.getState().updateTokens(access_token);

        // Retry all queued requests with the new token
        processQueue(null, access_token);

        // Retry the original request
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        useAuthStore.getState().clearAuth();

        const refreshAxiosError = refreshError as AxiosError;
        const refreshData = refreshAxiosError.response?.data as
          | { detail?: string }
          | undefined;
        const refreshDetail = refreshData?.detail;
        if (
          typeof refreshDetail === "string" &&
          refreshDetail.toLowerCase().includes("password change")
        ) {
          toast.error("Your password was changed by an administrator. Please log in again.");
        }

        const currentPath = window.location.pathname + window.location.search;
        window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Handle timeout errors
    if (error.code === "ECONNABORTED") {
      console.error("Request timeout - the server took too long to respond");
      if (!hideErrorToast)
        showErrorToast("Request timeout - the server took too long to respond");
    }

    // Handle network errors
    if (!error.response && error.code !== "ECONNABORTED") {
      console.error("Network error - please check your internet connection");
      if (!hideErrorToast)
        showErrorToast("Network error - please check your internet connection");
    }

    // Capture standard API error responses to display
    // Do not toast permission-denied (403) to avoid noisy cross-module lookups.
    if (
      error.response &&
      !hideErrorToast &&
      error.response.status !== 401 &&
      error.response.status !== 403
    ) {
      const data: any = error.response.data;
      if (data?.detail || data?.message) {
        // Surface the REAL reason to the user — including FastAPI/Pydantic
        // validation errors (HTTP 422) where `detail` is an array of field
        // errors. handleApiError formats every shape (string / array / object)
        // into readable text instead of a generic "API Error Occurred".
        showErrorToast(handleApiError(error, "API Error Occurred"));
      } else if (error.response.status >= 500) {
        showErrorToast(
          "Internal Server Error occurred. Please try again later.",
        );
      }
    }

    return Promise.reject(error);
  },
);

export default apiClient;
