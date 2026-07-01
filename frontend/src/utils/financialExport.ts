/**
 * Financial Table Export Utilities
 * 
 * Helper functions to prepare financial table data for CSV export.
 * Handles formatting, date conversion, currency formatting, etc.
 */

import { ExportOptions } from "@/components/tijaero/buttons/TExportButton";

/**
 * Generic function to convert any table data to CSV export format
 */
export function prepareFinancialTableForExport<T extends Record<string, any>>(
  data: T[],
  headers: Array<{ key: string; label: string; format?: (value: any) => string }>,
  filename: string
): ExportOptions {
  return {
    filename: `${filename}_${new Date().toISOString().split('T')[0]}.csv`,
    headers: headers.map(h => h.label),
    rows: data.map(row =>
      headers.map(header => {
        const value = row[header.key];
        return header.format ? header.format(value) : value;
      })
    ),
  };
}

/**
 * Chart of Accounts export formatter
 */
export function formatChartOfAccountsForExport(data: any[]): ExportOptions {
  return prepareFinancialTableForExport(
    data,
    [
      { key: "account_code", label: "Account Code" },
      { key: "account_name", label: "Account Name" },
      { key: "account_type", label: "Type" },
      { key: "account_category", label: "Category" },
      { key: "normal_balance", label: "Normal Balance" },
      { key: "is_active", label: "Status", format: (v) => v ? "Active" : "Inactive" },
      { key: "description", label: "Description" },
    ],
    "Chart_of_Accounts"
  );
}

/**
 * General Ledger export formatter
 */
export function formatGeneralLedgerForExport(data: any[]): ExportOptions {
  return prepareFinancialTableForExport(
    data,
    [
      { key: "date", label: "Date", format: (v) => formatDate(v) },
      { key: "account_code", label: "Account Code" },
      { key: "account_name", label: "Account Name" },
      { key: "reference_no", label: "Reference" },
      { key: "description", label: "Description" },
      { key: "debit", label: "Debit", format: (v) => formatCurrency(v) },
      { key: "credit", label: "Credit", format: (v) => formatCurrency(v) },
      { key: "balance", label: "Balance", format: (v) => formatCurrency(v) },
    ],
    "General_Ledger"
  );
}

/**
 * Income Statement export formatter
 */
export function formatIncomeStatementForExport(data: any[]): ExportOptions {
  return prepareFinancialTableForExport(
    data,
    [
      { key: "account_code", label: "Account Code" },
      { key: "account_name", label: "Account Name" },
      { key: "amount", label: "Amount", format: (v) => formatCurrency(v) },
      { key: "percentage", label: "Percentage", format: (v) => `${v.toFixed(2)}%` },
    ],
    "Income_Statement"
  );
}

/**
 * Balance Sheet export formatter
 */
export function formatBalanceSheetForExport(data: any[]): ExportOptions {
  return prepareFinancialTableForExport(
    data,
    [
      { key: "account_code", label: "Account Code" },
      { key: "account_name", label: "Account Name" },
      { key: "account_type", label: "Type" },
      { key: "amount", label: "Amount", format: (v) => formatCurrency(v) },
      { key: "percentage", label: "Percentage", format: (v) => `${v.toFixed(2)}%` },
    ],
    "Balance_Sheet"
  );
}

/**
 * Cashbook export formatter
 */
export function formatCashbookForExport(data: any[]): ExportOptions {
  return prepareFinancialTableForExport(
    data,
    [
      { key: "date", label: "Date", format: (v) => formatDate(v) },
      { key: "description", label: "Description" },
      { key: "reference_no", label: "Reference" },
      { key: "receipt", label: "Receipt", format: (v) => formatCurrency(v) },
      { key: "payment", label: "Payment", format: (v) => formatCurrency(v) },
      { key: "balance", label: "Balance", format: (v) => formatCurrency(v) },
    ],
    "Cashbook"
  );
}

/**
 * Bank Deposits export formatter
 */
export function formatBankDepositsForExport(data: any[]): ExportOptions {
  return prepareFinancialTableForExport(
    data,
    [
      { key: "deposit_no", label: "Deposit No" },
      { key: "date", label: "Date", format: (v) => formatDate(v) },
      { key: "bank_name", label: "Bank" },
      { key: "amount", label: "Amount", format: (v) => formatCurrency(v) },
      { key: "reference_no", label: "Reference" },
      { key: "status", label: "Status" },
      { key: "notes", label: "Notes" },
    ],
    "Bank_Deposits"
  );
}

