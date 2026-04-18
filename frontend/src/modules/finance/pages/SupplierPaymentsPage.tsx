/**
 * SupplierPaymentsPage - Unified Supplier Payments (ERP Best Practice)
 * 
 * Following standard ERP patterns (SAP, Oracle, Odoo, ERPNext), this unified page handles:
 * - Credit settlements (pay against credit terms)
 * - Non-credit payments (Cash, Bank Transfer, Cheque)
 * 
 * Features:
 * - Tab-based filtering by payment type (All, Credit, Non-Credit)
 * - Single/Multiple document selection
 * - Partial payments
 * - FIFO auto-allocation
 * - Multiple payment methods
 * - Payment history tracking
 * 
 * Workflow:
 * 1. Select supplier → View all outstanding documents
 * 2. Filter by payment type (optional)
 * 3. Select document(s) to pay
 * 4. Enter payment details
 * 5. Review and post payment
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "react-router-dom";
import {
  Box,
  TextField,
  MenuItem,
  Alert,
  CircularProgress,
  Chip,
  Typography,
  Paper,
  Divider,
  Button,
  Card,
  CardContent,
  Grid,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  InputAdornment,
  Stepper,
  Step,
  StepLabel,
  IconButton,
  Tabs,
  Tab,
  FormControlLabel,
  Switch,
  Autocomplete,
} from "@mui/material";
import PaymentIcon from "@mui/icons-material/Payment";
import BusinessIcon from "@mui/icons-material/Business";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import DescriptionIcon from "@mui/icons-material/Description";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import SearchIcon from "@mui/icons-material/Search";
import WarningIcon from "@mui/icons-material/Warning";
import AssessmentIcon from "@mui/icons-material/Assessment";
import PrintIcon from "@mui/icons-material/Print";
import { 
  handleApiError,
  showErrorToast,
  showSuccessToast,
  TConfirmDialog,
  useConfirmDialog,
  fmtLKR,
} from "@/components/tijaero";

import {
  MasterDetailLayout,
  SearchableList,
  SelectableListItem,
  DetailPanelHeader,
  ActionToolbar,
  FormSection,
  EmptyState,
  modernTableStyles,
  TFilterPanel,
} from "@/components/tijaero";

import {
  suppliersApi,
  supplierCreditsSettleApi,
  supplierCreditApi,
  supplierPaymentsApi,
  supplierAdvancePaymentsApi,
  SupplierPaymentStatusData,
} from "@/modules/purchasing/api";
import { useReferenceData } from "@/hooks";
import {
  Supplier,
  SupplierCreditsSettleCreate,
  SupplierCreditsSettleTransactionCreate,
  SupplierPaymentCreate,
  SupplierPayment,
  SupplierCreditsSettle,
  SupplierAdvancePaymentWithApplications,
} from "@/modules/purchasing/types";

// Configuration
interface SortOption {
  value: string;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { value: "full_name", label: "Name" },
  { value: "outstanding", label: "Outstanding" },
  { value: "max_credit_limit", label: "Credit Limit" },
];

const PAYMENT_METHODS = [
  { value: "Cash", label: "Cash" },
  { value: "Bank Transfer", label: "Bank Transfer" },
  { value: "Cheque", label: "Cheque" },
];

// Payment type tab
type PaymentTypeTab = "all" | "credit" | "non_credit";

// Outstanding document interface (unified view)
interface OutstandingDocument {
  id: number;
  po_id: number;
  po_no: string;
  invoice_no: string | null;
  date: string;
  due_date: string;
  status: string;
  payment_type: "credit" | "non_credit";
  payment_method?: string;
  total_amount: number;
  paid_amount: number;
  pending_payment_amount?: number;
  has_pending_payment?: boolean;
  supplier_advance_amount: number;
  remaining_amount: number;
  days_overdue: number;
  is_overdue: boolean;
  branch_code: string;
  has_grn?: boolean;
  grn_id?: number | null;
}

// Payment allocation line
interface PaymentLine {
  id: string;
  document: OutstandingDocument;
  allocated_amount: number;
}

// Steps in the workflow
const STEPS = ["Select Documents", "Payment Details", "Review & Post"];

type PaymentHistoryType = "credit_settlement" | "payment" | "advance_payment" | "advance_application";

// View mode enum
type ViewMode = "overview" | "documents" | "payment" | "review" | "history";

export default function SupplierPaymentsPage() {
  const location = useLocation();
  // Data state
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("full_name");

  // View state
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<SupplierPaymentStatusData | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [allPaymentStatuses, setAllPaymentStatuses] = useState<SupplierPaymentStatusData[]>([]);

  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [activeStep, setActiveStep] = useState(0);

  // Payment type filter
  const [paymentTypeTab, setPaymentTypeTab] = useState<PaymentTypeTab>("all");

  // Branch filter
  const { filteredBranches: branches = [] } = useReferenceData(["branches"]);
  const [selectedBranch, setSelectedBranch] = useState<string>("all");

  // Document search filter
  const [documentSearchQuery, setDocumentSearchQuery] = useState<string>("");

  // Document selection
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<number>>(new Set());
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);

  // Payment form
  const [paymentMethod, setPaymentMethod] = useState("Bank Transfer");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [remarks, setRemarks] = useState("");

  // FIFO mode
  const [useFIFO, setUseFIFO] = useState(false);
  const [fifoAmount, setFifoAmount] = useState(0);

  // Payment history state
  const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);



  const confirmDialog = useConfirmDialog();

  const loadSuppliers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await suppliersApi.getAll({ active: true });
      setSuppliers(data);
      
      // Load payment statuses for all suppliers to enable PO search
      const statuses = await Promise.all(
        data.map(async (supplier) => {
          try {
            return await supplierCreditApi.getPaymentStatus(supplier.id);
          } catch (err) {
            return null;
          }
        })
      );
      setAllPaymentStatuses(statuses.filter(Boolean) as SupplierPaymentStatusData[]);
    } catch (err: unknown) {
      setError(handleApiError(err, "Failed to load suppliers"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load/refresh suppliers whenever this route is entered.
  useEffect(() => {
    loadSuppliers();
  }, [location.key, loadSuppliers]);

  // Load payment status for selected supplier
  const loadPaymentStatus = useCallback(async (supplierId: number) => {
    try {
      setLoadingStatus(true);
      const status = await supplierCreditApi.getPaymentStatus(supplierId);
      setPaymentStatus(status);
    } catch (err) {
      setPaymentStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  // Load payment history for selected supplier
  const loadPaymentHistory = useCallback(async (supplierId: number) => {
    try {
      setLoadingHistory(true);

      // Load settlements, direct payments, and supplier advances for unified history.
      const [creditSettlements, nonCreditPayments, supplierAdvances] = await Promise.all([
        supplierCreditsSettleApi.getBySupplier(supplierId).catch(() => []),
        supplierPaymentsApi.getAll({ supplier_id: supplierId }).catch(() => []),
        supplierAdvancePaymentsApi.getBySupplier(supplierId, { skip: 0, limit: 1000 }).catch(() => []),
      ]);

      // Fetch full details for each credit settlement to get transaction info
      const settlementsWithDetails = await Promise.all(
        (creditSettlements || []).map(async (s: SupplierCreditsSettle) => {
          try {
            const fullSettlement = await supplierCreditsSettleApi.getById(s.id);
            const totalAmount = fullSettlement.transactions?.reduce((sum, t) => sum + (t.payment_amount || 0), 0) || 0;
            const poNos = [...new Set(fullSettlement.transactions?.map(t => t.po_no).filter(Boolean))].join(", ");
            const paymentMethods = [...new Set(fullSettlement.transactions?.map(t => t.payment_method).filter(Boolean))].join(", ");

            return {
              type: "credit_settlement",
              id: s.id,
              settle_no: s.supplier_credits_settle_no,
              date: s.created_date,
              total_amount: totalAmount,
              po_no: poNos || undefined,
              payment_method: paymentMethods || undefined,
              transactions: fullSettlement.transactions || [],
              branch_code: s.branch_code,
              status: fullSettlement.status,
            };
          } catch (err) {
            return {
              type: "credit_settlement",
              id: s.id,
              settle_no: s.supplier_credits_settle_no,
              date: s.created_date,
              total_amount: 0,
              transactions: [],
              branch_code: s.branch_code,
              status: s.status || "pending",
            };
          }
        })
      );

      const advancesWithApplications = await Promise.all(
        (supplierAdvances || []).map(async (advance) => {
          try {
            return await supplierAdvancePaymentsApi.getById(advance.id);
          } catch {
            return {
              ...advance,
              applications: [],
            } as SupplierAdvancePaymentWithApplications;
          }
        })
      );

      const advancePayments = advancesWithApplications.map((a) => ({
        type: "advance_payment" as PaymentHistoryType,
        id: a.id,
        payment_no: a.advance_no,
        date: a.payment_date,
        amount: a.original_amount,
        payment_method: a.payment_method,
        reference_number: a.reference_number,
        bank_name: a.bank_name,
        invoice_reference: a.po_no,
        remarks: a.remarks,
        status: a.is_fully_applied ? "verified" : "pending",
        po_no: a.po_no,
        branch_code: a.branch_code,
      }));

      const advanceApplications = advancesWithApplications.flatMap((a) =>
        (a.applications || []).map((app) => ({
          type: "advance_application" as PaymentHistoryType,
          id: app.id,
          payment_no: app.advance_no ? `${app.advance_no}/APP` : `APP-${app.id}`,
          date: app.application_date,
          amount: app.applied_amount,
          payment_method: "Advance Apply",
          reference_number: app.grn_no,
          invoice_reference: app.grn_no,
          remarks: app.remarks || (app.grn_no ? `Applied to ${app.grn_no}` : "Advance applied to GRN"),
          status: "verified",
          po_no: a.po_no,
          branch_code: a.branch_code,
        }))
      );

      // Combine and sort by date
      const combined: any[] = [
        ...settlementsWithDetails,
        ...(nonCreditPayments || [])
          .filter((p: SupplierPayment) => p.status === "verified")
          .filter((p: SupplierPayment) => !(p.remarks || "").startsWith("Auto-recorded cash payment on GRN "))
          .map((p: SupplierPayment) => ({
          type: "payment",
          id: p.id,
          payment_no: p.payment_no,
          date: p.payment_date,
          amount: p.payment_amount,
          payment_method: p.payment_method,
          reference_number: p.reference_number,
          bank_name: p.bank_name,
          invoice_reference: p.invoice_reference,
          remarks: p.remarks,
          status: p.status,
          po_no: p.po_no,
          branch_code: p.branch_code,
        })),
        ...advancePayments,
        ...advanceApplications,
      ];

      combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setPaymentHistory(combined);
    } catch (err) {
      setPaymentHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const refreshSelectedSupplierData = useCallback(() => {
    if (!selectedSupplier?.id) return;
    loadPaymentStatus(selectedSupplier.id);
    if (viewMode === "history") {
      loadPaymentHistory(selectedSupplier.id);
    }
  }, [selectedSupplier?.id, viewMode, loadPaymentStatus, loadPaymentHistory]);

  // Refresh selected supplier data whenever user re-enters this page.
  useEffect(() => {
    refreshSelectedSupplierData();
  }, [location.key, refreshSelectedSupplierData]);

  // Refresh immediately when approval actions happen in Payment Approvals page.
  useEffect(() => {
    const handler = () => {
      loadSuppliers();
      refreshSelectedSupplierData();
    };

    window.addEventListener("supplier-payment-approval-updated", handler as EventListener);
    return () => {
      window.removeEventListener("supplier-payment-approval-updated", handler as EventListener);
    };
  }, [loadSuppliers, refreshSelectedSupplierData]);









  // Build purchase documents (GRN-gated for supplier payments)
  const purchaseDocuments = useMemo((): OutstandingDocument[] => {
    if (!paymentStatus) return [];

    const docs: OutstandingDocument[] = [];

    // Add credit purchase orders
    // Show only when GRN exists
    paymentStatus.credit_purchase_orders?.forEach((po) => {
      if (po.has_grn && po.grn_id && (po.status === "approved" || !po.is_settled) && po.remaining_amount > 0) {
        docs.push({
          id: po.po_id,
          po_id: po.po_id,
          po_no: po.po_no,
          invoice_no: po.invoice_no,
          date: po.po_date,
          due_date: po.due_date,
          status: po.status,
          payment_type: "credit",
          total_amount: po.total_amount,
          paid_amount: po.settled_amount,
          supplier_advance_amount: po.advance_applied || 0,
          remaining_amount: po.remaining_amount,
          days_overdue: po.days_overdue,
          is_overdue: po.is_overdue,
          branch_code: po.branch_code,
          has_grn: po.has_grn,
          grn_id: po.grn_id,
        });
      }
    });

    // Add non-credit purchase orders (show only when GRN exists)
    paymentStatus.non_credit_purchase_orders?.forEach((po) => {
      if (po.has_grn && po.grn_id && (po.status === "approved" || !po.is_paid) && po.remaining_amount > 0) {
        docs.push({
          id: po.po_id,
          po_id: po.po_id,
          po_no: po.po_no,
          invoice_no: po.invoice_no,
          date: po.po_date,
          due_date: po.due_date,
          status: po.status,
          payment_type: "non_credit",
          payment_method: po.payment_method,
          total_amount: po.total_amount,
          paid_amount: po.paid_amount,
          pending_payment_amount: po.pending_payment_amount || 0,
          has_pending_payment: !!po.has_pending_payment,
          supplier_advance_amount: po.advance_applied || 0,
          remaining_amount: po.remaining_amount,
          days_overdue: po.days_overdue,
          is_overdue: po.is_overdue,
          branch_code: po.branch_code,
          has_grn: po.has_grn,
          grn_id: po.grn_id,
        });
      }
    });

    return docs;
  }, [paymentStatus]);

  // Transform to current tab's document list
  const outstandingDocuments = useMemo((): OutstandingDocument[] => {
    const docs = [...purchaseDocuments];

    // Apply filters
    let filtered = docs;

    // Filter by payment type tab
    if (paymentTypeTab !== "all") {
      filtered = filtered.filter((d) => d.payment_type === paymentTypeTab);
    }

    // Filter by branch
    if (selectedBranch !== "all") {
      filtered = filtered.filter((d) => d.branch_code === selectedBranch);
    }

    // Filter by document search (PO number, invoice number)
    if (documentSearchQuery.trim()) {
      const query = documentSearchQuery.toLowerCase().trim();
      filtered = filtered.filter((d) => 
        d.po_no?.toLowerCase().includes(query) ||
        d.invoice_no?.toLowerCase().includes(query)
      );
    }

    // Sort by due date (oldest first)
    filtered.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

    return filtered;
  }, [purchaseDocuments, paymentTypeTab, selectedBranch, documentSearchQuery]);

  const creditPurchaseCount = useMemo(
    () => purchaseDocuments.filter((d) => d.payment_type === "credit").length,
    [purchaseDocuments]
  );

  const nonCreditPurchaseCount = useMemo(
    () => purchaseDocuments.filter((d) => d.payment_type === "non_credit").length,
    [purchaseDocuments]
  );

  // Calculate totals
  const totalOutstanding = useMemo(() => {
    return outstandingDocuments.reduce((sum, doc) => sum + doc.remaining_amount, 0);
  }, [outstandingDocuments]);

  const overdueDocuments = useMemo(() => {
    return outstandingDocuments.filter((doc) => doc.payment_type === "credit" && doc.is_overdue);
  }, [outstandingDocuments]);

  const showDueDateColumn = useMemo(
    () => outstandingDocuments.some((doc) => doc.payment_type === "credit"),
    [outstandingDocuments]
  );

  const isPendingVerificationDocument = useCallback((doc: OutstandingDocument): boolean => {
    if (doc.payment_type !== "non_credit") return false;
    return !!doc.has_pending_payment || (doc.pending_payment_amount || 0) > 0;
  }, []);

  const payableDocuments = useMemo(
    () => outstandingDocuments.filter((doc) => !isPendingVerificationDocument(doc)),
    [outstandingDocuments, isPendingVerificationDocument]
  );

  const selectedPayableCount = useMemo(
    () => payableDocuments.filter((d) => selectedDocumentIds.has(d.id)).length,
    [payableDocuments, selectedDocumentIds]
  );

  useEffect(() => {
    setSelectedDocumentIds((prev) => {
      const allowedIds = new Set(payableDocuments.map((d) => d.id));
      const pruned = new Set(Array.from(prev).filter((id) => allowedIds.has(id)));
      if (pruned.size === prev.size) return prev;
      return pruned;
    });
  }, [payableDocuments]);

  // Total amount to pay
  const totalPaymentAmount = useMemo(() => {
    return paymentLines.reduce((sum, line) => sum + line.allocated_amount, 0);
  }, [paymentLines]);

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    let filtered = suppliers;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((s) => {
        // Search by supplier name or company name
        const nameMatch = s.full_name.toLowerCase().includes(query) ||
          s.company_name?.toLowerCase().includes(query);
        
        // Search by PO number if payment status is available
        const poMatch = allPaymentStatuses.some(status => {
          if (status.supplier_id !== s.id) return false;
          
          const creditPOMatch = status.credit_purchase_orders?.some(
            po => po.po_no.toLowerCase().includes(query)
          );
          const nonCreditPOMatch = status.non_credit_purchase_orders?.some(
            po => po.po_no.toLowerCase().includes(query)
          );
          
          return creditPOMatch || nonCreditPOMatch;
        });
        
        return nameMatch || poMatch;
      });
    }

    filtered.sort((a, b) => {
      switch (sortField) {
        case "full_name":
          return a.full_name.localeCompare(b.full_name);
        case "outstanding":
          return (b.max_credit_limit - (b.left_credit_amount ?? b.max_credit_limit)) -
            (a.max_credit_limit - (a.left_credit_amount ?? a.max_credit_limit));
        case "max_credit_limit":
          return b.max_credit_limit - a.max_credit_limit;
        default:
          return 0;
      }
    });

    return filtered;
  }, [suppliers, searchQuery, sortField, allPaymentStatuses]);

  // Handlers
  const handleSelectSupplier = useCallback((supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setViewMode("overview");
    setActiveStep(0);
    setSelectedDocumentIds(new Set());
    setPaymentLines([]);
    setPaymentTypeTab("all");
    setUseFIFO(false);
    setFifoAmount(0);
    resetPaymentForm();
    // Clear previous supplier's data
    setPaymentHistory([]);
    // Load data for this supplier
    loadPaymentStatus(supplier.id);
  }, [loadPaymentStatus]);

  // Auto-select first supplier
  useEffect(() => {
    if (filteredSuppliers.length > 0 && !selectedSupplier && !loading) {
      const firstSupplier = filteredSuppliers[0];
      handleSelectSupplier(firstSupplier);
    }
  }, [filteredSuppliers.length, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload payment status when a supplier is selected (to get fresh data after navigation)
  useEffect(() => {
    if (selectedSupplier) {
      loadPaymentStatus(selectedSupplier.id);
    }
  }, [selectedSupplier?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetPaymentForm = () => {
    setPaymentMethod("Bank Transfer");
    setReferenceNumber("");
    setBankName("");
    setChequeDate(new Date().toISOString().split("T")[0]);
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setRemarks("");
  };

  const handleStartPayment = useCallback(() => {
    setViewMode("documents");
    setActiveStep(0);
  }, []);

  const handleSelectDocument = useCallback((doc: OutstandingDocument) => {
    if (isPendingVerificationDocument(doc)) {
      return;
    }
    setSelectedDocumentIds((prev) => {
      const next = new Set(prev);
      if (next.has(doc.id)) {
        next.delete(doc.id);
      } else {
        next.add(doc.id);
      }
      return next;
    });
  }, [isPendingVerificationDocument]);

  const handleSelectAll = useCallback(() => {
    if (selectedPayableCount === payableDocuments.length) {
      setSelectedDocumentIds(new Set());
    } else {
      setSelectedDocumentIds(new Set(payableDocuments.map((d) => d.id)));
    }
  }, [payableDocuments, selectedPayableCount]);

  const allocateFIFO = useCallback((amount: number): PaymentLine[] => {
    const lines: PaymentLine[] = [];
    let remaining = amount;

    for (const doc of outstandingDocuments) {
      if (remaining <= 0) break;
      if (isPendingVerificationDocument(doc)) continue;

      const allocate = Math.min(remaining, doc.remaining_amount);
      if (allocate > 0) {
        lines.push({
          id: `line-${lines.length}`,
          document: doc,
          allocated_amount: allocate,
        });
        remaining -= allocate;
      }
    }

    return lines;
  }, [outstandingDocuments, isPendingVerificationDocument]);

  const handleProceedToPayment = useCallback(async () => {
    if (!selectedSupplier) {
      showErrorToast("Please select a supplier first");
      return;
    }

    if (useFIFO) {
      // FIFO allocation
      if (fifoAmount <= 0) {
        showErrorToast("Please enter a payment amount for FIFO allocation");
        return;
      }
      const lines = allocateFIFO(fifoAmount);
      if (lines.length === 0) {
        showErrorToast("No documents available for allocation");
        return;
      }
      setPaymentLines(lines);
    } else {
      // Manual selection
      if (selectedPayableCount === 0) {
        showErrorToast("Please select at least one document");
        return;
      }
      const selectedDocs = outstandingDocuments.filter(
        (d) => selectedDocumentIds.has(d.id) && !isPendingVerificationDocument(d)
      );
      if (selectedDocs.length === 0) {
        showErrorToast("Pending verification documents cannot be paid");
        return;
      }
      const lines: PaymentLine[] = selectedDocs.map((doc, idx) => ({
        id: `line-${idx}`,
        document: doc,
        allocated_amount: doc.remaining_amount, // Default to full amount
      }));
      setPaymentLines(lines);
    }

    setViewMode("payment");
    setActiveStep(1);
  }, [
    useFIFO,
    fifoAmount,
    selectedDocumentIds,
    outstandingDocuments,
    allocateFIFO,
    selectedSupplier,
    selectedPayableCount,
    isPendingVerificationDocument,
  ]);

  const handleLineAmountChange = useCallback((lineId: string, amount: number) => {
    setPaymentLines((prev) =>
      prev.map((line) => {
        if (line.id === lineId) {
          const clampedAmount = Math.min(Math.max(0, amount), line.document.remaining_amount);
          return { ...line, allocated_amount: clampedAmount };
        }
        return line;
      })
    );
  }, []);

  const handleRemoveLine = useCallback((lineId: string) => {
    setPaymentLines((prev) => prev.filter((line) => line.id !== lineId));
  }, []);

  const handleProceedToReview = useCallback(() => {
    const hasPendingVerificationDoc = paymentLines.some((line) =>
      isPendingVerificationDocument(line.document)
    );
    if (hasPendingVerificationDoc) {
      showErrorToast("Pending verification documents cannot be paid");
      return;
    }

    if (totalPaymentAmount <= 0) {
      showErrorToast("Total payment amount must be greater than 0");
      return;
    }

    if (paymentMethod === "Bank Transfer" && !referenceNumber) {
      showErrorToast("Please enter bank transfer reference number");
      return;
    }
    if (paymentMethod === "Cheque" && (!referenceNumber || !bankName)) {
      showErrorToast("Please enter cheque number and bank name");
      return;
    }

    setViewMode("review");
    setActiveStep(2);
  }, [
    totalPaymentAmount,
    paymentMethod,
    referenceNumber,
    bankName,
    paymentLines,
    isPendingVerificationDocument,
  ]);

  const handlePostPayment = useCallback(async () => {
    if (!selectedSupplier || paymentLines.length === 0) return;

    const hasPendingVerificationDoc = paymentLines.some((line) =>
      isPendingVerificationDocument(line.document)
    );
    if (hasPendingVerificationDoc) {
      showErrorToast("Pending verification documents cannot be paid");
      return;
    }

    // Check if we have mixed payment types
    const paymentTypes = new Set(paymentLines.map((l) => l.document.payment_type));
    const hasCreditPayments = paymentTypes.has("credit");
    const hasNonCreditPayments = paymentTypes.has("non_credit");

    const confirmMessage = `Post payment of Rs. ${fmtLKR(totalPaymentAmount)} for ${selectedSupplier.full_name}?`;

    const confirmed = await confirmDialog.confirm({
      title: "Post Payment",
      message: confirmMessage + " This action cannot be undone.",
      confirmText: "Confirm",
    });

    if (!confirmed) return;

    try {
      setSaving(true);
      setError(null);

      // STEP 1: Process credit payments (use credit settlement API)
      if (hasCreditPayments) {
        const creditLines = paymentLines.filter((l) => l.document.payment_type === "credit" && l.allocated_amount > 0);

        for (const line of creditLines) {
          const transactionData: SupplierCreditsSettleTransactionCreate = {
            payment_method: paymentMethod,
            cheque_date: chequeDate,
            payment_amount: line.allocated_amount,
            payment_method_number: referenceNumber || undefined,
            remarks: remarks || undefined,
            good_received_id: line.document.grn_id as number,
          };

          const settlementData: SupplierCreditsSettleCreate = {
            supplier_credits_settle_no: `CS-${Date.now()}-${line.document.po_id}`,
            branch_code: line.document.branch_code,
            suppliers_id: selectedSupplier.id,
            transactions: [transactionData],
          };

          await supplierCreditsSettleApi.create(settlementData);
        }
      }

      // STEP 2: Process non-credit payments (use supplier payment API)
      if (hasNonCreditPayments) {
        const nonCreditLines = paymentLines.filter((l) => l.document.payment_type === "non_credit" && l.allocated_amount > 0);

        for (const line of nonCreditLines) {
          const payload: SupplierPaymentCreate = {
            supplier_id: selectedSupplier.id,
            purchasing_order_id: line.document.po_id,
            payment_date: paymentDate,
            payment_method: paymentMethod,
            payment_amount: line.allocated_amount,
            reference_number: referenceNumber || undefined,
            bank_name: bankName || undefined,
            branch_code: line.document.branch_code,
            payment_for: "Purchase",
            invoice_reference: line.document.invoice_no || line.document.po_no,
            remarks: remarks || undefined,
          };

          await supplierPaymentsApi.create(payload);
        }
      }

      showSuccessToast("Payment posted successfully!");

      // Refresh status and reset
      await loadPaymentStatus(selectedSupplier.id);
      setViewMode("overview");
      setActiveStep(0);
      setSelectedDocumentIds(new Set());
      setPaymentLines([]);
      resetPaymentForm();
    } catch (err: unknown) {
      const msg = handleApiError(err, "Failed to post payment");
      setError(msg);
      showErrorToast(msg);
    } finally {
      setSaving(false);
    }
  }, [
    selectedSupplier,
    paymentLines,
    totalPaymentAmount,
    paymentMethod,
    referenceNumber,
    bankName,
    chequeDate,
    paymentDate,
    remarks,
    confirmDialog,
    loadPaymentStatus,
    isPendingVerificationDocument,
  ]);

  const handleBack = useCallback(() => {
    switch (viewMode) {
      case "documents":
        setViewMode("overview");
        setActiveStep(0);
        break;
      case "payment":
        setViewMode("documents");
        setActiveStep(0);
        break;
      case "review":
        setViewMode("payment");
        setActiveStep(1);
        break;
      case "history":
        setViewMode("overview");
        break;
    }
  }, [viewMode]);

  const handleCancelPayment = useCallback(() => {
    setViewMode("overview");
    setActiveStep(0);
    setSelectedDocumentIds(new Set());
    setPaymentLines([]);
    resetPaymentForm();
  }, []);

  // Credit usage percentage
  const getCreditUsage = (supplier: Supplier) => {
    const available = supplier.left_credit_amount ?? supplier.max_credit_limit;
    const used = supplier.max_credit_limit - available;
    return supplier.max_credit_limit > 0 ? (used / supplier.max_credit_limit) * 100 : 0;
  };

  // Master Panel - Supplier list
  const masterPanel = (
    <SearchableList<Supplier>
      items={filteredSuppliers}
      isLoading={loading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      placeholder="Search suppliers..."
      sortOptions={SORT_OPTIONS}
      sortField={sortField}
      onSortChange={setSortField}
      selectedItem={selectedSupplier}
      onSelectItem={handleSelectSupplier}
      emptyMessage="No suppliers found"
      width={300}
      listHeader={
        <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="caption" color="text.secondary">
            {filteredSuppliers.length} suppliers
          </Typography>
        </Box>
      }
      renderItem={(supplier, isSelected) => {
        const usage = getCreditUsage(supplier);
        const outstanding = supplier.max_credit_limit - (supplier.left_credit_amount ?? supplier.max_credit_limit);
        return (
          <SelectableListItem
            key={supplier.id}
            id={supplier.id}
            isSelected={isSelected}
            onClick={() => handleSelectSupplier(supplier)}
            primaryText={
              <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 0.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{supplier.full_name}</span>
                </Box>
                {isSelected && (
                  <>
                    <Typography variant="caption" component="span">
                      {supplier.company_name || "Individual"}
                    </Typography>
                    {supplier.max_credit_limit > 0 && (
                      <>
                        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                          <Typography variant="caption">
                            Credit: {fmtLKR(supplier.left_credit_amount ?? supplier.max_credit_limit)} / {fmtLKR(supplier.max_credit_limit)}
                          </Typography>
                        </Box>
                        <Box sx={{ mt: 0.5, width: "100%", height: 4, bgcolor: "grey.200", borderRadius: 1 }}>
                          <Box
                            sx={{
                              width: `${Math.min(usage, 100)}%`,
                              height: "100%",
                              bgcolor: usage > 80 ? "error.main" : usage > 50 ? "warning.main" : "success.main",
                              borderRadius: 1,
                            }}
                          />
                        </Box>
                        <Chip
                          label={`${supplier.credit_days} days`}
                          size="small"
                          color="info"
                          sx={{ height: 18, fontSize: "0.65rem", mt: 0.5 }}
                        />
                      </>
                    )}
                    {outstanding > 0 && (
                      <Typography variant="caption" color="warning.main">
                        Outstanding: Rs. {fmtLKR(outstanding)}
                      </Typography>
                    )}
                  </>
                )}
              </Box>
            }
            secondaryText={
              !isSelected ? (
                <Box component="span">
                  <Typography variant="caption" display="block">
                    {supplier.company_name || "Individual"}
                  </Typography>
                  {supplier.max_credit_limit > 0 && (
                    <Box sx={{ mt: 0.5, width: "100%", height: 4, bgcolor: "grey.200", borderRadius: 1 }}>
                      <Box
                        sx={{
                          width: `${Math.min(usage, 100)}%`,
                          height: "100%",
                          bgcolor: usage > 80 ? "error.main" : usage > 50 ? "warning.main" : "success.main",
                          borderRadius: 1,
                        }}
                      />
                    </Box>
                  )}
                </Box>
              ) : undefined
            }
            statusChip={
              !isSelected && supplier.max_credit_limit > 0
                ? { label: `${supplier.credit_days}d`, color: "info" }
                : undefined
            }
          />
        );
      }}
    />
  );

  // Payment history filter state
  const [historyDateFrom, setHistoryDateFrom] = useState<string>(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 3); // Default to last 3 months
    return date.toISOString().split("T")[0];
  });
  const [historyDateTo, setHistoryDateTo] = useState<string>(new Date().toISOString().split("T")[0]);
  const [historyBranchFilter, setHistoryBranchFilter] = useState<string>("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>("all");

  // Filtered payment history based on selected filters
  const filteredPaymentHistory = useMemo(() => {
    return paymentHistory.filter((item) => {
      // Pending records should not appear in history.
      if ((item.status || "pending").toLowerCase() === "pending") return false;

      // Date filter
      const itemDate = new Date(item.date);
      const fromDate = historyDateFrom ? new Date(historyDateFrom) : null;
      const toDate = historyDateTo ? new Date(historyDateTo) : null;

      if (fromDate && itemDate < fromDate) return false;
      if (toDate) {
        const endOfDay = new Date(toDate);
        endOfDay.setHours(23, 59, 59, 999);
        if (itemDate > endOfDay) return false;
      }

      // Branch filter
      if (historyBranchFilter !== "all" && item.branch_code !== historyBranchFilter) return false;

      // Status filter
      if (historyStatusFilter !== "all" && item.status !== historyStatusFilter) return false;

      return true;
    });
  }, [paymentHistory, historyDateFrom, historyDateTo, historyBranchFilter, historyStatusFilter]);

  // Calculate summary statistics for payment history
  const historySummary = useMemo(() => {
    const summary = {
      totalCount: filteredPaymentHistory.length,
      totalAmount: 0,
      creditSettlements: { count: 0, amount: 0 },
      directPayments: { count: 0, amount: 0 },
      advancePayments: { count: 0, amount: 0 },
      advanceApplications: { count: 0, amount: 0 },
      byStatus: {
        pending: { count: 0, amount: 0 },
        verified: { count: 0, amount: 0 },
        cancelled: { count: 0, amount: 0 },
      },
      byMethod: {} as Record<string, { count: number; amount: number }>,
      byBranch: {} as Record<string, { count: number; amount: number }>,
    };

    filteredPaymentHistory.forEach((item) => {
      // Safely parse amounts - handle strings, null, undefined
      let amount = 0;
      if (item.type === "credit_settlement") {
        amount = Number(item.total_amount) || 0;
      } else {
        amount = Number(item.amount) || 0;
      }
      
      // Skip if amount is still NaN after parsing
      if (isNaN(amount)) {
        amount = 0;
      }
      
      summary.totalAmount += amount;

      if (item.type === "credit_settlement") {
        summary.creditSettlements.count++;
        summary.creditSettlements.amount += amount;
      } else if (item.type === "advance_payment") {
        summary.advancePayments.count++;
        summary.advancePayments.amount += amount;
      } else if (item.type === "advance_application") {
        summary.advanceApplications.count++;
        summary.advanceApplications.amount += amount;
      } else {
        summary.directPayments.count++;
        summary.directPayments.amount += amount;
      }

      // By status
      const status = item.status || "pending";
      if (summary.byStatus[status as keyof typeof summary.byStatus]) {
        summary.byStatus[status as keyof typeof summary.byStatus].count++;
        summary.byStatus[status as keyof typeof summary.byStatus].amount += amount;
      }

      // By payment method
      const method = item.payment_method || "Unknown";
      if (!summary.byMethod[method]) {
        summary.byMethod[method] = { count: 0, amount: 0 };
      }
      summary.byMethod[method].count++;
      summary.byMethod[method].amount += amount;

      // By branch
      const branch = item.branch_code || "Unknown";
      if (!summary.byBranch[branch]) {
        summary.byBranch[branch] = { count: 0, amount: 0 };
      }
      summary.byBranch[branch].count++;
      summary.byBranch[branch].amount += amount;
    });

    return summary;
  }, [filteredPaymentHistory]);

  const historyNonPendingCount = useMemo(() => {
    return paymentHistory.filter(
      (item) => (item.status || "pending").toLowerCase() !== "pending"
    ).length;
  }, [paymentHistory]);

  const hasHistoryFiltersApplied = useMemo(() => {
    const defaultFromDate = (() => {
      const date = new Date();
      date.setMonth(date.getMonth() - 3);
      return date.toISOString().split("T")[0];
    })();

    return (
      historyDateFrom !== defaultFromDate ||
      historyDateTo !== new Date().toISOString().split("T")[0] ||
      historyBranchFilter !== "all" ||
      historyStatusFilter !== "all"
    );
  }, [
    historyDateFrom,
    historyDateTo,
    historyBranchFilter,
    historyStatusFilter,
  ]);

  // Print payment history report
  const handlePrintPaymentHistory = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showErrorToast("Please allow popups to print the report");
      return;
    }

    const dateRangeText = historyDateFrom && historyDateTo
      ? `${new Date(historyDateFrom).toLocaleDateString()} to ${new Date(historyDateTo).toLocaleDateString()}`
      : "All Time";

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Supplier Payment History Report</title>
        <style>
          * { box-sizing: border-box; }
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            padding: 20px; 
            color: #333;
            max-width: 1100px;
            margin: 0 auto;
          }
          .header { 
            text-align: center; 
            margin-bottom: 30px; 
            border-bottom: 3px solid #1976d2;
            padding-bottom: 20px;
          }
          .header h1 { 
            margin: 0 0 5px 0; 
            color: #1976d2;
            font-size: 24px;
          }
          .header h2 { 
            margin: 0; 
            font-weight: normal;
            color: #666;
            font-size: 18px;
          }
          .header .date-range {
            margin-top: 10px;
            font-size: 14px;
            color: #888;
          }
          .summary-grid { 
            display: grid; 
            grid-template-columns: repeat(4, 1fr); 
            gap: 15px; 
            margin-bottom: 25px;
          }
          .summary-card { 
            background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%);
            padding: 15px; 
            border-radius: 8px; 
            text-align: center;
            border: 1px solid #ddd;
          }
          .summary-card.primary { 
            background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
            color: white; 
          }
          .summary-card.success { 
            background: linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%);
            color: white; 
          }
          .summary-card.warning { 
            background: linear-gradient(135deg, #ed6c02 0%, #e65100 100%);
            color: white; 
          }
          .summary-card.info { 
            background: linear-gradient(135deg, #0288d1 0%, #01579b 100%);
            color: white; 
          }
          .summary-card .label { 
            font-size: 11px; 
            text-transform: uppercase;
            letter-spacing: 0.5px;
            opacity: 0.9;
          }
          .summary-card .value { 
            font-size: 20px; 
            font-weight: bold;
            margin-top: 5px;
          }
          .summary-card .count {
            font-size: 12px;
            opacity: 0.8;
            margin-top: 3px;
          }
          .section { 
            margin-bottom: 25px; 
          }
          .section-title { 
            font-size: 14px; 
            font-weight: 600;
            color: #1976d2;
            margin-bottom: 10px;
            padding-bottom: 5px;
            border-bottom: 2px solid #e0e0e0;
          }
          .breakdown-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            margin-bottom: 25px;
          }
          .breakdown-section {
            background: #fafafa;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid #e0e0e0;
          }
          .breakdown-section h4 {
            margin: 0 0 10px 0;
            font-size: 13px;
            color: #555;
          }
          .breakdown-item {
            display: flex;
            justify-content: space-between;
            padding: 5px 0;
            border-bottom: 1px dotted #ddd;
            font-size: 12px;
          }
          .breakdown-item:last-child {
            border-bottom: none;
          }
          table { 
            width: 100%; 
            border-collapse: collapse; 
            font-size: 11px;
          }
          th, td { 
            border: 1px solid #ddd; 
            padding: 8px 10px; 
            text-align: left; 
          }
          th { 
            background: #1976d2; 
            color: white;
            font-weight: 600;
            text-transform: uppercase;
            font-size: 10px;
            letter-spacing: 0.5px;
          }
          tr:nth-child(even) { 
            background: #f9f9f9; 
          }
          tr:hover {
            background: #f0f7ff;
          }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 500;
          }
          .status-verified { background: #e8f5e9; color: #2e7d32; }
          .status-pending { background: #fff3e0; color: #e65100; }
          .status-cancelled { background: #ffebee; color: #c62828; }
          .type-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 500;
          }
          .type-credit { background: #e3f2fd; color: #1565c0; }
          .type-payment { background: #e8f5e9; color: #2e7d32; }
          .type-advance { background: #ede7f6; color: #5e35b1; }
          .type-application { background: #f3e5f5; color: #8e24aa; }
          .totals-row {
            background: #f5f5f5 !important;
            font-weight: bold;
          }
          .footer {
            margin-top: 30px;
            padding-top: 15px;
            border-top: 1px solid #ddd;
            font-size: 11px;
            color: #888;
            text-align: center;
          }
          @media print {
            body { padding: 10px; }
            .header { margin-bottom: 20px; }
            .summary-grid { gap: 10px; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Supplier Payment History Report</h1>
          <h2>${selectedSupplier?.full_name || "Unknown Supplier"}</h2>
          ${selectedSupplier?.company_name ? `<div style="color: #888; font-size: 14px;">${selectedSupplier.company_name}</div>` : ''}
          <div class="date-range">Report Period: ${dateRangeText}</div>
        </div>

        <div class="summary-grid">
          <div class="summary-card primary">
            <div class="label">Total Payments</div>
            <div class="value">Rs. ${fmtLKR(historySummary.totalAmount)}</div>
            <div class="count">${historySummary.totalCount} Transaction${historySummary.totalCount !== 1 ? 's' : ''}</div>
          </div>
          <div class="summary-card success">
            <div class="label">Verified</div>
            <div class="value">Rs. ${fmtLKR(historySummary.byStatus.verified.amount)}</div>
            <div class="count">${historySummary.byStatus.verified.count} Transaction${historySummary.byStatus.verified.count !== 1 ? 's' : ''}</div>
          </div>
          <div class="summary-card warning">
            <div class="label">Pending</div>
            <div class="value">Rs. ${fmtLKR(historySummary.byStatus.pending.amount)}</div>
            <div class="count">${historySummary.byStatus.pending.count} Transaction${historySummary.byStatus.pending.count !== 1 ? 's' : ''}</div>
          </div>
          <div class="summary-card info">
            <div class="label">Credit Settlements</div>
            <div class="value">Rs. ${fmtLKR(historySummary.creditSettlements.amount)}</div>
            <div class="count">${historySummary.creditSettlements.count} Settlement${historySummary.creditSettlements.count !== 1 ? 's' : ''}</div>
          </div>
        </div>

        <div class="breakdown-grid">
          <div class="breakdown-section">
            <h4>By Payment Method</h4>
            ${Object.entries(historySummary.byMethod).map(([method, data]) => `
              <div class="breakdown-item">
                <span>${method}</span>
                <span><strong>Rs. ${fmtLKR(data.amount)}</strong> (${data.count})</span>
              </div>
            `).join('')}
          </div>
          <div class="breakdown-section">
            <h4>By Branch</h4>
            ${Object.entries(historySummary.byBranch).map(([branch, data]) => `
              <div class="breakdown-item">
                <span>${branch}</span>
                <span><strong>Rs. ${fmtLKR(data.amount)}</strong> (${data.count})</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="section">
          <div class="section-title">Payment Details</div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Document No.</th>
                <th>PO/Invoice</th>
                <th>Payment Method</th>
                <th>Reference</th>
                <th class="text-right">Amount (Rs.)</th>
                <th class="text-center">Status</th>
                <th>Branch</th>
              </tr>
            </thead>
            <tbody>
              ${filteredPaymentHistory.map((item) => `
                <tr>
                  <td>${new Date(item.date).toLocaleDateString()}</td>
                  <td>
                    <span class="type-badge ${
                      item.type === 'credit_settlement'
                        ? 'type-credit'
                        : item.type === 'advance_payment'
                          ? 'type-advance'
                          : item.type === 'advance_application'
                            ? 'type-application'
                            : 'type-payment'
                    }">
                      ${
                        item.type === 'credit_settlement'
                          ? 'Credit Settlement'
                          : item.type === 'advance_payment'
                            ? 'Advance Payment'
                            : item.type === 'advance_application'
                              ? 'Advance Application'
                              : 'Payment'
                      }
                    </span>
                  </td>
                  <td>${item.type === 'credit_settlement' ? item.settle_no || '-' : item.payment_no || '-'}</td>
                  <td>${item.po_no || item.invoice_reference || '-'}</td>
                  <td>${item.payment_method || '-'}</td>
                  <td>${item.reference_number || item.payment_method_number || '-'}</td>
                  <td class="text-right"><strong>${item.type === 'credit_settlement'
        ? (item.total_amount > 0 ? fmtLKR(item.total_amount) : '-')
        : fmtLKR(item.amount)}</strong></td>
                  <td class="text-center">
                    <span class="status-badge status-${item.status || 'pending'}">
                      ${(item.status || 'pending').toUpperCase()}
                    </span>
                  </td>
                  <td>${item.branch_code || '-'}</td>
                </tr>
              `).join('')}
              <tr class="totals-row">
                <td colspan="6" style="text-align: right;">TOTAL:</td>
                <td class="text-right">Rs. ${fmtLKR(historySummary.totalAmount)}</td>
                <td colspan="2"></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="footer">
          <p>Generated on ${new Date().toLocaleString()} | Tijaero ERP System</p>
          <p>This is a computer-generated report.</p>
        </div>

        <script>
          window.onload = function() { window.print(); }
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  // Render payment history
  const renderHistory = () => (
    <Box sx={{ p: 2 }}>
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 2,
          borderRadius: 2,
          border: "1px solid",
          borderColor: "divider",
          background: "linear-gradient(180deg, rgba(25,118,210,0.06) 0%, rgba(25,118,210,0.01) 100%)",
        }}
      >
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1.5 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Payment History
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Unified history of direct payments, credit settlements, advances, and applications
            </Typography>
          </Box>

          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<ArrowBackIcon />}
              onClick={() => setViewMode("overview")}
            >
              Back
            </Button>
            <Button
              variant="contained"
              color="primary"
              size="small"
              startIcon={<PrintIcon />}
              onClick={handlePrintPaymentHistory}
              disabled={filteredPaymentHistory.length === 0}
            >
              Print Report
            </Button>
          </Box>
        </Box>
      </Paper>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ py: 1.75 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4 }}>
                Total Amount
              </Typography>
              <Typography variant="h5" fontWeight={700} color="primary.main" sx={{ mt: 0.5 }}>
                Rs. {fmtLKR(historySummary.totalAmount)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {historySummary.totalCount} record{historySummary.totalCount !== 1 ? "s" : ""}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ py: 1.75 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4 }}>
                Verified
              </Typography>
              <Typography variant="h6" fontWeight={700} color="success.main" sx={{ mt: 0.5 }}>
                Rs. {fmtLKR(historySummary.byStatus.verified.amount)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {historySummary.byStatus.verified.count} transaction{historySummary.byStatus.verified.count !== 1 ? "s" : ""}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ py: 1.75 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4 }}>
                Pending
              </Typography>
              <Typography variant="h6" fontWeight={700} color="warning.main" sx={{ mt: 0.5 }}>
                Rs. {fmtLKR(historySummary.byStatus.pending.amount)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {historySummary.byStatus.pending.count} transaction{historySummary.byStatus.pending.count !== 1 ? "s" : ""}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ py: 1.75 }}>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.4 }}>
                Credit Settlements
              </Typography>
              <Typography variant="h6" fontWeight={700} color="info.main" sx={{ mt: 0.5 }}>
                Rs. {fmtLKR(historySummary.creditSettlements.amount)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {historySummary.creditSettlements.count} settlement{historySummary.creditSettlements.count !== 1 ? "s" : ""}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5, flexWrap: "wrap", gap: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Filters
          </Typography>
          <Button
            size="small"
            variant="text"
            disabled={!hasHistoryFiltersApplied}
            onClick={() => {
              const date = new Date();
              date.setMonth(date.getMonth() - 3);
              setHistoryDateFrom(date.toISOString().split("T")[0]);
              setHistoryDateTo(new Date().toISOString().split("T")[0]);
              setHistoryBranchFilter("all");
              setHistoryStatusFilter("all");
            }}
          >
            Reset Filters
          </Button>
        </Box>

        <Box
          sx={{
            display: "flex",
            alignItems: "flex-start",
            gap: 1.5,
            flexWrap: "nowrap",
            overflowX: "auto",
            overflowY: "visible",
            pt: 0.75,
            pb: 0.5,
            "& .MuiTextField-root": {
              minWidth: 170,
              flex: "0 0 170px",
            },
          }}
        >
          <TextField
            size="small"
            label="Date From"
            type="date"
            value={historyDateFrom}
            onChange={(e) => setHistoryDateFrom(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="small"
            label="Date To"
            type="date"
            value={historyDateTo}
            onChange={(e) => setHistoryDateTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            select
            size="small"
            label="Branch"
            value={historyBranchFilter}
            onChange={(e) => setHistoryBranchFilter(e.target.value)}
          >
            <MenuItem value="all">All Branches</MenuItem>
            {branches.map((b) => (
              <MenuItem key={b.branch_code} value={b.branch_code}>
                {b.branch_name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Status"
            value={historyStatusFilter}
            onChange={(e) => setHistoryStatusFilter(e.target.value)}
          >
            <MenuItem value="all">All Status</MenuItem>
            <MenuItem value="verified">Verified</MenuItem>
            <MenuItem value="cancelled">Cancelled</MenuItem>
          </TextField>
        </Box>
      </Paper>

      {loadingHistory ? (
        <Paper variant="outlined" sx={{ p: 4, borderRadius: 2, textAlign: "center" }}>
          <CircularProgress size={28} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            Loading payment history...
          </Typography>
        </Paper>
      ) : filteredPaymentHistory.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, borderRadius: 2, textAlign: "center" }}>
          <Typography variant="body1" sx={{ mb: 0.5, fontWeight: 600 }}>
            No payment history records found
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {paymentHistory.length > 0
              ? "Try changing filters or date range to view more records."
              : "No payment activity has been recorded for this supplier yet."}
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
          <TableContainer sx={{ maxHeight: 540 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow sx={modernTableStyles.headerRow}>
                  <TableCell>Date</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Document</TableCell>
                  <TableCell>PO/Invoice</TableCell>
                  <TableCell>Method</TableCell>
                  <TableCell>Reference</TableCell>
                  <TableCell align="right">Amount (Rs.)</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Branch</TableCell>
                  <TableCell>Remarks</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredPaymentHistory.map((item, index) => (
                  <TableRow
                    key={`${item.type}-${item.id}-${index}`}
                    hover
                    sx={{
                      "&:nth-of-type(odd)": { bgcolor: "grey.50" },
                      "& td": { borderColor: "divider" },
                    }}
                  >
                    <TableCell>{new Date(item.date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Chip
                        label={
                          item.type === "credit_settlement"
                            ? "Credit Settlement"
                            : item.type === "advance_payment"
                              ? "Advance Payment"
                              : item.type === "advance_application"
                                ? "Advance Application"
                                : "Direct Payment"
                        }
                        size="small"
                        color={
                          item.type === "credit_settlement"
                            ? "info"
                            : item.type === "advance_application"
                              ? "secondary"
                              : "success"
                        }
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {item.type === "credit_settlement" ? item.settle_no : item.payment_no}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {item.type === "credit_settlement"
                        ? item.po_no || "-"
                        : item.po_no || item.invoice_reference || "-"}
                    </TableCell>
                    <TableCell>{item.payment_method || "-"}</TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={item.reference_number || item.payment_method_number || "-"}
                      >
                        {item.reference_number || item.payment_method_number || "-"}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={700} color="primary.main">
                        {item.type === "credit_settlement"
                          ? (item.total_amount > 0 ? fmtLKR(item.total_amount) : "-")
                          : fmtLKR(item.amount)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={(item.status || "pending").toUpperCase()}
                        size="small"
                        color={
                          item.status === "verified"
                            ? "success"
                            : item.status === "cancelled"
                              ? "error"
                              : "warning"
                        }
                      />
                    </TableCell>
                    <TableCell>{item.branch_code || "-"}</TableCell>
                    <TableCell>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ maxWidth: 180, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={item.remarks || "-"}
                      >
                        {item.remarks || "-"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Box
            sx={{
              px: 2,
              py: 1.25,
              borderTop: "1px solid",
              borderColor: "divider",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              bgcolor: "grey.50",
              flexWrap: "wrap",
              gap: 1,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              Showing {filteredPaymentHistory.length} of {historyNonPendingCount} record{historyNonPendingCount !== 1 ? "s" : ""}
            </Typography>
            <Typography variant="subtitle1" color="primary.main" sx={{ fontWeight: 700 }}>
              Total: Rs. {fmtLKR(historySummary.totalAmount)}
            </Typography>
          </Box>
        </Paper>
      )}
    </Box>
  );

  // Render overview (supplier info + outstanding summary)
  const renderOverview = () => (
    <Box sx={{ p: 2 }}>
      {/* Supplier Info Card */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
          <BusinessIcon sx={{ fontSize: 40, color: "primary.main" }} />
          <Box>
            <Typography variant="h5">{selectedSupplier?.full_name}</Typography>
            {selectedSupplier?.company_name && (
              <Typography variant="body2" color="text.secondary">
                {selectedSupplier.company_name}
              </Typography>
            )}
          </Box>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Credit Information */}
        {selectedSupplier && selectedSupplier.max_credit_limit > 0 && (
          <>
            <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CreditCardIcon fontSize="small" />
              Credit Information
            </Typography>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Credit Days</Typography>
                    <Typography variant="h5" color="primary.main">
                      {selectedSupplier?.credit_days || 0}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Credit Limit</Typography>
                    <Typography variant="h6">
                      Rs. {fmtLKR(selectedSupplier?.max_credit_limit || 0)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined">
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Available</Typography>
                    <Typography variant="h6" color="success.main">
                      Rs. {fmtLKR(paymentStatus?.left_credit_amount || 0)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined" sx={{ bgcolor: "warning.light" }}>
                  <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                    <Typography variant="caption">Credit Outstanding</Typography>
                    <Typography variant="h6" color="warning.dark">
                      Rs. {fmtLKR(paymentStatus?.credit_outstanding || 0)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />
          </>
        )}

        {/* Outstanding Summary */}
        <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AccountBalanceIcon fontSize="small" />
          Outstanding Summary
        </Typography>

        {loadingStatus ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined">
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Open Documents</Typography>
                  <Typography variant="h5" color="primary.main">
                    {outstandingDocuments.length}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ bgcolor: "warning.light" }}>
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Total Outstanding</Typography>
                  <Typography variant="h6" color="warning.dark">
                    Rs. {fmtLKR(totalOutstanding)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ bgcolor: overdueDocuments.length > 0 ? "error.light" : "success.light" }}>
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Overdue Documents</Typography>
                  <Typography variant="h5" color={overdueDocuments.length > 0 ? "error.dark" : "success.dark"}>
                    {overdueDocuments.length}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card variant="outlined" sx={{ bgcolor: overdueDocuments.length > 0 ? "error.light" : "transparent" }}>
                <CardContent sx={{ textAlign: "center", py: 1.5 }}>
                  <Typography variant="caption">Overdue Amount</Typography>
                  <Typography variant="h6" color={overdueDocuments.length > 0 ? "error.dark" : "text.secondary"}>
                    Rs. {fmtLKR(overdueDocuments.reduce((sum, d) => sum + d.remaining_amount, 0))}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
      </Paper>

      {/* Outstanding Documents Preview */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <DescriptionIcon fontSize="small" />
          Outstanding Documents
        </Typography>

        {/* Filters Section */}
        <TFilterPanel>
          {/* PO/Document Search */}
          <TextField
            placeholder="Search PO, Invoice..."
            size="small"
            value={documentSearchQuery}
            onChange={(e) => setDocumentSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 250 }}
          />
          
          {/* Branch Filter */}
          <Autocomplete
            options={[{ branch_code: "all", branch_name: "All Branches" }, ...branches]}
            getOptionLabel={(option) =>
              option.branch_code === "all"
                ? option.branch_name
                : `${option.branch_name} (${option.branch_code})`
            }
            value={branches.find(b => b.branch_code === selectedBranch) || { branch_code: "all", branch_name: "All Branches" }}
            onChange={(_, newValue) => setSelectedBranch(newValue?.branch_code || "all")}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Filter by Branch"
                size="small"
              />
            )}
            sx={{ minWidth: 200 }}
            disableClearable
          />
        </TFilterPanel>

        {/* Payment Type Tabs */}
        <Tabs
          value={paymentTypeTab}
          onChange={(_, v) => setPaymentTypeTab(v)}
          sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
        >
          <Tab label={`All (${purchaseDocuments.length})`} value="all" />
          <Tab
            label={`Credit (${creditPurchaseCount})`}
            value="credit"
            icon={<CreditCardIcon sx={{ fontSize: 16 }} />}
            iconPosition="start"
          />
          <Tab
            label={`Non-Credit (${nonCreditPurchaseCount})`}
            value="non_credit"
            icon={<AccountBalanceWalletIcon sx={{ fontSize: 16 }} />}
            iconPosition="start"
          />
        </Tabs>

        <Divider />

        {outstandingDocuments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
            No outstanding documents for this supplier
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 350 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Document</TableCell>
                  <TableCell>Date</TableCell>
                  {showDueDateColumn && <TableCell>Due Date</TableCell>}
                  <TableCell align="right">Amount (Rs.)</TableCell>
                  <TableCell align="right">Paid (Rs.)</TableCell>
                  <TableCell align="right">Supplier Advance (Rs.)</TableCell>
                  <TableCell align="right">Outstanding (Rs.)</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {outstandingDocuments.map((doc) => (
                  <TableRow key={`${doc.payment_type}-${doc.id}`} hover>
                    <TableCell>
                      <Chip
                        label={doc.payment_type === "credit" ? "Credit" : doc.payment_method || "Cash"}
                        size="small"
                        color={doc.payment_type === "credit" ? "info" : "default"}
                        sx={{ minWidth: 70 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Box>
                        <Typography variant="body2">{doc.po_no}</Typography>
                        {doc.invoice_no && (
                          <Typography variant="caption" color="text.secondary">
                            Inv: {doc.invoice_no}
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell>{new Date(doc.date).toLocaleDateString()}</TableCell>
                    {showDueDateColumn && (
                      <TableCell>
                        {doc.payment_type === "credit" ? (
                          <Typography color={doc.is_overdue ? "error" : "text.primary"}>
                            {new Date(doc.due_date).toLocaleDateString()}
                          </Typography>
                        ) : (
                          <Typography color="text.secondary">-</Typography>
                        )}
                      </TableCell>
                    )}
                    <TableCell align="right">
                      {fmtLKR(doc.total_amount)}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2">
                        {fmtLKR(doc.paid_amount)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2">
                        {fmtLKR(doc.supplier_advance_amount || 0)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography color="warning.main" fontWeight="bold">
                        {fmtLKR(doc.remaining_amount)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {doc.payment_type === "credit" ? (
                        doc.is_overdue ? (
                          <Chip
                            label={`${doc.days_overdue}d overdue`}
                            size="small"
                            color="error"
                            icon={<WarningIcon />}
                          />
                        ) : (
                          <Chip label="Due" size="small" color="warning" />
                        )
                      ) : (doc.has_pending_payment || (doc.pending_payment_amount || 0) > 0) ? (
                        <Chip
                          label="Pending Verification"
                          size="small"
                          color="info"
                        />
                      ) : (
                        <Chip
                          label={doc.remaining_amount <= 0 ? "Paid" : "Unpaid"}
                          size="small"
                          color={doc.remaining_amount <= 0 ? "success" : "warning"}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );

  // Render document selection view (Step 1)
  const renderDocumentsView = () => (
    <Box sx={{ p: 2 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
        Back to Overview
      </Button>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Select Documents to Pay
        </Typography>

        {/* Branch Filter */}
        <Autocomplete
          options={[{ branch_code: "all", branch_name: "All Branches" }, ...branches]}
          getOptionLabel={(option) =>
            option.branch_code === "all"
              ? option.branch_name
              : `${option.branch_name} (${option.branch_code})`
          }
          value={branches.find(b => b.branch_code === selectedBranch) || { branch_code: "all", branch_name: "All Branches" }}
          onChange={(_, newValue) => {
            setSelectedBranch(newValue?.branch_code || "all");
            setSelectedDocumentIds(new Set());
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Filter by Branch"
              size="small"
            />
          )}
          sx={{ minWidth: 200, mb: 2 }}
          disableClearable
        />

        {/* Payment Type Tabs */}
        <Tabs
          value={paymentTypeTab}
          onChange={(_, v) => {
            setPaymentTypeTab(v);
            setSelectedDocumentIds(new Set());
          }}
          sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
        >
          <Tab label="All" value="all" />
          <Tab label="Credit" value="credit" icon={<CreditCardIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
          <Tab label="Non-Credit" value="non_credit" icon={<AccountBalanceWalletIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
        </Tabs>

        {/* FIFO Toggle */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={useFIFO}
                onChange={(e) => {
                  setUseFIFO(e.target.checked);
                  setSelectedDocumentIds(new Set());
                }}
              />
            }
            label="Use FIFO Allocation"
          />
          {useFIFO && (
            <TextField
              label="Payment Amount"
              type="number"
              size="small"
              value={fifoAmount}
              onChange={(e) => setFifoAmount(Number(e.target.value))}
              InputProps={{
                startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
              }}
              sx={{ width: 200 }}
            />
          )}
        </Box>

        <Divider sx={{ mb: 2 }} />

        {!useFIFO && (
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={selectedPayableCount === payableDocuments.length && payableDocuments.length > 0}
                  indeterminate={selectedPayableCount > 0 && selectedPayableCount < payableDocuments.length}
                  onChange={handleSelectAll}
                  disabled={payableDocuments.length === 0}
                />
              }
              label="Select All"
            />
            <Typography variant="body2" color="text.secondary">
              {selectedPayableCount} of {payableDocuments.length} selectable
            </Typography>
          </Box>
        )}

        {payableDocuments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No payable documents available. Pending verification documents are hidden from payment creation.
          </Typography>
        ) : (
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {!useFIFO && <TableCell padding="checkbox" />}
                  <TableCell>Type</TableCell>
                  <TableCell>Document</TableCell>
                  {showDueDateColumn && <TableCell>Due Date</TableCell>}
                  <TableCell align="right">Total</TableCell>
                  <TableCell align="right">Outstanding</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {payableDocuments.map((doc) => (
                  <TableRow
                    key={`${doc.payment_type}-${doc.id}`}
                    hover
                    selected={selectedDocumentIds.has(doc.id)}
                    onClick={() => !useFIFO && handleSelectDocument(doc)}
                    sx={{ cursor: useFIFO ? "default" : "pointer" }}
                  >
                    {!useFIFO && (
                      <TableCell padding="checkbox">
                        <Checkbox checked={selectedDocumentIds.has(doc.id)} />
                      </TableCell>
                    )}
                  <TableCell>
                    <Chip
                      label={doc.payment_type === "credit" ? "Credit" : doc.payment_method || "Cash"}
                      size="small"
                      color={doc.payment_type === "credit" ? "info" : "default"}
                    />
                  </TableCell>
                  <TableCell>
                    <Box>
                      <Typography variant="body2">{doc.po_no}</Typography>
                    </Box>
                  </TableCell>
                  {showDueDateColumn && (
                    <TableCell>
                      {doc.payment_type === "credit" ? (
                        <Typography color={doc.is_overdue ? "error" : "text.primary"}>
                          {new Date(doc.due_date).toLocaleDateString()}
                        </Typography>
                      ) : (
                        <Typography color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                  )}
                  <TableCell align="right">
                    <Typography variant="body2" color="text.secondary">
                      Rs. {fmtLKR(doc.remaining_amount)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography fontWeight="bold">
                      Rs. {fmtLKR(doc.remaining_amount)}
                    </Typography>
                  </TableCell>
                    <TableCell>
                      {doc.payment_type === "credit" ? (
                        doc.is_overdue ? (
                          <Chip label={`${doc.days_overdue}d overdue`} size="small" color="error" />
                        ) : (
                          <Chip label="Due" size="small" color="warning" />
                        )
                      ) : (
                        <Chip
                          label={doc.remaining_amount <= 0 ? "Paid" : "Unpaid"}
                          size="small"
                          color={doc.remaining_amount <= 0 ? "success" : "warning"}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* Summary */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle1">
            {useFIFO
              ? `FIFO Amount: Rs. ${fmtLKR(fifoAmount)}`
              : `Selected: ${selectedPayableCount} documents`}
          </Typography>
          <Typography variant="h6" color="primary.main">
            {useFIFO
              ? `Will allocate to ${allocateFIFO(fifoAmount).length} document(s)`
              : `Total: Rs. ${fmtLKR(payableDocuments
                .filter((d) => selectedDocumentIds.has(d.id))
                .reduce((sum, d) => sum + d.remaining_amount, 0))}`}
          </Typography>
        </Box>
      </Paper>

      {/* Actions */}
      <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
        <Button variant="outlined" onClick={handleCancelPayment}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleProceedToPayment}
          disabled={!useFIFO && selectedPayableCount === 0}
        >
          Continue to Payment
        </Button>
      </Box>
    </Box>
  );

  // Render payment details view (Step 2)
  const renderPaymentView = () => (
    <Box sx={{ p: 2 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
        Back to Document Selection
      </Button>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Payment Allocations */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Payment Allocations
        </Typography>
        
        <Divider sx={{ mb: 2 }} />

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Document</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Outstanding</TableCell>
                <TableCell align="right" sx={{ width: 150 }}>Payment Amount</TableCell>
                <TableCell sx={{ width: 50 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {paymentLines.map((line) => {
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <Typography variant="body2">{line.document.po_no}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={line.document.payment_type === "credit" ? "Credit" : line.document.payment_method || "Cash"}
                        size="small"
                        color={line.document.payment_type === "credit" ? "info" : "default"}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {fmtLKR(line.document.remaining_amount)}
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        type="number"
                        size="small"
                        value={line.allocated_amount}
                        onChange={(e) => handleLineAmountChange(line.id, Number(e.target.value))}
                        InputProps={{
                          startAdornment: <InputAdornment position="start">Rs.</InputAdornment>,
                        }}
                        inputProps={{
                          min: 0,
                          max: line.document.remaining_amount,
                          step: 0.01,
                        }}
                        sx={{ width: 130 }}
                      />
                    </TableCell>
                    <TableCell>
                      <IconButton size="small" color="error" onClick={() => handleRemoveLine(line.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* Totals Row */}
              <TableRow sx={{ bgcolor: "action.hover" }}>
                <TableCell colSpan={2} />
                <TableCell align="right">
                  <Typography variant="subtitle2" fontWeight="bold">Total:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="h6" fontWeight="bold" color="primary.main">
                    Rs. {fmtLKR(totalPaymentAmount)}
                  </Typography>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Payment Method */}
      <FormSection title="Payment Method" columns={2}>
        <TextField
          select
          label="Payment Method"
          size="small"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
        >
          {PAYMENT_METHODS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Payment Date"
          size="small"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label={paymentMethod === "Cheque" ? "Cheque Number" : "Reference Number"}
          size="small"
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
          required={paymentMethod !== "Cash"}
        />
        {paymentMethod === "Cheque" && (
          <>
            <TextField
              label="Bank Name"
              size="small"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              required
            />
            <TextField
              label="Cheque Date"
              size="small"
              type="date"
              value={chequeDate}
              onChange={(e) => setChequeDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </>
        )}
      </FormSection>

      <FormSection title="Remarks" columns={1}>
        <TextField
          label="Remarks"
          size="small"
          multiline
          rows={2}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </FormSection>

      {/* Actions */}
      <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
        <Button variant="outlined" onClick={handleCancelPayment}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleProceedToReview}>
          Review Payment
        </Button>
      </Box>
    </Box>
  );

  // Render review view (Step 3)
  const renderReviewView = () => (
    <Box sx={{ p: 2 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mb: 2 }}>
        Back to Payment Details
      </Button>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Supplier Info */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Payment Summary
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Supplier</Typography>
            <Typography variant="body1">{selectedSupplier?.full_name}</Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Payment Date</Typography>
            <Typography variant="body1">{new Date(paymentDate).toLocaleDateString()}</Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Payment Method</Typography>
            <Typography variant="body1">{paymentMethod}</Typography>
          </Grid>
          {referenceNumber && (
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Reference</Typography>
              <Typography variant="body1">{referenceNumber}</Typography>
            </Grid>
          )}
        </Grid>
      </Paper>

      {/* Payment Lines */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Documents Being Paid
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Document</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Outstanding (Rs.)</TableCell>
                <TableCell align="right">Payment (Rs.)</TableCell>
                <TableCell align="right">Remaining After (Rs.)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paymentLines.map((line) => {
                const remainingAfter = line.document.remaining_amount - line.allocated_amount;
                
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <Box>
                        <Typography variant="body2">{line.document.po_no}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={line.document.payment_type === "credit" ? "Credit" : line.document.payment_method || "Cash"}
                        size="small"
                        color={line.document.payment_type === "credit" ? "info" : "default"}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {fmtLKR(line.document.remaining_amount)}
                    </TableCell>
                    <TableCell align="right">
                      <Typography color="primary.main" fontWeight="bold">
                        {line.allocated_amount > 0 ? fmtLKR(line.allocated_amount) : "-"}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography color={remainingAfter > 0 ? "warning.main" : "success.main"}>
                        {fmtLKR(remainingAfter)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* Totals Row */}
              <TableRow sx={{ bgcolor: "action.hover" }}>
                <TableCell colSpan={2} />
                <TableCell align="right">
                  <Typography variant="subtitle2" fontWeight="bold">Total:</Typography>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="h5" fontWeight="bold" color="primary.main">
                    Rs. {fmtLKR(totalPaymentAmount)}
                  </Typography>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Warning */}
      <Alert severity="warning" sx={{ mb: 3 }}>
        <Typography variant="body2">
          <strong>Important:</strong> Once posted, this payment cannot be edited or deleted.
          Please review all details carefully before proceeding.
        </Typography>
      </Alert>

      {/* Actions */}
      <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
        <Button variant="outlined" onClick={handleCancelPayment}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="success"
          onClick={handlePostPayment}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : <CheckCircleIcon />}
          size="large"
        >
          {saving ? "Posting..." : "POST PAYMENT"}
        </Button>
      </Box>
    </Box>
  );

  // Detail Panel
  const detailPanel = (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <DetailPanelHeader
        breadcrumbs={[
          { label: "Purchasing", href: "/purchasing" },
          { label: "Supplier Payments", href: "/purchasing/payments" },
          ...(selectedSupplier ? [{ label: selectedSupplier.full_name }] : []),
          ...(viewMode === "history" ? [{ label: "Payment History" }]
              : viewMode !== "overview" ? [{ label: STEPS[activeStep] }] : []),
        ]}
        title={
          viewMode === "history"
            ? "Payment History"
            : viewMode === "review"
                ? "Review & Post"
                : viewMode === "payment"
                  ? "Payment Details"
                  : viewMode === "documents"
                    ? "Select Documents"
                    : selectedSupplier?.full_name || ""
        }
        titleIcon={
          viewMode === "history" ? (
            <AssessmentIcon color="info" />
          ) : viewMode === "review" ? (
            <CheckCircleIcon color="success" />
          ) : viewMode === "payment" || viewMode === "documents" ? (
            <PaymentIcon color="primary" />
          ) : (
            <BusinessIcon color="primary" />
          )
        }
        isCreating={false}
        noSelectionTitle="Select a Supplier"
        chips={
          viewMode === "history"
            ? [
              { label: `${historyNonPendingCount} Record${historyNonPendingCount !== 1 ? "s" : ""}`, color: "info" as const },
            ]
            : selectedSupplier && viewMode === "overview"
                ? [
                  { label: `${outstandingDocuments.length} Open Docs`, variant: "outlined" as const },
                  ...(totalOutstanding > 0
                    ? [{ label: `Rs. ${fmtLKR(totalOutstanding)} Outstanding`, color: "warning" as const }]
                    : []),
                ]
                : viewMode !== "overview"
                  ? [
                    { label: `Rs. ${fmtLKR(totalPaymentAmount)}`, color: "primary" as const },
                  ]
                  : []
        }
      />

      {/* Action Toolbar - contextual actions based on view mode */}
      {selectedSupplier && viewMode === "overview" && (
        <ActionToolbar
          hasSelectedItem={!!selectedSupplier}
          isCreating={false}
          isEditing={false}
          isSaving={saving}
          isFormValid={false}
          onNew={handleStartPayment}
          endActions={
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                color="info"
                startIcon={<AssessmentIcon />}
                onClick={() => {
                  setViewMode("history");
                  loadPaymentHistory(selectedSupplier!.id);
                }}
              >
                View History
              </Button>
            </Box>
          }
        />
      )}

      {/* Stepper for payment workflow */}
      {viewMode !== "overview" && viewMode !== "history" && (
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Stepper activeStep={activeStep} alternativeLabel>
            {STEPS.map((label, index) => (
              <Step key={label} completed={index < activeStep}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: "auto" }}>
        {!selectedSupplier ? (
          <Box sx={{ p: 2 }}>
            <EmptyState message="Select a supplier from the list to view outstanding documents and make payments" />
          </Box>
        ) : viewMode === "history" ? (
          renderHistory()
        ) : viewMode === "overview" ? (
          renderOverview()
        ) : viewMode === "documents" ? (
          renderDocumentsView()
        ) : viewMode === "payment" ? (
          renderPaymentView()
        ) : (
          renderReviewView()
        )}
      </Box>

      <TConfirmDialog {...confirmDialog.dialogProps} />
    </Box>
  );

  return (
    <MasterDetailLayout
      title="Supplier Payments"
      icon={<PaymentIcon />}
      onRefresh={loadSuppliers}
      masterPanel={masterPanel}
      detailPanel={detailPanel}
    />
  );
}
