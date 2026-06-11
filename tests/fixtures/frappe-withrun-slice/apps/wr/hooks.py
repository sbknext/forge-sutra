app_name = "wr"
app_title = "WithRun"

doc_events = {
    "Delivery Order": {
        "on_submit": "wr.order.handler.on_delivery_submit"
    }
}

scheduler_events = {
    "daily": ["wr.utils.sync.run_delivery_sync"]
}
