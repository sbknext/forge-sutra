import frappe
from frappe.model.document import Document


class Shipment(Document):
    def validate(self):
        pass

    def on_submit(self):
        pass
