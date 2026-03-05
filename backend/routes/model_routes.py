"""Model training API routes."""
from flask import Blueprint, request, jsonify
from backend.services import model_service
from backend.services.session_store import get_session
import numpy as np

model_bp = Blueprint("model", __name__)


@model_bp.route("/model/train", methods=["POST"])
def train_model():
    sess = get_session()
    if "X" not in sess:
        return jsonify({"error": "No dataset configured. Please configure a dataset first."}), 400

    data = request.get_json()
    model_type = data.get("model_type", "ols")
    train_ratio = data.get("train_ratio", 0.5)
    random_seed = data.get("random_seed", 42)
    model_params = data.get("model_params", {})

    X = sess["X"]
    y = sess["y"]
    coords = sess["coords"]
    coords_lonlat = sess["coords_lonlat"]

    try:
        # 3-way split
        split = model_service.three_way_split(X, y, coords, train_ratio, random_seed)

        # Also split coords_lonlat in the same way
        from sklearn.model_selection import train_test_split
        np.random.seed(random_seed)
        n = len(y)
        indices = np.arange(n)
        idx_train, idx_rest = train_test_split(indices, train_size=train_ratio, random_state=random_seed)
        idx_calib, idx_test = train_test_split(idx_rest, train_size=0.5, random_state=random_seed)

        coords_lonlat_test = coords_lonlat[idx_test]

        # Train model
        model, predict_fn, model_name = model_service.train_model(
            model_type, split["X_train"], split["y_train"], model_params
        )

        # Compute metrics on test set
        y_pred_test = predict_fn(split["X_test"])
        metrics = model_service.compute_metrics(split["y_test"], y_pred_test)

        # Store everything
        sess.update({
            "model": model,
            "predict_fn": predict_fn,
            "model_type": model_type,
            "model_name": model_name,
            "X_train": split["X_train"],
            "y_train": split["y_train"],
            "X_calib": split["X_calib"],
            "y_calib": split["y_calib"],
            "X_test": split["X_test"],
            "y_test": split["y_test"],
            "coord_train": split["coord_train"],
            "coord_calib": split["coord_calib"],
            "coord_test": split["coord_test"],
            "coords_lonlat_test": coords_lonlat_test,
            "metrics": metrics,
            "trained": True,
        })

        return jsonify({
            "status": "ok",
            "model_name": model_name,
            "metrics": metrics,
            "n_train": len(split["y_train"]),
            "n_calib": len(split["y_calib"]),
            "n_test": len(split["y_test"]),
        })
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 400


@model_bp.route("/model/status", methods=["GET"])
def model_status():
    sess = get_session()
    if sess.get("trained"):
        return jsonify({
            "trained": True,
            "model_name": sess.get("model_name"),
            "metrics": sess.get("metrics"),
        })
    return jsonify({"trained": False})
