# Tijaero-Style Component Library

This document describes the reusable Tijaero-style component library for building consistent master-detail pages throughout the ERP system.

## Overview

The Tijaero component library provides a set of reusable components that follow a consistent design pattern:
- **Master-Detail Layout**: Left panel with searchable list, right panel with detail view
- **Consistent Styling**: Same colors, spacing, and interactions everywhere
- **Reduced Code**: ~50-60% code reduction compared to manually building each page
- **Configuration-Driven**: Define behavior through props/keywords rather than reimplementing

## Component Library Structure

```
frontend/src/components/tijaero/
├── index.ts                    # Main exports
├── types.ts                    # TypeScript interfaces
├── hooks/
│   ├── index.ts
│   └── useMasterDetailState.ts # State management hook
├── layouts/
│   ├── index.ts
│   └── MasterDetailLayout.tsx  # Page layout wrapper
├── lists/
│   ├── index.ts
│   ├── SearchableList.tsx      # Master list panel
│   └── SelectableListItem.tsx  # List item component
├── panels/
│   ├── index.ts
│   └── DetailPanelHeader.tsx   # Detail panel header
├── toolbars/
│   ├── index.ts
│   └── ActionToolbar.tsx       # Action buttons
├── forms/
│   ├── index.ts
│   └── FormSection.tsx         # Form section wrapper
└── feedback/
    ├── index.ts
    └── EmptyState.tsx          # Empty/no-selection state
```

## Usage

Import all components from one place:

```tsx
import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  useMasterDetailState,
  SortOption,
} from "@/components/tijaero";
```

## Components

### 1. `useMasterDetailState` Hook

Manages all common state for master-detail pages:

```tsx
const {
  searchQuery, setSearchQuery,
  sortField, setSortField,
  selectedItem, setSelectedItem,
  isEditing, setIsEditing,
  isCreating, setIsCreating,
  favorites, toggleFavorite,
  formData, setFormData,
  handleSelectItem,
  handleNew,
  handleCancel,
  handleStartEdit,
} = useMasterDetailState<Item, ItemCreate>({
  initialFormData: { name: "", code: "" },
  resetFormFromItem: (item) => ({ name: item.name, code: item.code }),
  favoritesKey: "items_favorites",
  defaultSortField: "name",
});
```

### 2. `MasterDetailLayout`

Page wrapper providing consistent layout:

```tsx
<MasterDetailLayout
  title="Items"
  icon={<ItemIcon />}
  onRefresh={refetch}
  isLoading={isLoading}
  masterPanel={<SearchableList ... />}
  detailPanel={<DetailPanel ... />}
  tabs={[{ id: "all", label: "All Items" }]}  // optional
  activeTab="all"                              // optional
  onTabChange={handleTabChange}                // optional
/>
```

### 3. `SearchableList`

Master list panel with search and sort:

```tsx
<SearchableList<Item>
  items={filteredItems}
  isLoading={isLoading}
  searchQuery={searchQuery}
  onSearchChange={setSearchQuery}
  placeholder="Search items..."
  sortOptions={[
    { value: "name", label: "Name" },
    { value: "code", label: "Code" },
  ]}
  sortField={sortField}
  onSortChange={setSortField}
  selectedItem={selectedItem}
  onSelectItem={handleSelectItem}
  emptyMessage="No items found"
  width={280}  // default
  renderItem={(item, isSelected) => (
    <SelectableListItem
      id={item.id}
      isSelected={isSelected}
      onClick={() => handleSelectItem(item)}
      primaryText={item.code}
      secondaryText={item.name}
      isFavorite={favorites.includes(item.id)}
      onToggleFavorite={(e) => toggleFavorite(item.id, e)}
      statusChip={{ label: item.active ? "Active" : "Inactive", color: item.active ? "success" : "default" }}
    />
  )}
/>
```

### 4. `SelectableListItem`

Individual list item:

```tsx
<SelectableListItem
  id={item.id}
  isSelected={isSelected}
  onClick={() => handleSelectItem(item)}
  primaryText={item.code}
  secondaryText={item.name}
  isFavorite={favorites.includes(item.id)}
  onToggleFavorite={(e) => toggleFavorite(item.id, e)}
  statusChip={{ label: "Active", color: "success" }}
  chips={[{ label: "New", color: "info" }]}  // additional chips
  endAction={<CustomButton />}                 // custom action
/>
```

### 5. `DetailPanelHeader`

Header for detail panel with breadcrumbs:

