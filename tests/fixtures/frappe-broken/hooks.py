doc_events = {
    "Widget": {
        "on_submit": "myapp.events.handlers.missing_handler"
    }
}

scheduler_events = {
    "daily": ["myapp.jobs.removed_job.run_daily"]
}