/**
 * Cash Payments export formatter
 */
export function formatCashPaymentsForExport(data: any[]): ExportOptions {
  return prepareFinancialTableForExport(
    data,
    [
      { key: "payment_no", label: "Payment No" },
      { key: "date", label: "Date", format: (v) => formatDate(v) },
      { key: "payee", label: "Payee" },
      { key: "amount", label: "Amount", format: (v) => formatCurrency(v) },
      { key: "account_code", label: "Account Code" },
      { key: "description", label: "Description" },
      { key: "reference_no", label: "Reference" },
      { key: "status", label: "Status" },
    ],
    "Cash_Payments"
  );
}

/**
 * Cheque Payments export formatter
 */
export function formatChequePaymentsForExport(data: any[]): ExportOptions {
  return prepareFinancialTableForExport(
    data,
    [
      { key: "cheque_no", label: "Cheque No" },
      { key: "payee", label: "Payee" },
      { key: "amount", label: "Amount", format: (v) => formatCurrency(v) },
      { key: "date", label: "Date", format: (v) => formatDate(v) },
      { key: "bank_name", label: "Bank" },
      { key: "status", label: "Status" },
      { key: "reference_no", label: "Reference" },
    ],
    "Cheque_Payments"
  );
}

/**
 * Credit Payments export formatter
 */
export function formatCreditPaymentsForExport(data: any[]): ExportOptions {
  return prepareFinancialTableForExport(
    data,
    [
      { key: "reference_no", label: "Reference" },
      { key: "date", label: "Date", format: (v) => formatDate(v) },
      { key: "creditor", label: "Creditor" },
      { key: "amount", label: "Amount", format: (v) => formatCurrency(v) },
      { key: "due_date", label: "Due Date", format: (v) => formatDate(v) },
      { key: "status", label: "Status" },
      { key: "notes", label: "Notes" },
    ],
    "Credit_Payments"
  );
}

/**
 * Credit Notes export formatter
 */
export function formatCreditNotesForExport(data: any[]): ExportOptions {
  return prepareFinancialTableForExport(
    data,
    [
      { key: "credit_note_no", label: "Credit Note No" },
      { key: "date", label: "Date", format: (v) => formatDate(v) },
      { key: "customer", label: "Customer" },
      { key: "amount", label: "Amount", format: (v) => formatCurrency(v) },
      { key: "reason", label: "Reason" },
      { key: "status", label: "Status" },
      { key: "notes", label: "Notes" },
    ],
    "Credit_Notes"
  );
}

/**
 * Commission Payments export formatter
 */
export function formatCommissionPaymentsForExport(data: any[]): ExportOptions {
  return prepareFinancialTableForExport(
    data,
    [
      { key: "commission_no", label: "Commission No" },
      { key: "date", label: "Date", format: (v) => formatDate(v) },
      { key: "recipient", label: "Recipient" },
      { key: "amount", label: "Amount", format: (v) => formatCurrency(v) },
      { key: "rate", label: "Rate (%)", format: (v) => `${v.toFixed(2)}%` },
      { key: "status", label: "Status" },
      { key: "notes", label: "Notes" },
    ],
    "Commission_Payments"
  );
}

/**
 * Advance Payments export formatter
 */
export function formatAdvancePaymentsForExport(data: any[]): ExportOptions {
  return prepareFinancialTableForExport(
    data,
    [
      { key: "advance_no", label: "Advance No" },
      { key: "date", label: "Date", format: (v) => formatDate(v) },
      { key: "recipient", label: "Recipient" },
      { key: "amount", label: "Amount", format: (v) => formatCurrency(v) },
      { key: "purpose", label: "Purpose" },
      { key: "status", label: "Status" },
      { key: "notes", label: "Notes" },
    ],
    "Advance_Payments"
  );
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Format date to readable string
 */
function formatDate(date: any): string {
  if (!date) return "";
  if (typeof date === "string") {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return String(date);
}

/**
 * Format currency to readable string
 */
function formatCurrency(amount: any): string {
  if (amount === null || amount === undefined) return "";
  const num = typeof amount === "number" ? amount : parseFloat(amount);
  if (isNaN(num)) return String(amount);
  return num.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export { formatDate, formatCurrency };
