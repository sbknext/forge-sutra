import frappe

from .helpers import log_delivery_event


def process_delivery(payload: dict):
    """Core delivery processor — creates Delivery Order doc."""
    doc = frappe.new_doc("Delivery Order")
    log_delivery_event("process_delivery_called")
    return doc


def on_delivery_submit(doc, method):
    """doc_events handler — fires on Delivery Order submit."""
    process_delivery({"doc": doc.name})
