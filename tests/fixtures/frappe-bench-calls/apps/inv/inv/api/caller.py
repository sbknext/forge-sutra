import frappe
import requests


@frappe.whitelist()
def call_via_frappe(payload: dict):
    """Calls a sibling endpoint via frappe.call with a literal dotted method string."""
    return frappe.call("inv.api.endpoint.create_order", payload=payload)


def call_via_requests_post(payload: dict):
    """Calls the same endpoint via requests.post with a /api/method/ path."""
    return requests.post("/api/method/inv.api.endpoint.create_order", json=payload)


def call_via_requests_external(payload: dict):
    """Calls an external host — should NOT resolve to in-repo node."""
    return requests.post("https://external.example.com/api/capture", json=payload)


def call_unresolvable():
    """Dynamic frappe.call — variable method string, must not emit in-repo edge."""
    method = get_method_name()
    frappe.call(method)
