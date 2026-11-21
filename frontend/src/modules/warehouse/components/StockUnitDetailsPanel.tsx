/**
 * StockUnitDetailsPanel - right-side drawer for one stock unit / lot:
 * item info, stock info, tracking timeline and "Move to Company Assets".
 * (Extracted from the old warehouse dashboard so the Stock page can reuse it.)
 */
import { usePermission } from "@/auth/permissions";
import { TChip, TStatusChip, handleApiError, showSuccessToast } from "@/components/tijaero";
import { useCurrencyStore } from "@/state/currencyStore";
import { productImageUrl, reclassifyApi, salesStockApi } from "@/modules/inventory/api";
import ReclassifyDialog from "@/modules/inventory/components/ReclassifyDialog";
import { Product, SalesStock, StockTrackingEvent } from "@/modules/inventory/types";
import { Close as CloseIcon, Business as AssetIcon } from "@mui/icons-material";
import { Box, Button, CircularProgress, Drawer, Grid, IconButton, Paper, Typography } from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useState } from "react";

export interface StockUnitDetailsPanelProps {
  stock: SalesStock | null;
  /** Optional: the item's product record (image); falls back to the stock row's own fields. */
  product?: Product | null;
  brandName?: string;
  categoryName?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function StockUnitDetailsPanel({
  stock,
  product = null,
  brandName = "",
  categoryName = "",
  isOpen,
  onClose,
}: StockUnitDetailsPanelProps) {
  const itemName = product?.name || stock?.product_name || "";
  const itemCode = product?.item_code || stock?.item_code || "";
  const imageUrl = productImageUrl(product?.image_url);
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const queryClient = useQueryClient();
  const canUpdateStock = usePermission("sales_stock", "update");
  const canCreateAsset = usePermission("company_assets", "create");
  const canMoveToAsset = canUpdateStock && canCreateAsset;
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
      queryClient.invalidateQueries({ queryKey: ["warehouseStock"] });
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

      {stock && (
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
                description="This unit leaves stock and becomes a company asset (e.g. a laptop kept for office use)."
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
              Item Information
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
                    {imageUrl ? (
                      <Box
                        component="img"
                        src={imageUrl}
                        alt={itemName}
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
                        display: imageUrl ? "none" : "flex",
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
                    Item Name
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {itemName || "N/A"}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="text.secondary">
                    Item Code
                  </Typography>
                  <Typography variant="body2" fontWeight={500}>
                    {itemCode || "N/A"}
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
                    {stock.added_date ? format(parseISO(stock.added_date), "dd MMM yyyy") : "N/A"}
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
}
