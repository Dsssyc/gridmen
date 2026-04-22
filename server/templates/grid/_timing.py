"""
Timing helpers for grid mount (assembly + vector adjustment).

Exposes a dedicated DEBUG-level logger (`gridmen.grid.timing`) with its own
StreamHandler so timing output is visible regardless of the root logging
config (which is INFO by default in this project).

Usage:
    from ._timing import timed, timing_logger

    with timed("phase name", extra="more info"):
        do_work()
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager

_LOGGER_NAME = "gridmen.grid.timing"


def _make_logger() -> logging.Logger:
    logger = logging.getLogger(_LOGGER_NAME)
    logger.setLevel(logging.DEBUG)
    if not any(getattr(h, "_gridmen_timing", False) for h in logger.handlers):
        handler = logging.StreamHandler()
        handler.setLevel(logging.DEBUG)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s [%(name)s] %(levelname)s: %(message)s",
                datefmt="%H:%M:%S",
            )
        )
        handler._gridmen_timing = True  # type: ignore[attr-defined]
        logger.addHandler(handler)
        # Avoid duplicating through the root handler too.
        logger.propagate = False
    return logger


timing_logger = _make_logger()


@contextmanager
def timed(label: str, **extra):
    """Context manager that logs the elapsed time at DEBUG level.

    Args:
        label: Short description of the phase being timed.
        **extra: Additional key=value pairs appended to the log record.
    """
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed = time.perf_counter() - start
        if extra:
            extras = " ".join(f"{k}={v}" for k, v in extra.items())
            timing_logger.debug("%s took %.4fs (%s)", label, elapsed, extras)
        else:
            timing_logger.debug("%s took %.4fs", label, elapsed)


def log_debug(msg: str, *args, **kwargs) -> None:
    """Convenience wrapper to emit a DEBUG record on the timing logger."""
    timing_logger.debug(msg, *args, **kwargs)
