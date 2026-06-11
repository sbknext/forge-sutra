import frappe
from frappe.model.document import Document


class DeliveryOrder(Document):
    """DocType controller for Delivery Order."""

    def validate(self):
        pass

    def on_submit(self):
        pass
