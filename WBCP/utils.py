"""
Core computation utilities for Weighted Bayesian Conformal Prediction (WBCP).

These functions are weight-agnostic: they operate on arbitrary weight matrices
regardless of how the weights were computed (spatial kernels, covariate shift,
k-NN, etc.).

References:
    - Snell & Griffiths (2025), "Conformal Prediction as Bayesian Quadrature", ICML.
    - Kish (1965), "Survey Sampling" (effective sample size).
"""

import numpy as np
from numpy.typing import NDArray


def effective_sample_size(weights: NDArray) -> NDArray:
    """
    Kish's effective sample size for importance weights.

    Measures how many "equivalent uniform samples" the weighted set represents.
    Lower n_eff means fewer effective observations support the estimate.

    :param weights: shape (n_test, n_calib) or (n_calib,), importance weights (need not be normalized)
    :return: shape (n_test,) or scalar, effective sample size per test point
    """
    weights = np.asarray(weights)
    if weights.ndim == 1:
        weights = weights.reshape(1, -1)
    sum_w = np.sum(weights, axis=1)
    sum_w2 = np.sum(weights ** 2, axis=1)
    n_eff = sum_w ** 2 / (sum_w2 + 1e-14)
    return n_eff


def weighted_quantile(scores: NDArray, weights: NDArray, q: float) -> NDArray:
    """
    Compute weighted quantile (vectorized), stable version.

    For each test point (row in weights), computes the q-th weighted quantile
    of the calibration scores using the corresponding weight profile.

    :param scores: nonconformity scores, shape (n_calib,)
    :param weights: importance weights, shape (n_test, n_calib)
    :param q: quantile level (e.g., 0.9 for 90% coverage)
    :return: weighted quantile per test point, shape (n_test,)
    """
    scores = np.asarray(scores)
    weights = np.asarray(weights)
    n_test, n_calib = weights.shape

    # Sort scores once (shared across all test points)
    sorter = np.argsort(scores)
    sorted_scores = scores[sorter]
    sorted_weights = weights[:, sorter]

    # Compute cumulative sum and normalize
    cumsum_w = np.cumsum(sorted_weights, axis=1)
    total_w = cumsum_w[:, -1][:, None]
    normalized_cumsum_w = cumsum_w / (total_w + 1e-14)

    # Find quantile index
    idx = np.argmax(normalized_cumsum_w >= q, axis=1)

    # Linear interpolation for sharp coverage
    quantiles = np.zeros(n_test)
    for i in range(n_test):
        if normalized_cumsum_w[i, idx[i]] == q or idx[i] == 0:
            quantiles[i] = sorted_scores[idx[i]]
        else:
            prev_idx = idx[i] - 1
            x0 = normalized_cumsum_w[i, prev_idx]
            x1 = normalized_cumsum_w[i, idx[i]]
            y0 = sorted_scores[prev_idx]
            y1 = sorted_scores[idx[i]]
            quantiles[i] = y0 + (y1 - y0) * (q - x0) / (x1 - x0 + 1e-14)
    return quantiles


