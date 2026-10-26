/**
 * SalesStockDashboard - Comprehensive Sales Stock Management
 *
 * OPTIMIZED: Uses aggregated reference data endpoint to reduce API calls
 * BEFORE: 6 separate API calls (branches, brands, categories, locations, products, salesStock)
 * AFTER: 2 API calls (reference-data, salesStock)
 */

import { usePermission } from "@/auth/permissions";
import { TChip, TDataGrid, TDataGridColumn, TStatusChip, fmtLKR } from "@/components/tijaero";
import { useCurrencyStore } from "@/state/currencyStore";
import { KpiSparkCard } from "@/components/dashboard";
import { LocationRef, REFERENCE_DATA_PRESETS, useReferenceData } from "@/hooks";
import { productImageUrl, reclassifyApi, salesStockApi } from "@/modules/inventory/api";
import ReclassifyDialog from "@/modules/inventory/components/ReclassifyDialog";
import { handleApiError, showSuccessToast } from "@/components/tijaero";
import {
    Brand,
    Category,
    Product,
    SalesStock,
    StockSummaryRow,
    StockTrackingEvent,
} from "@/modules/inventory/types";
import {
    Warning as AlertIcon,
    Close as CloseIcon,
    Inventory as PackageIcon,
    AssignmentReturn as ReturnIcon,
    Search as SearchIcon,
    Business as AssetIcon,
    FilterList as FilterIcon,
    FilterListOff as FilterOffIcon,
} from "@mui/icons-material";
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Drawer,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useEffect, useMemo, useState } from "react";

// Selectable status filter options (mirrors backend StockStatus); rendered
// via TStatusChip's "salesStockStatus" map for the label/color everywhere else.
const SALES_STOCK_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "reserved", label: "Reserved" },
  { value: "sold", label: "Sold" },
  { value: "returned", label: "Returned" },
  { value: "returned_to_supplier", label: "Returned to Supplier" },
  { value: "returned_non_restockable", label: "Returned (Non-restockable)" },
  { value: "return_pending", label: "Return Pending" },
  { value: "transferred", label: "Transferred" },
  { value: "transfer_pending", label: "Transfer Pending" },
  { value: "in_transit", label: "In Transit" },
  { value: "damaged", label: "Damaged" },
  { value: "frozen", label: "Frozen (Hold)" },
  { value: "cancelled", label: "Cancelled (GRN)" },
];

// Ageing buckets for the Stock Summary view — standard ERP stock-position
// reports group age by bucket rather than a raw day count, so it scans at a
// glance; the exact day count still shows alongside the bucket label.
const ageingBucket = (
  days: number | null | undefined,
): { label: string; color: "success" | "info" | "warning" | "error" } | null => {
  if (days == null) return null;
  if (days <= 30) return { label: "0-30 days", color: "success" };
  if (days <= 60) return { label: "31-60 days", color: "info" };
  if (days <= 90) return { label: "61-90 days", color: "warning" };
  return { label: "90+ days", color: "error" };
};

// Stock Details Panel Component
interface StockDetailsPanelProps {
  stock: SalesStock | null;
  product: Product | null;
  brandName: string;
  categoryName: string;
  isOpen: boolean;
  onClose: () => void;
}

