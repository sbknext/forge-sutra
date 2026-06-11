import frappe

from .helpers_local import log_event


def process_order(payload: dict):
    doc = frappe.new_doc("Shipment")
    log_event("process_order_called")
    return doc


def on_shipment_submit(doc, method):
    process_order({"doc": doc.name})
