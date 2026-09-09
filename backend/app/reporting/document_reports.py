import base64
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional
from collections import OrderedDict

import app.models  # Ensures all relationships are resolving correctly
from app.auth.models import Branch
from app.core import timezone as tz
from app.modules.common.models import Locations
from app.modules.customers.commission_models import CustomerAgentCommission
from app.modules.customers.models import Customer, CustomerGiftVoucher, VoucherUsage
from app.modules.employees.models import (
    Employee,
    EmployeePayroll,
    EmployeeSalaryProfile,
)
from app.modules.finance.accounting_models import (
    ChartOfAccounts,
    JournalEntry,
    JournalEntryLine,
)
from app.modules.finance.models import Expenses
from app.modules.inventory.models import SalesStock
from app.modules.products.models import Product
from app.modules.purchasing.models import (
    GoodReceivedNote,
    PurchasingOrder,
    PurchasingOrderItems,
    PurchasingReturn,
    PurchasingReturnItems,
    Supplier,
)
from app.modules.sales.models import Invoice, InvoiceItems
from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
from app.modules.settings.models import Settings
from app.modules.warehouse.models import ItemTransferNote, ItemTransferNoteItems
from fastapi import HTTPException
from jinja2 import Environment, FileSystemLoader
from sqlalchemy.orm import Session, joinedload


