import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  MenuItem,
} from "@mui/material";
import { customersApi } from "../api";
import { Customer, CustomerCreate } from "../types";
import { toast } from "react-hot-toast";

interface CustomerDialogProps {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
}

export default function CustomerDialog({
  open,
  customer,
  onClose,
}: CustomerDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = !!customer;

  const { control, handleSubmit, reset } = useForm<CustomerCreate>({
    defaultValues: {
      customer_name: "",
      title: "Mr",
      email: "",
      mobile_contact_number: "",
      home_contact_number: "",
      company_name: "",
      occupation: "",
      gender: "Male",
      civil_status: "Single",
      no_of_kids: "0",
      birthdate: "",
      payment_address: "",
      delivery_address: "",
      credit_days: 0,
      max_credit_limit: 0,
      active: true,
      is_customer_agent: false,
    },
  });

  useEffect(() => {
    if (customer) {
      reset({
        customer_name: customer.customer_name,
        title: customer.title,
        email: customer.email || "",
        mobile_contact_number: customer.mobile_contact_number,
        home_contact_number: customer.home_contact_number || "",
        company_name: customer.company_name || "",
        occupation: customer.occupation || "",
        gender: customer.gender,
        civil_status: customer.civil_status,
        no_of_kids: customer.no_of_kids,
        birthdate: customer.birthdate || "",
        payment_address: customer.payment_address || "",
        delivery_address: customer.delivery_address || "",
        credit_days: customer.credit_days,
        max_credit_limit: customer.max_credit_limit,
        active: customer.active,
        is_customer_agent: customer.is_customer_agent,
      });
    } else {
      reset({
        customer_name: "",
        title: "Mr",
        email: "",
        mobile_contact_number: "",
        home_contact_number: "",
        company_name: "",
        occupation: "",
        gender: "Male",
        civil_status: "Single",
        no_of_kids: "0",
        birthdate: "",
        payment_address: "",
        delivery_address: "",
        credit_days: 0,
        max_credit_limit: 0,
        active: true,
        is_customer_agent: false,
      });
    }
  }, [customer, reset]);

  const createMutation = useMutation({
    mutationFn: customersApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer created successfully");
      onClose();
    },
    onError: () => {
      toast.error("Failed to create customer");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerCreate }) =>
      customersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Customer updated successfully");
      onClose();
    },
    onError: () => {
      toast.error("Failed to update customer");
    },
  });

  const onSubmit = (data: CustomerCreate) => {
    if (isEdit && customer) {
      updateMutation.mutate({ id: customer.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle>{isEdit ? "Edit Customer" : "Add Customer"}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={3}>
              <Controller
                name="title"
                control={control}
                rules={{ required: "Title is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Title"
                    select
                    fullWidth
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  >
                    <MenuItem value="Mr">Mr</MenuItem>
                    <MenuItem value="Ms">Ms</MenuItem>
                    <MenuItem value="Mrs">Mrs</MenuItem>
                    <MenuItem value="Dr">Dr</MenuItem>
                  </TextField>
                )}
              />
            </Grid>
            <Grid item xs={12} sm={9}>
              <Controller
                name="customer_name"
                control={control}
                rules={{ required: "Customer name is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Customer Name"
                    fullWidth
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="email"
                control={control}
                rules={{
                  pattern: {
                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                    message: "Invalid email address",
                  },
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Email"
                    type="email"
                    fullWidth
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="mobile_contact_number"
                control={control}
                rules={{ required: "Mobile number is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Mobile Number"
                    fullWidth
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="home_contact_number"
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Home Number" fullWidth />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="company_name"
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Company Name" fullWidth />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="occupation"
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Occupation" fullWidth />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="gender"
                control={control}
                rules={{ required: "Gender is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Gender"
                    select
                    fullWidth
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  >
                    <MenuItem value="Male">Male</MenuItem>
                    <MenuItem value="Female">Female</MenuItem>
                    <MenuItem value="Other">Other</MenuItem>
                  </TextField>
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="civil_status"
                control={control}
                rules={{ required: "Civil status is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Civil Status"
                    select
                    fullWidth
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  >
                    <MenuItem value="Single">Single</MenuItem>
                    <MenuItem value="Married">Married</MenuItem>
                    <MenuItem value="Divorced">Divorced</MenuItem>
                    <MenuItem value="Widowed">Widowed</MenuItem>
                  </TextField>
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="no_of_kids"
                control={control}
                rules={{ required: "Number of kids is required" }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Number of Kids"
                    fullWidth
                    required
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="birthdate"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Birth Date"
                    type="date"
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="credit_days"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Credit Days"
                    type="number"
                    fullWidth
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="max_credit_limit"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Max Credit Limit"
                    type="number"
                    fullWidth
                  />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <Controller
                name="payment_address"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Payment Address"
                    fullWidth
                    multiline
                    rows={2}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <Controller
                name="delivery_address"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Delivery Address"
                    fullWidth
                    multiline
                    rows={2}
                  />
                )}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {isEdit ? "Update" : "Create"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
