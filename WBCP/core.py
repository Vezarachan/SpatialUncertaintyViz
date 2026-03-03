"""
Core class for Weighted Bayesian Conformal Prediction (WBCP).

This module implements the general WBCP framework that accepts arbitrary
weight functions. Specific instantiations (spatial, covariate shift, k-NN,
joint spatial-feature, etc.) are achieved by providing different weight
functions from weights.py.

References:
    - Lou et al. (2025), "Weighted Bayesian Conformal Prediction"
    - Snell & Griffiths (2025), "Conformal Prediction as Bayesian Quadrature"
    - Tibshirani et al. (2019), "Conformal Prediction Under Covariate Shift"
"""

from __future__ import annotations
from typing import Callable
import numpy as np
from numpy.typing import NDArray

from .utils import weighted_quantile, bayesian_weighted_quantile
from .results import WBCPResults


def abs_nonconformity_score(pred: NDArray, gt: NDArray) -> NDArray:
    """Default nonconformity score: |predicted - ground_truth|."""
    return np.abs(pred - gt)


class WeightedBayesianCP:
    """
    Weighted Bayesian Conformal Prediction (WBCP).

    A general framework for weighted Bayesian conformal prediction that accepts
    arbitrary weight functions. This unifies and generalizes:
    - Standard CP (uniform weights)
    - BQ-CP (uniform weights + Bayesian posterior)
    - Weighted CP (non-uniform weights, point-estimate threshold)
    - GeoCP (spatial kernel weights)
    - GeoBCP (spatial kernel weights + Bayesian posterior)
    - GeoSIMCP (joint spatial + feature weights)
    - Localized CP (k-NN weights)

    The key innovation is replacing BQ-CP's Dir(1,...,1) with
    Dir(n_eff * w_1, ..., n_eff * w_n), where the weights can come from
    any domain-specific importance weighting scheme.

    Parameters
    ----------
    predict_f : Callable
        Prediction function that maps features to predictions.
        Signature: (NDArray) -> NDArray.
    x_calib : NDArray
        Calibration features, shape (n_calib, d).
    y_calib : NDArray
        Calibration ground truth, shape (n_calib,).
    weight_fn : Callable[[NDArray, NDArray], NDArray]
        Weight function that maps (x_test, x_calib) -> weights of shape
        (n_test, n_calib). See WBCP.weights for factory functions.
    miscoverage_level : float
        Desired miscoverage level alpha (default 0.1 for 90% coverage).
    score_fn : Callable, optional
        Nonconformity score function. Default: |pred - true|.

    Examples
    --------
    >>> from WBCP import WeightedBayesianCP
    >>> from WBCP.weights import spatial_kernel_weights
    >>>
    >>> # Spatial instantiation (equivalent to GeoBCP)
    >>> weight_fn = spatial_kernel_weights(coord_calib, bandwidth=0.15)
    >>> wbcp = WeightedBayesianCP(model.predict, x_calib, y_calib, weight_fn)
    >>> results = wbcp.bayesian_conformalize(x_test, y_test, beta=0.9)
    >>> print(results.coverage, results.mean_n_eff)
    """

    def __init__(
        self,
        predict_f: Callable,
        x_calib: NDArray,
        y_calib: NDArray,
        weight_fn: Callable[[NDArray, NDArray], NDArray],
        miscoverage_level: float = 0.1,
        score_fn: Callable = None,
    ):
        self.predict_f = predict_f
        self.x_calib = np.asarray(x_calib)
        self.y_calib = np.asarray(y_calib)
        self.weight_fn = weight_fn
        self.miscoverage_level = miscoverage_level
        self.score_fn = score_fn or abs_nonconformity_score

        # Pre-compute calibration scores
        y_calib_pred = self.predict_f(self.x_calib)
        self._scores = self.score_fn(y_calib_pred, self.y_calib)
        self._n_calib = len(self._scores)

    @property
    def q_level(self) -> float:
        """Quantile level for conformal prediction."""
        return np.ceil((1 - self.miscoverage_level) * (self._n_calib + 1)) / self._n_calib

    def conformalize(
        self,
        x_test: NDArray,
        y_test: NDArray,
    ) -> WBCPResults:
        """
        Weighted conformal prediction (point-estimate threshold).

        Computes per-test-point weighted quantiles of calibration scores
        using the weight function. Produces a single threshold per test point.

        Parameters
        ----------
        x_test : NDArray
            Test features, shape (n_test, d).
        y_test : NDArray
            Test ground truth, shape (n_test,).

        Returns
        -------
        WBCPResults
            Results with point-estimate thresholds. Bayesian fields are None.
        """
        x_test = np.asarray(x_test)
        y_test = np.asarray(y_test)

        # Compute weights
        weights = self.weight_fn(x_test, self.x_calib)

        # Weighted quantile
        q = min(self.q_level, 1.0)
        uncertainty = weighted_quantile(self._scores, weights, q)

        # Global (unweighted) quantile for reference
        global_uncertainty = float(np.quantile(self._scores, q))

        # Prediction intervals
        y_pred = self.predict_f(x_test)
        upper_bound = y_pred + uncertainty
        lower_bound = y_pred - uncertainty
        coverage = float(np.mean((y_test >= lower_bound) & (y_test <= upper_bound)))

        return WBCPResults(
            uncertainty=uncertainty,
            upper_bound=upper_bound,
            lower_bound=lower_bound,
            pred_value=y_pred,
            true_value=y_test,
            coverage=coverage,
            global_uncertainty=global_uncertainty,
        )

    def bayesian_conformalize(
        self,
        x_test: NDArray,
        y_test: NDArray,
        num_mc: int = 1000,
        beta: float = 0.9,
        concentration_scale: str = 'neff',
        random_state: int = 42,
    ) -> WBCPResults:
        """
        Bayesian weighted conformal prediction (posterior over threshold).

        For each test point, samples from a weighted Dirichlet posterior to
        produce a full distribution of thresholds. The HPD threshold at
        confidence level beta provides data-conditional coverage guarantees.

        This is the core WBCP method. It provides:
        - HPD threshold (data-conditional guarantee at confidence beta)
        - Posterior standard deviation (meta-uncertainty about interval width)
        - Effective sample size (diagnostic for weight quality)
        - Full posterior samples (for multi-resolution confidence layers)

        Parameters
        ----------
        x_test : NDArray
            Test features, shape (n_test, d).
        y_test : NDArray
            Test ground truth, shape (n_test,).
        num_mc : int
            Number of Monte Carlo Dirichlet samples (default 1000).
        beta : float
            Confidence level for HPD threshold (default 0.9).
        concentration_scale : str
            'neff' (recommended) or 'fixed'.
        random_state : int
            Random seed for reproducibility.

        Returns
        -------
        WBCPResults
            Results with Bayesian posterior fields populated.
        """
        x_test = np.asarray(x_test)
        y_test = np.asarray(y_test)

        # Compute weights
        weights = self.weight_fn(x_test, self.x_calib)

        # Bayesian weighted quantile
        q = min(self.q_level, 1.0)
        bq_result = bayesian_weighted_quantile(
            scores=self._scores,
            weights=weights,
            q=q,
            num_mc=num_mc,
            beta=beta,
            concentration_scale=concentration_scale,
            random_state=random_state,
        )

        uncertainty = bq_result['hpd_quantiles']
        global_uncertainty = float(np.quantile(self._scores, q))

        # Prediction intervals
        y_pred = self.predict_f(x_test)
        upper_bound = y_pred + uncertainty
        lower_bound = y_pred - uncertainty
        coverage = float(np.mean((y_test >= lower_bound) & (y_test <= upper_bound)))

        return WBCPResults(
            uncertainty=uncertainty,
            upper_bound=upper_bound,
            lower_bound=lower_bound,
            pred_value=y_pred,
            true_value=y_test,
            coverage=coverage,
            global_uncertainty=global_uncertainty,
            posterior_mean=bq_result['posterior_mean'],
            posterior_std=bq_result['posterior_std'],
            n_eff=bq_result['n_eff'],
            posterior_samples=bq_result['posterior_samples'],
            beta=beta,
        )
