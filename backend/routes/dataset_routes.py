"""Dataset API routes."""
from flask import Blueprint, request, jsonify, session
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
    coord_type = data.get("coord_type", "lonlat")
    region_col = data.get("region")

    if not all([dataset_name, target_col, feature_cols, coord_cols]):
        return jsonify({"error": "Missing required fields"}), 400

    try:
        df = dataset_service.load_dataset(dataset_name)

        y = df[target_col].values.astype(float)
        X = df[feature_cols].values.astype(float)
        coords = df[coord_cols].values.astype(float)

        # Convert coordinates to lon/lat for Deck.gl
        lon, lat = coordinate_service.convert_to_lonlat(
            coords[:, 0], coords[:, 1], coord_type
        )
        coords_lonlat = np.column_stack([lon, lat])

        # Compute coordinate extent statistics for bandwidth scaling
        coord_stats = coordinate_service.compute_coord_stats(coords)
        bandwidth_suggestion = coordinate_service.suggest_bandwidth(coord_type, coord_stats)

        # Store in session-like global store (simple dict for single-user)
        from backend.services.session_store import store
        sid = session.get("sid")
        if not sid:
            import uuid
            sid = str(uuid.uuid4())[:8]
            session["sid"] = sid

        store[sid] = {
            "dataset_name": dataset_name,
            "df": df,
            "X": X,
            "y": y,
            "coords": coords,
            "coords_lonlat": coords_lonlat,
            "target_col": target_col,
            "feature_cols": feature_cols,
            "coord_cols": coord_cols,
            "coord_type": coord_type,
            "region_col": region_col,
        }

        return jsonify({
            "status": "ok",
            "n_rows": len(y),
            "n_features": X.shape[1],
            "coord_type": coord_type,
            "coord_stats": coord_stats,
            "bandwidth_suggestion": bandwidth_suggestion,
            "y_stats": {
                "mean": round(float(np.mean(y)), 4),
                "std": round(float(np.std(y)), 4),
                "min": round(float(np.min(y)), 4),
                "max": round(float(np.max(y)), 4),
            },
        })
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 400


@dataset_bp.route("/datasets/<name>/metadata", methods=["GET"])
def get_metadata(name):
    meta = dataset_service.get_dataset_metadata(name)
    return jsonify({"metadata": meta})
