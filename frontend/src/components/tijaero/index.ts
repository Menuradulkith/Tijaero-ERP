/**
 * Tijaero-Style Component Library
 * 
 * This library provides reusable components for building Tijaero-style master-detail pages.
 * All components are designed to work together and follow consistent patterns.
 * 
 * Usage Example:
 * ```tsx
 * import {
 *   MasterDetailLayout,
 *   SearchableList,
 *   SelectableListItem,
 *   DetailPanelHeader,
 *   ActionToolbar,
 *   FormSection,
 *   EmptyState,
 *   useMasterDetailState,
 * } from "@/components/tijaero";
 * ```
 */

// Types
export * from "./types";

// Hooks
export { useMasterDetailState } from "./hooks";

// Layouts
export { MasterDetailLayout } from "./layouts";

// Lists
export { SearchableList, SelectableListItem } from "./lists";

// Panels
export { DetailPanelHeader } from "./panels";

// Toolbars
export { ActionToolbar } from "./toolbars";

// Forms
export { FormSection } from "./forms";

// Feedback
export { EmptyState } from "./feedback";
