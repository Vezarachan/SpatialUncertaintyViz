"""Coordinate detection and conversion service."""
import numpy as np


def detect_coordinate_columns(columns):
    """Auto-detect coordinate columns and type from column names.
    Returns dict with x_col, y_col, coord_type or None if not detected.
    coord_type is one of: "geodetic" (lon/lat in degrees) or "projected" (meters/feet).
    """
    cols_lower = {c: c.lower() for c in columns}

    # Try geodetic (lon/lat)
    lon_col = lat_col = None
    for c, cl in cols_lower.items():
        if cl in ("lon", "lng", "longitude", "long"):
            lon_col = c
        if cl in ("lat", "latitude"):
            lat_col = c
    if lon_col and lat_col:
        return {"x_col": lon_col, "y_col": lat_col, "coord_type": "geodetic"}

    # Try UTM (a type of projected coordinate)
    utm_x = utm_y = None
    for c, cl in cols_lower.items():
        if "utm" in cl and ("x" in cl or "east" in cl):
            utm_x = c
        if "utm" in cl and ("y" in cl or "north" in cl):
            utm_y = c
    if utm_x and utm_y:
        return {"x_col": utm_x, "y_col": utm_y, "coord_type": "projected"}

    # Try other projected coordinate patterns
    proj_x = proj_y = None
    for c, cl in cols_lower.items():
        if cl in ("proj_x", "x", "easting"):
            proj_x = c
        if cl in ("proj_y", "y", "northing"):
            proj_y = c
    if proj_x and proj_y:
        return {"x_col": proj_x, "y_col": proj_y, "coord_type": "projected"}

    return None


def compute_coord_stats(coords):
    """Compute coordinate extent statistics for bandwidth scaling.
    coords: Nx2 array of original coordinates.
    Returns dict with min, max, span, diagonal for each axis.
    """
    x = coords[:, 0]
    y = coords[:, 1]
    x_min, x_max = float(np.min(x)), float(np.max(x))
    y_min, y_max = float(np.min(y)), float(np.max(y))
    x_span = x_max - x_min
    y_span = y_max - y_min
    diagonal = float(np.sqrt(x_span ** 2 + y_span ** 2))
    return {
        "x_min": round(x_min, 4),
        "x_max": round(x_max, 4),
        "y_min": round(y_min, 4),
        "y_max": round(y_max, 4),
        "x_span": round(x_span, 4),
        "y_span": round(y_span, 4),
        "diagonal": round(diagonal, 4),
    }


def suggest_bandwidth(coord_type, coord_stats):
    """Suggest bandwidth default, min, max, step based on coordinate type and extent.
    For geodetic coords (degrees): bandwidth is a fraction of the extent in degrees.
    For projected coords (meters): bandwidth is a fraction of the extent in meters.
    """
    diag = coord_stats["diagonal"]
    if diag <= 0:
        diag = 1.0

    if coord_type == "geodetic":
        # Typical extent: US ~60 degrees, city ~0.5 degrees
        # Default: ~0.5% of diagonal
        default_bw = round(diag * 0.005, 4)
        # Clamp to reasonable range
        default_bw = max(0.01, min(default_bw, 10.0))
        return {
            "default": default_bw,
            "min": round(max(0.001, diag * 0.0005), 4),
            "max": round(min(diag * 0.5, 50.0), 4),
            "step": round(max(0.001, default_bw / 10), 4),
        }
    else:
        # Projected coordinates (meters)
        # Typical extent: city ~30000m, state ~500000m, country ~5000000m
        # Default: ~1% of diagonal
        default_bw = round(diag * 0.01, 0)
        # Clamp to reasonable range
        default_bw = max(100, min(default_bw, 500000))
        return {
            "default": default_bw,
            "min": round(max(10, diag * 0.001), 0),
            "max": round(min(diag * 0.5, 5000000), 0),
            "step": round(max(10, default_bw / 20), 0),
        }


def estimate_utm_zone(x_coords, y_coords):
    """Estimate UTM zone from coordinate ranges. Returns EPSG code."""
    mean_x = np.mean(x_coords)
    mean_y = np.mean(y_coords)

    # Typical UTM easting range: 100,000 - 900,000
    if 100000 < mean_x < 900000 and mean_y > 0:
        # Northern hemisphere
        if 500000 < mean_x < 600000 and 5200000 < mean_y < 5400000:
            return 32610  # UTM Zone 10N (Seattle area)
        if 400000 < mean_x < 700000 and 4000000 < mean_y < 5000000:
            return 32611  # UTM Zone 11N
    return 32610  # Default to Zone 10N


def convert_to_lonlat(x_coords, y_coords, coord_type, epsg_code=None):
    """Convert coordinates to WGS84 lon/lat for Deck.gl.
    Returns (lon_array, lat_array).
    coord_type: "geodetic" or "projected"
    """
    x_coords = np.asarray(x_coords, dtype=float)
    y_coords = np.asarray(y_coords, dtype=float)

    if coord_type == "geodetic":
        return x_coords, y_coords

    if coord_type == "projected":
        from pyproj import Transformer

        if epsg_code:
            transformer = Transformer.from_crs(f"EPSG:{epsg_code}", "EPSG:4326", always_xy=True)
            lon, lat = transformer.transform(x_coords, y_coords)
            return lon, lat

        # Auto-detect: try UTM zone estimation from data range
        mean_x = np.mean(x_coords)
        mean_y = np.mean(y_coords)

        # Check if values look like UTM (easting ~100k-900k, northing ~0-10M)
        if 100000 < mean_x < 900000 and 0 < mean_y < 10000000:
            epsg_code = estimate_utm_zone(x_coords, y_coords)
            try:
                transformer = Transformer.from_crs(f"EPSG:{epsg_code}", "EPSG:4326", always_xy=True)
                lon, lat = transformer.transform(x_coords, y_coords)
                # Validate results are reasonable lon/lat
                if -180 <= np.mean(lon) <= 180 and -90 <= np.mean(lat) <= 90:
                    return lon, lat
            except Exception:
                pass

        # Fallback: normalize to approximate US bounds for display
        x_min, x_max = x_coords.min(), x_coords.max()
        y_min, y_max = y_coords.min(), y_coords.max()
        lon = -130 + (x_coords - x_min) / (x_max - x_min + 1e-10) * 65
        lat = 24 + (y_coords - y_min) / (y_max - y_min + 1e-10) * 26
        return lon, lat

    return x_coords, y_coords
