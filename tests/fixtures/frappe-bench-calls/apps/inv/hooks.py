app_name = "inv"
app_title = "Inventory"

doc_events = {
    "Shipment": {
        "on_submit": "inv.handler.order.on_shipment_submit"
    }
}

scheduler_events = {
    "daily": ["inv.utils.helpers.run_daily_sync"]
}
