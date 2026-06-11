"""
Module with dynamic call that must NOT produce an edge (AC4).
"""


def do_dynamic_stuff(obj, method_name: str):
    # getattr-based call — dynamic target, no edge expected
    fn = getattr(obj, method_name)
    return fn()
