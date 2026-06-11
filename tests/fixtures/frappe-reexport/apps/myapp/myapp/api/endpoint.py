"""
Whitelisted endpoint that calls process_return imported via the re-export
package (myapp.handlers.__init__ re-exports from .return_handler).

AC1: calls edge must reach the ultimate definition in return_handler.py
AC2: fromId must match the emitted endpoint node id (no orphan from)
"""

import frappe

from myapp.handlers import process_return


@frappe.whitelist()
def submit_return(doc_name: str):
    """API endpoint — delegates to re-exported handler."""
    doc = frappe.get_doc("Return", doc_name)
    return process_return(doc)


@frappe.whitelist()
def list_returns():
    """Pure endpoint with no in-repo callees — tests AC4 (no spurious edge)."""
    return frappe.get_list("Return")
