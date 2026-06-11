import frappe
import requests

from wr.order.handler import process_delivery
from wr.utils.sync import validate_delivery


@frappe.whitelist()
def create_delivery(payload: dict):
    """Whitelisted API endpoint — delegates to order handler and validator."""
    validate_delivery(payload)
    return process_delivery(payload)


@frappe.whitelist()
def fetch_external_status(tracking_id: str):
    """Calls an external tracking API via HTTP."""
    resp = requests.get(
        "https://api.trackingprovider.com/status/" + tracking_id
    )
    return resp.json()