const StockDetailsPanel = ({
  stock,
  product,
  brandName,
  categoryName,
  isOpen,
  onClose,
}: StockDetailsPanelProps) => {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const canMoveToAsset =
    usePermission("sales_stock", "update") && usePermission("company_assets", "create");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const handleMoveToAsset = async (reason: string) => {
    if (!stock) return;
    setMoveBusy(true);
    setMoveError(null);
    try {
      await reclassifyApi.moveStockToAsset(stock.id, reason);
      showSuccessToast("Moved to company assets");
      setMoveOpen(false);
      queryClient.invalidateQueries({ queryKey: ["salesStock"] });
      queryClient.invalidateQueries({ queryKey: ["companyAssets"] });
      queryClient.invalidateQueries({ queryKey: ["stock-tracking", stock.id] });
      onClose();
    } catch (error) {
      setMoveError(handleApiError(error, "Could not move this unit to company assets"));
    } finally {
      setMoveBusy(false);
    }
  };

  // Fetch real tracking data from API when panel is open
  const { data: trackingEvents, isLoading: trackingLoading } = useQuery<
    StockTrackingEvent[]
  >({
    queryKey: ["stock-tracking", stock?.id],
    queryFn: () => salesStockApi.getTracking(stock!.id),
    enabled: isOpen && !!stock,
    staleTime: 30_000, // 30s — refetch if panel reopened after a while
  });

  return (
    <Drawer
      anchor="right"
      open={isOpen}
      onClose={onClose}
      PaperProps={{
        sx: { width: { xs: "100%", sm: 450 }, p: 3 },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 3,
        }}
      >
        <Typography variant="h6">Stock Details</Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </Box>

      {stock && product && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {/* Standard ERP practice: goods are received into stock, then capitalised as an asset in an audited step */}
          {canMoveToAsset && stock.status === "available" && !!stock.barcode && (
            <Box>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AssetIcon />}
                onClick={() => {
                  setMoveError(null);
                  setMoveOpen(true);
                }}
              >
                Move to Company Assets
              </Button>
              <ReclassifyDialog
                open={moveOpen}
                title="Move to Company Assets"
                description="This unit leaves sales stock and becomes a company asset (e.g. a laptop kept for office use)."
                confirmLabel="Move to assets"
                isSubmitting={moveBusy}
                error={moveError}
                onClose={() => setMoveOpen(false)}
                onSubmit={(reason) => handleMoveToAsset(reason)}
              />
            </Box>
          )}

          {/* Product Info */}
          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Product Information
            </Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Grid container spacing={2}>
                {/* Product image — full width at top */}
                <Grid item xs={12}>
                  <Box
                    sx={{
                      width: "100%",
                      height: 180,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: "action.hover",
                    }}
                  >
                    {productImageUrl(product.image_url) ? (
                      <Box
                        component="img"
                        src={productImageUrl(product.image_url)!}
                        alt={product.name}
                        onError={(
                          e: React.SyntheticEvent<HTMLImageElement>,
                        ) => {
                          e.currentTarget.style.display = "none";
                          const fallback = document.getElementById(
                            `img-fallback-${stock.id}`,
                          );
                          if (fallback) fallback.style.display = "flex";
                        }}
                        sx={{
                          maxWidth: "100%",
                          maxHeight: "100%",
                          objectFit: "contain",
                        }}
                      />
                    ) : null}
                    <Box
                      id={`img-fallback-${stock.id}`}
                      sx={{
                        display: productImageUrl(product.image_url) ? "none" : "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 0.5,
                        color: "text.disabled",
                      }}
                    >
                      <Typography variant="caption">No image</Typography>
                    </Box>
                  </Box>
                </Grid>

                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Product Name
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {product.name}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Item Code
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {product.item_code || "N/A"}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Brand
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {brandName || "N/A"}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Category
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {categoryName || "N/A"}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Box>

          {/* Stock Info */}
          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Stock Information
            </Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Barcode
                  </Typography>
                  <Typography
                    variant="body2"
                    fontWeight={500}
                    fontFamily="monospace"
                  >
                    {stock.barcode || "—"}
                  </Typography>
                </Grid>
                {!stock.barcode && (
                  <>
                    <Grid item xs={6}>
                      <Typography variant="caption" color="text.secondary">
                        Quantity
                      </Typography>
                      <Typography variant="body2" fontWeight={500}>
                        {stock.quantity}
                      </Typography>
                    </Grid>
                    {stock.batch_no && (
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">
                          Batch No
                        </Typography>
                        <Typography variant="body2" fontWeight={500}>
                          {stock.batch_no}
                        </Typography>
                      </Grid>
                    )}
                    {stock.expiry_date && (
                      <Grid item xs={6}>
                        <Typography variant="caption" color="text.secondary">
                          Expiry
                        </Typography>
                        <Typography variant="body2" fontWeight={500}>
                          {stock.expiry_date}
                        </Typography>
                      </Grid>
                    )}
                  </>
                )}
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Status
                  </Typography>
                  <Box sx={{ mt: 0.5 }}>
                    <TStatusChip status={stock.status} statusMap="salesStockStatus" />
                  </Box>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Branch
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {stock.branch_code}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    GRN No
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {stock.grn_no || stock.good_received_note_id || "N/A"}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Warranty
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {stock.warranty_month
                      ? `${stock.warranty_month} months`
                      : "N/A"}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Received Date
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {format(parseISO(stock.added_date), "dd MMM yyyy")}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Box>

          {/* Tracking Timeline */}
          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Tracking Timeline
            </Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              {trackingLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : !trackingEvents || trackingEvents.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center", py: 1 }}
                >
                  No tracking events found
                </Typography>
              ) : (
                trackingEvents.map((evt, index) => (
                  <Box
                    key={index}
                    sx={{
                      display: "flex",
                      gap: 2,
                      mb: index < trackingEvents.length - 1 ? 2 : 0,
                    }}
                  >
                    {/* Timeline connector */}
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        pt: 0.5,
                      }}
                    >
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          bgcolor: evt.color,
                          flexShrink: 0,
                        }}
                      />
                      {index < trackingEvents.length - 1 && (
                        <Box
                          sx={{
                            width: 2,
                            flex: 1,
                            bgcolor: "divider",
                            mt: 0.5,
                          }}
                        />
                      )}
                    </Box>
                    {/* Event content */}
                    <Box
                      sx={{
                        flex: 1,
                        pb: index < trackingEvents.length - 1 ? 1 : 0,
                      }}
                    >
                      <Typography variant="body2" fontWeight={600}>
                        {evt.action}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {evt.details}
                      </Typography>
                      {evt.date && (
                        <Typography
                          variant="caption"
                          display="block"
                          color="text.secondary"
                        >
                          {format(parseISO(evt.date), "dd MMM yyyy HH:mm")}
                        </Typography>
                      )}
                      {/* Extra details */}
                      {evt.extra && Object.keys(evt.extra).length > 0 && (
                        <Box
                          sx={{
                            mt: 0.5,
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 0.5,
                          }}
                        >
                          {evt.extra.po_no && (
                            <TChip
                              label={`PO: ${evt.extra.po_no}`}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.location && (
                            <TChip
                              label={`Location: ${evt.extra.location}`}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.branch && (
                            <TChip
                              label={`Branch: ${evt.extra.branch}`}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.selling_price != null && (
                            <TChip
                              label={`${currencySymbol} ${Number(evt.extra.selling_price).toFixed(2)}`}
                              size="small"
                              color="success"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.return_price != null && (
                            <TChip
                              label={`Return: ${currencySymbol} ${Number(evt.extra.return_price).toFixed(2)}`}
                              size="small"
                              color="warning"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.condition && (
                            <TChip
                              label={`Condition: ${evt.extra.condition}`}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.from_location && evt.extra.to_location && (
                            <TChip
                              label={`${evt.extra.from_location} → ${evt.extra.to_location}`}
                              size="small"
                              color="secondary"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                          {evt.extra.status && (
                            <TChip
                              label={String(evt.extra.status)}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.65rem" }}
                            />
                          )}
                        </Box>
                      )}
                    </Box>
                  </Box>
                ))
              )}
            </Paper>
          </Box>
        </Box>
      )}
    </Drawer>
  );
};

// Main Component
export default function SalesStockDashboard() {
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  // Whether the current user may see cost/buying price
  const canViewCost = usePermission("cost_price", "view");

  // Filter States
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Debounced copy of searchQuery — used for the server request so we don't
  // fire a query on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedBrand, setSelectedBrand] = useState<string>("all");
  const [selectedProduct, setSelectedProduct] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Unit list vs. per-product aggregated summary
  const [viewMode, setViewMode] = useState<"units" | "summary">("units");

  // Show / hide the filter panel (hiding keeps the chosen filters applied); remembered per browser.
  const [showFilters, setShowFilters] = useState<boolean>(() => {
    try {
      return localStorage.getItem("warehouseDashboardShowFilters") !== "0";
    } catch {
      return true;
    }
  });
  const toggleFilters = () => {
    setShowFilters((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("warehouseDashboardShowFilters", next ? "1" : "0");
      } catch {
        /* storage unavailable: the toggle still works for this visit */
      }
      return next;
    });
  };

  // Pagination
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  // Stock Summary pagination (independent of the unit list's)
  const [summaryPage, setSummaryPage] = useState(0);
  const [summaryRowsPerPage, setSummaryRowsPerPage] = useState(20);

  // Details Panel
  const [selectedStock, setSelectedStock] = useState<SalesStock | null>(null);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);

  // OPTIMIZED: Fetch all reference data in a single API call
  const {
    data: refData,
    isLoading: isLoadingRefData,
    filteredBranches,
    defaultBranchCode,
  } = useReferenceData(REFERENCE_DATA_PRESETS.DASHBOARD, {
    productsLimit: 1000,
  });

  // Set default branch filter from user's assigned branch
  useEffect(() => {
    if (defaultBranchCode && !selectedBranch) {
      setSelectedBranch(defaultBranchCode);
    }
  }, [defaultBranchCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wait until branch default is resolved before firing the query
  const branchResolved =
    defaultBranchCode === undefined || selectedBranch !== "";

  // Shared filter params for the Unit List query and its "export all" fetch.
  const buildUnitStockParams = (skip: number, limit: number) => {
    const params: Record<string, string | number> = { skip, limit };
    if (selectedBranch) params.branch_code = selectedBranch;
    if (selectedProduct !== "all") params.product_id = Number(selectedProduct);
    if (selectedStatus !== "all") params.status = selectedStatus;
    if (selectedBrand !== "all") params.brand_id = Number(selectedBrand);
    if (selectedLocation !== "all") params.location_id = Number(selectedLocation);
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  };

  // Shared filter params for the Stock Summary query and its "export all" fetch.
  const buildStockSummaryParams = (skip: number, limit: number) => {
    const params: Record<string, string | number> = { skip, limit };
    if (selectedBranch) params.branch_code = selectedBranch;
    if (selectedBrand !== "all") params.brand_id = Number(selectedBrand);
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
    return params;
  };

  // Server-side paginated + filtered sales stock (branch-scoped KPI summary
  // travels with the response so the cards reflect true branch totals).
  const {
    data: salesStockResp,
    isLoading: isLoadingStock,
  } = useQuery({
    queryKey: [
      "salesStock",
      selectedBranch,
      selectedProduct,
      selectedStatus,
      selectedBrand,
      selectedLocation,
      debouncedSearch,
      dateFrom,
      dateTo,
      page,
      rowsPerPage,
    ],
    queryFn: () => salesStockApi.getPaginated(buildUnitStockParams(page * rowsPerPage, rowsPerPage)),
    enabled: branchResolved && viewMode === "units",
    placeholderData: (prev) => prev,
  });

  // Per-product aggregated on-hand position (Stock Summary tab)
  const {
    data: stockSummaryResp,
    isLoading: isLoadingSummary,
  } = useQuery({
    queryKey: [
      "salesStockSummary",
      selectedBranch,
      selectedBrand,
      debouncedSearch,
      summaryPage,
      summaryRowsPerPage,
    ],
    queryFn: () =>
      salesStockApi.getStockSummary(buildStockSummaryParams(summaryPage * summaryRowsPerPage, summaryRowsPerPage)),
    enabled: branchResolved && viewMode === "summary",
    placeholderData: (prev) => prev,
  });

  // Fetch every row matching the current filters (for the grid's own Export,
  // which must cover the whole filtered set, not just the page on screen).
  const EXPORT_PAGE_SIZE = 200;
  const exportAllUnitRows = async (): Promise<SalesStock[]> => {
    const out: SalesStock[] = [];
    let skip = 0;
    for (;;) {
      const resp = await salesStockApi.getPaginated(buildUnitStockParams(skip, EXPORT_PAGE_SIZE));
      out.push(...resp.items);
      skip += EXPORT_PAGE_SIZE;
      if (out.length >= resp.total || resp.items.length === 0) break;
    }
    return out;
  };
  const exportAllSummaryRows = async (): Promise<StockSummaryRow[]> => {
    const out: StockSummaryRow[] = [];
    let skip = 0;
    for (;;) {
      const resp = await salesStockApi.getStockSummary(buildStockSummaryParams(skip, EXPORT_PAGE_SIZE));
      out.push(...resp.items);
      skip += EXPORT_PAGE_SIZE;
      if (out.length >= resp.total || resp.items.length === 0) break;
    }
    return out;
  };

  // Extract data from aggregated reference data response
  const branches = filteredBranches || [];
  const brands = (refData?.brands || []) as Brand[];
  const categories = (refData?.categories || []) as Category[];
  const locations = refData?.locations || [];
  const products = (refData?.products || []) as Product[];
  const salesStock = salesStockResp?.items || [];
  const totalStock = salesStockResp?.total || 0;
  const summary = salesStockResp?.summary;
  const stockSummaryRows = stockSummaryResp?.items || [];
  const totalStockSummaryRows = stockSummaryResp?.total || 0;

  // Loading state combines reference data and stock loading
  const isLoadingBranches = isLoadingRefData;
  const isLoadingLocations = isLoadingRefData;

  // Product lookup helper
  const getProduct = (productId: number): Product | undefined => {
    return products.find((p: Product) => p.id === productId);
  };

  // Brand lookup helper
  const getBrand = (brandId: number): Brand | undefined => {
    return brands.find((b: Brand) => b.id === brandId);
  };

  // Category lookup helper
  const getCategory = (categoryId: number): Category | undefined => {
    return categories.find((c: Category) => c.id === categoryId);
  };

  // Get brand name for a product
  const getProductBrandName = (product: Product | undefined): string => {
    if (!product) return "-";
    const brandId = product.items_brand_id;
    if (!brandId) return "-";
    const brand = getBrand(brandId);
    return brand?.brand_name || "-";
  };

  // Get category name for a product
  const getProductCategoryName = (product: Product | undefined): string => {
    if (!product) return "-";
    const category = getCategory(product.category_id);
    return category?.name || "-";
  };

  // Unit List grid columns
  const unitColumns: TDataGridColumn<SalesStock>[] = useMemo(() => {
    const cols: TDataGridColumn<SalesStock>[] = [
      {
        field: "barcode",
        header: "Barcode / Lot",
        width: 170,
        renderCell: (params: GridRenderCellParams<SalesStock>) => (
          <span style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
            {params.row.barcode ||
              `${params.row.batch_no ? `Batch ${params.row.batch_no}` : "Lot"} × ${params.row.quantity}`}
          </span>
        ),
      },
      {
        field: "expiry_date",
        header: "Expiry",
        width: 130,
        renderCell: (params: GridRenderCellParams<SalesStock>) => {
          const d = params.row.expiry_date;
          if (!d) return <span>-</span>;
          const expired = d < new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
          return <span style={{ color: expired ? "#d32f2f" : undefined, fontWeight: expired ? 600 : 400 }}>{d}{expired ? " (expired)" : ""}</span>;
        },
      },
      {
        field: "product_name",
        header: "Product",
        flex: 1,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<SalesStock>) => {
          const product = getProduct(params.row.product_id);
          return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {product && productImageUrl(product.image_url) && (
                <Box
                  component="img"
                  src={productImageUrl(product.image_url)!}
                  alt={product.name}
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                    e.currentTarget.style.display = "none";
                  }}
                  sx={{
                    width: 28,
                    height: 28,
                    objectFit: "contain",
                    borderRadius: 0.5,
                    border: "1px solid",
                    borderColor: "divider",
                    flexShrink: 0,
                  }}
                />
              )}
              <span style={{ fontWeight: 500 }}>
                {params.row.product_name || product?.name || "Unknown"}
              </span>
            </Box>
          );
        },
      },
      {
        field: "item_code",
        header: "Item Code",
        width: 130,
        renderCell: (params: GridRenderCellParams<SalesStock>) =>
          params.row.item_code || getProduct(params.row.product_id)?.item_code || "-",
      },
      {
        field: "brand_id",
        header: "Brand",
        width: 120,
        renderCell: (params: GridRenderCellParams<SalesStock>) => {
          const product = getProduct(params.row.product_id);
          const brandName = params.row.brand_id ? getBrand(params.row.brand_id)?.brand_name : null;
          return brandName || getProductBrandName(product) || "-";
        },
      },
      { field: "branch_code", header: "Branch", width: 110 },
      {
        field: "location_name",
        header: "Location",
        width: 130,
        renderCell: (params: GridRenderCellParams<SalesStock>) => params.row.location_name || "-",
      },
      {
        field: "status",
        header: "Status",
        width: 160,
        sortable: false,
        renderCell: (params: GridRenderCellParams<SalesStock>) => (
          <TStatusChip status={params.row.status} statusMap="salesStockStatus" />
        ),
      },
      {
        field: "grn_no",
        header: "GRN No",
        width: 150,
        renderCell: (params: GridRenderCellParams<SalesStock>) => params.row.grn_no || "-",
      },
      { field: "added_date", header: "Received Date", width: 130, type: "date" },
    ];
    if (canViewCost) {
      cols.push({
        field: "cost_price",
        header: `Cost Price (${currencySymbol})`,
        width: 130,
        type: "currency",
      });
    }
    cols.push({
      field: "selling_price",
      header: `Selling Price (${currencySymbol})`,
      width: 140,
      type: "currency",
    });
    return cols;
    // products/brands drive getProduct/getBrand's closures above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewCost, currencySymbol, products, brands]);

  // Stock Summary grid columns
  const summaryColumns: TDataGridColumn<StockSummaryRow>[] = useMemo(() => {
    const cols: TDataGridColumn<StockSummaryRow>[] = [
      { field: "item_code", header: "Item Code", width: 130 },
      { field: "product_name", header: "Product", flex: 1, minWidth: 200 },
      {
        field: "brand_name",
        header: "Brand",
        width: 120,
        renderCell: (params: GridRenderCellParams<StockSummaryRow>) => params.row.brand_name || "-",
      },
      { field: "unit_of_measure", header: "UOM", width: 80 },
      { field: "total_quantity", header: "Total Qty", width: 110, type: "number" },
      { field: "allocated_quantity", header: "Allocated", width: 110, type: "number" },
      {
        field: "available_quantity",
        header: "Available",
        width: 140,
        align: "right",
        headerAlign: "right",
        renderCell: (params: GridRenderCellParams<StockSummaryRow>) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 0.5, width: "100%" }}>
            {params.row.low_stock && (
              <Tooltip title="Low stock — at or below the reorder threshold">
                <AlertIcon fontSize="small" color="warning" />
              </Tooltip>
            )}
            <span style={{ fontWeight: params.row.low_stock ? 700 : 400 }}>
              {params.row.available_quantity.toLocaleString()}
            </span>
          </Box>
        ),
      },
      { field: "issued_quantity", header: "Issued", width: 100, type: "number" },
      { field: "freezed_quantity", header: "Freezed", width: 100, type: "number" },
      { field: "in_transit_quantity", header: "In Transit", width: 110, type: "number" },
      { field: "damaged_quantity", header: "Damaged", width: 100, type: "number" },
    ];
    if (canViewCost) {
      cols.push(
        { field: "unit_cost", header: `Unit Cost (${currencySymbol})`, width: 130, type: "currency" },
        { field: "total_value", header: `Total Value (${currencySymbol})`, width: 140, type: "currency" },
      );
    }
    cols.push(
      { field: "in_house_date", header: "In House Date", width: 130, type: "date" },
      {
        field: "ageing_days",
        header: "Ageing",
        width: 150,
        renderCell: (params: GridRenderCellParams<StockSummaryRow>) => {
          const bucket = ageingBucket(params.row.ageing_days);
          if (!bucket) return "-";
          return (
            <TChip
              label={`${bucket.label} (${params.row.ageing_days})`}
              size="small"
              color={bucket.color}
              sx={{ fontWeight: 500 }}
            />
          );
        },
      },
      {
        field: "supplier_name",
        header: "Supplier Name",
        width: 160,
        renderCell: (params: GridRenderCellParams<StockSummaryRow>) => params.row.supplier_name || "-",
      },
      {
        field: "supplier_code",
        header: "Supplier Code",
        width: 120,
        renderCell: (params: GridRenderCellParams<StockSummaryRow>) => params.row.supplier_code || "-",
      },
      {
        field: "invoice_no",
        header: "Invoice No",
        width: 140,
        renderCell: (params: GridRenderCellParams<StockSummaryRow>) => params.row.invoice_no || "-",
      },
    );
    return cols;
  }, [canViewCost, currencySymbol]);

  // KPI summary is computed server-side and scoped to the selected branch, so
  // the cards reflect true branch totals rather than the current table page.
  const summaryStats = {
    inStock: summary?.in_stock ?? 0,
    reserved: summary?.reserved ?? 0,
    soldToday: summary?.sold_today ?? 0,
    returnedItems: summary?.returned ?? 0,
    inTransit: summary?.in_transit ?? 0,
    damaged: summary?.damaged ?? 0,
  };

  // Whether any list filter is narrowing the result set (drives the
  // "try adjusting your filters" empty-state hint).
  const hasActiveFilters =
    !!debouncedSearch ||
    selectedBrand !== "all" ||
    selectedProduct !== "all" ||
    selectedStatus !== "all" ||
    selectedLocation !== "all" ||
    !!dateFrom ||
    !!dateTo;

  // Debounce the free-text search before it drives the server query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Reset to the first page whenever a filter changes
  useEffect(() => {
    setPage(0);
  }, [
    debouncedSearch,
    selectedBrand,
    selectedProduct,
    selectedStatus,
    dateFrom,
    dateTo,
    selectedLocation,
    selectedBranch,
  ]);

  useEffect(() => {
    setSummaryPage(0);
  }, [debouncedSearch, selectedBrand, selectedBranch]);

  // Clear all filters
  const clearFilters = () => {
    setSearchQuery("");
    setSelectedBrand("all");
    setSelectedProduct("all");
    setSelectedStatus("all");
    setDateFrom("");
    setDateTo("");
    setSelectedLocation("all");
  };

  return (
    <Box
      sx={(theme) => ({
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 2,
        p: { xs: 1.5, md: 2 },
        overflow: "auto",
        background: theme.palette.mode === "dark"
          ? `linear-gradient(180deg, ${theme.palette.background.default} 0%, ${theme.palette.background.paper} 280px)`
          : "linear-gradient(180deg, #f6f8fc 0%, #ffffff 280px)",
      })}
    >
      {/* View Mode */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Tabs
          value={viewMode}
          onChange={(_, value) => setViewMode(value)}
          sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5 } }}
        >
          <Tab value="units" label="Unit List" />
          <Tab value="summary" label="Stock Summary" />
        </Tabs>
        <Button
          size="small"
          variant="outlined"
          onClick={toggleFilters}
          startIcon={showFilters ? <FilterOffIcon /> : <FilterIcon />}
          aria-expanded={showFilters}
        >
          {showFilters ? "Hide Filters" : "Show Filters"}
        </Button>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={2.25}>
        <Grid item xs={12} sm={6} md="auto" sx={{ width: { md: 183 } }}>
          <KpiSparkCard
            compact
            title="In Stock"
            value={summaryStats.inStock.toLocaleString()}
            icon={<PackageIcon />}
            color="success"
          />
        </Grid>
        <Grid item xs={12} sm={6} md="auto" sx={{ width: { md: 183 } }}>
          <KpiSparkCard
            compact
            title="Reserved"
            value={summaryStats.reserved.toLocaleString()}
            icon={<AlertIcon />}
            color="warning"
          />
        </Grid>
        <Grid item xs={12} sm={6} md="auto" sx={{ width: { md: 183 } }}>
          <KpiSparkCard
            compact
            title="Sold Today"
            value={summaryStats.soldToday.toLocaleString()}
            icon={<PackageIcon />}
            color="primary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md="auto" sx={{ width: { md: 183 } }}>
          <KpiSparkCard
            compact
            title="Sent Back"
            value={summaryStats.returnedItems.toLocaleString()}
            icon={<ReturnIcon />}
            color="secondary"
          />
        </Grid>
        <Grid item xs={12} sm={6} md="auto" sx={{ width: { md: 183 } }}>
          <KpiSparkCard
            compact
            title="In Transit"
            value={summaryStats.inTransit.toLocaleString()}
            icon={<PackageIcon />}
            color="info"
          />
        </Grid>
        <Grid item xs={12} sm={6} md="auto" sx={{ width: { md: 183 } }}>
          <KpiSparkCard
            compact
            title="Damaged"
            value={summaryStats.damaged.toLocaleString()}
            icon={<AlertIcon />}
            color="error"
          />
        </Grid>
      </Grid>

      {/* Filters */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, display: showFilters ? undefined : "none" }}>
          <Grid container spacing={2}>
            {/* Branch */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <Autocomplete
                size="small"
                options={branches}
                getOptionLabel={(option: any) => option.branch_name || ""}
                value={
                  branches.find(
                    (branch: any) => branch.branch_code === selectedBranch,
                  ) || null
                }
                onChange={(_, value: any) =>
                  setSelectedBranch(value?.branch_code || "")
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Branch"
                    placeholder="Search branches..."
                  />
                )}
                noOptionsText={
                  isLoadingBranches ? "Loading..." : "No branches found"
                }
              />
            </Grid>

            {/* Location */}
            {viewMode === "units" && (
              <Grid item xs={12} sm={6} md={4} lg={2}>
                <Autocomplete
                  size="small"
                  options={locations}
                  getOptionLabel={(option: LocationRef) => option.name || ""}
                  value={
                    locations.find(
                      (location: LocationRef) =>
                        location.id.toString() === selectedLocation,
                    ) || null
                  }
                  onChange={(_, value: LocationRef | null) =>
                    setSelectedLocation(value?.id.toString() || "all")
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Location"
                      placeholder="Search locations..."
                    />
                  )}
                  noOptionsText={
                    isLoadingLocations ? "Loading..." : "No locations found"
                  }
                />
              </Grid>
            )}

            {/* Search */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <TextField
                fullWidth
                size="small"
                label="Search"
                placeholder="Barcode, Serial, Item Code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: "24px" } }}
              />
            </Grid>

            {/* Brand */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <Autocomplete
                size="small"
                options={brands}
                getOptionLabel={(option: Brand) => option.brand_name || ""}
                value={
                  brands.find(
                    (brand: Brand) => brand.id.toString() === selectedBrand,
                  ) || null
                }
                onChange={(_, value: Brand | null) =>
                  setSelectedBrand(value?.id.toString() || "all")
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Brand"
                    placeholder="Search brands..."
                  />
                )}
                noOptionsText="No brands found"
              />
            </Grid>

            {/* Product */}
            {viewMode === "units" && (
              <Grid item xs={12} sm={6} md={4} lg={2}>
                <Autocomplete
                  size="small"
                  options={products}
                  getOptionLabel={(option: Product) => option.name || ""}
                  value={
                    products.find(
                      (product: Product) =>
                        product.id.toString() === selectedProduct,
                    ) || null
                  }
                  onChange={(_, value: Product | null) =>
                    setSelectedProduct(value?.id.toString() || "all")
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Product"
                      placeholder="Search products..."
                    />
                  )}
                  noOptionsText="No products found"
                />
              </Grid>
            )}

            {/* Status */}
            {viewMode === "units" && (
              <Grid item xs={12} sm={6} md={4} lg={2}>
                <Autocomplete
                  size="small"
                  options={SALES_STOCK_STATUS_OPTIONS}
                  getOptionLabel={(option) => option.label}
                  value={
                    SALES_STOCK_STATUS_OPTIONS.find(
                      (s) => s.value === selectedStatus,
                    ) || null
                  }
                  onChange={(_, value) =>
                    setSelectedStatus(value?.value || "all")
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Status"
                      placeholder="Search status..."
                    />
                  )}
                  renderOption={(props, option) => (
                    <Box component="li" {...props}>
                      <TStatusChip status={option.value} statusMap="salesStockStatus" />
                    </Box>
                  )}
                />
              </Grid>
            )}

            {/* Date From */}
            {viewMode === "units" && (
              <Grid item xs={12} sm={6} md={4} lg={2}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="Date From"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            )}

            {/* Date To */}
            {viewMode === "units" && (
              <Grid item xs={12} sm={6} md={4} lg={2}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="Date To"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            )}

            {/* Clear Filters */}
            <Grid item xs={12} sm={6} md={4} lg={2}>
              <Button
                variant="outlined"
                size="small"
                fullWidth
                onClick={clearFilters}
                sx={{ height: 31.125 }}
              >
                Clear Filters
              </Button>
            </Grid>
          </Grid>
      </Paper>

      {/* Data Table */}
      {viewMode === "units" && (
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <TDataGrid<SalesStock>
            rows={salesStock}
            columns={unitColumns}
            loading={isLoadingStock}
            getRowId={(row) => row.id}
            onRowClick={(row) => {
              setSelectedStock(row);
              setIsDetailsPanelOpen(true);
            }}
            emptyMessage={
              hasActiveFilters ? "No stock items match your filters" : "No stock items found"
            }
            autoHeight={false}
            height="100%"
            exportFileName={`sales_stock_${selectedBranch || "all"}`}
            exportAllRows={exportAllUnitRows}
            serverPagination={{
              rowCount: totalStock,
              paginationModel: { page, pageSize: rowsPerPage },
              onPaginationModelChange: (model) => {
                setPage(model.page);
                setRowsPerPage(model.pageSize);
              },
            }}
            pageSizeOptions={[10, 20, 50, 100]}
          />
        </Box>
      )}

      {/* Stock Summary (per-product aggregated on-hand position) */}
      {viewMode === "summary" && (
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <TDataGrid<StockSummaryRow>
            rows={stockSummaryRows}
            columns={summaryColumns}
            loading={isLoadingSummary}
            getRowId={(row) => row.product_id}
            onRowClick={(row) => {
              // Drill down into that product's individual units.
              setSelectedProduct(String(row.product_id));
              setViewMode("units");
            }}
            emptyMessage={hasActiveFilters ? "No stock matches your filters" : "No stock found"}
            autoHeight={false}
            height="100%"
            exportFileName={`stock_summary_${selectedBranch || "all"}`}
            exportAllRows={exportAllSummaryRows}
            serverPagination={{
              rowCount: totalStockSummaryRows,
              paginationModel: { page: summaryPage, pageSize: summaryRowsPerPage },
              onPaginationModelChange: (model) => {
                setSummaryPage(model.page);
                setSummaryRowsPerPage(model.pageSize);
              },
            }}
            pageSizeOptions={[10, 20, 50, 100]}
          />
        </Box>
      )}

      {/* Stock Details Panel */}
      <StockDetailsPanel
        stock={selectedStock}
        product={
          selectedStock ? getProduct(selectedStock.product_id) || null : null
        }
        brandName={
          selectedStock
            ? getProductBrandName(getProduct(selectedStock.product_id))
            : ""
        }
        categoryName={
          selectedStock
            ? getProductCategoryName(getProduct(selectedStock.product_id))
            : ""
        }
        isOpen={isDetailsPanelOpen}
        onClose={() => setIsDetailsPanelOpen(false)}
      />
    </Box>
  );
}
