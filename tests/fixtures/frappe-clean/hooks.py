doc_events = {
    "Widget": {
        "on_submit": "myapp.events.handlers.on_widget_submit"
    }
}

scheduler_events = {
    "daily": ["myapp.jobs.daily_job.run_daily"]
}
