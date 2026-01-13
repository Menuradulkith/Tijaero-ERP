/**
 * useMasterDetailState - Custom hook for Tijaero-style master-detail state management
 * 
 * This hook encapsulates all the common state logic used across master-detail pages:
 * - Search and sort functionality
 * - Selection state
 * - Edit/Create mode
 * - Favorites management
 * - Form data handling
 */

import { useState, useCallback, useEffect } from "react";
import { BaseEntity, UseMasterDetailStateOptions, UseMasterDetailStateReturn } from "../types";

export function useMasterDetailState<T extends BaseEntity, TCreate>(
  options: UseMasterDetailStateOptions<T, TCreate>
): UseMasterDetailStateReturn<T, TCreate> {
  const {
    initialFormData,
    resetFormFromItem,
    favoritesKey,
    defaultSortField,
    initialSortField,
    confirmUnsavedChanges,
  } = options;

  // Use initialSortField if provided, otherwise defaultSortField, fallback to "name"
  const sortDefault = initialSortField || defaultSortField || "name";

  // Search & Sort State
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState(sortDefault);
  const [sortAnchorEl, setSortAnchorEl] = useState<HTMLElement | null>(null);

  // Selection State
  const [selectedItem, setSelectedItem] = useState<T | null>(null);

  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Favorites State (persisted to localStorage)
  const [favorites, setFavorites] = useState<number[]>(() => {
    if (favoritesKey) {
      try {
        const stored = localStorage.getItem(favoritesKey);
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    }
    return [];
  });

  // Form State
  const [formData, setFormData] = useState<TCreate>(initialFormData);
  const [originalFormData, setOriginalFormData] = useState<TCreate>(initialFormData);

  // Check if there are unsaved changes
  const hasChanges = JSON.stringify(formData) !== JSON.stringify(originalFormData);

  // Persist favorites to localStorage
  useEffect(() => {
    if (favoritesKey) {
      localStorage.setItem(favoritesKey, JSON.stringify(favorites));
    }
  }, [favorites, favoritesKey]);

  // Toggle favorite
  const toggleFavorite = useCallback((id: number, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  }, []);

  // Update single form field
  const updateFormField = useCallback(<K extends keyof TCreate>(field: K, value: TCreate[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Reset form to item data (with optional resetFormFromItem function)
  const resetToItem = useCallback((item: T) => {
    if (resetFormFromItem) {
      setFormData(resetFormFromItem(item));
    }
  }, [resetFormFromItem]);

  // Handle item selection - returns true if selection succeeded, false if cancelled
  const handleSelectItem = useCallback(async (item: T): Promise<boolean> => {
    // Check if form has actual changes (only when editing existing items, not creating)
    const hasChanges = !isCreating && JSON.stringify(formData) !== JSON.stringify(originalFormData);
    
    // Warn about unsaved changes only if there are actual changes
    if ((isEditing || isCreating) && hasChanges) {
      const confirmed = confirmUnsavedChanges
        ? await confirmUnsavedChanges()
        : window.confirm("You have unsaved changes. Discard them?");
      if (!confirmed) {
        return false;
      }
    }
    setSelectedItem(item);
    const newFormData = resetFormFromItem ? resetFormFromItem(item) : initialFormData;
    setFormData(newFormData);
    setOriginalFormData(newFormData);
    setIsEditing(false);
    setIsCreating(false);
    return true;
  }, [isEditing, isCreating, formData, originalFormData, resetFormFromItem, confirmUnsavedChanges, initialFormData]);

  // Handle creating new item - returns true if succeeded, false if cancelled
  const handleNew = useCallback(async (): Promise<boolean> => {
    // Only check for changes when editing existing items, not when creating new ones
    if (isEditing && !isCreating) {
      const hasChanges = JSON.stringify(formData) !== JSON.stringify(originalFormData);
      if (hasChanges) {
        const confirmed = confirmUnsavedChanges
          ? await confirmUnsavedChanges()
          : window.confirm("You have unsaved changes. Discard them?");
        if (!confirmed) {
          return false;
        }
      }
    }
    setSelectedItem(null);
    setFormData(initialFormData);
    setOriginalFormData(initialFormData);
    setIsCreating(true);
    setIsEditing(true);
    return true;
  }, [isEditing, isCreating, formData, originalFormData, initialFormData, confirmUnsavedChanges]);

  // Handle cancel
  const handleCancel = useCallback((filteredItems: T[]) => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      // Select first item if available
      if (filteredItems.length > 0 && resetFormFromItem) {
        const firstItem = filteredItems[0];
        const newFormData = resetFormFromItem(firstItem);
        setSelectedItem(firstItem);
        setFormData(newFormData);
        setOriginalFormData(newFormData);
      }
    } else if (selectedItem && resetFormFromItem) {
      // Reset to current item
      const resetData = resetFormFromItem(selectedItem);
      setFormData(resetData);
      setOriginalFormData(resetData);
      setIsEditing(false);
    }
  }, [isCreating, selectedItem, resetFormFromItem]);

  // Handle starting edit mode
  const handleStartEdit = useCallback(() => {
    setOriginalFormData(formData);
    setIsEditing(true);
  }, [formData]);

  // Mark form as saved (sync original data with current data)
  const markAsSaved = useCallback(() => {
    setOriginalFormData(formData);
  }, [formData]);

  return {
    // Search & Sort
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    sortAnchorEl,
    setSortAnchorEl,
    
    // Selection
    selectedItem,
    setSelectedItem,
    
    // Edit state
    isEditing,
    setIsEditing,
    isCreating,
    setIsCreating,
    hasChanges,
    
    // Favorites
    favorites,
    toggleFavorite,
    
    // Form
    formData,
    setFormData,
    updateFormField,
    markAsSaved,
    
    // Handlers
    handleSelectItem,
    handleNew,
    handleCancel,
    handleStartEdit,
    resetToItem,
  };
}

export default useMasterDetailState;
