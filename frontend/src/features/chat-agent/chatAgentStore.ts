/** Chat Agent — shared UI state so the header button can open the widget. */
import { create } from "zustand";

interface ChatAgentUiState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useChatAgentUi = create<ChatAgentUiState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
