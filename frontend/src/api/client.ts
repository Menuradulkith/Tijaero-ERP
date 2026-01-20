import axios, { AxiosError } from "axios";
import { useAuthStore } from "@/state/authStore";

// Create axios instance with performance-optimized configuration
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1",
  headers: {
    "Content-Type": "application/json",
    "Accept-Encoding": "gzip, deflate",
  },
  timeout: 30000,
});

// Response interceptor for error handling
apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = "/login";
    }

    // Handle timeout errors
    if (error.code === 'ECONNABORTED') {
      console.error('Request timeout - the server took too long to respond');
    }

    // Handle network errors
    if (!error.response) {
      console.error('Network error - please check your internet connection');
    }

    return Promise.reject(error);
  }
);

export default apiClient;
