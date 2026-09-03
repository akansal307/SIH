"""Pydantic request models. Response bodies are plain dicts already shaped as the
wire-format types documented in README.md "API Contract" (built by model_service.py /
routing_service.py), so they don't need their own schema classes here."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SimulateRequest(BaseModel):
    # Matches exactly what src/api/floodApi.ts::runSimulation() sends.
    scenario: str | None = Field(
        default=None,
        description="Optional preset id (e.g. 'extreme_cloudburst'). If it matches a "
                    "known preset, that preset's rainfall/duration/blockage are used "
                    "unless overridden below. If omitted or unrecognised, the explicit "
                    "fields below are used directly.",
    )
    rainfall_mm_hr: float | None = Field(default=None, ge=0)
    duration_min: float | None = Field(default=None, ge=1)
    blockage_percent: float | None = Field(default=None, ge=0, le=100)
    max_tide_height_m: float | None = Field(default=None, ge=0)
    num_high_tides: int | None = Field(default=None, ge=0)
