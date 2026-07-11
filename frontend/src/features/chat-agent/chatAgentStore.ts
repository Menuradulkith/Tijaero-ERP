/** Chat Agent — shared UI state so the header button can open the widget. */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ChatAgentUiState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Active server-side conversation id — persisted so reopening the widget
   *  (or reloading the page) resumes the same conversation and its history. */
  conversationId: number | null;
  setConversationId: (id: number | null) => void;
}

export const useChatAgentUi = create<ChatAgentUiState>()(
  persist(
    (set) => ({
      open: false,
      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),
      conversationId: null,
      setConversationId: (conversationId) => set({ conversationId }),
    }),
    {
      name: "tijaero-chat-agent",
      // Only the conversation pointer is persisted; open/close is per-session.
      partialize: (s) => ({ conversationId: s.conversationId }),
    },
  ),
);
