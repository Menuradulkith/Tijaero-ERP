/**
 * Toast Utilities - Standardized toast notifications
 * 
 * Wrapper around react-hot-toast for consistent toast styling.
 * 
 * @example
 * ```tsx
 * import { showToast } from "@/components/tijaero";
 * 
 * showToast.success("Record saved successfully");
 * showToast.error("Failed to save record");
 * showToast.info("Processing...");
 * showToast.warning("This action cannot be undone");
 * 
 * // Custom options
 * showToast.success("Saved!", { duration: 3000 });
 * ```
 */

import toast, { Toaster } from "react-hot-toast";

export interface ToastOptions {
  /** Duration in ms (0 = infinite) */
  duration?: number;
  /** Toast position */
  position?:
    | "top-left"
    | "top-center"
    | "top-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";
  /** Custom icon */
  icon?: string;
  /** Toast ID (for dismissing) */
  id?: string;
}

// Default options
const defaultOptions: ToastOptions = {
  duration: 4000,
  position: "top-right",
};

/**
 * Derive a stable toast id from a message so identical error messages collapse
 * into a single toast instead of stacking. react-hot-toast replaces (rather than
 * adds) a toast whenever a new one shares an existing id. This lets the global
 * Axios interceptor and a component/mutation handler both report the SAME error
 * without the user seeing it twice.
 */
function messageToastId(prefix: string, message: string): string {
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    hash = (hash * 31 + message.charCodeAt(i)) | 0;
  }
  return `${prefix}_${hash}`;
}

/**
 * Show toast notifications with consistent styling
 */
export const showToast = {
  /**
   * Show success toast
   */
  success: (message: string, options?: ToastOptions) => {
    return toast.success(message, {
      ...defaultOptions,
      ...options,
    });
  },

  /**
   * Show error toast.
   *
   * Errors are de-duplicated by message content: a stable id is derived from the
   * message so the same error reported by both the global Axios interceptor and a
   * component/mutation handler collapses into one toast. An explicit `options.id`
   * always wins.
   */
  error: (message: string, options?: ToastOptions) => {
    return toast.error(message, {
      ...defaultOptions,
      duration: 5000, // Errors stay longer
      id: messageToastId("t_err", message),
      ...options,
    });
  },

  /**
   * Show info toast
   */
  info: (message: string, options?: ToastOptions) => {
    return toast(message, {
      ...defaultOptions,
      icon: "ℹ️",
      ...options,
    });
  },

  /**
   * Show warning toast
   */
  warning: (message: string, options?: ToastOptions) => {
    return toast(message, {
      ...defaultOptions,
      icon: "⚠️",
      ...options,
    });
  },

  /**
   * Show loading toast (stays until dismissed)
   */
  loading: (message: string, options?: ToastOptions) => {
    return toast.loading(message, {
      ...defaultOptions,
      duration: Infinity,
      ...options,
    });
  },

  /**
   * Show promise toast (loading -> success/error)
   */
  promise: <T,>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((error: unknown) => string);
    },
    options?: ToastOptions
  ) => {
    return toast.promise(
      promise,
      {
        loading: messages.loading,
        success: messages.success,
        error: messages.error,
      },
      {
        ...defaultOptions,
        ...options,
      }
    );
  },

  /**
   * Dismiss a toast by ID
   */
  dismiss: (toastId?: string) => {
    toast.dismiss(toastId);
  },

  /**
   * Dismiss all toasts
   */
  dismissAll: () => {
    toast.dismiss();
  },

  /**
   * Update an existing toast
   */
  update: (toastId: string, message: string, type?: "success" | "error") => {
    toast.dismiss(toastId);
    if (type === "success") {
      toast.success(message, { id: toastId });
    } else if (type === "error") {
      toast.error(message, { id: toastId });
    } else {
      toast(message, { id: toastId });
    }
  },
};

/**
 * Hook for toast notifications with component state
 */
export function useToast() {
  return {
    toast: showToast,
    success: showToast.success,
    error: showToast.error,
    info: showToast.info,
    warning: showToast.warning,
    loading: showToast.loading,
    promise: showToast.promise,
    dismiss: showToast.dismiss,
    dismissAll: showToast.dismissAll,
  };
}

/**
 * Toaster component for rendering toasts
 * Add this to your app root
 */
export { Toaster };

/**
 * Convenience function aliases for direct imports
 */
export const showSuccessToast = (message: string, options?: ToastOptions) => showToast.success(message, options);
export const showErrorToast = (message: string, options?: ToastOptions) => showToast.error(message, options);
export const showInfoToast = (message: string, options?: ToastOptions) => showToast.info(message, options);
export const showWarningToast = (message: string, options?: ToastOptions) => showToast.warning(message, options);

export default showToast;
