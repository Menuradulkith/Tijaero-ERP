import { useEffect, useState } from "react";
import {
  Autocomplete,
  Box,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
} from "@mui/material";
import { reportCenterApi, type LookupKind, type Option, type ParamValues, type ReportParam } from "../center-api";

interface Props {
  params: ReportParam[];
  values: ParamValues;
  onChange: (values: ParamValues) => void;
  branches: Option[];
}

/** Filter form generated from a report's parameter definitions. */
export default function ReportParamsForm({ params, values, onChange, branches }: Props) {
  const set = (key: string, value: ParamValues[string]) => onChange({ ...values, [key]: value });

  return (
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", alignItems: "center" }}>
      {params.map((p) => {
        const value = values[p.key];
        const label = p.required ? `${p.label} *` : p.label;
        switch (p.type) {
          case "date":
            return (
              <TextField
                key={p.key}
                type="date"
                size="small"
                label={label}
                value={(value as string) ?? ""}
                onChange={(e) => set(p.key, e.target.value || null)}
                InputLabelProps={{ shrink: true }}
                helperText={p.help ?? undefined}
              />
            );
          case "int":
          case "year":
            return (
              <TextField
                key={p.key}
                type="number"
                size="small"
                label={label}
                value={value ?? ""}
                onChange={(e) => set(p.key, e.target.value === "" ? null : Number(e.target.value))}
                inputProps={{ min: p.min ?? (p.type === "year" ? 2000 : undefined), max: p.max ?? (p.type === "year" ? 2100 : undefined) }}
                helperText={p.help ?? undefined}
              />
            );
          case "bool":
            return (
              <FormControlLabel
                key={p.key}
                control={<Switch checked={!!value} onChange={(e) => set(p.key, e.target.checked)} />}
                label={p.label}
              />
            );
          case "select":
          case "branch": {
            const options = p.type === "branch" ? branches : p.options;
            const emptyLabel = p.type === "branch" ? (branches.length > 1 ? "All my branches" : "—") : "Any";
            return (
              <FormControl key={p.key} size="small">
                <InputLabel shrink>{label}</InputLabel>
                <Select
                  label={label}
                  notched
                  displayEmpty
                  value={(value as string) ?? ""}
                  onChange={(e) => set(p.key, e.target.value || null)}
                >
                  {!p.required && <MenuItem value="">{emptyLabel}</MenuItem>}
                  {options.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            );
          }
          case "customer":
          case "supplier":
          case "product":
          case "account":
            return (
              <LookupPicker
                key={p.key}
                kind={p.type}
                label={label}
                value={(value as number | string) ?? null}
                onChange={(v) => set(p.key, v)}
                placeholder={p.help ?? "Any"}
              />
            );
          default:
            return (
              <TextField
                key={p.key}
                size="small"
                label={label}
                value={(value as string) ?? ""}
                onChange={(e) => set(p.key, e.target.value || null)}
              />
            );
        }
      })}
    </Box>
  );
}

/** Searchable picker for customer / supplier / product / account filters. */
function LookupPicker({
  kind,
  label,
  value,
  onChange,
  placeholder,
}: {
  kind: LookupKind;
  label: string;
  value: number | string | null;
  onChange: (value: number | string | null) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<Option<number | string>[]>([]);
  const [selected, setSelected] = useState<Option<number | string> | null>(null);

  // Resolve a preset id (from a saved report) to its name.
  useEffect(() => {
    if (value === null) {
      setSelected(null);
      return;
    }
    if (selected?.value === value) return;
    reportCenterApi.lookup(kind, "", [value]).then((rows) => setSelected(rows[0] ?? { value, label: `#${value}` })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, kind]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      reportCenterApi.lookup(kind, input).then(setOptions).catch(() => setOptions([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [input, kind]);

  return (
    <Autocomplete
      size="small"
      options={options}
      value={selected}
      filterOptions={(x) => x}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      getOptionLabel={(o) => o.label}
      onInputChange={(_, v) => setInput(v)}
      onChange={(_, v) => {
        setSelected(v);
        onChange(v?.value ?? null);
      }}
      renderInput={(params) => <TextField {...params} label={label} placeholder={placeholder} InputLabelProps={{ shrink: true }} />}
    />
  );
}
