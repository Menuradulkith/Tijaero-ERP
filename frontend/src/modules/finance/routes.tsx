import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "@/auth/components/ProtectedRoute";
import FinanceDashboard from "./pages/FinanceDashboard";
import BankDepositsPage from "./pages/BankDepositsPage";
import CardPaymentsPage from "./pages/CardPaymentsPage";
import ChequePaymentsPage from "./pages/ChequePaymentsPage";
import ExpensesPage from "./pages/ExpensesPage";
import ExpenseApprovalsPage from "./pages/ExpenseApprovalsPage";
import AdvancePaymentsPage from "./pages/AdvancePaymentsPage";
import CustomerAdvancePaymentsPage from "./pages/CustomerAdvancePaymentsPage";
import SupplierAdvancePaymentsPage from "./pages/SupplierAdvancePaymentsPage";
import CreditNotesPage from "./pages/CreditNotesPage";
import CashbookPage from "./pages/CashbookPage";
import BankTransferVerifyPage from "./pages/BankTransferVerifyPage";
import SupplierPaymentsPage from "./pages/SupplierPaymentsPage";
import CustomerPaymentsPage from "./pages/CustomerPaymentsPage";
import PaymentApprovalsPage from "./pages/PaymentApprovalsPage";
import PaymentMethodsPage from "./pages/PaymentMethodsPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import ChartOfAccountsPage from "./pages/ChartOfAccountsPage";
import JournalEntriesPage from "./pages/JournalEntriesPage";
import GeneralLedgerPage from "./pages/GeneralLedgerPage";
import AccountingPeriodsPage from "./pages/AccountingPeriodsPage";
import CashFlowStatementsPage from "./pages/CashFlowStatementsPage";
import CommissionPaymentsPage from "./pages/CommissionPaymentsPage";
import CommissionPaymentApprovalsPage from "./pages/CommissionPaymentApprovalsPage";
import SupplierPaymentReportPage from "./pages/SupplierPaymentReportPage";
import CustomerPaymentReportPage from "./pages/CustomerPaymentReportPage";

export default function FinanceRoutes() {
  return (
    <Routes>
      <Route index element={<ProtectedRoute resource="finance_dashboard" action="view"><FinanceDashboard /></ProtectedRoute>} />
      <Route path="cashbook" element={<ProtectedRoute resource="cashbook" action="view"><CashbookPage /></ProtectedRoute>} />
      <Route path="expenses" element={<ProtectedRoute resource="expenses" action="view"><ExpensesPage /></ProtectedRoute>} />
      {/* Payment Methods - parent and sub-routes */}
      <Route path="payment-methods" element={<PaymentMethodsPage />} />
      <Route path="payment-methods/bank-deposits" element={<ProtectedRoute resource="bank_deposits" action="view"><BankDepositsPage /></ProtectedRoute>} />
      <Route path="payment-methods/card-payments" element={<ProtectedRoute resource="card_payments" action="view"><CardPaymentsPage /></ProtectedRoute>} />
      <Route path="payment-methods/cheque-payments" element={<ProtectedRoute resource="cheque_payments" action="view"><ChequePaymentsPage /></ProtectedRoute>} />
      <Route path="payment-methods/credit-notes" element={<ProtectedRoute resource="credit_notes" action="view"><CreditNotesPage /></ProtectedRoute>} />
      {/* Legacy routes for backward compatibility */}
      <Route path="bank-deposits" element={<ProtectedRoute resource="bank_deposits" action="view"><BankDepositsPage /></ProtectedRoute>} />
      <Route path="card-payments" element={<ProtectedRoute resource="card_payments" action="view"><CardPaymentsPage /></ProtectedRoute>} />
      <Route path="cheque-payments" element={<ProtectedRoute resource="cheque_payments" action="view"><ChequePaymentsPage /></ProtectedRoute>} />
      <Route path="credit-notes" element={<ProtectedRoute resource="credit_notes" action="view"><CreditNotesPage /></ProtectedRoute>} />
      {/* Advance Payments - parent and sub-routes */}
      <Route path="advance-payments" element={<AdvancePaymentsPage />} />
      <Route path="advance-payments/customer" element={<ProtectedRoute resource="customer_advances" action="view"><CustomerAdvancePaymentsPage /></ProtectedRoute>} />
      <Route path="advance-payments/supplier" element={<ProtectedRoute resource="supplier_advances" action="view"><SupplierAdvancePaymentsPage /></ProtectedRoute>} />
      {/* Approvals - parent and sub-routes */}
      <Route path="approvals" element={<ApprovalsPage />} />
      <Route path="approvals/payment-approvals" element={<ProtectedRoute resource="payment_approvals" action="view"><PaymentApprovalsPage /></ProtectedRoute>} />
      <Route path="approvals/expense-approvals" element={<ProtectedRoute resource="expense_approvals" action="view"><ExpenseApprovalsPage /></ProtectedRoute>} />
      <Route path="approvals/bank-transfer-verify" element={<ProtectedRoute resource="bank_transfer_verify" action="view"><BankTransferVerifyPage /></ProtectedRoute>} />
      <Route path="approvals/commission-payment-approvals" element={<ProtectedRoute resource="commission_payment_approvals" action="view"><CommissionPaymentApprovalsPage /></ProtectedRoute>} />
      {/* Legacy routes for backward compatibility */}
      <Route path="bank-transfer-verify" element={<ProtectedRoute resource="bank_transfer_verify" action="view"><BankTransferVerifyPage /></ProtectedRoute>} />
      <Route path="payment-approvals" element={<ProtectedRoute resource="payment_approvals" action="view"><PaymentApprovalsPage /></ProtectedRoute>} />
      {/* Commission Payments */}
      <Route path="commission-payments" element={<ProtectedRoute resource="commission_payments" action="view"><CommissionPaymentsPage /></ProtectedRoute>} />
      <Route path="commission-payment-approvals" element={<ProtectedRoute resource="commission_payment_approvals" action="view"><CommissionPaymentApprovalsPage /></ProtectedRoute>} />
      {/* Other finance routes */}
      <Route path="supplier-payments" element={<ProtectedRoute resource="supplier_payments" action="view"><SupplierPaymentsPage /></ProtectedRoute>} />
      <Route path="supplier-payments/report" element={<ProtectedRoute resource="supplier_payments" action="view"><SupplierPaymentReportPage /></ProtectedRoute>} />
      <Route path="customer-payments" element={<ProtectedRoute resource="customer_payments" action="view"><CustomerPaymentsPage /></ProtectedRoute>} />
      <Route path="customer-payments/report" element={<ProtectedRoute resource="customer_payments" action="view"><CustomerPaymentReportPage /></ProtectedRoute>} />
      {/* Accounting routes */}
      <Route path="chart-of-accounts" element={<ProtectedRoute resource="chart_of_accounts" action="view"><ChartOfAccountsPage /></ProtectedRoute>} />
      <Route path="journal-entries" element={<ProtectedRoute resource="journal_entries" action="view"><JournalEntriesPage /></ProtectedRoute>} />
      <Route path="general-ledger" element={<ProtectedRoute resource="general_ledger" action="view"><GeneralLedgerPage /></ProtectedRoute>} />
      <Route path="accounting-periods" element={<ProtectedRoute resource="accounting_periods" action="view"><AccountingPeriodsPage /></ProtectedRoute>} />
      <Route path="cash-flow" element={<ProtectedRoute resource="cash_flow" action="view"><CashFlowStatementsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}