class DocumentReportService:

    def __init__(self, db: Session):
        self.db = db
        template_dir = Path(__file__).parent / "templates"
        self.env = Environment(
            loader=FileSystemLoader(str(template_dir)), autoescape=True
        )

    def _get_header_data_uri(self) -> str:
        """Read logo.svg from templates dir and return as a base64 data URI."""
        try:
            logo_path = Path(__file__).parent / "templates" / "Invoice_background_blue.jpg"
            svg_bytes = logo_path.read_bytes()
            b64 = base64.b64encode(svg_bytes).decode("utf-8")
            return f"data:image/jpeg;base64,{b64}"
        except Exception:
            return ""

    def _get_company_info(self) -> dict:
        logo = self._get_header_data_uri()
        try:
            settings = self.db.query(Settings).first()
            if settings:
                return {
                    "name": settings.company_name or "UNITY SYSTEMS",
                    "tagline": "Solutions",
                    "logo": logo,
                    "address": settings.company_address
                    or "Ground Floor, Unity Plaza, Galle Road, Colombo 04.",
                    "phone": settings.company_telephone_number or "0112081667",
                    "fax": settings.company_fax_number or "0112081667",
                    "email": settings.company_email or "info@unitysystems.lk",
                }
        except Exception:
            self.db.rollback()
        return {
            "name": "UNITY SYSTEMS",
            "tagline": "Solutions",
            "logo": logo,
            "address": "Ground Floor, Unity Plaza, Galle Road, Colombo 04.",
            "phone": "0112081667",
            "fax": "0112081667",
            "email": "info@unitysystems.lk",
        }

    def _get_branch_info(self, branch_code: str) -> dict:
        branch = self.db.query(Branch).filter(Branch.branch_code == branch_code).first()
        if branch:
            return {
                "branch_code": branch.branch_code,
                "branch_name": branch.branch_name,
                "address": getattr(branch, "address", ""),
                "phone": getattr(branch, "telephone", ""),
            }
        return {
            "branch_code": branch_code,
            "branch_name": branch_code,
            "address": "",
            "phone": "",
        }

    def _get_supplier_info(self, supplier_id: int) -> dict:
        supplier = self.db.query(Supplier).filter(Supplier.id == supplier_id).first()
        if supplier:
            return {
                "id": supplier.id,
                "full_name": supplier.full_name,
                "company_name": supplier.company_name or "",
                "mobile_contact_number": supplier.mobile_contact_number or "",
                "home_contact_number": supplier.home_contact_number or "",
                "email": supplier.email or "",
                "address": supplier.postal_address or "",
            }
        return {
            "id": supplier_id,
            "full_name": f"Supplier #{supplier_id}",
            "company_name": "",
            "mobile_contact_number": "",
            "home_contact_number": "",
            "email": "",
            "address": "",
        }

    def _get_customer_info(self, customer_id: int) -> dict:
        customer = self.db.query(Customer).filter(Customer.id == customer_id).first()
        if customer:
            return {
                "id": customer.id,
                "customer_name": customer.customer_name,
                "mobile_number": customer.mobile_contact_number or "",
                "land_number": customer.home_contact_number or "",
                "email": customer.email or "",
                "address": customer.payment_address or "",
            }
        return {
            "id": customer_id,
            "customer_name": f"Customer #{customer_id}",
            "mobile_number": "",
            "land_number": "",
            "email": "",
            "address": "",
        }

    def _generate_syscode_from_amount(self, amount: float) -> str:
        """
        Generate syscode from paid amount.
        Rounds amount to nearest integer and converts each digit to alphabet (0-A, 1-B, etc).
        
        Example: 1234.56 -> 1235 -> "BCDE"
        
        Args:
            amount: The paid amount as float
            
        Returns:
            String with alphabet characters representing each digit
        """
        # Round to nearest integer
        rounded_amount = round(amount)
        
        # Convert to string to get individual digits
        amount_str = str(abs(int(rounded_amount)))
        
        # Convert each digit to alphabet (0=A, 1=B, 2=C, ..., 9=J)
        cipher = "TMAKEPROFI"
        digit_to_letter = {str(i): cipher[i] for i in range(10)}

        syscode = ''.join(digit_to_letter.get(digit, 'T') for digit in amount_str)

        return syscode if syscode else 'T'  # Return 'T' if amount is 0

    def generate_purchase_order_report(
        self,
        po_id: int,
        show_header: bool = True,
        show_discount: bool = True,
        show_signatures: bool = True,
        custom_remarks: Optional[str] = None,
    ) -> str:
        po = (
            self.db.query(PurchasingOrder)
            .options(joinedload(PurchasingOrder.items))
            .filter(PurchasingOrder.id == po_id)
            .first()
        )

        if not po:
            raise HTTPException(
                status_code=404, detail=f"Purchase Order #{po_id} not found"
            )

        company = self._get_company_info()
        supplier = self._get_supplier_info(po.first_suppliers_id)
        branch = self._get_branch_info(po.branch_code)

        items = []
        subtotal = 0
        for item in po.items:
            product = (
                self.db.query(Product).filter(Product.id == item.product_id).first()
            )
            item_total = (item.quantity or 0) * (item.unit_price or 0)
            items.append(
                {
                    "product_id": item.product_id,
                    "product_name": (
                        product.name if product else f"Product #{item.product_id}"
                    ),
                    "description": getattr(item, "description", "") or "",
                    "quantity": item.quantity,
                    "unit_price": item.unit_price or 0,
                    "total": item_total,
                }
            )
            subtotal += item_total

        template = self.env.get_template("purchase_order.html")
        return template.render(
            company=company,
            po={
                "id": po.id,
                "purchasing_order_no": po.purchasing_order_no,
                "purchasing_order_date": (
                    str(po.purchasing_order_date) if po.purchasing_order_date else ""
                ),
                "purchasing_invoice_no": po.purchasing_invoice_no or "",
                "status": po.status or "pending",
                "payment_terms": getattr(po, "payment_terms", "") or "",
                "delivery_terms": getattr(po, "delivery_terms", "") or "",
                "payment_method": getattr(po, "payment_method", "") or "",
                "remarks": po.remarks,
            },
            supplier=supplier,
            branch=branch,
            items=items,
            subtotal=subtotal,
            options={
                "show_header": show_header,
                "show_discount": show_discount,
                "show_signatures": show_signatures,
                "custom_remarks": custom_remarks,
            },
            generated_at=tz.now().strftime("%Y-%m-%d %H:%M:%S"),
        )

    def generate_grn_report(
        self,
        grn_id: int,
        show_header: bool = True,
        show_discount: bool = True,
        show_signatures: bool = True,
        custom_remarks: Optional[str] = None,
    ) -> str:

        grn = (
            self.db.query(GoodReceivedNote)
            .filter(GoodReceivedNote.id == grn_id)
            .first()
        )

        if not grn:
            raise HTTPException(status_code=404, detail=f"GRN #{grn_id} not found")

        po = (
            self.db.query(PurchasingOrder)
            .filter(PurchasingOrder.id == grn.purchasingorders_id)
            .first()
            if grn.purchasingorders_id
            else None
        )

        company = self._get_company_info()
        supplier_id = po.first_suppliers_id if po else None
        supplier = self._get_supplier_info(supplier_id) if supplier_id else {}
        branch = self._get_branch_info(grn.branch_code)

        from sqlalchemy.orm import joinedload

        stock_items = (
            self.db.query(SalesStock)
            .options(
                joinedload(SalesStock.product),
                joinedload(SalesStock.purchasing_order_item),
            )
            .filter(SalesStock.good_received_note_id == grn_id)
            .all()
        )

        items = []
        total_quantity = 0
        total_value = 0

        for stock in stock_items:

            unit_price = (
                float(stock.purchasing_order_item.unit_price)
                if stock.purchasing_order_item
                else 0
            )
            product_name = (
                stock.product.name if stock.product else f"Product #{stock.product_id}"
            )
            items.append(
                {
                    "product_id": stock.product_id,
                    "product_name": product_name,
                    "barcode": stock.barcode,
                    "quantity": 1,
                    "unit_price": unit_price,
                    "warranty_month": stock.warranty_month or "-",
                    "status": stock.status,
                }
            )
            total_quantity += 1
            total_value += unit_price

        template = self.env.get_template("grn.html")
        return template.render(
            company=company,
            grn={
                "id": grn.id,
                "good_received_no": grn.good_received_no,
                "added_date": str(grn.added_date) if grn.added_date else "",
                "branch_code": grn.branch_code,
                "received_by": getattr(grn, "received_by", None),
                "remarks": getattr(grn, "remarks", None),
            },
            po={
                "purchasing_order_no": po.purchasing_order_no if po else "N/A",
                "purchasing_order_date": str(po.purchasing_order_date) if po else "N/A",
                "purchasing_invoice_no": po.purchasing_invoice_no if po else "N/A",
            },
            supplier=supplier,
            branch=branch,
            items=items,
            total_quantity=total_quantity,
            total_value=total_value,
            options={
                "show_header": show_header,
                "show_discount": show_discount,
                "show_signatures": show_signatures,
                "custom_remarks": custom_remarks,
            },
            generated_at=tz.now().strftime("%Y-%m-%d %H:%M:%S"),
        )

    def generate_purchase_return_report(
        self,
        return_id: int,
        show_header: bool = True,
        show_discount: bool = True,
        show_signatures: bool = True,
        custom_remarks: Optional[str] = None,
    ) -> str:

        purchase_return = (
            self.db.query(PurchasingReturn)
            .options(
                joinedload(PurchasingReturn.items).joinedload(
                    PurchasingReturnItems.product
                ),
                joinedload(PurchasingReturn.items).joinedload(
                    PurchasingReturnItems.sales_stock
                ),
            )
            .filter(PurchasingReturn.id == return_id)
            .first()
        )

        if not purchase_return:
            raise HTTPException(
                status_code=404, detail=f"Purchase Return #{return_id} not found"
            )

        grn = (
            self.db.query(GoodReceivedNote)
            .filter(GoodReceivedNote.id == purchase_return.goodreceivednote_id)
            .first()
            if purchase_return.goodreceivednote_id
            else None
        )

        po = None
        if grn and grn.purchasingorders_id:
            po = (
                self.db.query(PurchasingOrder)
                .filter(PurchasingOrder.id == grn.purchasingorders_id)
                .first()
            )

        company = self._get_company_info()
        supplier_id = (
            po.first_suppliers_id
            if po
            else (
                purchase_return.supplier_id
                if hasattr(purchase_return, "supplier_id")
                else None
            )
        )
        supplier = self._get_supplier_info(supplier_id) if supplier_id else {}
        branch = self._get_branch_info(purchase_return.branch_code)

        items = []
        total_quantity = 0
        total_value = 0

        for item in purchase_return.items:
            unit_price = item.purchasing_price or 0
            product_name = (
                item.product.name if item.product else f"Product #{item.product_id}"
            )
            stock_status = item.sales_stock.status if item.sales_stock else "unknown"
            branch_code = (
                item.sales_stock.branch_code
                if item.sales_stock
                else purchase_return.branch_code
            )
            added_date = (
                str(item.added_date)
                if hasattr(item, "added_date") and item.added_date
                else ""
            )

            items.append(
                {
                    "product_id": item.product_id,
                    "product_name": product_name,
                    "barcode": item.barcode,
                    "branch_code": branch_code,
                    "purchasing_price": unit_price,
                    "status": stock_status,
                    "added_date": added_date,
                }
            )
            total_quantity += 1
            total_value += unit_price

        template = self.env.get_template("purchase_return.html")
        return template.render(
            company=company,
            return_data={
                "id": purchase_return.id,
                "purchasing_return_no": purchase_return.purchasing_return_no,
                "branch_code": purchase_return.branch_code,
                "added_date": (
                    str(purchase_return.added_date)
                    if purchase_return.added_date
                    else ""
                ),
                "status": purchase_return.status,
                "is_approved": purchase_return.status == "approved",
                "approved_date": (
                    str(purchase_return.approved_date)
                    if purchase_return.approved_date
                    else None
                ),
                "remark": purchase_return.remark,
            },
            grn={"good_received_no": grn.good_received_no if grn else "N/A"},
            po={
                "purchasing_order_no": po.purchasing_order_no if po else "N/A",
                "purchasing_order_date": str(po.purchasing_order_date) if po else "N/A",
            },
            supplier=supplier,
            branch=branch,
            items=items,
            total_quantity=total_quantity,
            total_value=total_value,
            options={
                "show_header": show_header,
                "show_discount": show_discount,
                "show_signatures": show_signatures,
                "custom_remarks": custom_remarks,
            },
            generated_at=tz.now().strftime("%Y-%m-%d %H:%M:%S"),
        )

    def generate_quotation_report(
        self,
        quote_id: int,
        show_header: bool = True,
        show_discount: bool = True,
        show_signatures: bool = True,
        custom_remarks: Optional[str] = None,
    ) -> str:
        quote = (
            self.db.query(SalesQuote)
            .options(joinedload(SalesQuote.items))
            .filter(SalesQuote.id == quote_id)
            .first()
        )

        if not quote:
            raise HTTPException(
                status_code=404, detail=f"Quotation #{quote_id} not found"
            )

        company = self._get_company_info()
        customer = self._get_customer_info(quote.customer_id)
        branch = self._get_branch_info(quote.branch_code)

        items = []
        subtotal = 0
        total_discount = 0

        for item in quote.items:
            product = (
                self.db.query(Product).filter(Product.id == item.product_id).first()
            )

            # Calculate item totals
            quantity = item.quantity or 0
            unit_price = float(item.selling_price or 0)
            base_total = quantity * unit_price

            # Discount
            discount_percent = float(item.discount_percentage or 0)
            discount_amount = base_total * (discount_percent / 100)

            line_total = base_total - discount_amount

            items.append(
                {
                    "product_id": item.product_id,
                    "product_name": (
                        product.name if product else f"Product #{item.product_id}"
                    ),
                    "description": getattr(item, "description", "") or "",
                    "quantity": quantity,
                    "selling_price": unit_price,
                    "discount_percentage": discount_percent,
                    "discount_amount": discount_amount,
                    "warrenty_month": item.warrenty_month,
                    "total_amount": line_total,
                }
            )

            subtotal += base_total
            total_discount += discount_amount

        final_total = subtotal - total_discount

        template = self.env.get_template("quotation.html")
        return template.render(
            company=company,
            quote={
                "id": quote.id,
                "quote_no": quote.quote_no,
                "created_date": str(quote.created_date) if quote.created_date else "",
                "valid_until": str(quote.valid_until) if quote.valid_until else "",
                "status": quote.status or "draft",
                "branch_code": quote.branch_code,
                "is_estimate": quote.is_estimate,
                "remarks": quote.remarks,
                "customer_notes": quote.customer_notes,
            },
            customer=customer,
            branch=branch,
            items=items,
            totals={
                "subtotal": subtotal,
                "discount": total_discount,
                "total_amount": final_total,
            },
            options={
                "show_header": show_header,
                "show_discount": show_discount,
                "show_signatures": show_signatures,
                "custom_remarks": custom_remarks,
            },
            generated_at=tz.now().strftime("%Y-%m-%d %H:%M:%S"),
        )

    def generate_invoice_report(
        self,
        invoice_id: int,
        show_header: bool = True,
        show_discount: bool = True,
        show_signatures: bool = True,
        custom_remarks: Optional[str] = None,
    ) -> str:
        invoice = (
            self.db.query(Invoice)
            .options(joinedload(Invoice.items).joinedload(InvoiceItems.product))
            .filter(Invoice.id == invoice_id)
            .first()
        )

        if not invoice:
            raise HTTPException(
                status_code=404, detail=f"Invoice #{invoice_id} not found"
            )

        company = self._get_company_info()
        customer = self._get_customer_info(invoice.customer_id)
        branch = self._get_branch_info(invoice.branch_code)

        # Fetch agent commission amount
        commission = self.db.query(CustomerAgentCommission).filter(
            CustomerAgentCommission.invoice_id == invoice.id
        ).first()
        agent_commission_amount = commission.commission_amount if commission else 0

        item_arrangement = OrderedDict()

        for item in invoice.items:
            _discount_percentage = item.discount_percent or 0 if show_discount else 0
            item_group_key = (item.product_id, item.selling_price, item.warrenty_month, _discount_percentage)
            if not item_arrangement.get(item_group_key, []):
                _product = item.product.name if item.product and item.product.name else f"Product #{item.product_id}"
                _product_category = item.product.category.name if item.product and item.product.category else ""
                _product_brand = item.product.brand.brand_name if item.product and item.product.brand else ""
                _discount_txt = f" ({_discount_percentage}% Discount)" if _discount_percentage else ""
                _product_full_description = ' '.join([_product_category, _product_brand, _product, _discount_txt]).strip()    
                item_arrangement[item_group_key] = [
                    len(item_arrangement) + 1, # Item No (will be updated later)
                    _product_full_description, # Invoice description
                    item.warrenty_month,
                    0, # Invoice quantity
                    item.selling_price,
                    0, #Total price
                ]
            _barcode = item.barcode or ""
            if _barcode:
                item_arrangement[item_group_key][1] += '\n' + _barcode
            item_arrangement[item_group_key][3] += item.quantity or 0
            item_arrangement[item_group_key][5] += item.line_total or (item.quantity * item.selling_price)
            

        items = [list([str(_item) for _item in item]) for item in item_arrangement.values()]

        # Process payment methods for breakdown
        payments = []
        if invoice.cash_amount > 0:
            payments.append({"method": "Cash", "amount": invoice.cash_amount})
        if invoice.card_visa_amount > 0:
            payments.append({"method": "Visa Card", "amount": invoice.card_visa_amount})
        if invoice.card_mastercard_amount > 0:
            payments.append(
                {"method": "Mastercard", "amount": invoice.card_mastercard_amount}
            )
        if invoice.card_amex_amount > 0:
            payments.append({"method": "Amex", "amount": invoice.card_amex_amount})
        if invoice.cheque_amount > 0:
            payments.append({"method": "Cheque", "amount": invoice.cheque_amount})
        if invoice.bank_transfer_amount > 0:
            payments.append(
                {"method": "Bank Transfer", "amount": invoice.bank_transfer_amount}
            )
        if invoice.credit_amount > 0:
            payments.append({"method": "Credit", "amount": invoice.credit_amount})

        template = self.env.get_template("printable_invoice.html")
        return template.render(
            company=company,
            invoice={
                "pageType":       'TAX INVOICE' if invoice.is_tax_invoice else '',
                "invoiceNo":      invoice.invoice_no,
                "soNo":           invoice.credit_payment_id if invoice.credit_payment_id else '',
                "date":           invoice.created_date.strftime("%d %b %Y") if invoice.created_date else "",
                "time":           invoice.created_at.strftime("%I:%M %p") if invoice.created_at else "",
                "terms":          '', 
                "ourRefPoNo":     '', 
                "ourRefPoDate":   '', 
                "repCode":        invoice.customer_agent_id or invoice.sale_rep_id or '',
                "sysCode":        self._generate_syscode_from_amount(agent_commission_amount),
                "customerCode":   invoice.customer_id or '',
                "customerName":   customer.get("customer_name", ""),
                "customerAddress": f"{customer.get('customer_address', '') + ' ' + customer.get('email', '')}".strip(),
                "customerContact": f"{customer.get('mobile_number', '') + '  ' + customer.get('land_number', '')}".strip(),
                "chequeBankName": '', #TODO
                "chequeAmount":   invoice.cheque_amount or '',
                "chequeDate":     invoice.cheque_date.strftime("%d %b %Y") if invoice.cheque_date else '',
                "subTotal":       invoice.subtotal,
                "vat":            invoice.tax_amount,
                "btt":            invoice.service_charge_amount,
                "netTotal":       invoice.grand_total,
                #TODO: NIY
                "paymentMethod": invoice.payment_method.replace("_", " ").title(),
                "discountAmount": invoice.discount_amount,
                "cuponAmount": invoice.cupon_amount,
                "giftVoucherAmount": invoice.gift_voucher_amount,
                "paidAmount": invoice.paid_amount,
                "balanceDue": invoice.balance_due,
            },
            customer=customer,
            branch=branch,
            items=items,
            payments=payments, #TODO: NIY - need to add payment method breakdown to invoice model
            options={
                "show_header": show_header,
                "show_discount": show_discount,
                "show_signatures": show_signatures,
                "custom_remarks": custom_remarks,
            },
            generated_at=tz.now().strftime("%Y-%m-%d %H:%M:%S"),
        )

    def generate_payroll_report(
        self,
        period: Optional[str] = None,
        show_header: bool = True,
        show_discount: bool = True,
        show_signatures: bool = True,
        custom_remarks: Optional[str] = None,
    ) -> str:
        # Fetch active employees with their salary profile
        employees = (
            self.db.query(Employee)
            .options(joinedload(Employee.salary_profile), joinedload(Employee.user))
            .all()
        )

        if not period:
            period = tz.now().strftime("%B %Y")

        company = self._get_company_info()

        emp_data = []
        total_salary = 0
        total_deductions = 0
        total_net_pay = 0

        for emp in employees:
            profile = emp.salary_profile
            basic = (
                float(profile.basic_salary) if profile and profile.basic_salary else 0.0
            )

            # Simple calculation for demo/standardization purposes as per requested template style
            # In a real system, this would come from a calculated payroll run
            allowances = 0.0
            if profile:
                allowances += float(profile.add_1_value or 0)
                allowances += float(profile.add_2_value or 0)

            # Assuming no deductions for basic report unless in profile?
            # Profile doesn't have deductions, only additions.
            # We'll stick to basic + allowances for now.
            deductions = 0.0

            net_pay = basic + allowances - deductions

            emp_name = "Unknown"
            if emp.user and emp.user.full_name:
                emp_name = emp.user.full_name
            elif emp.user and emp.user.username:
                emp_name = emp.user.username

            emp_data.append(
                {
                    "name": emp_name,
                    "salary": basic,
                    "allowances": allowances,
                    "deductions": deductions,
                    "net_pay": net_pay,
                }
            )

            total_salary += basic
            total_deductions += deductions
            total_net_pay += net_pay

        template = self.env.get_template("payroll.html")
        return template.render(
            company=company,
            period=period,
            employees=emp_data,
            total_salary=total_salary,
            total_deductions=total_deductions,
            total_net_pay=total_net_pay,
            options={
                "show_header": show_header,
                "show_discount": show_discount,
                "show_signatures": show_signatures,
                "custom_remarks": custom_remarks,
            },
            generated_at=tz.now().strftime("%Y-%m-%d %H:%M:%S"),
        )

    def generate_credit_note_report(
        self,
        sale_return_id: int,
        show_header: bool = True,
        show_signatures: bool = True,
        custom_remarks: Optional[str] = None,
    ) -> str:
        """Generate a credit note report for a sale return."""
        from app.modules.sales.models import SaleReturn, SaleReturnItems

        sale_return = (
            self.db.query(SaleReturn)
            .options(joinedload(SaleReturn.items), joinedload(SaleReturn.invoice))
            .filter(SaleReturn.id == sale_return_id)
            .first()
        )

        if not sale_return:
            raise HTTPException(
                status_code=404, detail=f"Sale Return #{sale_return_id} not found"
            )

        # Only generate credit note for processed returns
        if sale_return.status != "processed":
            raise HTTPException(
                status_code=400,
                detail=f"Credit note can only be generated for processed returns. Current status: {sale_return.status}",
            )

        company = self._get_company_info()
        customer = (
            self._get_customer_info(sale_return.invoice.customer_id)
            if sale_return.invoice
            else {}
        )
        branch = self._get_branch_info(sale_return.branch_code)

        # Get processed by user name
        processed_by_name = None
        if sale_return.processed_by:
            from app.auth.models import User

            user = (
                self.db.query(User).filter(User.id == sale_return.processed_by).first()
            )
            if user:
                processed_by_name = (
                    f"{user.first_name} {user.last_name}".strip() or user.username
                )

        items = []
        subtotal = 0

        for item in sale_return.items:
            product = (
                self.db.query(Product).filter(Product.id == item.product_id).first()
            )

            quantity = item.quantity or 1
            return_price = float(item.return_price or 0)
            total_amount = quantity * return_price

            items.append(
                {
                    "product_id": item.product_id,
                    "product_name": (
                        product.name if product else f"Product #{item.product_id}"
                    ),
                    "barcode": item.barcode,
                    "quantity": quantity,
                    "sold_price": float(item.sold_price or 0),
                    "return_price": return_price,
                    "condition": item.condition or "good",
                    "restockable": item.restockable,
                    "total_amount": total_amount,
                }
            )

            subtotal += total_amount

        template = self.env.get_template("credit_note.html")
        return template.render(
            company=company,
            credit_note={
                "id": sale_return.id,
                "sale_return_no": sale_return.sale_return_no,
                "added_date": (
                    str(sale_return.added_date) if sale_return.added_date else ""
                ),
                "status": sale_return.status or "pending",
                "branch_code": sale_return.branch_code,
                "return_reason": sale_return.return_reason,
                "remark": sale_return.remark,
                "payment_method": sale_return.payment_method or "credit_note",
                "refund_date": (
                    str(sale_return.refund_date) if sale_return.refund_date else None
                ),
                "refund_reference": sale_return.refund_reference,
                "processed_by_name": processed_by_name,
            },
            invoice={
                "invoice_no": (
                    sale_return.invoice.invoice_no if sale_return.invoice else "N/A"
                )
            },
            customer=customer,
            branch=branch,
            items=items,
            totals={
                "subtotal": subtotal,
                "tax_refund": float(sale_return.tax_refund or 0),
                "total_refund": float(sale_return.total_refund or 0),
            },
            options={
                "show_header": show_header,
                "show_signatures": show_signatures,
                "custom_remarks": custom_remarks,
            },
            generated_at=tz.now().strftime("%Y-%m-%d %H:%M:%S"),
        )

    def generate_expense_report(
        self,
        expense_id: int,
        show_header: bool = True,
        show_signatures: bool = True,
        custom_remarks: Optional[str] = None,
    ) -> str:
        """Generate a printable expense report."""
        expense = self.db.query(Expenses).filter(Expenses.id == expense_id).first()

        if not expense:
            raise HTTPException(
                status_code=404, detail=f"Expense #{expense_id} not found"
            )

        company = self._get_company_info()
        branch = self._get_branch_info(expense.branch_code)

        template = self.env.get_template("expense.html")
        return template.render(
            company=company,
            expense={
                "id": expense.id,
                "expenses_no": expense.expenses_no,
                "expense_type": expense.expense_type or "operational",
                "expense_category": expense.expense_category or "miscellaneous",
                "expenses_method": expense.expenses_method or "",
                "expense_amount": float(expense.expense_amount or 0),
                "expense_date": (
                    str(expense.expense_date) if expense.expense_date else ""
                ),
                "created_date": (
                    str(expense.created_date) if expense.created_date else ""
                ),
                "vendor_name": expense.vendor_name,
                "description": expense.description,
                "receipt_number": expense.receipt_number,
                "bill_reference": expense.bill_reference,
                "remarks": expense.remarks,
                "branch_code": expense.branch_code,
                "status": expense.status or "pending",
                "approved_date": (
                    str(expense.approved_date) if expense.approved_date else None
                ),
                "account_code": expense.account_code,
                "payment_status": expense.payment_status,
                "payment_date": (
                    str(expense.payment_date) if expense.payment_date else None
                ),
                "payment_method": expense.payment_method,
                "payment_reference": expense.payment_reference,
            },
            branch=branch,
            options={
                "show_header": show_header,
                "show_signatures": show_signatures,
                "custom_remarks": custom_remarks,
            },
            generated_at=tz.now().strftime("%Y-%m-%d %H:%M:%S"),
        )

    def generate_itn_report(
        self,
        itn_id: int,
        show_header: bool = True,
        show_signatures: bool = True,
        custom_remarks: Optional[str] = None,
    ) -> str:
        """Generate a printable Item Transfer Note report."""
        itn = (
            self.db.query(ItemTransferNote)
            .options(
                joinedload(ItemTransferNote.items).joinedload(
                    ItemTransferNoteItems.product
                ),
                joinedload(ItemTransferNote.from_location),
                joinedload(ItemTransferNote.to_location),
            )
            .filter(ItemTransferNote.id == itn_id)
            .first()
        )

        if not itn:
            raise HTTPException(
                status_code=404, detail=f"Item Transfer Note #{itn_id} not found"
            )

        company = self._get_company_info()
        branch = self._get_branch_info(itn.branch_code)

        from_loc = itn.from_location
        to_loc = itn.to_location

        items = []
        total_quantity = 0
        for item in itn.items:
            product = item.product
            items.append(
                {
                    "product_code": (
                        product.product_code
                        if product and hasattr(product, "product_code")
                        else ""
                    ),
                    "product_name": (
                        product.name if product else f"Product #{item.product_id}"
                    ),
                    "barcode": item.barcode or "",
                    "quantity": 1,
                    "uom": getattr(product, "uom", "") or "" if product else "",
                    "remarks": item.remark or "",
                }
            )
            total_quantity += 1

        template = self.env.get_template("item_transfer_note.html")
        return template.render(
            company=company,
            itn={
                "id": itn.id,
                "itn_no": itn.item_transfer_note,
                "transfer_date": str(itn.added_date) if itn.added_date else "",
                "created_date": str(itn.created_date) if itn.created_date else "",
                "branch_code": itn.branch_code,
                "status": itn.status or "pending",
                "remark": itn.remark,
                "remarks": itn.remark,
                "from_warehouse_name": (
                    from_loc.name if from_loc else f"Location #{itn.from_location_id}"
                ),
                "from_warehouse_id": itn.from_location_id,
                "to_warehouse_name": (
                    to_loc.name if to_loc else f"Location #{itn.to_location_id}"
                ),
                "to_warehouse_id": itn.to_location_id,
                "priority": "Normal",
            },
            branch=branch,
            items=items,
            total_quantity=total_quantity,
            options={
                "show_header": show_header,
                "show_signatures": show_signatures,
                "custom_remarks": custom_remarks,
            },
            generated_at=tz.now().strftime("%Y-%m-%d %H:%M:%S"),
        )

    def generate_voucher_report(
        self,
        voucher_id: int,
        show_header: bool = True,
        show_signatures: bool = True,
        custom_remarks: Optional[str] = None,
    ) -> str:
        """Generate a printable gift voucher report."""
        voucher = (
            self.db.query(CustomerGiftVoucher)
            .options(joinedload(CustomerGiftVoucher.usages))
            .filter(CustomerGiftVoucher.id == voucher_id)
            .first()
        )

        if not voucher:
            raise HTTPException(
                status_code=404, detail=f"Gift Voucher #{voucher_id} not found"
            )

        company = self._get_company_info()
        branch = (
            self._get_branch_info(voucher.branch_code)
            if voucher.branch_code
            else {"branch_name": ""}
        )

        # Build usage history
        usage_history = []
        amount_used = 0
        for usage in voucher.usages:
            inv = self.db.query(Invoice).filter(Invoice.id == usage.invoice_id).first()
            usage_history.append(
                {
                    "date": str(usage.used_date) if usage.used_date else "",
                    "reference": (
                        inv.invoice_no if inv else f"Invoice #{usage.invoice_id}"
                    ),
                    "description": "Voucher redemption",
                    "amount": float(usage.amount_used or 0),
                }
            )
            amount_used += float(usage.amount_used or 0)

        remaining_balance = float(voucher.balance or 0)

        # Calculate expiry date
        expiry_date = None
        if voucher.date and voucher.valid_period_in_months:
            from dateutil.relativedelta import relativedelta

            expiry_date = str(
                voucher.date + relativedelta(months=voucher.valid_period_in_months)
            )

        template = self.env.get_template("voucher.html")
        return template.render(
            company=company,
            voucher={
                "id": voucher.id,
                "voucher_code": voucher.barcode_no,
                "amount": float(voucher.amount or 0),
                "amount_used": amount_used,
                "remaining_balance": remaining_balance,
                "status": voucher.status or "active",
                "issue_date": str(voucher.date) if voucher.date else "",
                "created_date": str(voucher.created_at) if voucher.created_at else "",
                "expiry_date": expiry_date,
                "branch_code": voucher.branch_code or "",
                "customer_name": voucher.customer_name,
                "voucher_type": "Gift",
                "payment_method": voucher.payment_method,
                "purchased_invoice_no": voucher.purchased_invoice_no,
                "remarks": None,
            },
            branch=branch,
            usage_history=usage_history,
            options={
                "show_header": show_header,
                "show_signatures": show_signatures,
                "custom_remarks": custom_remarks,
            },
            generated_at=tz.now().strftime("%Y-%m-%d %H:%M:%S"),
        )

    def generate_journal_entry_report(
        self,
        je_id: int,
        show_header: bool = True,
        show_signatures: bool = True,
        custom_remarks: Optional[str] = None,
    ) -> str:
        """Generate a printable journal entry report."""
        je = (
            self.db.query(JournalEntry)
            .options(
                joinedload(JournalEntry.lines).joinedload(JournalEntryLine.account)
            )
            .filter(JournalEntry.id == je_id)
            .first()
        )

        if not je:
            raise HTTPException(
                status_code=404, detail=f"Journal Entry #{je_id} not found"
            )

        company = self._get_company_info()
        branch = self._get_branch_info(je.branch_code or "MAIN")

        # Build line items with account info
        lines = []
        for line in sorted(je.lines, key=lambda l: l.line_number):
            account = line.account
            lines.append(
                {
                    "line_number": line.line_number,
                    "account_code": account.account_code if account else "",
                    "account_name": (
                        account.account_name
                        if account
                        else f"Account #{line.account_id}"
                    ),
                    "description": line.description or "",
                    "debit_amount": float(line.debit_amount or 0),
                    "credit_amount": float(line.credit_amount or 0),
                }
            )

        template = self.env.get_template("journal_entry.html")
        return template.render(
            company=company,
            je={
                "id": je.id,
                "journal_entry_no": je.journal_entry_no,
                "entry_date": str(je.entry_date) if je.entry_date else "",
                "posting_date": str(je.posting_date) if je.posting_date else "",
                "entry_type": (je.entry_type or "standard").replace("_", " ").title(),
                "description": je.description or "",
                "total_debit": float(je.total_debit or 0),
                "total_credit": float(je.total_credit or 0),
                "status": je.status or "draft",
                "is_reversed": je.is_reversed or False,
                "fiscal_year": je.fiscal_year,
                "fiscal_period": je.fiscal_period,
                "branch_code": je.branch_code or "",
            },
            lines=lines,
            branch=branch,
            options={
                "show_header": show_header,
                "show_signatures": show_signatures,
                "custom_remarks": custom_remarks,
            },
            generated_at=tz.now().strftime("%Y-%m-%d %H:%M:%S"),
        )


def get_document_report_service(db: Session) -> DocumentReportService:

    return DocumentReportService(db)
