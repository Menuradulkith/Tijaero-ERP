import { Routes, Route } from "react-router-dom";
import FinanceDashboard from "./pages/FinanceDashboard";
import BankDepositsPage from "./pages/BankDepositsPage";
import CardPaymentsPage from "./pages/CardPaymentsPage";
import ChequePaymentsPage from "./pages/ChequePaymentsPage";
import ExpensesPage from "./pages/ExpensesPage";
import AdvancePaymentsPage from "./pages/AdvancePaymentsPage";
import CreditNotesPage from "./pages/CreditNotesPage";

export default function FinanceRoutes() {
  return (
    <Routes>
      <Route index element={<FinanceDashboard />} />
      <Route path="bank-deposits" element={<BankDepositsPage />} />
      <Route path="card-payments" element={<CardPaymentsPage />} />
      <Route path="cheque-payments" element={<ChequePaymentsPage />} />
      <Route path="expenses" element={<ExpensesPage />} />
      <Route path="advance-payments" element={<AdvancePaymentsPage />} />
      <Route path="credit-notes" element={<CreditNotesPage />} />
    </Routes>
  );
}
