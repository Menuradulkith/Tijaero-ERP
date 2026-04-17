import apiClient from "@/api/client";
import type { User } from "@/api/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// Read persisted auth state synchronously at module load time.
// This ensures the very first render already has the correct isAuthenticated
// value, preventing the redirect-on-refresh bug.
function getPersistedAuth(): {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
} {
  try {
    const raw = localStorage.getItem("auth-storage");
    if (raw) {
      const parsed = JSON.parse(raw);
      const state = parsed?.state;
      if (state) {
        return {
          token: state.token ?? null,
          user: state.user ?? null,
          isAuthenticated: state.isAuthenticated ?? false,
        };
      }
    }
  } catch {
    // ignore parse errors
  }
  return { token: null, user: null, isAuthenticated: false };
}

const persisted = getPersistedAuth();

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  clearAuth: () => void;
  updateUser: (user: User) => void;
  updateTokens: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (_set) => ({
      token: persisted.token,
      user: persisted.user,
      isAuthenticated: persisted.isAuthenticated,
      login: (token, user) => _set({ token, user, isAuthenticated: true }),
      logout: () => {
        _set({ token: null, user: null, isAuthenticated: false });
        apiClient.post("/auth/logout").catch(() => {}); // Clear secure cookie on backend
      },
      clearAuth: () => {
        _set({ token: null, user: null, isAuthenticated: false });
      },
      updateUser: (user) => _set({ user }),
      updateTokens: (token) => _set({ token }),
    }),
    {
      name: "auth-storage",
    },
  ),
);
