import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TimezoneState {
  timezone: string;
  setTimezone: (timezone: string) => void;
}

export const useTimezoneStore = create<TimezoneState>()(
  persist(
    (set) => ({
      timezone: "Asia/Colombo",
      setTimezone: (timezone) => set({ timezone }),
    }),
    {
      name: "timezone-storage",
    }
  )
);
