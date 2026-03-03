"""Conformal prediction analysis service."""
import threading
import uuid
import numpy as np
import sys
import os

# Add parent dir to path for WBCP imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from WBCP.utils import weighted_quantile, bayesian_weighted_quantile, effective_sample_size
from WBCP.weights import (
    uniform_weights, spatial_kernel_weights, adaptive_spatial_weights,
    knn_weights, spatial_feature_l2_weights, spatial_feature_minmax_weights,
)
from WBCP.methods import GWQRConformalPredictor, LSCPConformalPredictor

from config import METHOD_REGISTRY, DEFAULT_PARAMS

# Job store
_jobs = {}


def get_job(job_id):
    return _jobs.get(job_id)


def run_analysis(session_data, method, params):
    """Run a CP analysis. Returns job_id."""
    job_id = str(uuid.uuid4())[:8]
    method_info = METHOD_REGISTRY.get(method)

    if not method_info:
        _jobs[job_id] = {"status": "error", "error": f"Unknown method: {method}"}
        return job_id

    is_async = method_info.get("async", False)

    if is_async:
        _jobs[job_id] = {"status": "running", "progress": 0}
        t = threading.Thread(target=_execute_analysis, args=(job_id, session_data, method, params))
        t.daemon = True
        t.start()
    else:
        _jobs[job_id] = {"status": "running", "progress": 0}
        _execute_analysis(job_id, session_data, method, params)

    return job_id


def _execute_analysis(job_id, session_data, method, params):
    """Execute the analysis and store results."""
    try:
        result = _compute_cp(session_data, method, params)
        _jobs[job_id] = {"status": "done", "progress": 100, "result": result}
    except Exception as e:
        import traceback
        _jobs[job_id] = {"status": "error", "error": str(e), "traceback": traceback.format_exc()}


