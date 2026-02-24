import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/api/types";

// Read persisted auth state synchronously at module load time.
// This ensures the very first render already has the correct isAuthenticated
// value, preventing the redirect-on-refresh bug.
function getPersistedAuth(): { token: string | null; refreshToken: string | null; user: User | null; isAuthenticated: boolean } {
  try {
    const raw = localStorage.getItem("auth-storage");
    if (raw) {
      const parsed = JSON.parse(raw);
      const state = parsed?.state;
      if (state) {
        return {
          token: state.token ?? null,
          refreshToken: state.refreshToken ?? null,
          user: state.user ?? null,
          isAuthenticated: state.isAuthenticated ?? false,
        };
      }
    }
  } catch {
    // ignore parse errors
  }
  return { token: null, refreshToken: null, user: null, isAuthenticated: false };
}

const persisted = getPersistedAuth();

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  login: (token: string, refreshToken: string, user: User) => void;
  logout: () => void;
  updateUser: (user: User) => void;
  updateTokens: (token: string, refreshToken: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (_set) => ({
      token: persisted.token,
      refreshToken: persisted.refreshToken,
      user: persisted.user,
      isAuthenticated: persisted.isAuthenticated,
      login: (token, refreshToken, user) =>
        _set({ token, refreshToken, user, isAuthenticated: true }),
      logout: () =>
        _set({ token: null, refreshToken: null, user: null, isAuthenticated: false }),
      updateUser: (user) => _set({ user }),
      updateTokens: (token, refreshToken) => _set({ token, refreshToken }),
    }),
    {
      name: "auth-storage",
    }
  )
);
