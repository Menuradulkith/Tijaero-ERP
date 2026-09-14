import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CurrencyState {
  code: string;
  symbol: string;
  locale: string;
  setCurrency: (code: string, symbol: string) => void;
}

export const useCurrencyStore = create<CurrencyState>()(
  persist(
    (set) => ({
      code: "LKR",
      symbol: "Rs.",
      locale: "en-LK",
      setCurrency: (code, symbol) => set({ code, symbol }),
    }),
    {
      name: "currency-storage",
    }
  )
);
