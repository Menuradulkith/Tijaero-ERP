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

  // Handle item selection
  const handleSelectItem = useCallback((item: T) => {
    // Warn about unsaved changes
    if (isEditing || isCreating) {
      if (!window.confirm("You have unsaved changes. Discard them?")) {
        return;
      }
    }
    setSelectedItem(item);
    if (resetFormFromItem) {
      setFormData(resetFormFromItem(item));
    }
    setIsEditing(false);
    setIsCreating(false);
  }, [isEditing, isCreating, resetFormFromItem]);

  // Handle creating new item
  const handleNew = useCallback(() => {
    if (isEditing || isCreating) {
      if (!window.confirm("You have unsaved changes. Discard them?")) {
        return;
      }
    }
    setSelectedItem(null);
    setFormData(initialFormData);
    setIsCreating(true);
    setIsEditing(true);
  }, [isEditing, isCreating, initialFormData]);

  // Handle cancel
  const handleCancel = useCallback((filteredItems: T[]) => {
    if (isCreating) {
      setIsCreating(false);
      setIsEditing(false);
      // Select first item if available
      if (filteredItems.length > 0 && resetFormFromItem) {
        const firstItem = filteredItems[0];
        setSelectedItem(firstItem);
        setFormData(resetFormFromItem(firstItem));
      }
    } else if (selectedItem && resetFormFromItem) {
      // Reset to current item
      setFormData(resetFormFromItem(selectedItem));
      setIsEditing(false);
    }
  }, [isCreating, selectedItem, resetFormFromItem]);

  // Handle starting edit mode
  const handleStartEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

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
    
    // Favorites
    favorites,
    toggleFavorite,
    
    // Form
    formData,
    setFormData,
    updateFormField,
    
    // Handlers
    handleSelectItem,
    handleNew,
    handleCancel,
    handleStartEdit,
    resetToItem,
  };
}

export default useMasterDetailState;
