/**
 * CustomerReadOnlyView - the Customers page detail panel (General / Address / Contact Person /
 * Payment tabs), same layout and fields, view only. Used by the customer "peek" popup so a user
 * who may not open the Customers page can still see what it shows.
 *
 * Bank details are never sent; ID / passport / registration numbers only to users who hold
 * customers:view (`show_sensitive`). Keep in step with CustomersPage.tsx's detail panel.
 */
import { useMemo, useState } from "react";
import { Box, FormControlLabel, InputAdornment, MenuItem, Switch, TextField, Typography } from "@mui/material";
import type { GridRenderCellParams } from "@mui/x-data-grid";
import PersonIcon from "@mui/icons-material/Person";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import { useCurrencyStore } from "@/state/currencyStore";
import { useReferenceData } from "@/hooks/useReferenceData";
import {
  FormSection,
  SUPPLIER_PAYMENT_TERMS,
  SUPPLIER_PAYMENT_TERMS_CUSTOM,
  TChip,
  TDataGrid,
  TTabPanel,
  TTabs,
  type TDataGridColumn,
  type TTabConfig,
} from "@/components/tijaero";
import type { Customer, CustomerContactPerson } from "@/modules/customers/types";

const TABS: TTabConfig[] = [
  { id: "general", label: "General", icon: <PersonIcon fontSize="small" /> },
  { id: "address", label: "Address", icon: <LocationOnOutlinedIcon fontSize="small" /> },
  { id: "contactPerson", label: "Contact Person", icon: <PersonOutlineIcon fontSize="small" /> },
  { id: "payment", label: "Payment", icon: <AccountBalanceWalletOutlinedIcon fontSize="small" /> },
];

export interface CustomerPeekData {
  customer: Customer;
  contact_persons: CustomerContactPerson[];
  show_sensitive: boolean;
}

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

export default function CustomerReadOnlyView({ customer, contact_persons, show_sensitive }: CustomerPeekData) {
  const [tab, setTab] = useState("general");
  const currencySymbol = useCurrencyStore((s) => s.symbol);
  const { data: reference } = useReferenceData(["countries", "currencies"]);
  const countryName = (id?: number | null) => reference?.countries?.find((c) => c.id === id)?.name ?? "";

  const isBusiness = customer.customer_type === "business";
  const currency = reference?.currencies?.find((c) => c.code === customer.default_currency);
  const knownTerm = SUPPLIER_PAYMENT_TERMS.find((t) => t.value === customer.credit_days);
  const deliverySame = !customer.shipping_address_line1;

  const contactColumns: TDataGridColumn<CustomerContactPerson>[] = useMemo(
    () => [
      {
        field: "full_name",
        header: "Name",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<CustomerContactPerson>) => (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: "100%" }}>
            <PersonOutlineIcon fontSize="small" color="action" />
            <Typography variant="body2" fontWeight={600}>
              {[params.row.title, params.row.full_name].filter(Boolean).join(" ")}
            </Typography>
          </Box>
        ),
      },
      { field: "designation", header: "Designation", flex: 1, minWidth: 130 },
      { field: "email", header: "Email", flex: 1, minWidth: 160 },
      { field: "phone", header: "Contact No", width: 130 },
      {
        field: "is_primary",
        header: "Primary",
        width: 100,
        align: "center",
        headerAlign: "center",
        renderCell: (params: GridRenderCellParams<CustomerContactPerson>) =>
          params.row.is_primary ? <TChip label="Primary" size="small" color="primary" /> : null,
      },
    ],
    [],
  );

  return (
    <Box>
      <Box sx={{ mb: 1 }}>
        <Typography variant="h6" noWrap>
          {isBusiness && customer.company_name ? customer.company_name : customer.customer_name}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {customer.customer_no}
        </Typography>
      </Box>
      <TTabs tabs={TABS} activeTab={tab} onChange={(id) => setTab(String(id))} showDivider={false} />

      <TTabPanel value={tab} index="general" padding={0} sx={{ pt: 2 }}>
        <FormSection title={isBusiness ? "Company Information" : "Personal Information"} columns={2}>
          <Field label="Customer Category" value={isBusiness ? "Company" : "Individual"} />
          {isBusiness ? (
            <Field label="Company Name" value={customer.company_name} />
          ) : (
            <Field label="Title" value={customer.title} />
          )}
          {!isBusiness && <Field label="Customer Name" value={customer.customer_name} />}
          {isBusiness && show_sensitive && (
            <>
              <Field label="Tax Registration No" value={customer.tax_registration_number} />
              <Field label="Company Registration No" value={customer.company_registration_number} />
            </>
          )}
          <Field
            label="Currency"
            value={currency ? `${currency.code} — ${currency.name} (${currency.symbol})` : customer.default_currency}
          />
        </FormSection>

        <FormSection title="Contact Information" columns={2}>
          <Field label="Email" value={customer.email} />
          <Field label="Contact No 1" value={customer.mobile_contact_number} />
          <Field label="Contact No 2" value={customer.home_contact_number} />
        </FormSection>

        {!isBusiness && show_sensitive && (
          <FormSection title="ID & Documents" columns={2}>
            <Field label="ID Card Number" value={customer.id_card_number} />
            <Field label="Passport No" value={customer.passport_no} />
          </FormSection>
        )}
      </TTabPanel>

      <TTabPanel value={tab} index="address" padding={0} sx={{ pt: 2 }}>
        <FormSection title="Payment Address" columns={2}>
          <Field label="Address Line 1" value={customer.billing_address_line1} />
          <Field label="Address Line 2" value={customer.billing_address_line2} />
          <Field label="City" value={customer.billing_city} />
          <Field label="State / Province" value={customer.billing_state} />
          <Field label="Postal Code" value={customer.billing_postal_code} />
          <Field label="Country" value={countryName(customer.billing_country_id)} />
        </FormSection>

        <FormSection title="Delivery Address" columns={2}>
          <FormControlLabel
            sx={{ gridColumn: "span 2" }}
            control={<Switch checked={deliverySame} disabled />}
            label="Same as payment address"
          />
          {!deliverySame && (
            <>
              <Field label="Address Line 1" value={customer.shipping_address_line1} />
              <Field label="Address Line 2" value={customer.shipping_address_line2} />
              <Field label="City" value={customer.shipping_city} />
              <Field label="State / Province" value={customer.shipping_state} />
              <Field label="Postal Code" value={customer.shipping_postal_code} />
              <Field label="Country" value={countryName(customer.shipping_country_id)} />
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

      <TTabPanel value={tab} index="payment" padding={0} sx={{ pt: 2 }}>
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
          {!knownTerm && <Field label="Custom Payment Terms (days)" value={customer.credit_days} />}
          <Field label="Max Credit Limit" value={customer.max_credit_limit} adornment={currencySymbol} />
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <FormControlLabel control={<Switch checked={customer.active ?? true} disabled />} label="Active" />
            <FormControlLabel control={<Switch checked={!!customer.is_customer_agent} disabled />} label="Agent" />
          </Box>
          {customer.is_customer_agent && (
            <Field label="Default Commission Rate (%)" value={customer.commission_rate ?? 0} />
          )}
        </FormSection>
      </TTabPanel>
    </Box>
  );
}
