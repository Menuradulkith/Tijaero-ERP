/**
 * SupplierReadOnlyView - the Suppliers page detail panel (General / Address / Contact Person /
 * Payment tabs), same layout and fields, view only. Used by the supplier "peek" popup so a user
 * who may not open the Suppliers page can still see exactly what it shows.
 *
 * Keep the sections in step with SuppliersPage.tsx's detailPanel.
 */
import { useMemo, useState } from "react";
import { Avatar, Box, FormControlLabel, InputAdornment, MenuItem, Switch, TextField, Typography } from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import BusinessIcon from "@mui/icons-material/Business";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import { useCurrencyStore } from "@/state/currencyStore";
import { useReferenceData } from "@/hooks/useReferenceData";
import {
  FormSection,
  SUPPLIER_PAYMENT_TERMS,
  SUPPLIER_PAYMENT_TERMS_CUSTOM,
  SUPPLIER_TAX_AREA,
  TDataGrid,
  TTabPanel,
  TTabs,
  type TDataGridColumn,
  type TTabConfig,
} from "@/components/tijaero";
import type {
  Supplier,
  SupplierContactPerson,
} from "@/modules/purchasing/types";

const TABS: TTabConfig[] = [
  { id: "general", label: "General", icon: <BusinessIcon fontSize="small" /> },
  { id: "address", label: "Address", icon: <LocationOnOutlinedIcon fontSize="small" /> },
  { id: "contactPerson", label: "Contact Person", icon: <PersonOutlineIcon fontSize="small" /> },
  { id: "payment", label: "Payment", icon: <AccountBalanceWalletOutlinedIcon fontSize="small" /> },
];