```tsx
<DetailPanelHeader
  breadcrumbs={[
    { label: "Items", href: "#" },
    { label: selectedItem?.code || "New" },
  ]}
  title={selectedItem ? `${selectedItem.code} - ${selectedItem.name}` : ""}
  titleIcon={<ItemIcon color="primary" />}
  isCreating={isCreating}
  createTitle="New Item"
  noSelectionTitle="Select an Item"
  chips={[{ label: "Active", color: "success" }]}
  isFavorite={selectedItem ? favorites.includes(selectedItem.id) : false}
  onToggleFavorite={selectedItem ? (e) => toggleFavorite(selectedItem.id, e) : undefined}
  actions={<CustomActions />}  // optional
/>
```

### 6. `ActionToolbar`

Toolbar with CRUD actions:

```tsx
<ActionToolbar
  canCreate={true}
  canUpdate={true}
  canDelete={true}
  canDuplicate={true}
  hasSelectedItem={!!selectedItem}
  isCreating={isCreating}
  isEditing={isEditing}
  isSaving={isSaving}
  isFormValid={!!formData.code && !!formData.name}
  onNew={handleNew}
  onDuplicate={handleDuplicate}
  onDelete={handleDelete}
  onSave={handleSave}
  onCancel={() => handleCancel(filteredItems)}
  onEdit={handleStartEdit}
  startActions={<CustomButtons />}  // before default buttons
  endActions={<MoreButtons />}      // after default buttons
/>
```

### 7. `FormSection`

Form section wrapper with grid layout:

```tsx
<FormSection title="Basic Information" columns={2}>
  <TextField label="Code" value={formData.code} ... />
  <TextField label="Name" value={formData.name} ... />
  <TextField label="Description" sx={{ gridColumn: "1 / -1" }} ... />
</FormSection>

<FormSection title="Advanced" columns={3} collapsible defaultCollapsed>
  <TextField ... />
  <TextField ... />
  <TextField ... />
</FormSection>
```

### 8. `EmptyState`

Empty/no-selection state:

```tsx
<EmptyState
  message="Select an item from the list or create a new one"
  icon={<CustomIcon />}  // optional
  action={{              // optional
    label: "Create New",
    onClick: handleNew,
    icon: <AddIcon />,
  }}
/>
```

## Code Comparison

### Before (Manual Implementation)
**BranchesPage.tsx: 627 lines**

```tsx
// 45+ imports
// 200+ lines of state management
// 150+ lines of handlers
// 100+ lines for MasterList component
// 130+ lines for DetailPanel component
// 100+ lines for main return
```

### After (Using Tijaero Components)
**BranchesPage.tsx: 290 lines** (54% reduction!)

```tsx
// 20 imports
// Configuration constants defined once
// State via useMasterDetailState hook
// Simplified handlers
// Clean JSX with reusable components
```

## Migration Guide

To convert an existing page to use Tijaero components:

1. **Import components**:
   ```tsx
   import { MasterDetailLayout, SearchableList, ... } from "@/components/tijaero";
   ```

2. **Replace state with hook**:
   ```tsx
   const { searchQuery, sortField, selectedItem, ... } = useMasterDetailState({...});
   ```

3. **Define configuration**:
   ```tsx
   const SORT_OPTIONS = [{ value: "name", label: "Name" }];
   const INITIAL_FORM_DATA = { name: "", code: "" };
   ```

4. **Replace MasterList with SearchableList**:
   ```tsx
   <SearchableList items={...} renderItem={(item) => <SelectableListItem ... />} />
   ```

5. **Replace DetailPanel header with components**:
   ```tsx
   <DetailPanelHeader ... />
   <ActionToolbar ... />
   ```

6. **Replace form sections**:
   ```tsx
   <FormSection title="..." columns={2}>{fields}</FormSection>
   ```

## Best Practices

1. **Define constants at top of file**: Sort options, initial form data, etc.
2. **Use configuration objects**: Don't hardcode values in JSX
3. **Keep handlers simple**: Let the hook manage state complexity
4. **Consistent naming**: `selectedItem`, `formData`, `isEditing`, `isCreating`
5. **Use TypeScript generics**: `SearchableList<Item>`, `useMasterDetailState<Item, ItemCreate>`

## Adding New Features

To add new reusable features:

1. Create component in appropriate folder
2. Export from folder's `index.ts`
3. Export from main `components/tijaero/index.ts`
4. Add types to `types.ts`
5. Document in this README
