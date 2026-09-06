"""
config.py

Central place for paths, constants, and env-driven settings. Nothing under
data/source/ is ever written to by this backend — same rule the offline
scripts/ pipeline follows.
"""

import os

from dotenv import load_dotenv


load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))

HERE = os.path.dirname(os.path.abspath(__file__))          
BACKEND_ROOT = os.path.dirname(HERE)                       
ROOT = os.path.dirname(BACKEND_ROOT)                       

DATA_SOURCE = os.path.join(ROOT, "data", "source")
MODEL_PATH = os.path.join(DATA_SOURCE, "flood_nowcast_model.pkl")
THRESHOLDS_PATH = os.path.join(DATA_SOURCE, "flood_nowcast_thresholds.pkl")
FEATURE_COLS_PATH = os.path.join(DATA_SOURCE, "flood_nowcast_feature_cols.pkl")
EDGE_CACHE_PATH = os.path.join(DATA_SOURCE, "edge_cache.pkl")
GRAPHML_PATH = os.path.join(DATA_SOURCE, "city_graph_with_elevation (1).graphml")


ZONES_BASE_FALLBACK_PATH = os.path.join(ROOT, "data", "derived", "zones_base.json")

FORECAST_OFFSETS_MIN = [0, 30, 60, 120, 180]


CLASS_TO_RISK = {0: "LOW", 1: "MODERATE", 2: "HIGH"}


ANDHERI_LAT = float(os.environ.get("ANDHERI_LAT", "19.1197"))
ANDHERI_LON = float(os.environ.get("ANDHERI_LON", "72.8468"))


WEATHER_POLL_INTERVAL_SECONDS = int(os.environ.get("WEATHER_POLL_INTERVAL_SECONDS", "300"))


TIDE_POLL_INTERVAL_SECONDS = int(os.environ.get("TIDE_POLL_INTERVAL_SECONDS", "1800"))


TOMORROWIO_API_KEY = os.environ.get("TOMORROWIO_API_KEY", "")

WORLDTIDES_API_KEY = os.environ.get("WORLDTIDES_API_KEY", "")

FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "*")


ROUTE_OD_PAIRS = {
    "station-to-marol": dict(
        label="Andheri Station -> Marol Naka (MIDC)",
        origin=(72.846944, 19.119167),
        destination=(72.877000, 19.119000),
    ),
    "around-tilak-marg": dict(
        label="Lokmanya Tilak Marg crossing (north Andheri West)",
        origin=(72.818000, 19.145500),
        destination=(72.840000, 19.145500),
    ),
    "around-ns-road-5": dict(
        label="N. S. Road No. 5 crossing (south Andheri West)",
        origin=(72.818000, 19.104000),
        destination=(72.840000, 19.104000),
    ),
}


SIMULATION_PRESETS = {
    "normal_rain": dict(
        label="Normal Rain", description="Typical monsoon drizzle. Most streets stay clear.",
        rainfall_mm_hr=15, duration_min=60, elapsed_at_now_min=60, blockage_percent=0,
        max_tide_height_m=1.2, num_high_tides=0),
    "heavy_rain": dict(
        label="Heavy Rain", description="Sustained heavy showers across Andheri.",
        rainfall_mm_hr=50, duration_min=60, elapsed_at_now_min=60, blockage_percent=0,
        max_tide_height_m=1.4, num_high_tides=1),
    "drainage_stress_test": dict(
        label="Drainage Stress Test",
        description="Moderate, sustained rain that keeps falling. Calm right now — "
                     "watch the +60 min forecast step, where accumulated rainfall crosses "
                     "the model's real decision boundary (~76.7mm).",
        rainfall_mm_hr=45, duration_min=120, elapsed_at_now_min=45, blockage_percent=0,
        max_tide_height_m=1.5, num_high_tides=1),
    "extreme_cloudburst": dict(
        label="Extreme Cloudburst",
        description="A cloudburst-intensity downpour, the kind that has shut down Andheri Subway before.",
        rainfall_mm_hr=120, duration_min=60, elapsed_at_now_min=60, blockage_percent=0,
        max_tide_height_m=1.8, num_high_tides=1),
    "cloudburst_drain_blockage": dict(
        label="Cloudburst + Drain Blockage",
        description="Extreme cloudburst compounded by silted / blocked storm drains.",
        rainfall_mm_hr=120, duration_min=60, elapsed_at_now_min=60, blockage_percent=50,
        max_tide_height_m=1.8, num_high_tides=2),
}

SPEED_KMH = {
    "trunk": 32, "trunk_link": 28, "primary": 28, "primary_link": 24,
    "secondary": 26, "secondary_link": 22, "tertiary": 22, "tertiary_link": 20,
    "residential": 18, "living_street": 12, "unclassified": 18, "service": 12,
}
DEFAULT_SPEED_KMH = 20
RISK_PENALTY_MULTIPLIER = {"HIGH": 25.0, "MODERATE": 15.0, "LOW": 1.0}
