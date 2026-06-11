import requests


def validate_payload(payload: dict):
    pass


def run_daily_sync():
    requests.get("https://api.example.com/sync")
