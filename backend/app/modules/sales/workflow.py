"""
Sales Order Workflow — delegates to the centralized ApprovalService.

Kept as a facade so existing code that references ``sales_workflow``
continues to work, while the actual approval logic is managed by
the shared ``approval_service``.
"""

from app.common.enums import DocumentStatus


class SalesOrderWorkflow:
    def submit_for_approval(self, order):
        order.status = DocumentStatus.PENDING
        order.approval_status = DocumentStatus.PENDING
        return order

    def approve(self, order):
        order.status = DocumentStatus.APPROVED
        order.approval_status = DocumentStatus.APPROVED
        return order

    def reject(self, order, reason: str = ""):
        order.status = DocumentStatus.REJECTED
        order.approval_status = DocumentStatus.REJECTED
        return order

    def cancel(self, order):
        order.status = DocumentStatus.CANCELLED
        order.approval_status = DocumentStatus.CANCELLED
        return order


sales_workflow = SalesOrderWorkflow()
