"""
handlers package — re-exports process_return so callers can do:
    from myapp.handlers import process_return
"""

from .return_handler import process_return