def _compute_cp(session_data, method, params):
    """Core CP computation logic."""
    predict_fn = session_data["predict_fn"]
    X_calib = session_data["X_calib"]
    y_calib = session_data["y_calib"]
    X_test = session_data["X_test"]
    y_test = session_data["y_test"]
    coord_calib = session_data["coord_calib"]
    coord_test = session_data["coord_test"]

    alpha = params.get("alpha", DEFAULT_PARAMS["alpha"])
    method_info = METHOD_REGISTRY[method]

    # Handle GWQR and LSCP (alternative methods with their own classes)
    if method == "gwqr":
        predictor = GWQRConformalPredictor(
            predict_fn, X_calib, y_calib, coord_calib,
            k=params.get("k", DEFAULT_PARAMS["k"]),
            miscoverage_level=alpha,
            n_jobs=params.get("n_jobs", DEFAULT_PARAMS["n_jobs"]),
            optimize=True,
        )
        wbcp_results = predictor.analyze(X_test, y_test, coord_test)
        return _package_results(method, wbcp_results, session_data, params)

    if method == "lscp":
        predictor = LSCPConformalPredictor(
            predict_fn, X_calib, y_calib, coord_calib,
            k=params.get("k", DEFAULT_PARAMS["k"]),
            miscoverage_level=alpha,
            n_jobs=params.get("n_jobs", DEFAULT_PARAMS["n_jobs"]),
        )
        wbcp_results = predictor.analyze(X_test, y_test, coord_test)
        return _package_results(method, wbcp_results, session_data, params)

    # Weight-based methods: bypass WeightedBayesianCP, use utils directly
    # Step 1: Compute calibration nonconformity scores
    y_calib_pred = predict_fn(X_calib)
    scores = np.abs(y_calib_pred - y_calib)
    n_calib = len(scores)
    q_level = min(np.ceil((1 - alpha) * (n_calib + 1)) / n_calib, 1.0)

    # Step 2: Create weight function and compute weights
    weight_fn_type = method_info["weight_fn"]

    if weight_fn_type == "uniform":
        wf = uniform_weights()
        weights = wf(X_test, X_calib)

    elif weight_fn_type == "spatial_kernel":
        bw = params.get("bandwidth", DEFAULT_PARAMS["bandwidth"])
        wf = spatial_kernel_weights(coord_calib, bandwidth=bw)
        weights = wf(coord_test, coord_calib)

    elif weight_fn_type == "adaptive_spatial":
        bw = params.get("base_bandwidth", DEFAULT_PARAMS["base_bandwidth"])
        k_adapt = params.get("k_adaptive", DEFAULT_PARAMS["k_adaptive"])
        wf = adaptive_spatial_weights(coord_calib, base_bandwidth=bw, k=k_adapt)
        weights = wf(coord_test, coord_calib)

    elif weight_fn_type == "knn":
        k = params.get("k", DEFAULT_PARAMS["k"])
        wf = knn_weights(k=k)
        weights = wf(X_test, X_calib)

    elif weight_fn_type == "spatial_feature_l2":
        bw = params.get("bandwidth", DEFAULT_PARAMS["bandwidth"])
        lam = params.get("lambda_weight", DEFAULT_PARAMS["lambda_weight"])
        wf = spatial_feature_l2_weights(coord_calib, X_calib, bandwidth=bw, lambda_weight=lam)
        x_combined_test = np.hstack([coord_test, X_test])
        x_combined_calib = np.hstack([coord_calib, X_calib])
        weights = wf(x_combined_test, x_combined_calib)

    elif weight_fn_type == "spatial_feature_minmax":
        bw = params.get("bandwidth", DEFAULT_PARAMS["bandwidth"])
        lam = params.get("lambda_weight", DEFAULT_PARAMS["lambda_weight"])
        wf = spatial_feature_minmax_weights(coord_calib, X_calib, bandwidth=bw, lambda_weight=lam)
        x_combined_test = np.hstack([coord_test, X_test])
        x_combined_calib = np.hstack([coord_calib, X_calib])
        weights = wf(x_combined_test, x_combined_calib)

    else:
        raise ValueError(f"Unknown weight function: {weight_fn_type}")

    # Step 3: Compute threshold
    is_bayesian = method_info.get("bayesian", False)
    posterior_mean = posterior_std = n_eff_arr = posterior_samples = None
    beta_val = None

    if is_bayesian:
        beta_val = params.get("beta", DEFAULT_PARAMS["beta"])
        num_mc = params.get("num_mc", DEFAULT_PARAMS["num_mc"])
        bq_result = bayesian_weighted_quantile(
            scores, weights, q_level, num_mc=num_mc, beta=beta_val
        )
        uncertainty = bq_result["hpd_quantiles"]
        posterior_mean = bq_result["posterior_mean"]
        posterior_std = bq_result["posterior_std"]
        n_eff_arr = bq_result["n_eff"]
        posterior_samples = bq_result["posterior_samples"]
    else:
        uncertainty = weighted_quantile(scores, weights, q_level)
        n_eff_arr = effective_sample_size(weights)

    # Step 4: Prediction intervals
    y_pred = predict_fn(X_test)
    upper_bound = y_pred + uncertainty
    lower_bound = y_pred - uncertainty
    covered = (y_test >= lower_bound) & (y_test <= upper_bound)
    coverage = float(np.mean(covered))
    global_uncertainty = float(np.quantile(scores, min(q_level, 1.0)))

    # Step 5: Package results
    coords_lonlat = session_data.get("coords_lonlat_test")
    if coords_lonlat is None:
        coords_lonlat = coord_test

    result = {
        "method": method,
        "method_label": method_info["label"],
        "is_bayesian": is_bayesian,
        "summary": {
            "coverage": round(coverage, 4),
            "target_coverage": round(1 - alpha, 4),
            "mean_width": round(float(2 * np.mean(uncertainty)), 4),
            "global_uncertainty": round(global_uncertainty, 4),
            "n_test": len(y_test),
            "n_calib": n_calib,
        },
        "per_point": {
            "coords_lonlat": coords_lonlat.tolist() if isinstance(coords_lonlat, np.ndarray) else coords_lonlat,
            "uncertainty": uncertainty.tolist(),
            "upper_bound": upper_bound.tolist(),
            "lower_bound": lower_bound.tolist(),
            "pred_value": y_pred.tolist(),
            "true_value": y_test.tolist(),
            "covered": covered.tolist(),
            "residual": (y_pred - y_test).tolist(),
            "n_eff": n_eff_arr.tolist() if n_eff_arr is not None else None,
        },
    }

    if is_bayesian:
        result["summary"]["beta"] = beta_val
        result["summary"]["mean_n_eff"] = round(float(np.mean(n_eff_arr)), 1) if n_eff_arr is not None else None
        result["summary"]["mean_sigma_post"] = round(float(np.mean(posterior_std)), 4) if posterior_std is not None else None
        result["per_point"]["posterior_mean"] = posterior_mean.tolist() if posterior_mean is not None else None
        result["per_point"]["posterior_std"] = posterior_std.tolist() if posterior_std is not None else None
        # Send a subset of posterior samples (max 100 per point for bandwidth)
        if posterior_samples is not None:
            step = max(1, posterior_samples.shape[1] // 100)
            result["posterior_samples_subset"] = posterior_samples[:, ::step].tolist()

    return result


def _package_results(method, wbcp_results, session_data, params):
    """Package WBCPResults object (from GWQR/LSCP) into JSON-serializable dict."""
    method_info = METHOD_REGISTRY[method]
    alpha = params.get("alpha", DEFAULT_PARAMS["alpha"])

    coords_lonlat = session_data.get("coords_lonlat_test")
    if coords_lonlat is None:
        coords_lonlat = session_data["coord_test"]

    r = wbcp_results
    return {
        "method": method,
        "method_label": method_info["label"],
        "is_bayesian": r.is_bayesian,
        "summary": {
            "coverage": round(r.coverage, 4),
            "target_coverage": round(1 - alpha, 4),
            "mean_width": round(r.mean_width, 4),
            "global_uncertainty": round(r.global_uncertainty, 4),
            "n_test": len(r.true_value),
            "n_calib": session_data["X_calib"].shape[0],
        },
        "per_point": {
            "coords_lonlat": coords_lonlat.tolist() if isinstance(coords_lonlat, np.ndarray) else coords_lonlat,
            "uncertainty": r.uncertainty.tolist(),
            "upper_bound": r.upper_bound.tolist(),
            "lower_bound": r.lower_bound.tolist(),
            "pred_value": r.pred_value.tolist(),
            "true_value": r.true_value.tolist(),
            "covered": ((r.true_value >= r.lower_bound) & (r.true_value <= r.upper_bound)).tolist(),
            "residual": (r.pred_value - r.true_value).tolist(),
            "n_eff": r.n_eff.tolist() if r.n_eff is not None else None,
            "posterior_mean": r.posterior_mean.tolist() if r.posterior_mean is not None else None,
            "posterior_std": r.posterior_std.tolist() if r.posterior_std is not None else None,
        },
    }
