"""
state.py

Everything loaded once at startup (model, thresholds, zones, road graph) plus the
latest live-computed snapshots live here, on a single AppState instance held at
app.state.flood.

The penalised routing graph is rebuilt once per live refresh cycle and reused by
dynamic route requests until the next refresh.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .model_service import ModelArtifacts


@dataclass
class AppState:
    artifacts: ModelArtifacts
    graph: Any

    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    latest_current: dict | None = None
    latest_forecast: list | None = None
    latest_streets: list | None = None
    latest_live_conditions: Any = None
    last_updated: datetime | None = None

    poller_task: asyncio.Task | None = None
    tide_poller_task: asyncio.Task | None = None

    # Cached flood-penalised graph used by dynamic routing.
    latest_penalised_graph: Any = None

    # Nearest graph node for each configured destination.
    destination_nodes: dict[str, Any] = field(default_factory=dict)

    # (max_tide_height_m, num_high_tides, tide_source)
    cached_tide: tuple[float, int, str] | None = None

    def is_ready(self) -> bool:
        return self.latest_current is not None
