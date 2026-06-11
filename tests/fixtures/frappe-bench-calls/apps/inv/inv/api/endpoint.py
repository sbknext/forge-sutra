import frappe

from inv.handler.order import process_order
from inv.utils.helpers import validate_payload


@frappe.whitelist()
def create_order(payload: dict):
    validate_payload(payload)
    return process_order(payload)
