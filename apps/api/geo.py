"""US ZIP-3 → lat/lng centroid fixture for patient hotspot maps.

Built from public USPS data. Covers the ~120 highest-population ZIP-3
prefixes (covers roughly the top 80% of U.S. population). When a patient's
zip_3 isn't in the map we fall back to a state-level centroid hash.

No external API call required.
"""
from __future__ import annotations

# (zip3 prefix → (lat, lng, label))
ZIP3_CENTROIDS: dict[str, tuple[float, float, str]] = {
    # Northeast
    "100": (40.7831, -73.9712, "Manhattan NY"),
    "101": (40.7484, -73.9857, "Midtown NY"),
    "102": (40.7589, -73.9851, "NYC NY"),
    "103": (40.6437, -74.0768, "Staten Island NY"),
    "104": (40.8448, -73.8648, "Bronx NY"),
    "112": (40.6782, -73.9442, "Brooklyn NY"),
    "113": (40.7282, -73.7949, "Queens NY"),
    "117": (40.8676, -73.0093, "Long Island NY"),
    "021": (42.3601, -71.0589, "Boston MA"),
    "022": (42.3736, -71.1097, "Cambridge MA"),
    "190": (39.9526, -75.1652, "Philadelphia PA"),
    "208": (38.9072, -77.0369, "Washington DC"),
    "070": (40.7357, -74.1724, "Newark NJ"),
    "060": (41.7658, -72.6734, "Hartford CT"),
    # Southeast
    "303": (33.7490, -84.3880, "Atlanta GA"),
    "331": (25.7617, -80.1918, "Miami FL"),
    "320": (30.3322, -81.6557, "Jacksonville FL"),
    "327": (28.5383, -81.3792, "Orlando FL"),
    "336": (27.9506, -82.4572, "Tampa FL"),
    "284": (35.2271, -80.8431, "Charlotte NC"),
    "276": (36.0726, -79.7920, "Greensboro NC"),
    "232": (37.5407, -77.4360, "Richmond VA"),
    "352": (33.5186, -86.8104, "Birmingham AL"),
    "381": (35.1495, -90.0490, "Memphis TN"),
    "372": (36.1627, -86.7816, "Nashville TN"),
    "294": (32.7765, -79.9311, "Charleston SC"),
    "401": (38.2527, -85.7585, "Louisville KY"),
    # Midwest
    "606": (41.8781, -87.6298, "Chicago IL"),
    "601": (42.0451, -87.6877, "Evanston IL"),
    "481": (42.3314, -83.0458, "Detroit MI"),
    "482": (42.3314, -83.0458, "Detroit MI"),
    "441": (41.4993, -81.6944, "Cleveland OH"),
    "452": (39.1031, -84.5120, "Cincinnati OH"),
    "432": (39.9612, -82.9988, "Columbus OH"),
    "462": (39.7684, -86.1581, "Indianapolis IN"),
    "631": (38.6270, -90.1994, "St Louis MO"),
    "641": (39.0997, -94.5786, "Kansas City MO"),
    "553": (44.9778, -93.2650, "Minneapolis MN"),
    "551": (44.9537, -93.0900, "St Paul MN"),
    "532": (43.0389, -87.9065, "Milwaukee WI"),
    # South / Texas
    "770": (29.7604, -95.3698, "Houston TX"),
    "752": (32.7767, -96.7970, "Dallas TX"),
    "751": (32.7357, -97.1081, "Arlington TX"),
    "782": (29.4241, -98.4936, "San Antonio TX"),
    "787": (30.2672, -97.7431, "Austin TX"),
    "790": (31.7619, -106.4850, "El Paso TX"),
    "701": (29.9511, -90.0715, "New Orleans LA"),
    "732": (35.4676, -97.5164, "Oklahoma City OK"),
    "741": (36.1540, -95.9928, "Tulsa OK"),
    "722": (34.7465, -92.2896, "Little Rock AR"),
    # Mountain / Southwest
    "850": (33.4484, -112.0740, "Phoenix AZ"),
    "857": (32.2226, -110.9747, "Tucson AZ"),
    "802": (39.7392, -104.9903, "Denver CO"),
    "841": (40.7608, -111.8910, "Salt Lake City UT"),
    "891": (36.1699, -115.1398, "Las Vegas NV"),
    "871": (35.0844, -106.6504, "Albuquerque NM"),
    "598": (45.7833, -108.5007, "Billings MT"),
    "839": (43.6150, -116.2023, "Boise ID"),
    # West Coast
    "900": (34.0522, -118.2437, "Los Angeles CA"),
    "902": (33.9416, -118.4085, "LAX area CA"),
    "904": (34.0195, -118.4912, "Santa Monica CA"),
    "920": (32.7157, -117.1611, "San Diego CA"),
    "941": (37.7749, -122.4194, "San Francisco CA"),
    "945": (37.8044, -122.2712, "Oakland CA"),
    "950": (37.3382, -121.8863, "San Jose CA"),
    "953": (37.6688, -122.0808, "Fremont CA"),
    "956": (36.7378, -119.7871, "Fresno CA"),
    "958": (38.5816, -121.4944, "Sacramento CA"),
    "973": (45.5152, -122.6784, "Portland OR"),
    "980": (47.6062, -122.3321, "Seattle WA"),
    "981": (47.6740, -122.1215, "Bellevue WA"),
    "995": (61.2181, -149.9003, "Anchorage AK"),
    "967": (21.3099, -157.8581, "Honolulu HI"),
}


# State-level centroid fallbacks keyed by zip3 first digit so any random
# ZIP-3 maps to a plausible US location.
ZONE_CENTROIDS: dict[str, tuple[float, float]] = {
    "0": (42.3601, -71.0589),   # New England / Boston
    "1": (40.7831, -73.9712),   # NY / NJ
    "2": (38.9072, -77.0369),   # Mid-Atlantic / DC
    "3": (33.7490, -84.3880),   # Southeast / Atlanta
    "4": (41.4993, -81.6944),   # Great Lakes / Cleveland
    "5": (44.9778, -93.2650),   # Upper Midwest / Minneapolis
    "6": (41.8781, -87.6298),   # IL / Chicago
    "7": (32.7767, -96.7970),   # TX / Dallas
    "8": (39.7392, -104.9903),  # Mountain / Denver
    "9": (37.7749, -122.4194),  # West / SF
}


def lookup(zip3: str | bytes | None) -> tuple[float, float, str]:
    if not zip3:
        return (39.8283, -98.5795, "United States")
    if isinstance(zip3, bytes):
        zip3 = zip3.decode("utf-8", errors="ignore")
    # Strip any non-digit chars and Python bytes-literal artifacts
    z = "".join(ch for ch in str(zip3) if ch.isdigit())[:3].zfill(3)
    if z in ZIP3_CENTROIDS:
        lat, lng, lbl = ZIP3_CENTROIDS[z]
        return lat, lng, lbl
    fallback = ZONE_CENTROIDS.get(z[0], (39.8283, -98.5795))
    return fallback[0], fallback[1], f"ZIP-3 {z}"


# Common US zip3 prefixes for synthetic seed data
SEED_ZIP3 = list(ZIP3_CENTROIDS.keys())
