import frappe

from myapp.utils.helpers import load_widget_data


@frappe.whitelist()
def get_widget(name: str):
    return load_widget_data(name)
