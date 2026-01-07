# Tijaero ERP Component Library

A comprehensive, reusable UI component library for building consistent enterprise-grade interfaces across the entire ERP application.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Component Categories](#component-categories)
   - [Base Components](#1-base-components-base)
   - [Data Components](#2-data-components-data)
   - [Form Components](#3-form-components-forms-extended)
   - [Feedback Components](#4-feedback-components-feedback-extended)
   - [Navigation Components](#5-navigation-components-navigation)
   - [Layout Components](#6-layout-components-layout)
4. [Master-Detail Components](#7-master-detail-components-legacy)
5. [Best Practices](#best-practices)
6. [Migration Guide](#migration-guide)

---

## Overview

This component library follows the enterprise pattern of creating standardized, reusable components for every UI element to minimize code duplication and ensure consistency. All new components are prefixed with "T" (e.g., `TButton`, `TTextField`) for easy identification.

### Key Benefits

- **Consistency**: Uniform look and feel across all modules
- **Code Reduction**: 50-70% less code compared to manual implementation
- **Maintainability**: Change once, update everywhere
- **Type Safety**: Full TypeScript support with exported types
- **Documentation**: JSDoc comments with usage examples

## Quick Start

Import components from `@/components/tijaero`:

```tsx
import {
  // Base
  TButton, TTextField, TSelect, TStatusChip,
  // Data
  TDataGrid, TStatCard, TTable,
  // Forms
  TFormField, TFormDialog, TLineItemsTable,
  // Feedback
  TConfirmDialog, TLoading, showToast,
  // Navigation
  TTabs, TBreadcrumbs, TSteps,
  // Layout
  TPageHeader, TPageLayout, TSection,
  // Master-Detail
  MasterDetailLayout, useMasterDetailState,
} from "@/components/tijaero";
```

---

## Component Categories

### 1. Base Components (`base/`)

Core UI building blocks that wrap MUI components with ERP-specific defaults.

| Component | Description | Key Features |
|-----------|-------------|--------------|
| `TButton` | Primary button component | Presets (primary, secondary, danger), loading state, icons |
| `TIconButton` | Icon-only button | Tooltip support, color variants |
| `TTextField` | Text input field | Error handling, currency/percent modes, adornments |
| `TSelect` | Dropdown select | Multiple selection, async loading, grouping |
| `TAutocomplete` | Searchable select | Async search, create new, custom rendering |
| `TCheckbox` | Checkbox input | Label position, indeterminate state |
| `TSwitch` | Toggle switch | Label, description, controlled/uncontrolled |
| `TDatePicker` | Date picker | Date/time/range modes, min/max dates |
| `TChip` | Chip/tag display | Delete, click handlers, variants |
| `TStatusChip` | Status indicator | Predefined status maps, custom colors |

#### Example

```tsx
import { TButton, TTextField, TStatusChip } from '@/components/tijaero';

<TButton preset="primary" loading={isSubmitting}>Save</TButton>
<TTextField label="Amount" type="currency" value={amount} />
<TStatusChip status="approved" />
```

### 2. Data Components (`data/`)

Components for displaying and visualizing data.

| Component | Description | Key Features |
|-----------|-------------|--------------|
| `TDataGrid` | Advanced data grid | Sorting, filtering, pagination, selection, export |
| `TTable` | Simple table | Static data display, custom cell rendering |
| `TStatCard` | Statistics card | Value, trend, icon, click action |
| `TInfoCard` | Information card | Icon, description, actions |
| `TDataCard` | Data display card | Key-value pairs, sections |
| `TList` | List display | Icons, actions, selection, virtualization |
| `TCurrency` | Currency formatter | Locale support, color coding |
| `TDate` | Date formatter | Relative time, custom formats |
| `TNumber` | Number formatter | Decimals, units, abbreviations |

#### Example

```tsx
import { TDataGrid, TStatCard, TCurrency } from '@/components/tijaero';

<TStatCard title="Total Revenue" value={125000} trend={12.5} format="currency" />

<TDataGrid
  rows={orders}
  columns={[
    { field: 'orderNumber', headerName: 'Order #', width: 120 },
    { field: 'total', headerName: 'Total',
      renderCell: (params) => <TCurrency value={params.value} /> },
  ]}
/>
```

### 3. Form Components (`forms-extended/`)

Form building with react-hook-form integration.

| Component | Description | Key Features |
|-----------|-------------|--------------|
| `TFormField` | Form field wrapper | Controller integration, error display |
| `TFormSection` | Collapsible form section | Grouping, validation indicators |
| `TFormDialog` | Modal form dialog | Create/edit modes, validation, loading |
| `TFormActions` | Form action buttons | Submit, cancel, reset, custom actions |
| `TLineItemsTable` | Editable line items | Add/remove rows, calculations |
| `TFilterBar` | Search and filters | Configurable filters, presets, clear |
| `useFormState` | Form state hook | Dirty tracking, validation |

#### Example

```tsx
import { TFormDialog, TFormField, TFormSection } from '@/components/tijaero';
import { useForm } from 'react-hook-form';

const form = useForm<OrderFormData>();

<TFormDialog open={open} title="Create Order" form={form} onSubmit={handleSubmit}>
  <TFormSection title="Customer Information">
    <TFormField name="customer" control={form.control} label="Customer" type="autocomplete" required />
  </TFormSection>
</TFormDialog>
```

### 4. Feedback Components (`feedback-extended/`)

User feedback and notification components.

| Component | Description | Key Features |
|-----------|-------------|--------------|
| `TAlert` | Alert messages | Severity levels, actions, dismissible |
| `TLoading` | Loading indicators | Spinner, overlay, inline modes |
| `TLoadingSkeleton` | Content skeletons | Card, list, table, form variants |
| `TConfirmDialog` | Confirmation dialogs | Danger mode, custom buttons |
| `TEmptyState` | Empty state display | Icon, message, action button |
| `showToast` | Toast notifications | Success, error, warning, info |

#### Example

```tsx
import { TConfirmDialog, useTConfirmDialog, showSuccessToast } from '@/components/tijaero';

const { dialogProps, confirm } = useTConfirmDialog();

const handleDelete = async () => {
  const confirmed = await confirm({ title: 'Delete?', danger: true });
  if (confirmed) {
    await deleteItem(id);
    showSuccessToast('Deleted successfully');
  }
};

<TConfirmDialog {...dialogProps} />
```

### 5. Navigation Components (`navigation/`)

Navigation and routing components.

| Component | Description | Key Features |
|-----------|-------------|--------------|
| `TTabs` | Tab navigation | Badges, icons, vertical mode |
| `TTabPanel` | Tab content panel | Lazy loading, keep mounted |
| `TBreadcrumbs` | Breadcrumb navigation | Icons, links, home button |
| `TContextMenu` | Right-click menu | Nested items, icons, dividers |
| `TDropdownMenu` | Dropdown button menu | Icons, disabled items, dividers |
| `TSteps` | Wizard/stepper | Linear/non-linear, optional steps |

#### Example

```tsx
import { TTabs, TBreadcrumbs } from '@/components/tijaero';

<TBreadcrumbs items={[{ label: 'Orders', href: '/orders' }, { label: 'PO-2024-001' }]} />

<TTabs
  tabs={[
    { label: 'Details', icon: <InfoIcon /> },
    { label: 'Line Items', badge: 5 },
  ]}
  value={activeTab}
  onChange={setActiveTab}
/>
```

### 6. Layout Components (`layout/`)

Page and content layout components.

| Component | Description | Key Features |
|-----------|-------------|--------------|
| `TPageHeader` | Page header | Title, breadcrumbs, actions, back button |
| `TPageLayout` | Page wrapper | Max width, padding, sidebar |
| `TCardLayout` | Card grid layout | Responsive columns, spacing |
| `TGridLayout` | CSS Grid layout | Column spans, named areas |
| `TSidebar` | Side navigation | Collapsible, nested items, badges |
| `TSplitPane` | Resizable split view | Drag to resize, collapse |
| `TSection` | Content section | Title, collapsible, actions |

#### Example

```tsx
import { TPageLayout, TPageHeader, TSection, TCardLayout, TStatCard } from '@/components/tijaero';

<TPageLayout>
  <TPageHeader
    title="Purchase Orders"
    actions={<TButton preset="primary">New Order</TButton>}
  />
  
  <TCardLayout columns={4} spacing={2}>
    <TStatCard title="Total" value={156} />
    <TStatCard title="Pending" value={23} />
  </TCardLayout>
  
  <TSection title="Recent Orders" collapsible>
    <TDataGrid rows={orders} columns={columns} />
  </TSection>
</TPageLayout>
```

---

## 7. Master-Detail Components (Legacy)

This document describes the reusable Tijaero-style component library for building consistent master-detail pages throughout the ERP system.

### Master-Detail Overview

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
