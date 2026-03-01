/**
 * Form Guard Store — Global unsaved changes protection
 *
 * Tracks whether any form in the ERP has unsaved changes.
 * Used by Sidebar, Header, IconNav and browser beforeunload to warn
 * before navigating away from dirty forms.
 *
 * Pages register a `discardFn` callback via useMasterDetailState so that
 * when the user confirms "Discard Changes", the form automatically cancels
 * (exits create/edit mode and resets form data) before navigating.
 */

import { create } from "zustand";

interface FormGuardState {
  /** Whether any form currently has unsaved changes */
  isDirty: boolean;
  /** Set the global dirty flag */
  setDirty: (dirty: boolean) => void;
  /** Callback registered by the active form to cancel / reset itself */
  discardFn: (() => void) | null;
  /** Register a discard callback (called by useMasterDetailState) */
  setDiscardFn: (fn: (() => void) | null) => void;
  /** Execute discard: call the registered callback and clear dirty */
  executeDiscard: () => void;
}

export const useFormGuardStore = create<FormGuardState>((set, get) => ({
  isDirty: false,
  setDirty: (dirty) => set({ isDirty: dirty }),
  discardFn: null,
  setDiscardFn: (fn) => set({ discardFn: fn }),
  executeDiscard: () => {
    const { discardFn } = get();
    if (discardFn) discardFn();
    set({ isDirty: false });
  },
}));
