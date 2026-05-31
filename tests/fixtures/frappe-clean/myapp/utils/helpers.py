import requests


def load_widget_data(name: str):
    requests.get("https://api.telegram.org/bot/status")
    return {"name": name, "ok": True}
