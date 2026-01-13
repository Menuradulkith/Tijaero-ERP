"""
Credit Management Service for Suppliers

Handles the complete credit cycle for purchases:
1. Credit Days - Calculate due dates based on supplier's credit_days
2. Credit Limit - Validate and track available credit from suppliers
3. Credit Settle - Process payments to suppliers against credit purchases

Key Fields:
- supplier.credit_days: Number of days supplier gives you to pay
- supplier.max_credit_limit: Maximum credit the supplier extends to you
- supplier.left_credit_amount: Remaining credit available from supplier
- supplier.initial_credit_amount: Original credit limit
"""

from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import HTTPException, status
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List, Optional, Dict, Any

from app.modules.purchasing.models import (
    Supplier,
    PurchasingOrder,
    SupplierCreditsSettle,
    SupplierCreditsSettleTransaction,
    GoodReceivedNote,
    GoodReceivedItems
)
from app.modules.purchasing import schemas


class SupplierCreditService:
    """Service for managing supplier credit operations (payables)"""
    
    # ==================== CREDIT DAYS ====================
    
    def calculate_due_date(self, grn_date: date, credit_days: int) -> date:
        """
        Calculate the due date for a credit purchase.
        
        Args:
            grn_date: The date goods were received (GRN date)
            credit_days: Number of days the supplier allows for payment
            
        Returns:
            The due date for payment
        """
        return grn_date + timedelta(days=credit_days)
    
    def get_grn_due_date(self, db: Session, grn_id: int) -> date:
        """Get the due date for a specific GRN"""
        grn = db.query(GoodReceivedNote).filter(GoodReceivedNote.id == grn_id).first()
        if not grn:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"GRN {grn_id} not found"
            )
        
        # Get supplier from the purchasing order
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
        """
        Calculate how many days a payment is overdue.
        
        Returns:
            Positive number if overdue, negative if not yet due, 0 if due today
        """
        due_date = self.calculate_due_date(grn_date, credit_days)
        return (date.today() - due_date).days
    
    # ==================== CREDIT LIMIT ====================
    
    def get_supplier_credit_status(self, db: Session, supplier_id: int) -> Dict[str, Any]:
        """
        Get complete credit status for a supplier.
        
        Returns:
            Dictionary with credit limit, outstanding payables, available credit, and overdue info
        """
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier {supplier_id} not found"
            )
        
        # Calculate total outstanding (what you owe the supplier)
        outstanding = self._calculate_outstanding_payable(db, supplier_id)
        
        # Get overdue GRNs
        overdue_grns = self._get_overdue_grns(db, supplier_id, supplier.credit_days)
        
        # Get all unpaid GRNs (for settlement)
        unpaid_grns = self._get_unpaid_grns(db, supplier_id, supplier.credit_days)
        
        # Get credit purchase orders (unsettled)
        credit_purchase_orders = self._get_credit_purchase_orders(db, supplier_id, supplier.credit_days)
        
        return {
            "supplier_id": supplier_id,
            "supplier_name": supplier.full_name,
            "company_name": supplier.company_name,
            "credit_days": supplier.credit_days,
            "max_credit_limit": supplier.max_credit_limit,
            "initial_credit_amount": supplier.initial_credit_amount or supplier.max_credit_limit,
            "left_credit_amount": supplier.left_credit_amount or (supplier.max_credit_limit - int(outstanding)),
            "outstanding_payable": float(outstanding),
            "available_credit": max(0, supplier.max_credit_limit - float(outstanding)),
            "overdue_count": len(overdue_grns),
            "total_overdue_amount": sum(grn["remaining_amount"] for grn in overdue_grns),
            "overdue_grns": overdue_grns,
            "unpaid_grns": unpaid_grns,
            "credit_purchase_orders": credit_purchase_orders
        }
    
    def _get_credit_purchase_orders(self, db: Session, supplier_id: int, credit_days: int) -> List[Dict]:
        """
        Get all credit purchase orders for a supplier with their settlement status.
        Only includes POs with payment_method='Credit'.
        """
        from app.modules.purchasing.models import PurchasingOrderItems
        
        # Get all credit POs for this supplier
        credit_pos = db.query(PurchasingOrder).filter(
            PurchasingOrder.first_suppliers_id == supplier_id,
            PurchasingOrder.payment_method == "Credit"
        ).order_by(PurchasingOrder.purchasing_order_date.desc()).all()
        
        result = []
        for po in credit_pos:
            # Calculate PO total from items
            po_total = db.query(
                func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0)
            ).filter(
                PurchasingOrderItems.purchasingorders_id == po.id
            ).scalar() or Decimal("0")
            
            # Check if this PO has a GRN (goods received)
            grn = db.query(GoodReceivedNote).filter(
                GoodReceivedNote.purchasingorders_id == po.id
            ).first()
            
            # Get settlements for this PO (through GRN)
            total_settled = Decimal("0")
            if grn:
                total_settled = db.query(
                    func.coalesce(func.sum(SupplierCreditsSettleTransaction.payment_amount), 0)
                ).filter(
                    SupplierCreditsSettleTransaction.good_received_id == grn.id
                ).scalar() or Decimal("0")
            
            remaining = float(po_total) - float(total_settled)
            is_settled = remaining <= 0
            
            # Calculate due date based on PO date
            po_date = po.purchasing_order_date
            if isinstance(po_date, str):
                po_date = datetime.strptime(po_date, "%Y-%m-%d").date()
            due_date = self.calculate_due_date(po_date, credit_days)
            days_overdue = (date.today() - due_date).days
            
            result.append({
                "po_id": po.id,
                "po_no": po.purchasing_order_no,
                "invoice_no": po.purchasing_invoice_no,
                "po_date": po.purchasing_order_date,
                "status": po.status,
                "total_amount": float(po_total),
                "settled_amount": float(total_settled),
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
    
    def _calculate_outstanding_payable(self, db: Session, supplier_id: int) -> Decimal:
        """
        Calculate total outstanding payable to a supplier.
        
        Outstanding = PO Values (for POs with GRN) - Settlements - Purchase Returns
        
        Credit only starts when goods are received (GRN created),
        not when purchase order is created.
        
        Note: We calculate based on PO total, not GRN items, because GRN items
        may not exist immediately when GRN is created.
        """
        from app.modules.purchasing.models import PurchasingOrderItems
        
        # Get all POs for this supplier that have a GRN (goods received)
        # This ensures credit only counts after goods are received
        po_ids_with_grn = db.query(GoodReceivedNote.purchasingorders_id).filter(
            GoodReceivedNote.purchasingorders_id.in_(
                db.query(PurchasingOrder.id).filter(
                    PurchasingOrder.first_suppliers_id == supplier_id
                )
            )
        ).distinct().all()
        po_ids_with_grn = [p[0] for p in po_ids_with_grn]
        
        if not po_ids_with_grn:
            return Decimal("0")
        
        # Get GRN IDs for these POs (for returns calculation)
        grn_ids = db.query(GoodReceivedNote.id).filter(
            GoodReceivedNote.purchasingorders_id.in_(po_ids_with_grn)
        ).all()
        grn_ids = [g[0] for g in grn_ids]
        
        # Get total PO value for POs that have GRN (goods received)
        # Using PO items total since GRN confirms receipt of the PO
        total_grn_value = db.query(
            func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0)
        ).filter(
            PurchasingOrderItems.purchasingorders_id.in_(po_ids_with_grn)
        ).scalar() or Decimal("0")
        
        # Get all settled amounts for this supplier
        total_settled = db.query(
            func.coalesce(func.sum(SupplierCreditsSettleTransaction.payment_amount), 0)
        ).join(
            SupplierCreditsSettle,
            SupplierCreditsSettleTransaction.supplier_credit_settle_id == SupplierCreditsSettle.id
        ).filter(
            SupplierCreditsSettle.suppliers_id == supplier_id
        ).scalar() or Decimal("0")
        
        # Get total purchase returns value (reduces what we owe)
        from app.modules.purchasing.models import PurchasingReturn, PurchasingReturnItems
        
        return_ids = db.query(PurchasingReturn.id).filter(
            PurchasingReturn.goodreceivednote_id.in_(grn_ids)
        ).all()
        return_ids = [r[0] for r in return_ids]
        
        total_returns = Decimal("0")
        if return_ids:
            total_returns = db.query(
                func.coalesce(func.sum(PurchasingReturnItems.return_price), 0)
            ).filter(
                PurchasingReturnItems.purchasingreturn_id.in_(return_ids)
            ).scalar() or Decimal("0")
        
        return total_grn_value - total_settled - total_returns
    
    def _get_overdue_grns(self, db: Session, supplier_id: int, credit_days: int) -> List[Dict]:
        """Get list of overdue GRNs for a supplier"""
        cutoff_date = date.today() - timedelta(days=credit_days)
        
        # Get PO IDs for this supplier
        po_ids = db.query(PurchasingOrder.id).filter(
            PurchasingOrder.first_suppliers_id == supplier_id
        ).all()
        po_ids = [p[0] for p in po_ids]
        
        if not po_ids:
            return []
        
        # Get GRNs that are past due date
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
                    "days_overdue": (date.today() - due_date).days,
                    "remaining_amount": float(remaining)
                })
        
        return overdue_list

    def _get_unpaid_grns(self, db: Session, supplier_id: int, credit_days: int) -> List[Dict]:
        """Get list of ALL unpaid GRNs for a supplier (including not yet due)"""
        # Get PO IDs for this supplier
        po_ids = db.query(PurchasingOrder.id).filter(
            PurchasingOrder.first_suppliers_id == supplier_id
        ).all()
        po_ids = [p[0] for p in po_ids]
        
        if not po_ids:
            return []
        
        # Get all GRNs for this supplier
        grns = db.query(GoodReceivedNote).filter(
            GoodReceivedNote.purchasingorders_id.in_(po_ids)
        ).order_by(GoodReceivedNote.good_received_date).all()
        
        unpaid_list = []
        for grn in grns:
            remaining = self._get_grn_remaining_payable(db, grn.id)
            if remaining > 0:
                due_date = self.calculate_due_date(grn.good_received_date, credit_days)
                days_overdue = (date.today() - due_date).days
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
        """
        Get remaining unpaid amount for a specific GRN.
        Remaining = GRN Value - Settlements - Returns
        """
        grn = db.query(GoodReceivedNote).filter(GoodReceivedNote.id == grn_id).first()
        if not grn:
            return Decimal("0")
        
        from app.modules.purchasing.models import PurchasingOrderItems
        
        # Get total value of received items for this GRN
        total = db.query(
            func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0)
        ).join(
            GoodReceivedItems,
            GoodReceivedItems.purchasing_order_items_id == PurchasingOrderItems.id
        ).filter(
            PurchasingOrderItems.purchasingorders_id == grn.purchasingorders_id
        ).scalar() or Decimal("0")
        
        # Get paid amount
        paid = db.query(
            func.coalesce(func.sum(SupplierCreditsSettleTransaction.payment_amount), 0)
        ).filter(
            SupplierCreditsSettleTransaction.good_received_id == grn_id
        ).scalar() or Decimal("0")
        
        # Get returns for this GRN
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
        
        return total - paid - total_returns
    
    def validate_credit_purchase(
        self, 
        db: Session, 
        supplier_id: int, 
        purchase_amount: Decimal,
        allow_over_limit: bool = False
    ) -> Dict[str, Any]:
        """
        Validate if a credit purchase can be made from a supplier.
        
        Args:
            supplier_id: The supplier ID
            purchase_amount: The credit amount for the new purchase
            allow_over_limit: If True, return warning instead of blocking
            
        Returns:
            Dictionary with validation result and details
        """
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
        payment_method: str = "Credit"
    ) -> Dict[str, Any]:
        """
        Soft check for Purchase Order creation.
        
        This is called when creating a PO to determine if it needs approval.
        - If payment method is not Credit, always allowed
        - If credit will exceed limit, PO is allowed but requires approval
        
        Returns:
            POCreditCheckResponse-compatible dict
        """
        # If not a credit purchase, always allow
        if payment_method.lower() != "credit":
            return {
                "can_save": True,
                "requires_approval": False,
                "suggested_status": "pending",
                "credit_check": {
                    "allowed": True,
                    "requires_approval": False,
                    "current_outstanding": 0,
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
        
        # Get supplier credit status
        status = self.get_supplier_credit_status(db, supplier_id)
        
        projected_outstanding = status["outstanding_payable"] + float(po_value)
        will_exceed = projected_outstanding > status["max_credit_limit"]
        excess_amount = max(0, projected_outstanding - status["max_credit_limit"])
        
        # Determine warning level
        warning_level = "none"
        if will_exceed:
            warning_level = "error"
        elif status["overdue_count"] > 0:
            warning_level = "warning"
        elif projected_outstanding > status["max_credit_limit"] * 0.8:
            warning_level = "warning"  # Over 80% usage
        
        credit_check = {
            "allowed": True,  # PO is always allowed (soft check)
            "requires_approval": will_exceed,
            "current_outstanding": status["outstanding_payable"],
            "po_value": float(po_value),
            "projected_outstanding": projected_outstanding,
            "max_credit_limit": status["max_credit_limit"],
            "available_credit": status["available_credit"],
            "will_exceed_limit": will_exceed,
            "excess_amount": excess_amount,
            "overdue_count": status["overdue_count"],
            "has_overdue": status["overdue_count"] > 0,
            "message": "",
            "warning_level": warning_level
        }
        
        # Set message
        messages = []
        if will_exceed:
            messages.append(f"Credit limit will be exceeded by Rs. {excess_amount:,.2f}")
        if status["overdue_count"] > 0:
            messages.append(f"Warning: {status['overdue_count']} overdue payment(s) to this supplier")
        
        credit_check["message"] = ". ".join(messages) if messages else "Credit check passed"
        
        return {
            "can_save": True,  # Soft check - always allow saving
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
        allow_override: bool = False
    ) -> Dict[str, Any]:
        """
        Hard check for GRN posting.
        
        This is called when creating a GRN to determine if it can be posted.
        - If credit will exceed limit, GRN is blocked unless override is provided
        
        Returns:
            GRNCreditCheckResponse-compatible dict
        """
        # Get supplier credit status
        status = self.get_supplier_credit_status(db, supplier_id)
        
        projected_outstanding = status["outstanding_payable"] + float(grn_value)
        will_exceed = projected_outstanding > status["max_credit_limit"]
        excess_amount = max(0, projected_outstanding - status["max_credit_limit"])
        
        # Determine warning level
        warning_level = "none"
        if will_exceed:
            warning_level = "error"
        elif status["overdue_count"] > 0:
            warning_level = "warning"
        
        credit_check = {
            "allowed": not will_exceed or allow_override,
            "requires_approval": False,
            "current_outstanding": status["outstanding_payable"],
            "po_value": float(grn_value),
            "projected_outstanding": projected_outstanding,
            "max_credit_limit": status["max_credit_limit"],
            "available_credit": status["available_credit"],
            "will_exceed_limit": will_exceed,
            "excess_amount": excess_amount,
            "overdue_count": status["overdue_count"],
            "has_overdue": status["overdue_count"] > 0,
            "message": "",
            "warning_level": warning_level
        }
        
        # Set message
        messages = []
        if will_exceed:
            if allow_override:
                messages.append(f"Credit limit exceeded (override applied). Excess: Rs. {excess_amount:,.2f}")
            else:
                messages.append(f"Cannot post GRN: Credit limit exceeded by Rs. {excess_amount:,.2f}")
        if status["overdue_count"] > 0:
            messages.append(f"Warning: {status['overdue_count']} overdue payment(s)")
        
        credit_check["message"] = ". ".join(messages) if messages else "Credit check passed"
        
        can_post = not will_exceed or allow_override
        
        return {
            "can_post": can_post,
            "requires_override": will_exceed and not allow_override,
            "credit_check": credit_check,
            "message": credit_check["message"]
        }
    
    def update_supplier_credit_balance(self, db: Session, supplier_id: int):
        """
        Recalculate and update supplier's left_credit_amount.
        Call this after any credit transaction.
        """
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier:
            return
        
        outstanding = self._calculate_outstanding_payable(db, supplier_id)
        supplier.left_credit_amount = int(supplier.max_credit_limit - outstanding)
        db.commit()
    
    # ==================== CREDIT SETTLE ====================
    
    def create_credit_settlement(
        self, 
        db: Session, 
        settlement_data: schemas.SupplierCreditsSettleCreate
    ) -> SupplierCreditsSettle:
        """
        Create a credit settlement record with transactions.
        
        This records payments made to a supplier against credit purchases.
        """
        # Validate supplier exists
        supplier = db.query(Supplier).filter(
            Supplier.id == settlement_data.suppliers_id
        ).first()
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier {settlement_data.suppliers_id} not found"
            )
        
        # Validate all GRN IDs in transactions
        for trans in settlement_data.transactions:
            grn = db.query(GoodReceivedNote).filter(
                GoodReceivedNote.id == trans.good_received_id
            ).first()
            if not grn:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"GRN {trans.good_received_id} not found"
                )
            
            # Verify GRN belongs to this supplier
            po = db.query(PurchasingOrder).filter(
                PurchasingOrder.id == grn.purchasingorders_id
            ).first()
            if not po or po.first_suppliers_id != settlement_data.suppliers_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"GRN {trans.good_received_id} does not belong to supplier {settlement_data.suppliers_id}"
                )
            
            # Check if payment amount exceeds remaining payable
            remaining = self._get_grn_remaining_payable(db, grn.id)
            if trans.payment_amount > remaining:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Payment amount {trans.payment_amount} exceeds remaining payable {remaining} for GRN {grn.good_received_no}"
                )
        
        # Create settlement header
        settlement = SupplierCreditsSettle(
            supplier_credits_settle_no=settlement_data.supplier_credits_settle_no,
            branch_code=settlement_data.branch_code,
            suppliers_id=settlement_data.suppliers_id,
            created_date=datetime.now()
        )
        db.add(settlement)
        db.flush()
        
        # Create transaction records
        for trans in settlement_data.transactions:
            transaction = SupplierCreditsSettleTransaction(
                payment_method=trans.payment_method,
                cheque_date=trans.cheque_date,
                payment_amount=trans.payment_amount,
                payment_method_number=trans.payment_method_number,
                remarks=trans.remarks,
                supplier_credit_settle_id=settlement.id,
                good_received_id=trans.good_received_id,
                created_date=datetime.now()
            )
            db.add(transaction)
        
        db.commit()
        
        # Update supplier's available credit
        self.update_supplier_credit_balance(db, settlement_data.suppliers_id)
        
        db.refresh(settlement)
        return settlement
    
    def get_settlement(self, db: Session, settlement_id: int) -> SupplierCreditsSettle:
        """Get a credit settlement by ID"""
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
        
        # Get PO and supplier info
        po = db.query(PurchasingOrder).filter(
            PurchasingOrder.id == grn.purchasingorders_id
        ).first()
        supplier = db.query(Supplier).filter(Supplier.id == po.first_suppliers_id).first()
        
        # Get total payable
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
    
    # ==================== AGING REPORTS ====================
    
    def get_aging_report(self, db: Session, supplier_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Generate aging report for payables.
        
        Categories:
        - Current (not yet due)
        - 1-30 days overdue
        - 31-60 days overdue
        - 61-90 days overdue
        - Over 90 days overdue
        """
        # Get all GRNs
        grn_query = db.query(GoodReceivedNote)
        
        if supplier_id:
            # Filter by supplier through PO
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
            
            # Get supplier credit days
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
        
        # Convert Decimal to float for JSON serialization
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
        """Generate a supplier statement showing all credit transactions"""
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if not supplier:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Supplier {supplier_id} not found"
            )
        
        # Get PO IDs for this supplier
        po_ids = db.query(PurchasingOrder.id).filter(
            PurchasingOrder.first_suppliers_id == supplier_id
        ).all()
        po_ids = [p[0] for p in po_ids]
        
        # Get GRNs (purchases)
        grn_query = db.query(GoodReceivedNote).filter(
            GoodReceivedNote.purchasingorders_id.in_(po_ids)
        )
        if from_date:
            grn_query = grn_query.filter(GoodReceivedNote.good_received_date >= from_date)
        if to_date:
            grn_query = grn_query.filter(GoodReceivedNote.good_received_date <= to_date)
        
        grns = grn_query.order_by(GoodReceivedNote.good_received_date).all()
        
        # Get settlements (payments)
        settle_query = db.query(SupplierCreditsSettle).filter(
            SupplierCreditsSettle.suppliers_id == supplier_id
        )
        if from_date:
            settle_query = settle_query.filter(SupplierCreditsSettle.created_date >= from_date)
        if to_date:
            settle_query = settle_query.filter(SupplierCreditsSettle.created_date <= to_date)
        
        settlements = settle_query.order_by(SupplierCreditsSettle.created_date).all()
        
        # Build statement lines
        from app.modules.purchasing.models import PurchasingOrderItems
        
        lines = []
        running_balance = Decimal("0")
        
        # Add GRN lines (purchases = what you owe)
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
                "debit": float(total),  # What you owe
                "credit": 0,
                "balance": float(running_balance),
                "due_date": due_date
            })
        
        # Add settlement lines (payments = reducing what you owe)
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
        
        # Sort by date
        lines.sort(key=lambda x: x["date"])
        
        # Recalculate running balance in order
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


# Singleton instance
supplier_credit_service = SupplierCreditService()
