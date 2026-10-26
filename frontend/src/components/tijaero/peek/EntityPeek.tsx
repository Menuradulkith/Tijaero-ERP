/**
 * EntityPeek - read-only popup for a record that a document refers to.
 *
 * Lets a user look at a supplier / product / quotation from inside the page they are working on,
 * even when they may not open that record's own page. View only, there is no link to that page. The backend (`/peek/{entity}/{id}`) decides
 * what the user may see; this file only renders it.
 *
 * @example
 * <EntityLink entity="supplier" id={order.first_suppliers_id}>{supplierName}</EntityLink>
 * <EntityPeekButton entity="product" id={line.product_id} />
 */
import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import apiClient from "@/api/client";
import { fmtLKR } from "@/components/tijaero/data";
import { TChip } from "@/components/tijaero/base";

// The supplier popup is the Suppliers page's own detail layout, view only. Loaded on demand
// (and from the module, not the shared library) to keep the library free of module imports.
const SupplierReadOnlyView = lazy(() => import("@/modules/purchasing/components/SupplierReadOnlyView"));
const ProductReadOnlyView = lazy(() => import("@/modules/inventory/components/ProductReadOnlyView"));
const QuotationReadOnlyView = lazy(() => import("@/modules/sales/components/QuotationReadOnlyView"));
const CustomerReadOnlyView = lazy(() => import("@/modules/sales/components/CustomerReadOnlyView"));
const PurchaseOrderReadOnlyView = lazy(() => import("@/modules/purchasing/components/PurchaseOrderReadOnlyView"));

export type PeekEntity = "supplier" | "product" | "quotation" | "customer" | "purchase-order";

interface PeekField {
  label: string;
  value: string | number | null;
  kind?: "money";
}

interface PeekResponse {
  entity: PeekEntity;
  entity_id: number;
  title: string;
  subtitle?: string | null;
  status?: string | null;
  fields: PeekField[];
  contacts?: { name: string; role?: string | null; phone?: string | null; email?: string | null }[];
  items?: { name: string; quantity: number; status: string; procured: number }[];
  // supplier only: the same data the Suppliers page shows
  kind?: "supplier" | "product" | "quotation" | "customer" | "purchase-order";
  supplier?: any;
  show_payment?: boolean;
  contact_persons?: any[];
  // product only: the same data the Products page shows
  product?: any;
  category_name?: string | null;
  brand_name?: string | null;
  show_pricing?: boolean;
  show_supplier_costs?: boolean;
  suppliers?: any[];
  // quotation only: the same data the Quotations page shows
  quote?: any;
  // customer only: the same data the Customers page shows
  customer?: any;
  // purchase order only: the same data the Purchase Orders page shows
  order?: any;
  show_sensitive?: boolean;
  branch_name?: string;
  customer_name?: string | null;
  related_purchase_orders?: any[];
  procurement?: any[];
}

const ENTITY_LABEL: Record<PeekEntity, string> = {
  supplier: "Supplier",
  product: "Product",
  quotation: "Quotation",
  customer: "Customer",
  "purchase-order": "Purchase Order",
};

const errorText = (error: unknown): string => {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 403) return "You do not have access to view this record.";
  if (status === 404) return "This record no longer exists.";
  return "Could not load the details. Please try again.";
};

const showValue = (f: PeekField) =>
  f.value === null || f.value === undefined || f.value === ""
    ? "-"
    : f.kind === "money"
      ? fmtLKR(Number(f.value))
      : String(f.value);

export interface EntityPeekDialogProps {
  entity: PeekEntity;
  id: number;
  open: boolean;
  onClose: () => void;
  /** Tabs of the record view to leave out, e.g. ["payment"] for a supplier seen from the GRN page. */
  hideTabs?: string[];
}

