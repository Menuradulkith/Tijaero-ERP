/**
 * TTabFilterBar - Tab-style filter bar for page headers
 *
 * Shows filter field names as a row of clickable tabs. Clicking a tab
 * reveals that field's input directly below the tab row; other tabs stay
 * collapsed. A tab with an active value is shown in bold. Search/Clear
 * buttons sit at the end of the tab row.
 *
 * @example
 * ```tsx
 * <TTabFilterBar
 *   tabs={[
 *     { key: "branch", label: "Branch", hasValue: !!draftBranch, render: () => <TBranchFilter ... /> },
 *     { key: "status", label: "Status", hasValue: !!draftStatus, render: () => <TStatusFilter ... /> },
 *   ]}
 *   onSearch={handleApplyFilters}
 *   onClear={handleClearFilters}
 *   clearDisabled={!hasAnyFilter}
 * />
 * ```
 */

import React from "react";
import { Box, Button } from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";

export interface TTabFilterTab {
  /** Unique key for this tab */
  key: string;
  /** Label shown in the tab row */
  label: string;
  /** Whether this field currently has a value set (shown in bold) */
  hasValue?: boolean;
  /** Renders the field's input, shown below the tab row when active. Call `close()` (e.g. on Enter) to collapse the box, matching the Search button's behavior. */
  render: (helpers: { close: () => void }) => React.ReactNode;
}

export interface TTabFilterBarProps {
  /** Filter tabs */
  tabs: TTabFilterTab[];
  /** Apply filters (Search button) */
  onSearch: () => void;
  /** Reset filters (Clear button) */
  onClear: () => void;
  /** Disable the Clear button */
  clearDisabled?: boolean;
}

export const TTabFilterBar: React.FC<TTabFilterBarProps> = ({
  tabs,
  onSearch,
  onClear,
  clearDisabled = false,
}) => {
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const activeTab = tabs.find((t) => t.key === activeKey);

  const handleSearch = () => {
    setActiveKey(null);
    onSearch();
  };

  const handleClear = () => {
    setActiveKey(null);
    onClear();
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2.5, flexWrap: "wrap" }}>
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          return (
            <Box
              key={tab.key}
              onClick={() => setActiveKey(isActive ? null : tab.key)}
              sx={{
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                userSelect: "none",
                color: isActive ? "primary.main" : "text.primary",
                fontWeight: tab.hasValue ? 700 : 500,
                fontSize: "0.875rem",
                "&:hover": { color: "primary.main" },
              }}
            >
              {tab.label}
              <ArrowDropDownIcon
                fontSize="small"
                sx={{ transform: isActive ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
              />
            </Box>
          );
        })}
        <Button variant="contained" size="small" onClick={handleSearch}>
          Search
        </Button>
        <Button variant="outlined" size="small" onClick={handleClear} disabled={clearDisabled}>
          Clear
        </Button>
      </Box>
      {activeTab && <Box sx={{ width: 260 }}>{activeTab.render({ close: () => setActiveKey(null) })}</Box>}
    </Box>
  );
};

export default TTabFilterBar;
