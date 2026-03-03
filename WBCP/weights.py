"""
Weight function factories for Weighted Bayesian Conformal Prediction (WBCP).

Each factory returns a Callable[[NDArray, NDArray], NDArray] that maps
(x_test, x_calib) -> weights of shape (n_test, n_calib).

These weight functions can be plugged into WeightedBayesianCP to instantiate
different variants of weighted/localized conformal prediction:

    - spatial_kernel_weights:              GeoCP / GeoBCP (Gaussian kernel on coordinates)
    - adaptive_spatial_weights:            Adaptive GeoCP / Adaptive GeoBCP
    - covariate_shift_weights:             Weighted CP under covariate shift (Tibshirani 2019)
    - knn_weights:                         Localized CP via k-NN (Guan 2023)
    - uniform_weights:                     Standard CP / BQ-CP (all weights equal)
    - rbf_feature_weights:                 RBF kernel on feature space
    - spatial_feature_l2_weights:           GeoSIMCP (L2 Euclidean feature distance)
    - spatial_feature_minmax_weights:      GeoSIMCP-Zhao (range-normalized min-similarity)
"""

from typing import Callable, Tuple
import numpy as np
from numpy.typing import NDArray


# ============================================================
# Internal kernel functions
# ============================================================

def _gaussian_kernel(d: NDArray) -> NDArray:
    """Gaussian distance decay function: K(d) = exp(-d^2/2)."""
    return np.exp(-0.5 * d ** 2)


def _compute_distances(z_test: NDArray, z_calib: NDArray) -> NDArray:
    """Compute pairwise Euclidean distances between test and calibration points."""
    z_test_norm = np.sum(z_test ** 2, axis=1).reshape(-1, 1)
    z_calib_norm = np.sum(z_calib ** 2, axis=1).reshape(1, -1)
    distances = np.sqrt(
        np.maximum(z_test_norm + z_calib_norm - 2 * np.dot(z_test, z_calib.T), 0)
    )
    return distances


# ============================================================
# Weight function factories
# ============================================================

def spatial_kernel_weights(coord_calib: NDArray, bandwidth: float) -> Callable:
    """
    Create a spatial Gaussian kernel weight function.

    Equivalent to GeoCP's kernel_smoothing. Weights decrease with geographic
    distance via K(||s - s_i|| / h).

    :param coord_calib: calibration coordinates, shape (n_calib, 2)
    :param bandwidth: kernel bandwidth h > 0
    :return: weight function (x_test, x_calib) -> weights (n_test, n_calib)

    Note: The returned function uses coord_test (not x_test features) for
    distance computation. Pass coordinates as x_test when calling.
    """
    _coord_calib = np.asarray(coord_calib)
    _bw = float(bandwidth)

    def weight_fn(x_test: NDArray, x_calib: NDArray) -> NDArray:
        # x_test is assumed to be coordinates for spatial weighting
        distances = _compute_distances(x_test, _coord_calib)
        weights = _gaussian_kernel(distances / _bw)
        return weights

    return weight_fn


def adaptive_spatial_weights(
    coord_calib: NDArray,
    base_bandwidth: float = 0.15,
    k: int = 200
) -> Callable:
    """
    Create an adaptive bandwidth spatial kernel weight function.

    Uses k-NN median distance to compute per-test-point bandwidths,
    then applies Gaussian kernel with local bandwidths:
        local_bw_i = median(kNN_distances_i) * base_bandwidth

    :param coord_calib: calibration coordinates, shape (n_calib, 2)
    :param base_bandwidth: scaling factor for local bandwidths (default 0.15)
    :param k: number of nearest neighbors for local bandwidth (default 200)
    :return: weight function (x_test, x_calib) -> weights (n_test, n_calib)
    """
    from sklearn.neighbors import NearestNeighbors

    _coord_calib = np.asarray(coord_calib)
    _bw0 = float(base_bandwidth)
    _k = min(k, len(_coord_calib))

    def weight_fn(x_test: NDArray, x_calib: NDArray) -> NDArray:
        distances = _compute_distances(x_test, _coord_calib)

        # Compute local bandwidths via k-NN
        nbrs = NearestNeighbors(n_neighbors=_k, algorithm='auto').fit(_coord_calib)
        knn_dists, _ = nbrs.kneighbors(x_test)
        local_bandwidths = np.maximum(np.median(knn_dists, axis=1) * _bw0, 1e-6)

        # Adaptive Gaussian kernel: each test point has its own bandwidth
        bw = local_bandwidths[:, None]  # (n_test, 1)
        weights = np.exp(-0.5 * (distances / bw) ** 2)

        # Normalize
        weights = weights / (weights.sum(axis=1, keepdims=True) + 1e-14)
        return weights

    return weight_fn


