"""Dataset API routes."""
from flask import Blueprint, request, jsonify
from backend.services import dataset_service, coordinate_service
from config import BUILTIN_DATASETS
import numpy as np
import pandas as pd

dataset_bp = Blueprint("datasets", __name__)


@dataset_bp.route("/datasets", methods=["GET"])
def list_datasets():
    datasets = dataset_service.list_datasets()
    return jsonify({"datasets": datasets})


@dataset_bp.route("/datasets/<name>/preview", methods=["GET"])
def preview_dataset(name):
    try:
        preview = dataset_service.preview_dataset(name)
        # Also detect coordinates
        coord_info = coordinate_service.detect_coordinate_columns(preview["columns"])
        preview["coord_detection"] = coord_info
        # If built-in, include pre-configured settings
        if name in BUILTIN_DATASETS:
            preview["default_config"] = BUILTIN_DATASETS[name]
        return jsonify(preview)
    except FileNotFoundError:
        return jsonify({"error": f"Dataset not found: {name}"}), 404


@dataset_bp.route("/datasets/upload", methods=["POST"])
def upload_dataset():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    try:
        name = dataset_service.save_uploaded(file)
        preview = dataset_service.preview_dataset(name)
        coord_info = coordinate_service.detect_coordinate_columns(preview["columns"])
        return jsonify({
            "name": name,
            "rows": preview["n_total"],
            "columns": preview["columns"],
            "numeric_columns": preview["numeric_columns"],
            "coord_detection": coord_info,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@dataset_bp.route("/datasets/configure", methods=["POST"])
def configure_dataset():
    """Set column roles and prepare data for modeling."""
    data = request.get_json()
    dataset_name = data.get("dataset")
    target_col = data.get("target")
    feature_cols = data.get("features")
    coord_cols = data.get("coords")  # [x_col, y_col]
    coord_type = data.get("coord_type", "geodetic")
    epsg_code = data.get("epsg")  # optional EPSG code for projected CRS
    region_col = data.get("region")

    if not all([dataset_name, target_col, feature_cols, coord_cols]):
        return jsonify({"error": "Missing required fields"}), 400

    try:
        df = dataset_service.load_dataset(dataset_name)

        y = df[target_col].values.astype(float)
        X = df[feature_cols].values.astype(float)
        raw_coords = df[coord_cols].values.astype(float)

        auto_converted = False
        effective_coord_type = coord_type

        # Auto-detect: if user says "geodetic" but coords look projected, auto-convert
        if coord_type == "geodetic" and coordinate_service.is_likely_projected(
                raw_coords[:, 0], raw_coords[:, 1]):
            # Coordinates are clearly not lon/lat — try to convert
            if epsg_code:
                lon, lat = coordinate_service.convert_to_lonlat(
                    raw_coords[:, 0], raw_coords[:, 1], "projected", epsg_code=epsg_code
                )
                # Use converted lon/lat as the working coordinates
                coords = np.column_stack([lon, lat])
                coords_lonlat = coords.copy()
                effective_coord_type = "geodetic"  # now we're in lon/lat space
                auto_converted = True
            else:
                # Try auto-detection (UTM zone estimation)
                try:
                    lon, lat = coordinate_service.convert_to_lonlat(
                        raw_coords[:, 0], raw_coords[:, 1], "projected", epsg_code=None
                    )
                    if -180 <= np.mean(lon) <= 180 and -90 <= np.mean(lat) <= 90:
                        coords = np.column_stack([lon, lat])
                        coords_lonlat = coords.copy()
                        effective_coord_type = "geodetic"
                        auto_converted = True
                    else:
                        # Conversion failed, fall back to treating as projected
                        coords = raw_coords
                        effective_coord_type = "projected"
                        coords_lonlat = np.column_stack([lon, lat])
                except Exception:
                    # Can't convert — treat as projected
                    coords = raw_coords
                    effective_coord_type = "projected"
                    lon = raw_coords[:, 0]
                    lat = raw_coords[:, 1]
                    coords_lonlat = raw_coords.copy()
        elif coord_type == "projected":
            # Standard projected: keep native coords for spatial analysis
            coords = raw_coords
            lon, lat = coordinate_service.convert_to_lonlat(
                raw_coords[:, 0], raw_coords[:, 1], coord_type, epsg_code=epsg_code
            )
            coords_lonlat = np.column_stack([lon, lat])
        else:
            # Standard geodetic: coords are already lon/lat
            coords = raw_coords
            coords_lonlat = raw_coords.copy()

        # Compute coordinate extent statistics for bandwidth scaling
        coord_stats = coordinate_service.compute_coord_stats(coords)
        bandwidth_suggestion = coordinate_service.suggest_bandwidth(effective_coord_type, coord_stats)

        # Store in single-user session (no cookie dependency)
        from backend.services.session_store import get_session
        sess = get_session()
        sess.update({
            "dataset_name": dataset_name,
            "df": df,
            "X": X,
            "y": y,
            "coords": coords,
            "coords_lonlat": coords_lonlat,
            "target_col": target_col,
            "feature_cols": feature_cols,
            "coord_cols": coord_cols,
            "coord_type": effective_coord_type,
            "region_col": region_col,
        })

        response = {
            "status": "ok",
            "n_rows": len(y),
            "n_features": X.shape[1],
            "coord_type": effective_coord_type,
            "coord_stats": coord_stats,
            "bandwidth_suggestion": bandwidth_suggestion,
            "y_stats": {
                "mean": round(float(np.mean(y)), 4),
                "std": round(float(np.std(y)), 4),
                "min": round(float(np.min(y)), 4),
                "max": round(float(np.max(y)), 4),
            },
        }

        if auto_converted:
            response["auto_converted"] = True
            response["message"] = (
                "Coordinates were auto-converted from projected to lon/lat. "
                "Bandwidth is now in degrees."
            )

        return jsonify(response)
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 400


@dataset_bp.route("/datasets/<name>/metadata", methods=["GET"])
def get_metadata(name):
    meta = dataset_service.get_dataset_metadata(name)
    return jsonify({"metadata": meta})
