// Export API client
export { default as apiClient } from "./client";

// Export CRUD API factory
export { createCrudApi } from "./createCrudApi";
export type { CrudApi } from "./createCrudApi";

// Export auth API
export { authApi } from "@/auth/api";

// Export module APIs
export { customersApi } from "@/modules/customers/api";
export { salesApi, saleReturnsApi } from "@/modules/sales/api";
export { productsApi, categoriesApi, brandsApi } from "@/modules/inventory/api";
export {
  suppliersApi,
  purchaseOrdersApi,
  purchaseReturnsApi,
  supplierAdvancePaymentsApi,
} from "@/modules/purchasing/api";
export {
  bankDepositsApi,
  cardPaymentsApi,
  chequePaymentsApi,
  expensesApi,
  advancePaymentsApi,
  creditNotesApi,
} from "@/modules/finance/api";
export { employeesApi } from "@/modules/employees/api";

// Export types
export type * from "./types";
export type * from "@/modules/customers/types";
export type * from "@/modules/sales/types";
export type * from "@/modules/inventory/types";
export type * from "@/modules/purchasing/types";
export type * from "@/modules/finance/types";
export type * from "@/modules/employees/types";