def covariate_shift_weights(density_ratio_fn: Callable) -> Callable:
    """
    Create a covariate shift weight function (Tibshirani et al., 2019).

    Weights are importance ratios: w_i = p_test(X_i) / p_calib(X_i).

    :param density_ratio_fn: function that computes density ratios,
        Callable[[NDArray], NDArray], maps calibration features to ratios.
    :return: weight function (x_test, x_calib) -> weights (n_test, n_calib)
    """
    def weight_fn(x_test: NDArray, x_calib: NDArray) -> NDArray:
        # Density ratios for calibration points (independent of test point)
        ratios = density_ratio_fn(x_calib)  # (n_calib,)
        n_test = x_test.shape[0]
        # Same weight profile for all test points
        weights = np.tile(ratios, (n_test, 1))  # (n_test, n_calib)
        return weights

    return weight_fn


def knn_weights(k: int = 20) -> Callable:
    """
    Create a k-NN binary weight function for localized conformal prediction.

    Each test point assigns weight 1 to its k nearest calibration neighbors
    and weight 0 to all others. This is equivalent to the localization
    approach of Guan et al. (2023).

    :param k: number of nearest neighbors
    :return: weight function (x_test, x_calib) -> weights (n_test, n_calib)
    """
    from sklearn.neighbors import NearestNeighbors

    def weight_fn(x_test: NDArray, x_calib: NDArray) -> NDArray:
        _k = min(k, x_calib.shape[0])
        nbrs = NearestNeighbors(n_neighbors=_k, algorithm='auto').fit(x_calib)
        _, indices = nbrs.kneighbors(x_test)

        n_test = x_test.shape[0]
        n_calib = x_calib.shape[0]
        weights = np.zeros((n_test, n_calib))
        for i in range(n_test):
            weights[i, indices[i]] = 1.0
        return weights

    return weight_fn


def uniform_weights() -> Callable:
    """
    Create a uniform weight function (standard CP / BQ-CP).

    All calibration points receive equal weight. When used with
    bayesian_conformalize, this recovers Snell & Griffiths' BQ-CP exactly.

    :return: weight function (x_test, x_calib) -> weights (n_test, n_calib)
    """
    def weight_fn(x_test: NDArray, x_calib: NDArray) -> NDArray:
        n_test = x_test.shape[0]
        n_calib = x_calib.shape[0]
        return np.ones((n_test, n_calib))

    return weight_fn


def rbf_feature_weights(gamma: float = 1.0) -> Callable:
    """
    Create an RBF kernel weight function on feature space.

    Weights are computed as K(x_test, x_calib) = exp(-gamma * ||x - x'||^2).
    This provides feature-space localization regardless of spatial structure.

    :param gamma: RBF kernel parameter (inverse of length scale squared)
    :return: weight function (x_test, x_calib) -> weights (n_test, n_calib)
    """
    def weight_fn(x_test: NDArray, x_calib: NDArray) -> NDArray:
        distances_sq = _compute_distances(x_test, x_calib) ** 2
        weights = np.exp(-gamma * distances_sq)
        return weights

    return weight_fn


# ============================================================
# New weight functions from Codes_GeoSIMCP
# ============================================================