export function EntityPeekDialog({ entity, id, open, onClose, hideTabs }: EntityPeekDialogProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["peek", entity, id],
    queryFn: async () => (await apiClient.get<PeekResponse>(`/peek/${entity}/${id}`)).data,
    enabled: open && id > 0,
    staleTime: 30_000,
    retry: false,
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {ENTITY_LABEL[entity]}
          </Typography>
          {!data?.kind && (
            <Typography variant="h6" noWrap>
              {data?.title ?? "..."}
            </Typography>
          )}
          {data?.subtitle && !data?.kind && (
            <Typography variant="body2" color="text.secondary">
              {data.subtitle}
            </Typography>
          )}
        </Box>
        {data?.status && <TChip size="small" label={data.status.replace(/_/g, " ")} />}
      </DialogTitle>

      <DialogContent dividers>
        {isLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        )}
        {error && <Alert severity="warning">{errorText(error)}</Alert>}

        {data?.kind === "supplier" && data.supplier && (
          <Suspense fallback={<CircularProgress size={28} />}>
            <SupplierReadOnlyView
              supplier={data.supplier}
              contact_persons={data.contact_persons ?? []}
              hideTabs={data.show_payment === false ? [...(hideTabs ?? []), "payment"] : hideTabs}
            />
          </Suspense>
        )}

        {data?.kind === "product" && data.product && (
          <Suspense fallback={<CircularProgress size={28} />}>
            <ProductReadOnlyView
              product={data.product}
              category_name={data.category_name}
              brand_name={data.brand_name}
              show_pricing={!!data.show_pricing}
              show_supplier_costs={data.show_supplier_costs !== false}
              suppliers={data.suppliers ?? []}
            />
          </Suspense>
        )}

        {data?.kind === "quotation" && data.quote && (
          <Suspense fallback={<CircularProgress size={28} />}>
            <QuotationReadOnlyView
              quote={data.quote}
              show_pricing={!!data.show_pricing}
              branch_name={data.branch_name ?? ""}
              customer_name={data.customer_name}
              related_purchase_orders={data.related_purchase_orders ?? []}
              procurement={data.procurement ?? []}
            />
          </Suspense>
        )}

        {data?.kind === "customer" && data.customer && (
          <Suspense fallback={<CircularProgress size={28} />}>
            <CustomerReadOnlyView
              customer={data.customer}
              contact_persons={data.contact_persons ?? []}
              show_sensitive={!!data.show_sensitive}
            />
          </Suspense>
        )}

        {data?.kind === "purchase-order" && data.order && (
          <Suspense fallback={<CircularProgress size={28} />}>
            <PurchaseOrderReadOnlyView order={data.order} show_pricing={!!data.show_pricing} branch_name={data.branch_name ?? ""} />
          </Suspense>
        )}

        {data && !data.kind && (
          <>
            <Box sx={{ display: "grid", gridTemplateColumns: "160px 1fr", rowGap: 0.75, columnGap: 2 }}>
              {data.fields.map((f) => (
                <Box key={f.label} sx={{ display: "contents" }}>
                  <Typography variant="body2" color="text.secondary">
                    {f.label}
                  </Typography>
                  <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                    {showValue(f)}
                  </Typography>
                </Box>
              ))}
            </Box>

            {!!data.contacts?.length && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Contact persons
                </Typography>
                {data.contacts.map((c, i) => (
                  <Typography key={`${c.name}-${i}`} variant="body2">
                    {c.name}
                    {c.role ? ` (${c.role})` : ""}
                    {c.phone ? ` · ${c.phone}` : ""}
                    {c.email ? ` · ${c.email}` : ""}
                  </Typography>
                ))}
              </Box>
            )}

            {!!data.items?.length && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Items
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Product</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell align="right">Procured</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.items.map((i, idx) => (
                      <TableRow key={`${i.name}-${idx}`}>
                        <TableCell>{i.name}</TableCell>
                        <TableCell align="right">{i.quantity}</TableCell>
                        <TableCell align="right">{i.procured}</TableCell>
                        <TableCell>{i.status.replace(/_/g, " ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface PeekTriggerProps {
  entity: PeekEntity;
  id?: number | null;
  hideTabs?: string[];
}

/** Small (i) button that opens the peek popup. Renders nothing until there is a record to show. */
export function EntityPeekButton({ entity, id, hideTabs }: PeekTriggerProps) {
  const [open, setOpen] = useState(false);
  if (!id) return null;
  return (
    <>
      <Tooltip title={`View ${ENTITY_LABEL[entity].toLowerCase()} details`}>
        <IconButton
          size="small"
          aria-label={`View ${ENTITY_LABEL[entity].toLowerCase()} details`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <InfoOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <EntityPeekDialog entity={entity} id={id} open={open} onClose={() => setOpen(false)} hideTabs={hideTabs} />
    </>
  );
}

/** Text that opens the peek popup when clicked. */
export function EntityLink({ entity, id, hideTabs, children }: PeekTriggerProps & { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!id) return <>{children}</>;
  return (
    <>
      <Link
        component="button"
        type="button"
        underline="hover"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        sx={{ verticalAlign: "baseline", textAlign: "left" }}
      >
        {children}
      </Link>
      <EntityPeekDialog entity={entity} id={id} open={open} onClose={() => setOpen(false)} hideTabs={hideTabs} />
    </>
  );
}