// The API client's baseURL includes /api/v1; uploaded files are served from the plain origin.
const LOGO_API_ORIGIN = (import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1").replace(/\/api\/v1$/, "");

export interface SupplierPeekData {
  /** Tab ids to leave out ("general" | "address" | "contactPerson" | "payment"). */
  hideTabs?: string[];
  supplier: Supplier;
  contact_persons: SupplierContactPerson[];
}

/** A disabled, read-only field styled like the page's fields. */
function Field({ label, value, adornment }: { label: string; value: unknown; adornment?: string }) {
  return (
    <TextField
      label={label}
      size="small"
      value={value === null || value === undefined ? "" : String(value)}
      disabled
      InputProps={{
        readOnly: true,
        startAdornment: adornment ? <InputAdornment position="start">{adornment}</InputAdornment> : undefined,
      }}
      InputLabelProps={{ shrink: true }}
    />
  );
}

export default function SupplierReadOnlyView({ supplier, contact_persons, hideTabs = [] }: SupplierPeekData) {
  const [tab, setTab] = useState("general");
  const tabs = TABS.filter((t) => !hideTabs.includes(String(t.id)));
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const { data: reference } = useReferenceData(["countries", "currencies"]);
  const countryName = (id?: number | null) => reference?.countries?.find((c) => c.id === id)?.name ?? "";

  const taxArea = SUPPLIER_TAX_AREA.find((t) => t.value === supplier.tax_area)?.label ?? "";
  const currency = reference?.currencies?.find((c) => c.code === supplier.default_currency);
  const knownTerm = SUPPLIER_PAYMENT_TERMS.find((t) => t.value === supplier.credit_days);
  const logo = supplier.logo_path ? `${LOGO_API_ORIGIN}/uploads/${supplier.logo_path}` : undefined;
  const shippingSame = !supplier.shipping_address_line1;

  const contactColumns: TDataGridColumn<SupplierContactPerson>[] = useMemo(
    () => [
      {
        field: "full_name",
        header: "Name",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<SupplierContactPerson>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: "100%" }}>
            <PersonOutlineIcon fontSize="small" color="action" />
            <Typography variant="body2" fontWeight={600}>
              {[params.row.title, params.row.full_name].filter(Boolean).join(" ")}
            </Typography>
          </Box>
        ),
      },
      { field: "occupation", header: "Occupation", flex: 1, minWidth: 130 },
      { field: "email", header: "Email", flex: 1, minWidth: 160 },
      { field: "phone", header: "Contact No", width: 130 },
    ],
    [],
  );

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
        <Avatar src={logo} sx={{ width: 40, height: 40 }}>
          {supplier.company_name?.[0]?.toUpperCase() ?? <BusinessIcon />}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" noWrap>
            {supplier.company_name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {supplier.supplier_no}
          </Typography>
        </Box>
      </Box>
      <TTabs tabs={tabs} activeTab={tab} onChange={(id) => setTab(String(id))} showDivider={false} />

      <TTabPanel value={tab} index="general" padding={0} sx={{ pt: 2 }}>
        <FormSection title="Company Information" columns={2}>
          <Field label="Company Name" value={supplier.company_name} />
          <Field label="Company Registration No." value={supplier.company_registration_number} />
          <Field label="Tax/VAT Number" value={supplier.tax_registration_number} />
          <Field label="Tax Area" value={taxArea} />
          <Field
            label="Default Currency"
            value={currency ? `${currency.code} — ${currency.name} (${currency.symbol})` : supplier.default_currency}
          />
          <Field label="Country" value={countryName(supplier.country_id)} />
          <Field label="Company Website" value={supplier.company_website} />
          <FormControlLabel control={<Switch checked={!!supplier.active} disabled />} label="Active" />
          <Field label="Lead Time (days)" value={supplier.lead_time_days} />
          <Field
            label="Avg. Lead Time (computed)"
            value={
              supplier.average_lead_time_days != null
                ? `${supplier.average_lead_time_days} days`
                : "No completed orders yet"
            }
          />
        </FormSection>

        <FormSection title="Contact Information" columns={2}>
          <Field label="Email" value={supplier.email} />
          <Field label="Contact No 1" value={supplier.mobile_contact_number} />
          <Field label="Contact No 2" value={supplier.home_contact_number} />
        </FormSection>
      </TTabPanel>

      <TTabPanel value={tab} index="address" padding={0} sx={{ pt: 2 }}>
        <FormSection title="Billing Address" columns={2}>
          <Field label="Address Line 1" value={supplier.billing_address_line1} />
          <Field label="Address Line 2" value={supplier.billing_address_line2} />
          <Field label="City" value={supplier.billing_city} />
          <Field label="State / Province" value={supplier.billing_state} />
          <Field label="Postal Code" value={supplier.billing_postal_code} />
          <Field label="Country" value={countryName(supplier.billing_country_id)} />
        </FormSection>

        <FormSection title="Shipping Address" columns={2}>
          <FormControlLabel
            sx={{ gridColumn: "span 2" }}
            control={<Switch checked={shippingSame} disabled />}
            label="Same as billing address"
          />
          {!shippingSame && (
            <>
              <Field label="Address Line 1" value={supplier.shipping_address_line1} />
              <Field label="Address Line 2" value={supplier.shipping_address_line2} />
              <Field label="City" value={supplier.shipping_city} />
              <Field label="State / Province" value={supplier.shipping_state} />
              <Field label="Postal Code" value={supplier.shipping_postal_code} />
              <Field label="Country" value={countryName(supplier.shipping_country_id)} />
            </>
          )}
        </FormSection>
      </TTabPanel>

      <TTabPanel value={tab} index="contactPerson" padding={0} sx={{ pt: 2 }}>
        <FormSection title="Contact Persons" columns={1}>
          {contact_persons.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No contact persons added yet.
            </Typography>
          ) : (
            <TDataGrid
              rows={contact_persons}
              columns={contactColumns}
              autoHeight
              density="standard"
              pageSizeOptions={[10, 25, 50]}
              pageSize={10}
            />
          )}
        </FormSection>
      </TTabPanel>

      {!hideTabs.includes("payment") && <TTabPanel value={tab} index="payment" padding={0} sx={{ pt: 2 }}>
        <FormSection title="Payment" columns={2}>
          <TextField
            select
            label="Payment Terms"
            size="small"
            value={knownTerm ? knownTerm.value : SUPPLIER_PAYMENT_TERMS_CUSTOM}
            disabled
            InputLabelProps={{ shrink: true }}
          >
            {SUPPLIER_PAYMENT_TERMS.map((term) => (
              <MenuItem key={term.value} value={term.value}>
                {term.label}
              </MenuItem>
            ))}
            <MenuItem value={SUPPLIER_PAYMENT_TERMS_CUSTOM}>Custom</MenuItem>
          </TextField>
          {!knownTerm && <Field label="Custom Payment Terms (days)" value={supplier.credit_days} />}
          <Field label="Max Credit Limit" value={supplier.max_credit_limit} adornment={currencySymbol} />
          <Field label="Initial Credit Amount" value={supplier.initial_credit_amount ?? 0} adornment={currencySymbol} />
          <Field label="Left Credit Amount" value={supplier.left_credit_amount ?? 0} adornment={currencySymbol} />
        </FormSection>
      </TTabPanel>}
    </Box>
  );
}
