"""
state.py

Everything loaded once at startup (model, thresholds, zones, road graph) plus the
latest live-computed snapshots live here, on a single AppState instance held at
app.state.flood — never reloaded or rebuilt per-request. A single asyncio.Lock guards
the "latest" fields since the background poller (a long-running task) and request
handlers both touch them.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .model_service import ModelArtifacts


@dataclass
class AppState:
    artifacts: ModelArtifacts
    graph: Any  # networkx.Graph, loaded once by routing_service.load_graph()

    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    latest_current: dict | None = None
    latest_forecast: list | None = None
    latest_live_conditions: Any = None
    last_updated: datetime | None = None
    poller_task: asyncio.Task | None = None
    tide_poller_task: asyncio.Task | None = None

    # (max_tide_height_m, num_high_tides, tide_source) — refreshed on its own slower
    # loop (config.TIDE_POLL_INTERVAL_SECONDS) and reused by every rain-poll cycle in
    # between, so the fast rainfall loop doesn't burn WorldTides' request quota.
    cached_tide: tuple[float, int, str] | None = None

    def is_ready(self) -> bool:
        return self.latest_current is not None
