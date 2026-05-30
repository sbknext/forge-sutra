import frappe

@frappe.whitelist()
def get_widget(name: str):
    return {"name": name}
