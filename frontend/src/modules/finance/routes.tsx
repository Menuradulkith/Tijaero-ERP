import { Routes, Route } from "react-router-dom";
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

export default function FinanceRoutes() {
  return (
    <Routes>
      <Route index element={<FinanceDashboard />} />
      <Route path="cashbook" element={<CashbookPage />} />
      <Route path="expenses" element={<ExpensesPage />} />
      {/* Payment Methods - parent and sub-routes */}
      <Route path="payment-methods" element={<PaymentMethodsPage />} />
      <Route path="payment-methods/bank-deposits" element={<BankDepositsPage />} />
      <Route path="payment-methods/card-payments" element={<CardPaymentsPage />} />
      <Route path="payment-methods/cheque-payments" element={<ChequePaymentsPage />} />
      <Route path="payment-methods/credit-notes" element={<CreditNotesPage />} />
      {/* Legacy routes for backward compatibility */}
      <Route path="bank-deposits" element={<BankDepositsPage />} />
      <Route path="card-payments" element={<CardPaymentsPage />} />
      <Route path="cheque-payments" element={<ChequePaymentsPage />} />
      <Route path="credit-notes" element={<CreditNotesPage />} />
      {/* Advance Payments - parent and sub-routes */}
      <Route path="advance-payments" element={<AdvancePaymentsPage />} />
      <Route path="advance-payments/customer" element={<CustomerAdvancePaymentsPage />} />
      <Route path="advance-payments/supplier" element={<SupplierAdvancePaymentsPage />} />
      {/* Approvals - parent and sub-routes */}
      <Route path="approvals" element={<ApprovalsPage />} />
      <Route path="approvals/payment-approvals" element={<PaymentApprovalsPage />} />
      <Route path="approvals/expense-approvals" element={<ExpenseApprovalsPage />} />
      <Route path="approvals/bank-transfer-verify" element={<BankTransferVerifyPage />} />
      <Route path="approvals/commission-payment-approvals" element={<CommissionPaymentApprovalsPage />} />
      {/* Legacy routes for backward compatibility */}
      <Route path="bank-transfer-verify" element={<BankTransferVerifyPage />} />
      <Route path="payment-approvals" element={<PaymentApprovalsPage />} />
      {/* Commission Payments */}
      <Route path="commission-payments" element={<CommissionPaymentsPage />} />
      <Route path="commission-payment-approvals" element={<CommissionPaymentApprovalsPage />} />
      {/* Other finance routes */}
      <Route path="supplier-payments" element={<SupplierPaymentsPage />} />
      <Route path="customer-payments" element={<CustomerPaymentsPage />} />
      {/* Accounting routes */}
      <Route path="chart-of-accounts" element={<ChartOfAccountsPage />} />
      <Route path="journal-entries" element={<JournalEntriesPage />} />
      <Route path="general-ledger" element={<GeneralLedgerPage />} />
      <Route path="accounting-periods" element={<AccountingPeriodsPage />} />
      <Route path="cash-flow" element={<CashFlowStatementsPage />} />
    </Routes>
  );
}
