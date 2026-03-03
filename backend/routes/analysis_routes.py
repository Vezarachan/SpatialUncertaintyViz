"""Analysis API routes."""
from flask import Blueprint, request, jsonify, session
from backend.services import analysis_service
from backend.services.session_store import store
from config import METHOD_REGISTRY, DEFAULT_PARAMS

analysis_bp = Blueprint("analysis", __name__)


@analysis_bp.route("/analysis/methods", methods=["GET"])
def list_methods():
    """List all available CP methods with their parameters."""
    methods = {}
    for key, info in METHOD_REGISTRY.items():
        methods[key] = {
            "label": info["label"],
            "group": info["group"],
            "bayesian": info.get("bayesian", False),
            "needs_coords": info.get("needs_coords", False),
            "is_async": info.get("async", False),
            "params": info["params"],
        }
    return jsonify({"methods": methods, "defaults": DEFAULT_PARAMS})


@analysis_bp.route("/analysis/run", methods=["POST"])
def run_analysis():
    sid = session.get("sid")
    if not sid or sid not in store:
        return jsonify({"error": "No dataset configured"}), 400

    sess = store[sid]
    if not sess.get("trained"):
        return jsonify({"error": "No model trained. Please train a model first."}), 400

    data = request.get_json()
    method = data.get("method")
    params = data.get("params", {})

    if method not in METHOD_REGISTRY:
        return jsonify({"error": f"Unknown method: {method}"}), 400

    job_id = analysis_service.run_analysis(sess, method, params)
    return jsonify({"job_id": job_id})


@analysis_bp.route("/analysis/status/<job_id>", methods=["GET"])
def analysis_status(job_id):
    job = analysis_service.get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404

    if job["status"] == "error":
        return jsonify({"status": "error", "error": job.get("error", "Unknown error")}), 400

    return jsonify({
        "status": job["status"],
        "progress": job.get("progress", 0),
    })


@analysis_bp.route("/analysis/results/<job_id>", methods=["GET"])
def analysis_results(job_id):
    job = analysis_service.get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404

    if job["status"] == "error":
        return jsonify({"status": "error", "error": job.get("error", "Unknown error")}), 400

    if job["status"] != "done":
        return jsonify({"status": job["status"], "message": "Analysis still running"}), 202

    return jsonify({"status": "done", "result": job["result"]})
