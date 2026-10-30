"""Report Center: reports defined once in code, run and exported from one place."""

from . import definitions  # noqa: F401  (registers the reports)
from . import aging, ledger, manufacturing, stock  # noqa: F401  (more reports, by area)
from .core import REGISTRY, get_report
