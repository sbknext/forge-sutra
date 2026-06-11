app_name = "myapp"
app_title = "My App"
app_publisher = "Test"
app_description = "Test app for reexport fixture"
app_email = "test@example.com"
app_license = "MIT"

doc_events = {
    "Return": {
        "on_submit": "myapp.handlers.return_handler.process_return",
    }
}