def spatial_feature_l2_weights(
    coord_calib: NDArray,
    feat_calib: NDArray,
    bandwidth: float,
    lambda_weight: float = 1.0,
    standardize: bool = True,
) -> Callable:
    """
    Create a joint spatial + feature kernel weight function (GeoSIMCP).

    Combines geographic distance and feature-space distance using:
        d_joint = sqrt(lambda * d_geo^2 + (1-lambda) * d_feat^2)
    then applies Gaussian kernel: K(d_joint / h).

    Adapted from GeoSIMConformalSpatialRegression._kernel_smoothing_joint().

    :param coord_calib: calibration coordinates, shape (n_calib, 2)
    :param feat_calib: calibration features for distance computation, shape (n_calib, p)
    :param bandwidth: kernel bandwidth h > 0
    :param lambda_weight: trade-off parameter in [0, 1].
        1.0 = pure spatial (equivalent to GeoCP).
        0.0 = pure feature-space weighting.
    :param standardize: whether to z-score normalize features before
        computing feature distance (default True, using StandardScaler).
    :return: weight function (x_test, x_calib) -> weights (n_test, n_calib).
        x_test should be np.hstack([coord_test, feat_test]).
    """
    _coord_calib = np.asarray(coord_calib, dtype=float)
    _feat_calib = np.asarray(feat_calib, dtype=float)
    _bw = float(bandwidth)
    _lam = float(lambda_weight)
    _n_coord_cols = _coord_calib.shape[1]

    if standardize:
        from sklearn.preprocessing import StandardScaler
        _scaler = StandardScaler()
        _feat_calib_scaled = _scaler.fit_transform(_feat_calib)
    else:
        _scaler = None
        _feat_calib_scaled = _feat_calib.copy()

    def weight_fn(x_test: NDArray, x_calib: NDArray) -> NDArray:
        x_test = np.asarray(x_test, dtype=float)
        # Split x_test into coordinates and features
        coord_test = x_test[:, :_n_coord_cols]
        feat_test = x_test[:, _n_coord_cols:]

        if _scaler is not None:
            feat_test_scaled = _scaler.transform(feat_test)
        else:
            feat_test_scaled = feat_test

        # Geographic distances: (n_test, n_calib)
        d_geo = _compute_distances(coord_test, _coord_calib)

        # Feature distances: (n_test, n_calib)
        d_feat = _compute_distances(feat_test_scaled, _feat_calib_scaled)
        d_feat = d_feat + 1e-8  # Avoid exact zeros (matching GeoSIMCP convention)

        # Joint distance
        d_joint = np.sqrt(_lam * d_geo ** 2 + (1 - _lam) * d_feat ** 2)

        # Gaussian kernel
        weights = _gaussian_kernel(d_joint / _bw)
        return weights

    return weight_fn


def spatial_feature_minmax_weights(
    coord_calib: NDArray,
    feat_calib: NDArray,
    bandwidth: float,
    lambda_weight: float = 1.0,
    feature_ranges: NDArray = None,
) -> Callable:
    """
    Create a joint spatial + feature kernel weight function with
    range-normalized feature distance (Zhao 2024 variant).

    Uses feature-wise range normalization for computing feature distances:
        similarity_k = 1 - |diff_k| / range_k   (per feature k)
        d_feat = 1 - min(similarity_1, ..., similarity_p)
    then combines with geographic distance:
        d_joint = sqrt(lambda * d_geo^2 + (1-lambda) * d_feat^2)

    Adapted from GeoSIMCPzhao._custom_feat_distance() and
    _kernel_smoothing_joint_zhao2024().

    :param coord_calib: calibration coordinates, shape (n_calib, 2)
    :param feat_calib: calibration features, shape (n_calib, p)
    :param bandwidth: kernel bandwidth h > 0
    :param lambda_weight: trade-off parameter in [0, 1].
        1.0 = pure spatial. 0.0 = pure feature-space.
    :param feature_ranges: per-feature ranges, shape (p,). If None,
        computed from feat_calib via np.ptp (peak-to-peak).
    :return: weight function (x_test, x_calib) -> weights (n_test, n_calib).
        x_test should be np.hstack([coord_test, feat_test]).
    """
    _coord_calib = np.asarray(coord_calib, dtype=float)
    _feat_calib = np.asarray(feat_calib, dtype=float)
    _bw = float(bandwidth)
    _lam = float(lambda_weight)
    _n_coord_cols = _coord_calib.shape[1]

    if feature_ranges is not None:
        _ranges = np.asarray(feature_ranges, dtype=float)
    else:
        _ranges = np.ptp(_feat_calib, axis=0)
    _ranges[_ranges == 0] = 1e-8  # Avoid zero range

    def weight_fn(x_test: NDArray, x_calib: NDArray) -> NDArray:
        x_test = np.asarray(x_test, dtype=float)
        # Split x_test into coordinates and features
        coord_test = x_test[:, :_n_coord_cols]
        feat_test = x_test[:, _n_coord_cols:]

        # Geographic distances: (n_test, n_calib)
        d_geo = _compute_distances(coord_test, _coord_calib)

        # Zhao's range-normalized feature distance: (n_test, n_calib)
        # diffs[i,j,k] = |feat_test[i,k] - feat_calib[j,k]|
        diffs = np.abs(
            feat_test[:, None, :] - _feat_calib[None, :, :]
        )  # (n_test, n_calib, p)
        scaled = 1.0 - (diffs / _ranges[None, None, :])  # (n_test, n_calib, p)
        similarity = np.min(scaled, axis=2)  # (n_test, n_calib)
        d_feat = 1.0 - similarity  # (n_test, n_calib)

        # Joint distance
        d_joint = np.sqrt(_lam * d_geo ** 2 + (1 - _lam) * d_feat ** 2)

        # Gaussian kernel
        weights = _gaussian_kernel(d_joint / _bw)
        return weights

    return weight_fn
