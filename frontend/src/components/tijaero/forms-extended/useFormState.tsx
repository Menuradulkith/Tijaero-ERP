/**
 * useFormState - Custom hook for form state management
 * 
 * Encapsulates common form state patterns including edit mode,
 * dirty checking, and form data management.
 * 
 * @example
 * ```tsx
 * const {
 *   mode,
 *   isDirty,
 *   formData,
 *   updateField,
 *   startEdit,
 *   startCreate,
 *   cancel,
 *   resetToItem,
 * } = useFormState<Customer>({
 *   initialData: { name: "", email: "" },
 *   transformItem: (customer) => ({ name: customer.name, email: customer.email }),
 * });
 * ```
 */

import { useState, useCallback, useEffect, useRef } from "react";

export interface UseFormStateOptions<TFormData, TItem = unknown> {
  /** Initial form data for create mode */
  initialData: TFormData;
  /** Transform item to form data */
  transformItem?: (item: TItem) => TFormData;
  /** Warn before discarding unsaved changes */
  warnOnUnsaved?: boolean;
  /** Custom unsaved changes message */
  unsavedMessage?: string;
  /** Custom async confirm function (replaces window.confirm) */
  confirmFn?: (message: string) => Promise<boolean>;
}

export interface UseFormStateReturn<TFormData, TItem = unknown> {
  /** Current mode */
  mode: "view" | "edit" | "create";
  /** Is currently editing (edit or create) */
  isEditing: boolean;
  /** Is creating new */
  isCreating: boolean;
  /** Form data has been modified */
  isDirty: boolean;
  /** Current form data */
  formData: TFormData;
  /** Original item (if editing) */
  originalItem: TItem | null;
  /** Set form data */
  setFormData: React.Dispatch<React.SetStateAction<TFormData>>;
  /** Update a single form field */
  updateField: <K extends keyof TFormData>(field: K, value: TFormData[K]) => void;
  /** Start editing an item */
  startEdit: (item?: TItem) => void;
  /** Start creating new item */
  startCreate: () => void;
  /** Cancel editing and restore original */
  cancel: () => void;
  /** Reset form to item data */
  resetToItem: (item: TItem) => void;
  /** Set mode to view */
  setViewMode: () => void;
  /** Mark form as saved (resets dirty state) */
  markSaved: () => void;
  /** Check for unsaved changes before action (async to support dialog confirmations) */
  checkUnsaved: (action: () => void) => Promise<void>;
}

export function useFormState<TFormData, TItem = unknown>(
  options: UseFormStateOptions<TFormData, TItem>
): UseFormStateReturn<TFormData, TItem> {
  const {
    initialData,
    transformItem,
    warnOnUnsaved = true,
    unsavedMessage = "You have unsaved changes. Discard them?",
    confirmFn,
  } = options;

  // State
  const [mode, setMode] = useState<"view" | "edit" | "create">("view");
  const [formData, setFormData] = useState<TFormData>(initialData);
  const [originalItem, setOriginalItem] = useState<TItem | null>(null);
  
  // Track original form data for dirty checking
  const originalDataRef = useRef<TFormData>(initialData);

  // Computed state
  const isEditing = mode === "edit" || mode === "create";
  const isCreating = mode === "create";

  // Check if form is dirty (has unsaved changes)
  const isDirty = isEditing && JSON.stringify(formData) !== JSON.stringify(originalDataRef.current);

  // Update single field
  const updateField = useCallback(<K extends keyof TFormData>(
    field: K,
    value: TFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Reset form to item
  const resetToItem = useCallback((item: TItem) => {
    if (transformItem) {
      const transformed = transformItem(item);
      setFormData(transformed);
      originalDataRef.current = transformed;
    }
    setOriginalItem(item);
  }, [transformItem]);

  // Start editing
  const startEdit = useCallback((item?: TItem) => {
    if (item && transformItem) {
      resetToItem(item);
    }
    setMode("edit");
  }, [resetToItem, transformItem]);

  // Start creating
  const startCreate = useCallback(() => {
    setFormData(initialData);
    originalDataRef.current = initialData;
    setOriginalItem(null);
    setMode("create");
  }, [initialData]);

  // Cancel editing
  const cancel = useCallback(() => {
    if (originalItem && transformItem) {
      setFormData(transformItem(originalItem));
    } else {
      setFormData(initialData);
    }
    setMode("view");
  }, [originalItem, transformItem, initialData]);

  // Set view mode
  const setViewMode = useCallback(() => {
    setMode("view");
  }, []);

  // Mark as saved
  const markSaved = useCallback(() => {
    originalDataRef.current = formData;
  }, [formData]);

  // Check unsaved before action (supports async confirm dialogs)
  const checkUnsaved = useCallback(async (action: () => void) => {
    if (warnOnUnsaved && isDirty) {
      // Use custom confirm function if provided, otherwise fall back to native
      const confirmed = confirmFn 
        ? await confirmFn(unsavedMessage)
        : window.confirm(unsavedMessage);
      
      if (confirmed) {
        action();
      }
    } else {
      action();
    }
  }, [warnOnUnsaved, isDirty, unsavedMessage, confirmFn]);

  // Warn on page unload if dirty
  useEffect(() => {
    if (warnOnUnsaved && isDirty) {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = unsavedMessage;
        return unsavedMessage;
      };

      window.addEventListener("beforeunload", handleBeforeUnload);
      return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }
  }, [warnOnUnsaved, isDirty, unsavedMessage]);

  return {
    mode,
    isEditing,
    isCreating,
    isDirty,
    formData,
    originalItem,
    setFormData,
    updateField,
    startEdit,
    startCreate,
    cancel,
    resetToItem,
    setViewMode,
    markSaved,
    checkUnsaved,
  };
}

export default useFormState;