def bayesian_weighted_quantile(
    scores: NDArray,
    weights: NDArray,
    q: float,
    num_mc: int = 1000,
    beta: float = 0.9,
    concentration_scale: str = 'neff',
    random_state: int = 42
) -> dict:
    """
    Bayesian weighted quantile via Dirichlet posterior sampling.

    For each test point, samples from Dir(c*w_1, ..., c*w_N, c*w_{N+1}) and
    computes the weighted quantile under each sample, yielding a posterior
    distribution of thresholds. The HPD threshold at confidence level beta
    provides data-conditional coverage guarantees.

    This is the core of the WBCP framework. It is completely weight-agnostic:
    the weights can come from spatial kernels, covariate shift ratios, k-NN,
    or any other importance weighting scheme.

    :param scores: nonconformity scores, shape (n_calib,)
    :param weights: importance weights, shape (n_test, n_calib)
    :param q: quantile level (e.g., 0.9 for 90% coverage)
    :param num_mc: number of Monte Carlo Dirichlet samples (default 1000)
    :param beta: confidence level for HPD threshold (default 0.9).
        Higher beta -> more conservative (wider) intervals.
    :param concentration_scale: how to set concentration parameter c.
        'neff' uses Kish's effective sample size (recommended).
        'fixed' uses c=1 (standard BQ-CP, ignores weight magnitudes).
    :param random_state: random seed for reproducibility
    :return: dict with keys:
        'hpd_quantiles': shape (n_test,) -- HPD threshold at confidence beta
        'posterior_mean': shape (n_test,) -- posterior mean of threshold
        'posterior_std': shape (n_test,) -- posterior std of threshold
        'n_eff': shape (n_test,) -- effective sample size per test point
        'posterior_samples': shape (n_test, num_mc) -- all MC threshold samples
    """
    scores = np.asarray(scores)
    weights = np.asarray(weights)
    if weights.ndim == 1:
        weights = weights.reshape(1, -1)

    n_test, n_calib = weights.shape
    rng = np.random.default_rng(random_state)

    # Sort scores once (shared across all test points)
    sorter = np.argsort(scores)
    sorted_scores = scores[sorter]
    sorted_weights = weights[:, sorter]  # (n_test, n_calib)

    # Normalize weights to sum to 1 per test point
    w_sum = sorted_weights.sum(axis=1, keepdims=True) + 1e-14
    sorted_weights_norm = sorted_weights / w_sum

    # Compute effective sample size
    n_eff = effective_sample_size(weights)  # (n_test,)

    # Concentration scaling
    if concentration_scale == 'neff':
        c = n_eff  # (n_test,)
    elif concentration_scale == 'fixed':
        c = np.ones(n_test)
    else:
        raise ValueError(f"Unknown concentration_scale: {concentration_scale}")

    # Weight for the N+1 "unseen test" bin
    w_future = 1.0 / (n_calib + 1)

    # Dirichlet concentration parameters: shape (n_test, n_calib + 1)
    alpha_min = 1e-6
    alpha_calib = np.maximum(c[:, None] * sorted_weights_norm, alpha_min)
    alpha_future = np.maximum(c * w_future, alpha_min)
    alpha_full = np.concatenate([alpha_calib, alpha_future[:, None]], axis=1)

    # Monte Carlo sampling
    posterior_thresholds = np.zeros((n_test, num_mc))

    for i in range(n_test):
        # Draw Dirichlet samples: shape (num_mc, n_calib + 1)
        dir_samples = rng.dirichlet(alpha_full[i], size=num_mc)

        # Extract calibration weights (exclude the future bin)
        u_calib = dir_samples[:, :n_calib]  # (num_mc, n_calib)

        # Normalize calibration part
        u_calib_norm = u_calib / (u_calib.sum(axis=1, keepdims=True) + 1e-14)

        # Compute weighted quantile for each MC sample via cumulative sum
        cumsum_u = np.cumsum(u_calib_norm, axis=1)  # (num_mc, n_calib)

        # Find index where cumulative weight >= q
        idx = np.argmax(cumsum_u >= q, axis=1)  # (num_mc,)

        # Handle case where cumsum never reaches q
        never_reached = np.all(cumsum_u < q, axis=1)
        idx[never_reached] = n_calib - 1

        posterior_thresholds[i] = sorted_scores[idx]

    # Compute summary statistics
    hpd_quantiles = np.quantile(posterior_thresholds, beta, axis=1)
    posterior_mean = np.mean(posterior_thresholds, axis=1)
    posterior_std = np.std(posterior_thresholds, axis=1)

    return {
        'hpd_quantiles': hpd_quantiles,
        'posterior_mean': posterior_mean,
        'posterior_std': posterior_std,
        'n_eff': n_eff,
        'posterior_samples': posterior_thresholds,
    }
