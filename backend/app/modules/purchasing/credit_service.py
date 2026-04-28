from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from fastapi import HTTPException, status
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List, Optional, Dict, Any
from app.core import timezone as tz

from app.modules.purchasing.models import (
    Supplier,
    PurchasingOrder,
    SupplierCreditsSettle,
    SupplierCreditsSettleTransaction,
    SupplierPayment,
    SupplierAdvancePayment,
    SupplierAdvanceApplication,
    GoodReceivedNote,
    GoodReceivedItems
)
from app.modules.purchasing import schemas


class SupplierCreditService:

    
    def calculate_due_date(self, grn_date: date, credit_days: int) -> date:
        return grn_date + timedelta(days=credit_days)
    
    def get_grn_due_date(self, db: Session, grn_id: int) -> date:
        grn = db.query(GoodReceivedNote).filter(GoodReceivedNote.id == grn_id).first()
        if not grn:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GRN {grn_id} not found"
            )

        po = db.query(PurchasingOrder).filter(
            PurchasingOrder.id == grn.purchasingorders_id
        ).first()
        if not po:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Purchasing order not found for GRN {grn_id}"
            )
        
        supplier = db.query(Supplier).filter(Supplier.id == po.first_suppliers_id).first()
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier not found for GRN {grn_id}"
            )
        
        return self.calculate_due_date(grn.good_received_date, supplier.credit_days)
    
    def get_days_overdue(self, grn_date: date, credit_days: int) -> int:
        due_date = self.calculate_due_date(grn_date, credit_days)
        return (tz.today() - due_date).days
    
    
    def get_supplier_credit_status(self, db: Session, supplier_id: int, exclude_po_id: Optional[int] = None) -> Dict[str, Any]:

        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier {supplier_id} not found"
            )

        outstanding = self._calculate_outstanding_payable(db, supplier_id)
        pending_credits = self._calculate_pending_credits(db, supplier_id, exclude_po_id=exclude_po_id)
        total_exposure = float(outstanding) + float(pending_credits)
        
        overdue_grns = self._get_overdue_grns(db, supplier_id, supplier.credit_days)
        unpaid_grns = self._get_unpaid_grns(db, supplier_id, supplier.credit_days)
        credit_purchase_orders = self._get_credit_purchase_orders(db, supplier_id, supplier.credit_days)
        
        return {
            "supplier_id": supplier_id,
            "supplier_name": supplier.full_name,
            "company_name": supplier.company_name,
            "credit_days": supplier.credit_days,
            "max_credit_limit": supplier.max_credit_limit,
            "initial_credit_amount": supplier.initial_credit_amount or supplier.max_credit_limit,
            "left_credit_amount": supplier.left_credit_amount or (supplier.max_credit_limit - int(total_exposure)),
            "outstanding_payable": float(outstanding),
            "pending_credits": float(pending_credits),
            "total_exposure": total_exposure,
            "available_credit": max(0, supplier.max_credit_limit - total_exposure),
            "overdue_count": len(overdue_grns),
            "total_overdue_amount": sum(grn["remaining_amount"] for grn in overdue_grns),
            "overdue_grns": overdue_grns,
            "unpaid_grns": unpaid_grns,
            "credit_purchase_orders": credit_purchase_orders
        }
    
    def get_supplier_payment_status(self, db: Session, supplier_id: int) -> Dict[str, Any]:
        """
        Get complete payment status for a supplier - ALL outstanding documents.
        
        This is the unified API for the Supplier Payments page that shows
        both credit and non-credit POs in a single view.
        
        Returns:
            Dictionary with:
            - Supplier info and credit details
            - All outstanding purchase orders (both credit and non-credit)
            - Outstanding amounts by payment type
        """
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier {supplier_id} not found"
            )
        
        # Get credit purchase orders
        credit_pos = self._get_credit_purchase_orders(db, supplier_id, supplier.credit_days)
        
        # Get non-credit purchase orders
        non_credit_pos = self._get_non_credit_purchase_orders(db, supplier_id)
        
        # Calculate totals
        credit_outstanding = sum(po["remaining_amount"] for po in credit_pos if not po["is_settled"])
        non_credit_outstanding = sum(po["remaining_amount"] for po in non_credit_pos if not po["is_paid"])
        total_outstanding = credit_outstanding + non_credit_outstanding
        
        credit_overdue = [po for po in credit_pos if po["is_overdue"] and not po["is_settled"]]
        non_credit_overdue = [po for po in non_credit_pos if po["is_overdue"] and not po["is_paid"]]
        total_overdue = len(credit_overdue) + len(non_credit_overdue)
        total_overdue_amount = sum(po["remaining_amount"] for po in credit_overdue) + sum(po["remaining_amount"] for po in non_credit_overdue)
        
        # Combine all POs for unified view
        all_purchase_orders = []
        
        # Add credit POs with payment_type marker
        for po in credit_pos:
            if po["has_grn"] and not po["is_settled"]:
                all_purchase_orders.append({
                    **po,
                    "payment_type": "credit",
                    "paid_amount": po["settled_amount"],
                    "is_paid": po["is_settled"],
                })
        
        # Add non-credit POs with payment_type marker
        for po in non_credit_pos:
            if not po["is_paid"]:
                all_purchase_orders.append({
                    **po,
                    "payment_type": "non_credit",
                })
        
        # Sort by due date (oldest first)
        all_purchase_orders.sort(key=lambda x: x["due_date"])
        
        return {
            "supplier_id": supplier_id,
            "supplier_name": supplier.full_name,
            "company_name": supplier.company_name,
            "credit_days": supplier.credit_days,
            "max_credit_limit": supplier.max_credit_limit,
            "left_credit_amount": supplier.left_credit_amount or supplier.max_credit_limit,
            "credit_outstanding": credit_outstanding,
            "non_credit_outstanding": non_credit_outstanding,
            "total_outstanding": total_outstanding,
            "overdue_count": total_overdue,
            "total_overdue_amount": total_overdue_amount,
            "credit_purchase_orders": credit_pos,
            "non_credit_purchase_orders": non_credit_pos,
            "all_purchase_orders": all_purchase_orders,
        }
    
    def get_supplier_non_credit_status(self, db: Session, supplier_id: int) -> Dict[str, Any]:
 
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier {supplier_id} not found"
            )
        
        non_credit_pos = self._get_non_credit_purchase_orders(db, supplier_id)
        
        total_outstanding = sum(po["remaining_amount"] for po in non_credit_pos)
        overdue_pos = [po for po in non_credit_pos if po["is_overdue"]]
        
        return {
            "supplier_id": supplier_id,
            "supplier_name": supplier.full_name,
            "company_name": supplier.company_name,
            "total_outstanding": total_outstanding,
            "overdue_count": len(overdue_pos),
            "total_overdue_amount": sum(po["remaining_amount"] for po in overdue_pos),
            "non_credit_purchase_orders": non_credit_pos
        }

    def _get_po_total_amount(self, db: Session, po_id: int) -> Decimal:
        from app.modules.purchasing.models import PurchasingOrderItems

        return db.query(
            func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0)
        ).filter(
            PurchasingOrderItems.purchasingorders_id == po_id
        ).scalar() or Decimal("0")

    def _get_po_received_amount(self, db: Session, po_id: int) -> Decimal:
        from app.modules.purchasing.models import PurchasingOrderItems

        return db.query(
            func.coalesce(func.sum(PurchasingOrderItems.unit_price), 0)
        ).join(
            GoodReceivedItems,
            GoodReceivedItems.purchasing_order_items_id == PurchasingOrderItems.id
        ).filter(
            PurchasingOrderItems.purchasingorders_id == po_id,
            GoodReceivedItems.active == True
        ).scalar() or Decimal("0")
    
    def _get_credit_purchase_orders(self, db: Session, supplier_id: int, credit_days: int) -> List[Dict]:
        from app.modules.purchasing.models import PurchasingOrderItems
        
        valid_statuses = ['draft', 'pending', 'pending_approval', 'approved', 'completed', 'partially_completed']
        credit_pos = db.query(PurchasingOrder).filter(
            PurchasingOrder.first_suppliers_id == supplier_id,
            func.lower(PurchasingOrder.payment_method) == "credit",
            PurchasingOrder.status.in_(valid_statuses)
        ).order_by(PurchasingOrder.purchasing_order_date.desc()).all()
        
        # Import SupplierAdvanceApplication for advance applications
        from app.modules.purchasing.models import SupplierAdvanceApplication
        
        result = []
        for po in credit_pos:
            po_total = db.query(
                func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0)
            ).filter(
                PurchasingOrderItems.purchasingorders_id == po.id
            ).scalar() or Decimal("0")

            grns = db.query(GoodReceivedNote).filter(
                GoodReceivedNote.purchasingorders_id == po.id
            ).order_by(GoodReceivedNote.good_received_date.asc(), GoodReceivedNote.id.asc()).all()
            grn = grns[0] if grns else None
            grn_ids = [g.id for g in grns]
            
            # Get settlements for this PO (through GRN, only verified settlements)
            total_settled = Decimal("0")
            total_advance_applied = Decimal("0")
            if grn_ids:
                total_settled = db.query(
                    func.coalesce(func.sum(SupplierCreditsSettleTransaction.payment_amount), 0)
                ).join(
                    SupplierCreditsSettle,
                    SupplierCreditsSettleTransaction.supplier_credit_settle_id == SupplierCreditsSettle.id
                ).filter(
                    SupplierCreditsSettleTransaction.good_received_id.in_(grn_ids)
                ).scalar() or Decimal("0")
                
                # Get advance applications for this GRN
                total_advance_applied = db.query(
                    func.coalesce(func.sum(SupplierAdvanceApplication.applied_amount), 0)
                ).filter(
                    SupplierAdvanceApplication.grn_id.in_(grn_ids)
                ).scalar() or Decimal("0")
            
            # Calculate approved purchase returns for this PO's GRNs
            from app.modules.purchasing.models import PurchasingReturn, PurchasingReturnItems
            total_returns = Decimal("0")
            if grn_ids:
                approved_return_ids = db.query(PurchasingReturn.id).filter(
                    PurchasingReturn.goodreceivednote_id.in_(grn_ids),
                    PurchasingReturn.status == "approved"
                ).all()
                approved_return_ids = [r[0] for r in approved_return_ids]
                if approved_return_ids:
                    total_returns = db.query(
                        func.coalesce(func.sum(PurchasingReturnItems.return_price), 0)
                    ).filter(
                        PurchasingReturnItems.purchasingreturn_id.in_(approved_return_ids)
                    ).scalar() or Decimal("0")

            # Calculate remaining after settlements, advance applications, AND returns
            total_paid = float(total_settled) + float(total_advance_applied)
            remaining = float(po_total) - total_paid - float(total_returns)
            if remaining < 0:
                remaining = 0
            is_settled = remaining <= 0

            po_date = po.purchasing_order_date
            if isinstance(po_date, str):
                po_date = datetime.strptime(po_date, "%Y-%m-%d").date()
            due_date = self.calculate_due_date(po_date, credit_days)
            days_overdue = (tz.today() - due_date).days
            
            result.append({
                "po_id": po.id,
                "po_no": po.purchasing_order_no,
                "invoice_no": po.purchasing_invoice_no,
                "po_date": po.purchasing_order_date,
                "status": po.status,
                "total_amount": float(po_total),
                "settled_amount": total_paid,  # Include both settlements and advance applications
                "advance_applied": float(total_advance_applied),
                "return_amount": float(total_returns),
                "remaining_amount": remaining,
                "is_settled": is_settled,
                "has_grn": grn is not None,
                "grn_id": grn.id if grn else None,
                "grn_no": grn.good_received_no if grn else None,
                "due_date": due_date,
                "days_overdue": days_overdue,
                "is_overdue": days_overdue > 0 and not is_settled,
                "branch_code": po.branch_code
            })
        
        return result
    
    def _get_non_credit_purchase_orders(self, db: Session, supplier_id: int) -> List[Dict]:
        from app.modules.purchasing.models import PurchasingOrderItems, SupplierAdvanceApplication, SupplierPayment, SupplierAdvancePayment
        
        # Include 'approved' status so payments can be made before GRN is created
        non_credit_pos = db.query(PurchasingOrder).filter(
            PurchasingOrder.first_suppliers_id == supplier_id,
            func.lower(PurchasingOrder.payment_method) != "credit",
            PurchasingOrder.status.in_(['approved', 'completed', 'partially_completed'])
        ).order_by(PurchasingOrder.purchasing_order_date.desc()).all()
        
        result = []
        for po in non_credit_pos:
            po_total = db.query(
                func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0)
            ).filter(
                PurchasingOrderItems.purchasingorders_id == po.id
            ).scalar() or Decimal("0")

            grns = db.query(GoodReceivedNote).filter(
                GoodReceivedNote.purchasingorders_id == po.id
            ).order_by(GoodReceivedNote.good_received_date.asc(), GoodReceivedNote.id.asc()).all()
            grn = grns[0] if grns else None
            grn_ids = [g.id for g in grns]
            has_grn = len(grn_ids) > 0
            
            # Get payments for this PO
            # Only VERIFIED payments should reduce outstanding.
            # Pending payments are treated as notes until approved.
            payment_link_filters = [SupplierPayment.purchasing_order_id == po.id]
            if po.purchasing_order_no:
                payment_link_filters.append(
                    SupplierPayment.invoice_reference == po.purchasing_order_no
                )
            if po.purchasing_invoice_no:
                payment_link_filters.append(
                    SupplierPayment.invoice_reference == po.purchasing_invoice_no
                )
            if grn and grn.good_received_no:
                payment_link_filters.append(
                    SupplierPayment.invoice_reference == grn.good_received_no
                )

            total_paid = db.query(
                func.coalesce(func.sum(SupplierPayment.payment_amount), 0)
            ).filter(
                or_(*payment_link_filters),
                SupplierPayment.status == "verified",
                or_(
                    SupplierPayment.remarks.is_(None),
                    ~SupplierPayment.remarks.like("Auto-recorded cash payment on GRN %")
                )
            ).scalar() or Decimal("0")

            pending_payment_amount = db.query(
                func.coalesce(func.sum(SupplierPayment.payment_amount), 0)
            ).filter(
                or_(*payment_link_filters),
                SupplierPayment.status == "pending",
                or_(
                    SupplierPayment.remarks.is_(None),
                    ~SupplierPayment.remarks.like("Auto-recorded cash payment on GRN %")
                )
            ).scalar() or Decimal("0")
            
            # Get advance applications for all GRNs under this PO
            total_advance_applied = Decimal("0")
            if grn_ids:
                total_advance_applied = db.query(
                    func.coalesce(func.sum(SupplierAdvanceApplication.applied_amount), 0)
                ).filter(
                    SupplierAdvanceApplication.grn_id.in_(grn_ids)
                ).scalar() or Decimal("0")

            # Fallback: include PO-linked supplier advances even when explicit GRN applications
            # are not yet created, so non-credit payable reflects real net exposure.
            po_linked_advance_total = db.query(
                func.coalesce(func.sum(SupplierAdvancePayment.original_amount), 0)
            ).filter(
                SupplierAdvancePayment.supplier_id == supplier_id,
                SupplierAdvancePayment.purchasing_order_id == po.id
            ).scalar() or Decimal("0")

            # For non-credit, payable should track received goods value after GRN,
            # while pre-GRN rows still use PO total for planning visibility.
            received_amount = self._get_po_received_amount(db, po.id) if has_grn else Decimal("0")
            base_amount = received_amount if has_grn else po_total

            effective_advance = min(
                base_amount,
                max(Decimal(str(total_advance_applied)), Decimal(str(po_linked_advance_total)))
            )

            # Calculate approved purchase returns for this PO's GRNs
            from app.modules.purchasing.models import PurchasingReturn, PurchasingReturnItems
            total_returns = Decimal("0")
            if grn_ids:
                approved_return_ids = db.query(PurchasingReturn.id).filter(
                    PurchasingReturn.goodreceivednote_id.in_(grn_ids),
                    PurchasingReturn.status == "approved"
                ).all()
                approved_return_ids = [r[0] for r in approved_return_ids]
                if approved_return_ids:
                    total_returns = db.query(
                        func.coalesce(func.sum(PurchasingReturnItems.return_price), 0)
                    ).filter(
                        PurchasingReturnItems.purchasingreturn_id.in_(approved_return_ids)
                    ).scalar() or Decimal("0")

            # Calculate remaining after payments, advance applications, AND returns
            total_all_paid_decimal = total_paid + effective_advance + total_returns
            remaining_decimal = base_amount - total_all_paid_decimal
            if remaining_decimal < Decimal("0"):
                remaining_decimal = Decimal("0")

            total_all_paid = float(total_paid)
            remaining = float(remaining_decimal)
            is_paid = remaining <= 0

            po_date = po.purchasing_order_date
            if isinstance(po_date, str):
                po_date = datetime.strptime(po_date, "%Y-%m-%d").date()
            due_date = self.calculate_due_date(po_date, 0)
            days_overdue = (tz.today() - due_date).days
            
            result.append({
                "po_id": po.id,
                "po_no": po.purchasing_order_no,
                "invoice_no": po.purchasing_invoice_no,
                "po_date": po.purchasing_order_date,
                "status": po.status,
                "payment_method": po.payment_method,
                "total_amount": float(base_amount),
                "paid_amount": total_all_paid,
                "pending_payment_amount": float(pending_payment_amount),
                "has_pending_payment": float(pending_payment_amount) > 0,
                "advance_applied": float(effective_advance),
                "return_amount": float(total_returns),
                "remaining_amount": remaining,
                "is_paid": is_paid,
                "has_grn": has_grn,
                "grn_id": grn.id if grn else None,
                "grn_no": grn.good_received_no if grn else None,
                "due_date": due_date,
                "days_overdue": days_overdue,
                "is_overdue": days_overdue > 0 and not is_paid,
                "branch_code": po.branch_code
            })
        
        return result
    
    def _calculate_outstanding_payable(self, db: Session, supplier_id: int) -> Decimal:
        from app.modules.purchasing.models import PurchasingOrderItems
        
        completed_credit_po_ids = db.query(PurchasingOrder.id).filter(
            PurchasingOrder.first_suppliers_id == supplier_id,
            func.lower(PurchasingOrder.payment_method) == "credit",
            PurchasingOrder.status.in_(['completed', 'partially_completed'])
        ).all()
        completed_credit_po_ids = [p[0] for p in completed_credit_po_ids]
        
        if not completed_credit_po_ids:
            return Decimal("0")
        
        total_grn_value = db.query(
            func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0)
        ).filter(
            PurchasingOrderItems.purchasingorders_id.in_(completed_credit_po_ids)
        ).scalar() or Decimal("0")
        
        # Get all settled amounts for this supplier (only verified settlements)
        total_settled = db.query(
            func.coalesce(func.sum(SupplierCreditsSettleTransaction.payment_amount), 0)
        ).join(
            SupplierCreditsSettle,
            SupplierCreditsSettleTransaction.supplier_credit_settle_id == SupplierCreditsSettle.id
        ).filter(
            SupplierCreditsSettle.suppliers_id == supplier_id
        ).scalar() or Decimal("0")
        
        from app.modules.purchasing.models import PurchasingReturn, PurchasingReturnItems
        
        grn_ids = db.query(GoodReceivedNote.id).filter(
            GoodReceivedNote.purchasingorders_id.in_(completed_credit_po_ids)
        ).all()
        grn_ids = [g[0] for g in grn_ids]
        
        total_returns = Decimal("0")
        if grn_ids:
            approved_return_ids = db.query(PurchasingReturn.id).filter(
                PurchasingReturn.goodreceivednote_id.in_(grn_ids),
                PurchasingReturn.status == "approved"
            ).all()
            approved_return_ids = [r[0] for r in approved_return_ids]
            
            if approved_return_ids:
                total_returns = db.query(
                    func.coalesce(func.sum(PurchasingReturnItems.return_price), 0)
                ).filter(
                    PurchasingReturnItems.purchasingreturn_id.in_(approved_return_ids)
                ).scalar() or Decimal("0")
        
        return total_grn_value - total_settled - total_returns
    
    def _calculate_pending_credits(self, db: Session, supplier_id: int, exclude_po_id: Optional[int] = None) -> Decimal:
        from app.modules.purchasing.models import PurchasingOrderItems
        
        pending_statuses = ['draft', 'pending', 'pending_approval', 'approved']
        query = db.query(PurchasingOrder.id).filter(
            PurchasingOrder.first_suppliers_id == supplier_id,
            func.lower(PurchasingOrder.payment_method) == "credit",
            PurchasingOrder.status.in_(pending_statuses)
        )
        # Exclude the PO currently being checked/approved to avoid double-counting
        if exclude_po_id is not None:
            query = query.filter(PurchasingOrder.id != exclude_po_id)
        pending_credit_po_ids = [p[0] for p in query.all()]
        
        if not pending_credit_po_ids:
            return Decimal("0")

        total_pending = db.query(
            func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0)
        ).filter(
            PurchasingOrderItems.purchasingorders_id.in_(pending_credit_po_ids)
        ).scalar() or Decimal("0")
        
        return total_pending
    
    def _get_overdue_grns(self, db: Session, supplier_id: int, credit_days: int) -> List[Dict]:
        cutoff_date = tz.today() - timedelta(days=credit_days)
        
        po_ids = db.query(PurchasingOrder.id).filter(
            PurchasingOrder.first_suppliers_id == supplier_id
        ).all()
        po_ids = [p[0] for p in po_ids]
        
        if not po_ids:
            return []
        
        grns = db.query(GoodReceivedNote).filter(
            GoodReceivedNote.purchasingorders_id.in_(po_ids),
            GoodReceivedNote.good_received_date < cutoff_date
        ).all()
        
        overdue_list = []
        for grn in grns:
            remaining = self._get_grn_remaining_payable(db, grn.id)
            if remaining > 0:
                due_date = self.calculate_due_date(grn.good_received_date, credit_days)
                overdue_list.append({
                    "grn_id": grn.id,
                    "grn_no": grn.good_received_no,
                    "grn_date": grn.good_received_date,
                    "supplier_invoice_no": grn.supplier_invoice_no,
                    "due_date": due_date,
                    "days_overdue": (tz.today() - due_date).days,
                    "remaining_amount": float(remaining)
                })
        
        return overdue_list

    def _get_unpaid_grns(self, db: Session, supplier_id: int, credit_days: int) -> List[Dict]:

        po_ids = db.query(PurchasingOrder.id).filter(
            PurchasingOrder.first_suppliers_id == supplier_id
        ).all()
        po_ids = [p[0] for p in po_ids]
        
        if not po_ids:
            return []

        grns = db.query(GoodReceivedNote).filter(
            GoodReceivedNote.purchasingorders_id.in_(po_ids)
        ).order_by(GoodReceivedNote.good_received_date).all()
        
        unpaid_list = []
        for grn in grns:
            remaining = self._get_grn_remaining_payable(db, grn.id)
            if remaining > 0:
                due_date = self.calculate_due_date(grn.good_received_date, credit_days)
                days_overdue = (tz.today() - due_date).days
                unpaid_list.append({
                    "grn_id": grn.id,
                    "grn_no": grn.good_received_no,
                    "grn_date": grn.good_received_date,
                    "supplier_invoice_no": grn.supplier_invoice_no,
                    "due_date": due_date,
                    "days_overdue": days_overdue,
                    "is_overdue": days_overdue > 0,
                    "remaining_amount": float(remaining)
                })
        
        return unpaid_list
    
    def _get_grn_remaining_payable(self, db: Session, grn_id: int) -> Decimal:

        grn = db.query(GoodReceivedNote).filter(GoodReceivedNote.id == grn_id).first()
        if not grn:
            return Decimal("0")
        
        from app.modules.purchasing.models import PurchasingOrderItems

        total = db.query(
            func.coalesce(func.sum(PurchasingOrderItems.unit_price), 0)
        ).join(
            GoodReceivedItems,
            GoodReceivedItems.purchasing_order_items_id == PurchasingOrderItems.id
        ).filter(
            PurchasingOrderItems.purchasingorders_id == grn.purchasingorders_id,
            GoodReceivedItems.good_received_note == grn.good_received_no,
            GoodReceivedItems.active == True
        ).scalar() or Decimal("0")
        
        # Get paid amount (only verified settlements)
        paid = db.query(
            func.coalesce(func.sum(SupplierCreditsSettleTransaction.payment_amount), 0)
        ).join(
            SupplierCreditsSettle,
            SupplierCreditsSettleTransaction.supplier_credit_settle_id == SupplierCreditsSettle.id
        ).filter(
            SupplierCreditsSettleTransaction.good_received_id == grn_id
        ).scalar() or Decimal("0")

        from app.modules.purchasing.models import PurchasingReturn, PurchasingReturnItems
        
        return_ids = db.query(PurchasingReturn.id).filter(
            PurchasingReturn.goodreceivednote_id == grn_id
        ).all()
        return_ids = [r[0] for r in return_ids]
        
        total_returns = Decimal("0")
        if return_ids:
            total_returns = db.query(
                func.coalesce(func.sum(PurchasingReturnItems.return_price), 0)
            ).filter(
                PurchasingReturnItems.purchasingreturn_id.in_(return_ids)
            ).scalar() or Decimal("0")

        from app.modules.purchasing.models import SupplierAdvanceApplication
        total_advance_applied = db.query(
            func.coalesce(func.sum(SupplierAdvanceApplication.applied_amount), 0)
        ).filter(
            SupplierAdvanceApplication.grn_id == grn_id
        ).scalar() or Decimal("0")

        remaining = total - paid - total_returns - total_advance_applied
        if remaining < Decimal("0"):
            return Decimal("0")
        return remaining
    
    def validate_credit_purchase(
        self, 
        db: Session, 
        supplier_id: int, 
        purchase_amount: Decimal,
        allow_over_limit: bool = False
    ) -> Dict[str, Any]:

        status = self.get_supplier_credit_status(db, supplier_id)
        
        new_outstanding = status["outstanding_payable"] + float(purchase_amount)
        will_exceed = new_outstanding > status["max_credit_limit"]
        
        result = {
            "allowed": not will_exceed or allow_over_limit,
            "current_outstanding": status["outstanding_payable"],
            "new_purchase_amount": float(purchase_amount),
            "new_total_outstanding": new_outstanding,
            "max_credit_limit": status["max_credit_limit"],
            "available_credit": status["available_credit"],
            "will_exceed_limit": will_exceed,
            "excess_amount": max(0, new_outstanding - status["max_credit_limit"]),
            "overdue_count": status["overdue_count"],
            "has_overdue": status["overdue_count"] > 0,
            "message": ""
        }
        
        if will_exceed:
            result["message"] = f"Supplier credit limit exceeded. Max: {status['max_credit_limit']}, New total: {new_outstanding}"
        elif status["overdue_count"] > 0:
            result["message"] = f"You have {status['overdue_count']} overdue payment(s) to this supplier"
        else:
            result["message"] = "Credit purchase approved"
        
        return result
    
    def check_po_credit(
        self, 
        db: Session, 
        supplier_id: int, 
        po_value: Decimal,
        payment_method: str = "Credit",
        exclude_po_id: Optional[int] = None
    ) -> Dict[str, Any]:

        if payment_method.lower() != "credit":
            return {
                "can_save": True,
                "requires_approval": False,
                "suggested_status": "pending",
                "credit_check": {
                    "allowed": True,
                    "requires_approval": False,
                    "current_outstanding": 0,
                    "pending_credits": 0,
                    "po_value": float(po_value),
                    "projected_outstanding": 0,
                    "max_credit_limit": 0,
                    "available_credit": 0,
                    "will_exceed_limit": False,
                    "excess_amount": 0,
                    "overdue_count": 0,
                    "has_overdue": False,
                    "message": "Non-credit purchase - no credit check required",
                    "warning_level": "none"
                },
                "message": "PO can be saved (non-credit purchase)"
            }
        
        status = self.get_supplier_credit_status(db, supplier_id, exclude_po_id=exclude_po_id)
        
        # Check if PO value exceeds AVAILABLE CREDIT
        # available_credit = max_credit_limit - total_exposure (outstanding + pending)
        will_exceed = float(po_value) > status["available_credit"]
        excess_amount = max(0, float(po_value) - status["available_credit"])
        
        # Calculate what the projected outstanding will be after this PO
        projected_exposure = status["total_exposure"] + float(po_value)
        
        # Determine warning level
        warning_level = "none"
        if will_exceed:
            warning_level = "error"
        elif status["overdue_count"] > 0:
            warning_level = "warning"
        elif status["available_credit"] < status["max_credit_limit"] * 0.2:
            warning_level = "warning"  # Less than 20% credit available
        
        credit_check = {
            "allowed": True,
            "requires_approval": will_exceed,
            "current_outstanding": status["outstanding_payable"],  # GRN-based actual liability
            "po_value": float(po_value),
            "projected_outstanding": projected_exposure,  # Total after this PO
            "max_credit_limit": status["max_credit_limit"],
            "available_credit": status["available_credit"],
            "will_exceed_limit": will_exceed,
            "excess_amount": excess_amount,
            "overdue_count": status["overdue_count"],
            "has_overdue": status["overdue_count"] > 0,
            "message": "",
            "warning_level": warning_level
        }
        

        messages = []
        if will_exceed:
            messages.append(f"PO amount (Rs. {float(po_value):,.2f}) exceeds available credit (Rs. {status['available_credit']:,.2f}) by Rs. {excess_amount:,.2f}")
        if status["overdue_count"] > 0:
            messages.append(f"Warning: {status['overdue_count']} overdue payment(s) to this supplier")
        
        # Add breakdown info
        breakdown = f"Credit Limit: Rs. {status['max_credit_limit']:,.2f}, Available: Rs. {status['available_credit']:,.2f}, This PO: Rs. {float(po_value):,.2f}"
        
        credit_check["message"] = ". ".join(messages) if messages else "Credit check passed"
        credit_check["breakdown"] = breakdown
        
        return {
            "can_save": True,
            "requires_approval": will_exceed,
            "suggested_status": "pending_approval" if will_exceed else "pending",
            "credit_check": credit_check,
            "message": f"PO {'requires approval' if will_exceed else 'can be saved'}. {credit_check['message']}"
        }
    
    def check_grn_credit(
        self, 
        db: Session, 
        supplier_id: int, 
        grn_value: Decimal,
        po_id: Optional[int] = None,
        allow_override: bool = False
    ) -> Dict[str, Any]:

        status = self.get_supplier_credit_status(db, supplier_id)
        
        po_in_pending = False
        if po_id:
            po = db.query(PurchasingOrder).filter(PurchasingOrder.id == po_id).first()
            if po and po.status in ['approved', 'pending', 'pending_approval', 'draft']:
                po_in_pending = True
        

        new_outstanding = status["outstanding_payable"] + float(grn_value)

        
        credit_check = {
            "allowed": True, 
            "requires_approval": False,
            "current_outstanding": status["outstanding_payable"],
            "po_value": float(grn_value),  # Using grn_value as po_value for schema compatibility
            "projected_outstanding": status["total_exposure"],  # Total exposure (stays same after GRN)
            "max_credit_limit": status["max_credit_limit"],
            "available_credit": status["available_credit"],
            "will_exceed_limit": False,  # GRN doesn't change exposure
            "excess_amount": 0,
            "overdue_count": status["overdue_count"],
            "has_overdue": status["overdue_count"] > 0,
            "message": "",
            "warning_level": "none"
        }
        
        messages = []
        if po_in_pending:
            messages.append(f"GRN will convert Rs. {float(grn_value):,.2f} from pending to outstanding")
        else:
            messages.append("Creating GRN for order")
        if status["overdue_count"] > 0:
            messages.append(f"Note: {status['overdue_count']} overdue payment(s) to this supplier")
        
        credit_check["message"] = ". ".join(messages)
        
        return {
            "can_post": True,
            "requires_override": False,
            "credit_check": credit_check,
            "message": credit_check["message"]
        }
    
    def update_supplier_credit_balance(self, db: Session, supplier_id: int):
        """Update supplier credit balance. Uses flush() to participate in caller's transaction."""
        # Lock the supplier row to prevent concurrent credit balance updates
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).with_for_update().first()
        if not supplier:
            return
        
        outstanding = self._calculate_outstanding_payable(db, supplier_id)
        supplier.left_credit_amount = int(supplier.max_credit_limit - outstanding)
        db.flush()
    
    def create_credit_settlement(
        self, 
        db: Session, 
        settlement_data: schemas.SupplierCreditsSettleCreate
    ) -> SupplierCreditsSettle:
        supplier = db.query(Supplier).filter(
            Supplier.id == settlement_data.suppliers_id
        ).first()
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier {settlement_data.suppliers_id} not found"
            )
        for trans in settlement_data.transactions:
            grn = db.query(GoodReceivedNote).filter(
                GoodReceivedNote.id == trans.good_received_id
            ).first()
            if not grn:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"GRN {trans.good_received_id} not found"
                )

            po = db.query(PurchasingOrder).filter(
                PurchasingOrder.id == grn.purchasingorders_id
            ).first()
            if not po or po.first_suppliers_id != settlement_data.suppliers_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"GRN {trans.good_received_id} does not belong to supplier {settlement_data.suppliers_id}"
                )

            remaining = self._get_grn_remaining_payable(db, grn.id)
            if trans.payment_amount > remaining:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Payment amount {trans.payment_amount} exceeds remaining payable {remaining} for GRN {grn.good_received_no}"
                )

        settlement = SupplierCreditsSettle(
            supplier_credits_settle_no=settlement_data.supplier_credits_settle_no,
            branch_code=settlement_data.branch_code,
            suppliers_id=settlement_data.suppliers_id,
            created_date=tz.now()
        )
        db.add(settlement)
        db.flush()

        for trans in settlement_data.transactions:
            transaction = SupplierCreditsSettleTransaction(
                payment_method=trans.payment_method,
                cheque_date=trans.cheque_date,
                payment_amount=trans.payment_amount,
                payment_method_number=trans.payment_method_number,
                remarks=trans.remarks,
                supplier_credit_settle_id=settlement.id,
                good_received_id=trans.good_received_id,
                created_date=tz.now()
            )
            db.add(transaction)
        
        db.commit()

        self.update_supplier_credit_balance(db, settlement_data.suppliers_id)
        db.commit()
        
        db.refresh(settlement)
        return settlement
    
    def get_settlement(self, db: Session, settlement_id: int) -> SupplierCreditsSettle:
        settlement = db.query(SupplierCreditsSettle).filter(
            SupplierCreditsSettle.id == settlement_id
        ).first()
        if not settlement:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credit settlement {settlement_id} not found"
            )
        return settlement
    
    def get_settlement_with_transactions(
        self, 
        db: Session, 
        settlement_id: int
    ) -> schemas.SupplierCreditsSettleWithTransactions:
        """Get settlement with all transaction details"""
        settlement = self.get_settlement(db, settlement_id)
        transactions = db.query(SupplierCreditsSettleTransaction).filter(
            SupplierCreditsSettleTransaction.supplier_credit_settle_id == settlement_id
        ).all()
        
        return schemas.SupplierCreditsSettleWithTransactions(
            id=settlement.id,
            supplier_credits_settle_no=settlement.supplier_credits_settle_no,
            branch_code=settlement.branch_code,
            created_date=settlement.created_date,
            suppliers_id=settlement.suppliers_id,
            transactions=[
                schemas.SupplierCreditsSettleTransaction.model_validate(t) 
                for t in transactions
            ]
        )
    
    def get_supplier_settlements(
        self, 
        db: Session, 
        supplier_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[SupplierCreditsSettle]:
        """Get all settlements for a supplier"""
        return db.query(SupplierCreditsSettle).filter(
            SupplierCreditsSettle.suppliers_id == supplier_id
        ).order_by(
            SupplierCreditsSettle.created_date.desc()
        ).offset(skip).limit(limit).all()
    
    def get_grn_payment_history(
        self, 
        db: Session, 
        grn_id: int
    ) -> Dict[str, Any]:
        """Get payment history for a specific GRN"""
        grn = db.query(GoodReceivedNote).filter(GoodReceivedNote.id == grn_id).first()
        if not grn:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GRN {grn_id} not found"
            )

        po = db.query(PurchasingOrder).filter(
            PurchasingOrder.id == grn.purchasingorders_id
        ).first()
        supplier = db.query(Supplier).filter(Supplier.id == po.first_suppliers_id).first()

        from app.modules.purchasing.models import PurchasingOrderItems
        total_amount = db.query(
            func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0)
        ).filter(
            PurchasingOrderItems.purchasingorders_id == grn.purchasingorders_id
        ).scalar() or Decimal("0")
        
        transactions = db.query(SupplierCreditsSettleTransaction).filter(
            SupplierCreditsSettleTransaction.good_received_id == grn_id
        ).order_by(SupplierCreditsSettleTransaction.created_date).all()
        
        total_paid = sum(t.payment_amount for t in transactions)
        remaining = total_amount - total_paid
        
        due_date = self.calculate_due_date(grn.good_received_date, supplier.credit_days)
        
        return {
            "grn_id": grn_id,
            "grn_no": grn.good_received_no,
            "grn_date": grn.good_received_date,
            "supplier_invoice_no": grn.supplier_invoice_no,
            "due_date": due_date,
            "total_amount": float(total_amount),
            "total_paid": float(total_paid),
            "remaining": float(remaining),
            "is_fully_paid": remaining <= 0,
            "payments": [
                {
                    "transaction_id": t.id,
                    "settlement_id": t.supplier_credit_settle_id,
                    "payment_date": t.created_date,
                    "payment_method": t.payment_method,
                    "amount": float(t.payment_amount),
                    "reference": t.payment_method_number,
                    "remarks": t.remarks
                }
                for t in transactions
            ]
        }

    
    def get_aging_report(self, db: Session, supplier_id: Optional[int] = None) -> Dict[str, Any]:
        grn_query = db.query(GoodReceivedNote)
        
        if supplier_id:
            po_ids = db.query(PurchasingOrder.id).filter(
                PurchasingOrder.first_suppliers_id == supplier_id
            ).all()
            po_ids = [p[0] for p in po_ids]
            grn_query = grn_query.filter(GoodReceivedNote.purchasingorders_id.in_(po_ids))
        
        grns = grn_query.all()
        
        aging = {
            "current": {"count": 0, "amount": Decimal("0")},
            "1_30_days": {"count": 0, "amount": Decimal("0")},
            "31_60_days": {"count": 0, "amount": Decimal("0")},
            "61_90_days": {"count": 0, "amount": Decimal("0")},
            "over_90_days": {"count": 0, "amount": Decimal("0")},
            "total": {"count": 0, "amount": Decimal("0")}
        }
        
        for grn in grns:
            remaining = self._get_grn_remaining_payable(db, grn.id)
            if remaining <= 0:
                continue
            
            po = db.query(PurchasingOrder).filter(
                PurchasingOrder.id == grn.purchasingorders_id
            ).first()
            if not po:
                continue
            
            supplier = db.query(Supplier).filter(Supplier.id == po.first_suppliers_id).first()
            if not supplier:
                continue
            
            days_overdue = self.get_days_overdue(grn.good_received_date, supplier.credit_days)
            
            if days_overdue <= 0:
                bucket = "current"
            elif days_overdue <= 30:
                bucket = "1_30_days"
            elif days_overdue <= 60:
                bucket = "31_60_days"
            elif days_overdue <= 90:
                bucket = "61_90_days"
            else:
                bucket = "over_90_days"
            
            aging[bucket]["count"] += 1
            aging[bucket]["amount"] += remaining
            aging["total"]["count"] += 1
            aging["total"]["amount"] += remaining
        for key in aging:
            aging[key]["amount"] = float(aging[key]["amount"])
        
        return aging
    
    def get_supplier_statement(
        self, 
        db: Session, 
        supplier_id: int,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None
    ) -> Dict[str, Any]:
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier {supplier_id} not found"
            )

        po_ids = db.query(PurchasingOrder.id).filter(
            PurchasingOrder.first_suppliers_id == supplier_id
        ).all()
        po_ids = [p[0] for p in po_ids]
        
        grn_query = db.query(GoodReceivedNote).filter(
            GoodReceivedNote.purchasingorders_id.in_(po_ids)
        )
        if from_date:
            grn_query = grn_query.filter(GoodReceivedNote.good_received_date >= from_date)
        if to_date:
            grn_query = grn_query.filter(GoodReceivedNote.good_received_date <= to_date)
        
        grns = grn_query.order_by(GoodReceivedNote.good_received_date).all()

        settle_query = db.query(SupplierCreditsSettle).filter(
            SupplierCreditsSettle.suppliers_id == supplier_id
        )
        if from_date:
            settle_query = settle_query.filter(SupplierCreditsSettle.created_date >= from_date)
        if to_date:
            settle_query = settle_query.filter(SupplierCreditsSettle.created_date <= to_date)
        
        settlements = settle_query.order_by(SupplierCreditsSettle.created_date).all()

        from app.modules.purchasing.models import PurchasingOrderItems
        
        lines = []
        running_balance = Decimal("0")

        for grn in grns:
            total = db.query(
                func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0)
            ).filter(
                PurchasingOrderItems.purchasingorders_id == grn.purchasingorders_id
            ).scalar() or Decimal("0")
            
            due_date = self.calculate_due_date(grn.good_received_date, supplier.credit_days)
            running_balance += total
            
            lines.append({
                "date": grn.good_received_date,
                "type": "PURCHASE",
                "reference": grn.good_received_no,
                "description": f"GRN {grn.good_received_no} - Invoice: {grn.supplier_invoice_no}",
                "debit": float(total),
                "credit": 0,
                "balance": float(running_balance),
                "due_date": due_date
            })

        for settlement in settlements:
            transactions = db.query(SupplierCreditsSettleTransaction).filter(
                SupplierCreditsSettleTransaction.supplier_credit_settle_id == settlement.id
            ).all()
            
            total_payment = sum(t.payment_amount for t in transactions)
            running_balance -= total_payment
            
            lines.append({
                "date": settlement.created_date.date() if hasattr(settlement.created_date, 'date') else settlement.created_date,
                "type": "PAYMENT",
                "reference": settlement.supplier_credits_settle_no,
                "description": f"Payment made - {settlement.supplier_credits_settle_no}",
                "debit": 0,
                "credit": float(total_payment),
                "balance": float(running_balance),
                "due_date": None
            })

        lines.sort(key=lambda x: x["date"])
        running_balance = Decimal("0")
        for line in lines:
            if line["type"] == "PURCHASE":
                running_balance += Decimal(str(line["debit"]))
            else:
                running_balance -= Decimal(str(line["credit"]))
            line["balance"] = float(running_balance)
        
        return {
            "supplier_id": supplier_id,
            "supplier_name": supplier.full_name,
            "company_name": supplier.company_name,
            "from_date": from_date,
            "to_date": to_date,
            "credit_days": supplier.credit_days,
            "max_credit_limit": supplier.max_credit_limit,
            "current_balance": float(running_balance),
            "statement_lines": lines
        }

    def get_payment_report(
        self,
        db: Session,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        supplier_id: Optional[int] = None,
        branch_code: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Consolidated payment report across all suppliers and payment types.
        Queries SupplierPayment (verified, non-auto), SupplierCreditsSettleTransaction,
        and SupplierAdvanceApplication into a unified flat list.
        """
        items: List[Dict[str, Any]] = []

        # --- 1. Direct payments (all statuses except auto-recorded GRN cash) ---
        sp_query = (
            db.query(SupplierPayment, Supplier.full_name)
            .join(Supplier, Supplier.id == SupplierPayment.supplier_id)
            .filter(
                or_(
                    SupplierPayment.remarks == None,  # noqa: E711
                    ~SupplierPayment.remarks.startswith("Auto-recorded cash payment on GRN "),
                )
            )
        )
        if date_from:
            sp_query = sp_query.filter(SupplierPayment.payment_date >= date_from)
        if date_to:
            sp_query = sp_query.filter(SupplierPayment.payment_date <= date_to)
        if supplier_id:
            sp_query = sp_query.filter(SupplierPayment.supplier_id == supplier_id)
        if branch_code:
            sp_query = sp_query.filter(SupplierPayment.branch_code == branch_code)

        for payment, supplier_name in sp_query.all():
            items.append({
                "id": payment.id,
                "date": str(payment.payment_date),
                "type": "Direct Payment",
                "supplier_id": payment.supplier_id,
                "supplier_name": supplier_name,
                "document_no": payment.payment_no or f"PAY-{payment.id}",
                "po_no": None,
                "grn_reference": payment.invoice_reference,
                "payment_method": payment.payment_method,
                "amount": float(payment.payment_amount),
                "status": payment.status,
                "branch_code": payment.branch_code,
                "remarks": payment.remarks,
            })

        # --- 2. Credit settlements ---
        cs_query = (
            db.query(
                SupplierCreditsSettleTransaction,
                SupplierCreditsSettle.supplier_credits_settle_no,
                SupplierCreditsSettle.branch_code,
                SupplierCreditsSettle.suppliers_id,
                SupplierCreditsSettle.status,
                Supplier.full_name,
                GoodReceivedNote.good_received_no,
            )
            .join(
                SupplierCreditsSettle,
                SupplierCreditsSettle.id == SupplierCreditsSettleTransaction.supplier_credit_settle_id,
            )
            .join(Supplier, Supplier.id == SupplierCreditsSettle.suppliers_id)
            .outerjoin(
                GoodReceivedNote,
                GoodReceivedNote.id == SupplierCreditsSettleTransaction.good_received_id,
            )
        )
        if date_from:
            cs_query = cs_query.filter(SupplierCreditsSettleTransaction.created_date >= date_from)
        if date_to:
            cs_query = cs_query.filter(
                SupplierCreditsSettleTransaction.created_date <= datetime.combine(date_to, datetime.max.time())
            )
        if supplier_id:
            cs_query = cs_query.filter(SupplierCreditsSettle.suppliers_id == supplier_id)
        if branch_code:
            cs_query = cs_query.filter(SupplierCreditsSettle.branch_code == branch_code)

        for txn, settle_no, br_code, sup_id, settle_status, supplier_name, grn_no in cs_query.all():
            items.append({
                "id": txn.id,
                "date": str(txn.created_date.date()) if isinstance(txn.created_date, datetime) else str(txn.created_date),
                "type": "Credit Settlement",
                "supplier_id": sup_id,
                "supplier_name": supplier_name,
                "document_no": settle_no or f"CS-{txn.id}",
                "po_no": None,
                "grn_reference": grn_no,
                "payment_method": txn.payment_method,
                "amount": float(txn.payment_amount),
                "status": settle_status or "verified",
                "branch_code": br_code,
                "remarks": txn.remarks,
            })

        # --- 3. Advance applications (applied amount with GRN reference) ---
        aa_query = (
            db.query(
                SupplierAdvanceApplication,
                SupplierAdvancePayment.advance_no,
                SupplierAdvancePayment.supplier_id,
                SupplierAdvancePayment.branch_code,
                Supplier.full_name,
                GoodReceivedNote.good_received_no,
            )
            .join(
                SupplierAdvancePayment,
                SupplierAdvancePayment.id == SupplierAdvanceApplication.advance_id,
            )
            .join(Supplier, Supplier.id == SupplierAdvancePayment.supplier_id)
            .outerjoin(
                GoodReceivedNote,
                GoodReceivedNote.id == SupplierAdvanceApplication.grn_id,
            )
        )
        if date_from:
            aa_query = aa_query.filter(SupplierAdvanceApplication.application_date >= date_from)
        if date_to:
            aa_query = aa_query.filter(SupplierAdvanceApplication.application_date <= date_to)
        if supplier_id:
            aa_query = aa_query.filter(SupplierAdvancePayment.supplier_id == supplier_id)
        if branch_code:
            aa_query = aa_query.filter(SupplierAdvancePayment.branch_code == branch_code)

        for app, advance_no, sup_id, br_code, supplier_name, grn_no in aa_query.all():
            items.append({
                "id": app.id,
                "date": str(app.application_date),
                "type": "Advance Application",
                "supplier_id": sup_id,
                "supplier_name": supplier_name,
                "document_no": f"{advance_no}/APP" if advance_no else f"APP-{app.id}",
                "po_no": None,
                "grn_reference": grn_no,
                "payment_method": "Advance Apply",
                "amount": float(app.applied_amount),
                "status": "verified",
                "branch_code": br_code,
                "remarks": app.remarks or (f"Applied to {grn_no}" if grn_no else "Advance applied to GRN"),
            })

        # --- 4. Supplier advance payments (the actual payment made to hold as advance) ---
        ap_query = (
            db.query(SupplierAdvancePayment, Supplier.full_name)
            .join(Supplier, Supplier.id == SupplierAdvancePayment.supplier_id)
        )
        if date_from:
            ap_query = ap_query.filter(SupplierAdvancePayment.payment_date >= date_from)
        if date_to:
            ap_query = ap_query.filter(SupplierAdvancePayment.payment_date <= date_to)
        if supplier_id:
            ap_query = ap_query.filter(SupplierAdvancePayment.supplier_id == supplier_id)
        if branch_code:
            ap_query = ap_query.filter(SupplierAdvancePayment.branch_code == branch_code)

        for advance, supplier_name in ap_query.all():
            items.append({
                "id": advance.id,
                "date": str(advance.payment_date),
                "type": "Advance Payment",
                "supplier_id": advance.supplier_id,
                "supplier_name": supplier_name,
                "document_no": advance.advance_no or f"ADV-{advance.id}",
                "po_no": advance.po_no,
                "grn_reference": None,
                "payment_method": advance.payment_method,
                "amount": float(advance.original_amount),
                "status": "verified",
                "branch_code": advance.branch_code,
                "remarks": advance.remarks,
            })

        # Sort by date descending
        items.sort(key=lambda x: x["date"], reverse=True)

        # Build summary
        summary = {
            "total_amount": sum(i["amount"] for i in items),
            "total_count": len(items),
            "direct_payments": sum(i["amount"] for i in items if i["type"] == "Direct Payment"),
            "direct_payments_count": sum(1 for i in items if i["type"] == "Direct Payment"),
            "credit_settlements": sum(i["amount"] for i in items if i["type"] == "Credit Settlement"),
            "credit_settlements_count": sum(1 for i in items if i["type"] == "Credit Settlement"),
            "advance_payments": sum(i["amount"] for i in items if i["type"] == "Advance Payment"),
            "advance_payments_count": sum(1 for i in items if i["type"] == "Advance Payment"),
            "advance_applications": sum(i["amount"] for i in items if i["type"] == "Advance Application"),
            "advance_applications_count": sum(1 for i in items if i["type"] == "Advance Application"),
            "pending_amount": sum(i["amount"] for i in items if i["status"] == "pending"),
            "pending_count": sum(1 for i in items if i["status"] == "pending"),
        }

        return {"items": items, "summary": summary}

supplier_credit_service = SupplierCreditService()
