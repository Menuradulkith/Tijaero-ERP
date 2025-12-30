from app.common.workflow import WorkflowStatus

class SalesOrderWorkflow:
    def submit_for_approval(self, order):
        order.status = WorkflowStatus.PENDING
        return order
    
    def approve(self, order):
        order.status = WorkflowStatus.APPROVED
        return order

sales_workflow = SalesOrderWorkflow()
