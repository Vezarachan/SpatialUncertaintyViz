"""
Alternative conformal prediction methods for the WBCP package.

These methods do NOT follow the weight-function paradigm of WeightedBayesianCP.
Instead, they use local model fitting (quantile regression or quantile random
forests) to produce spatially adaptive prediction intervals.

Classes
-------
GWQRConformalPredictor
    Geographically Weighted Quantile Regression (GWQR) based conformal predictor.
    Adapted from Codes_GeoSIMCP/GeoConformal/GWQRBasedGeoCP.py.

LSCPConformalPredictor
    Locally-Smoothed Conformal Prediction (LSCP) using k-NN neighbor
    nonconformity scores and Quantile Random Forests.
    Adapted from Codes_GeoSIMCP/GeoConformal/LSCP.py.
"""

from __future__ import annotations
from typing import Callable, Optional
import numpy as np
from numpy.typing import NDArray

from .results import WBCPResults


# ============================================================
# GWQR-Based Conformal Predictor
# ============================================================

class GWQRConformalPredictor:
    """
    Geographically Weighted Quantile Regression (GWQR) conformal predictor.

    For each test point, fits a local quantile regression model using
    geographically weighted k nearest calibration neighbors. The local model
    predicts asymmetric lower/upper nonconformity score quantiles, yielding
    spatially adaptive prediction intervals.

    Optionally optimizes (k, beta, alpha) per test point to minimize interval
    width while penalizing non-coverage.

    Parameters
    ----------
    predict_f : Callable
        Base prediction function, (NDArray) -> NDArray.
    x_calib : NDArray
        Calibration features, shape (n_calib, d).
    y_calib : NDArray
        Calibration ground truth, shape (n_calib,).
    coord_calib : NDArray
        Calibration coordinates, shape (n_calib, 2).
    k : int
        Number of nearest neighbors (default 10).
    miscoverage_level : float
        Desired miscoverage level alpha (default 0.1).
    beta : float
        Lower quantile offset (default 0.01). The prediction interval
        covers quantiles [beta, 1 - miscoverage_level + beta].
    alpha_penalty : float
        Penalty weight for coverage violations during optimization (default 1.0).
    optimize : bool
        Whether to optimize (k, beta, alpha_penalty) per test point (default True).
    n_jobs : int
        Number of parallel jobs (default 8).
    use_qrf : bool
        If True, use RandomForestQuantileRegressor instead of QuantileRegressor
        for the optimized path (default True).

    Examples
    --------
    >>> from WBCP.methods import GWQRConformalPredictor
    >>> gwqr = GWQRConformalPredictor(model.predict, x_calib, y_calib, coord_calib)
    >>> results = gwqr.analyze(x_test, y_test, coord_test)
    >>> print(results.coverage)
    """

    def __init__(
        self,
        predict_f: Callable,
        x_calib: NDArray,
        y_calib: NDArray,
        coord_calib: NDArray,
        k: int = 10,
        miscoverage_level: float = 0.1,
        beta: float = 0.01,
        alpha_penalty: float = 1.0,
        optimize: bool = True,
        n_jobs: int = 8,
        use_qrf: bool = True,
    ):
        self.predict_f = predict_f
        self.x_calib = np.asarray(x_calib)
        self.y_calib = np.asarray(y_calib)
        self.coord_calib = np.asarray(coord_calib)
        self.k = k
        self.miscoverage_level = miscoverage_level
        self.beta = beta
        self.alpha_penalty = alpha_penalty
        self.optimize = optimize
        self.n_jobs = n_jobs
        self.use_qrf = use_qrf

        # Pre-compute calibration residuals (signed: y - pred)
        y_calib_pred = self.predict_f(self.x_calib)
        self._residuals = self.y_calib - y_calib_pred

    # ----------------------------------------------------------
    # Internal helpers
    # ----------------------------------------------------------

    @staticmethod
    def _gaussian_kernel(d: NDArray) -> NDArray:
        """Gaussian distance decay: K(d) = exp(-d^2/2)."""
        return np.exp(-0.5 * d ** 2)

    @staticmethod
    def _k_neighbors(distances: NDArray, k: int) -> NDArray:
        """Return indices of k nearest neighbors."""
        return np.argsort(distances)[:k]

    def _local_weights(self, distances: NDArray, indices: NDArray) -> NDArray:
        """Compute Gaussian kernel weights using k-th neighbor as bandwidth."""
        bandwidth = distances[indices[-1]] + 1e-14
        w = self._gaussian_kernel(distances[indices] / bandwidth)
        return w / (w.sum() + 1e-14)

    def _fit_gwqr(self, x, y, locations, target_location, k, q):
        """Fit a local QuantileRegressor at target_location."""
        from sklearn.linear_model import QuantileRegressor

        distances = np.sqrt(np.sum((locations - target_location) ** 2, axis=1))
        indices = self._k_neighbors(distances, k)
        weights = self._local_weights(distances, indices)
        model = QuantileRegressor(quantile=q, alpha=0.0, solver='highs')
        model.fit(x[indices], y[indices], sample_weight=weights)
        return model

    def _fit_qrf_gwqr(self, x, y, locations, target_location, k):
        """Fit a local RandomForestQuantileRegressor at target_location."""
        from quantile_forest import RandomForestQuantileRegressor

        distances = np.sqrt(np.sum((locations - target_location) ** 2, axis=1))
        indices = self._k_neighbors(distances, k)
        weights = self._local_weights(distances, indices)
        model = RandomForestQuantileRegressor(n_jobs=self.n_jobs)
        model.fit(x[indices], y[indices], sample_weight=weights)
        return model

    # ----------------------------------------------------------
    # Optimization per test point
    # ----------------------------------------------------------

    def _objective_single_point(self, params, x_new, coord_new, y_new):
        """Objective: interval width + coverage penalty."""
        k_val, beta_val, alpha_val = params
        k_val = max(int(k_val), 2)

        gwqr_lb = self._fit_gwqr(
            self.x_calib, self._residuals, self.coord_calib,
            coord_new.reshape(1, -1), k_val, beta_val,
        )
        gwqr_ub = self._fit_gwqr(
            self.x_calib, self._residuals, self.coord_calib,
            coord_new.reshape(1, -1), k_val,
            1 - self.miscoverage_level + beta_val,
        )
        lb = gwqr_lb.predict(x_new.reshape(1, -1))[0]
        ub = gwqr_ub.predict(x_new.reshape(1, -1))[0]

        y_pred = self.predict_f(x_new.reshape(1, -1))[0]
        y_pred_lb = y_pred + lb
        y_pred_ub = y_pred + ub

        width = ub - lb
        lower_penalty = max(y_new - y_pred_ub, 0)
        upper_penalty = max(y_pred_lb - y_new, 0)
        penalty = alpha_val * (lower_penalty ** 2 + upper_penalty ** 2)
        return width + penalty

    def _predict_single_point_optimized(self, i, residuals):
        """Optimize and predict for a single test point."""
        from scipy.optimize import minimize as sp_minimize

        x_new = self.x_test[i]
        coord_new = self.coord_test[i]
        y_new = self.y_test[i]

        # Optimize (k, beta, alpha)
        bounds = [
            (2, self.x_calib.shape[0]),
            (1e-10, self.miscoverage_level - 1e-10),
            (0, 10),
        ]
        res = sp_minimize(
            fun=self._objective_single_point,
            x0=np.array([self.k, self.beta, self.alpha_penalty]),
            bounds=bounds,
            method='Powell',
            args=(x_new, coord_new, y_new),
        )
        k_opt, beta_opt, alpha_opt = res.x
        k_opt = max(int(k_opt), 2)

        # Predict with optimized parameters
        if self.use_qrf:
            qrf = self._fit_qrf_gwqr(
                self.x_calib, residuals, self.coord_calib,
                coord_new.reshape(1, -1), k_opt,
            )
            lb, ub = qrf.predict(
                x_new.reshape(1, -1),
                quantiles=[beta_opt, 1 - self.miscoverage_level + beta_opt],
            )[0]
        else:
            gwqr_lb = self._fit_gwqr(
                self.x_calib, residuals, self.coord_calib,
                coord_new.reshape(1, -1), k_opt, beta_opt,
            )
            gwqr_ub = self._fit_gwqr(
                self.x_calib, residuals, self.coord_calib,
                coord_new.reshape(1, -1), k_opt,
                1 - self.miscoverage_level + beta_opt,
            )
            lb = gwqr_lb.predict(x_new.reshape(1, -1))[0]
            ub = gwqr_ub.predict(x_new.reshape(1, -1))[0]

        return lb, ub, k_opt, beta_opt, alpha_opt

    def _predict_single_point_fixed(self, i, residuals):
        """Predict for a single test point with fixed (k, beta)."""
        x_new = self.x_test[i]
        coord_new = self.coord_test[i]

        gwqr_lb = self._fit_gwqr(
            self.x_calib, residuals, self.coord_calib,
            coord_new.reshape(1, -1), self.k, self.beta,
        )
        gwqr_ub = self._fit_gwqr(
            self.x_calib, residuals, self.coord_calib,
            coord_new.reshape(1, -1), self.k,
            1 - self.miscoverage_level + self.beta,
        )
        lb = gwqr_lb.predict(x_new.reshape(1, -1))[0]
        ub = gwqr_ub.predict(x_new.reshape(1, -1))[0]
        return lb, ub, self.k, self.beta, self.alpha_penalty

    # ----------------------------------------------------------
    # Main entry point
    # ----------------------------------------------------------

    def analyze(
        self,
        x_test: NDArray,
        y_test: NDArray,
        coord_test: NDArray,
    ) -> WBCPResults:
        """
        Run GWQR conformal prediction on test data.

        Parameters
        ----------
        x_test : NDArray
            Test features, shape (n_test, d).
        y_test : NDArray
            Test ground truth, shape (n_test,).
        coord_test : NDArray
            Test coordinates, shape (n_test, 2).

        Returns
        -------
        WBCPResults
            Prediction intervals and coverage. Bayesian fields are None.
        """
        from joblib import Parallel, delayed

        self.x_test = np.asarray(x_test)
        self.y_test = np.asarray(y_test)
        self.coord_test = np.asarray(coord_test)
        n_test = len(self.y_test)

        worker = (
            self._predict_single_point_optimized
            if self.optimize
            else self._predict_single_point_fixed
        )

        results = Parallel(n_jobs=self.n_jobs)(
            delayed(worker)(i, self._residuals) for i in range(n_test)
        )

        lb_residuals = np.array([r[0] for r in results])
        ub_residuals = np.array([r[1] for r in results])

        y_pred = self.predict_f(self.x_test)
        lower_bound = y_pred + lb_residuals
        upper_bound = y_pred + ub_residuals
        uncertainty = (upper_bound - lower_bound) / 2.0
        coverage = float(
            np.mean((self.y_test >= lower_bound) & (self.y_test <= upper_bound))
        )

        global_uncertainty = float(
            np.quantile(np.abs(self._residuals), 1 - self.miscoverage_level)
        )

        return WBCPResults(
            uncertainty=uncertainty,
            upper_bound=upper_bound,
            lower_bound=lower_bound,
            pred_value=y_pred,
            true_value=self.y_test,
            coverage=coverage,
            global_uncertainty=global_uncertainty,
        )


# ============================================================
# LSCP Conformal Predictor
# ============================================================

class LSCPConformalPredictor:
    """
    Locally-Smoothed Conformal Prediction (LSCP).

    Uses k-NN neighbor nonconformity scores as features to train a
    Quantile Random Forest (QRF), which then predicts asymmetric
    prediction interval bounds for each test point.

    The key idea: for each calibration point, collect its k nearest
    neighbors' nonconformity scores as a feature vector. Train a QRF
    to map these feature vectors to the nonconformity score. At test
    time, use the k-NN scores of the test point as input to the QRF.

    Parameters
    ----------
    predict_f : Callable
        Base prediction function, (NDArray) -> NDArray.
    x_calib : NDArray
        Calibration features, shape (n_calib, d).
    y_calib : NDArray
        Calibration ground truth, shape (n_calib,).
    coord_calib : NDArray
        Calibration coordinates, shape (n_calib, 2).
    k : int
        Number of nearest neighbors (default 10).
    miscoverage_level : float
        Desired miscoverage level alpha (default 0.1).
    n_jobs : int
        Number of parallel jobs (default 8).

    Examples
    --------
    >>> from WBCP.methods import LSCPConformalPredictor
    >>> lscp = LSCPConformalPredictor(model.predict, x_calib, y_calib, coord_calib)
    >>> results = lscp.analyze(x_test, y_test, coord_test)
    >>> print(results.coverage)
    """

    def __init__(
        self,
        predict_f: Callable,
        x_calib: NDArray,
        y_calib: NDArray,
        coord_calib: NDArray,
        k: int = 10,
        miscoverage_level: float = 0.1,
        n_jobs: int = 8,
    ):
        self.predict_f = predict_f
        self.x_calib = np.asarray(x_calib)
        self.y_calib = np.asarray(y_calib)
        self.coord_calib = np.asarray(coord_calib)
        self.k = k
        self.miscoverage_level = miscoverage_level
        self.n_jobs = n_jobs

        # Pre-compute calibration residuals (signed: y - pred)
        y_calib_pred = self.predict_f(self.x_calib)
        self._residuals = self.y_calib - y_calib_pred

    # ----------------------------------------------------------
    # Internal helpers
    # ----------------------------------------------------------

    @staticmethod
    def _k_neighbors(target: NDArray, others: NDArray, k: int,
                     exclude_self: bool = True) -> NDArray:
        """
        Find k nearest neighbor indices.

        Parameters
        ----------
        target : shape (2,) or (1, 2)
        others : shape (n, 2)
        k : number of neighbors
        exclude_self : if True, skip index 0 (the point itself in calib)
        """
        target = target.ravel()
        distances = np.sqrt(np.sum((others - target) ** 2, axis=1))
        if exclude_self:
            sorted_indices = np.argsort(distances)[1:k + 1]
        else:
            sorted_indices = np.argsort(distances)[:k]
        return sorted_indices

    def _generate_diff_dataset(self, residuals: NDArray):
        """
        Build training dataset for QRF.

        For each calibration point, the features are the k-NN neighbors'
        nonconformity scores, and the target is the point's own score.

        Returns
        -------
        y : shape (n_calib,)
        x : shape (n_calib, k)
        """
        n_calib = len(residuals)
        x_list = np.zeros((n_calib, self.k))
        for i in range(n_calib):
            indices = self._k_neighbors(
                self.coord_calib[i], self.coord_calib, self.k,
                exclude_self=True,
            )
            x_list[i] = residuals[indices]
        return residuals.copy(), x_list

    def _fit_qrf(self, y: NDArray, x: NDArray):
        """Train a RandomForestQuantileRegressor."""
        from quantile_forest import RandomForestQuantileRegressor

        qrf = RandomForestQuantileRegressor(n_jobs=self.n_jobs)
        qrf.fit(x, y)
        return qrf

    # ----------------------------------------------------------
    # Optimization per test point
    # ----------------------------------------------------------

    def _interval_width_single(self, params, coord_new, residuals, qrf):
        """Objective: interval width for a single beta."""
        beta = params[0]
        indices = self._k_neighbors(
            coord_new, self.coord_calib, self.k, exclude_self=False,
        )
        x_new = residuals[indices].reshape(1, -1)
        lb, ub = qrf.predict(
            x_new,
            quantiles=[beta, 1 - self.miscoverage_level + beta],
        )[0]
        return ub - lb

    def _optimize_and_predict_single(self, i, residuals, qrf):
        """Optimize beta and predict for a single test point."""
        from scipy.optimize import minimize as sp_minimize

        coord_new = self.coord_test[i]

        # Optimize beta
        res = sp_minimize(
            fun=self._interval_width_single,
            x0=np.array([0.01]),
            bounds=[(1e-10, self.miscoverage_level - 1e-10)],
            method='Powell',
            args=(coord_new, residuals, qrf),
        )
        beta_opt = res.x[0]

        # Predict with optimized beta
        indices = self._k_neighbors(
            coord_new, self.coord_calib, self.k, exclude_self=False,
        )
        x_new = residuals[indices].reshape(1, -1)
        lb, ub = qrf.predict(
            x_new,
            quantiles=[beta_opt, 1 - self.miscoverage_level + beta_opt],
        )[0]
        return lb, ub, beta_opt

    # ----------------------------------------------------------
    # Main entry point
    # ----------------------------------------------------------

    def analyze(
        self,
        x_test: NDArray,
        y_test: NDArray,
        coord_test: NDArray,
    ) -> WBCPResults:
        """
        Run LSCP conformal prediction on test data.

        Parameters
        ----------
        x_test : NDArray
            Test features, shape (n_test, d).
        y_test : NDArray
            Test ground truth, shape (n_test,).
        coord_test : NDArray
            Test coordinates, shape (n_test, 2).

        Returns
        -------
        WBCPResults
            Prediction intervals and coverage. Bayesian fields are None.
        """
        from joblib import Parallel, delayed

        self.x_test = np.asarray(x_test)
        self.y_test = np.asarray(y_test)
        self.coord_test = np.asarray(coord_test)
        n_test = len(self.y_test)

        # Build QRF training data from calibration set
        y_qrf, x_qrf = self._generate_diff_dataset(self._residuals)
        qrf = self._fit_qrf(y_qrf, x_qrf)

        # Parallel optimization + prediction
        results = Parallel(n_jobs=self.n_jobs)(
            delayed(self._optimize_and_predict_single)(
                i, self._residuals, qrf,
            )
            for i in range(n_test)
        )

        lb_residuals = np.array([r[0] for r in results])
        ub_residuals = np.array([r[1] for r in results])

        y_pred = self.predict_f(self.x_test)
        lower_bound = y_pred + lb_residuals
        upper_bound = y_pred + ub_residuals
        uncertainty = (upper_bound - lower_bound) / 2.0
        coverage = float(
            np.mean((self.y_test >= lower_bound) & (self.y_test <= upper_bound))
        )

        global_uncertainty = float(
            np.quantile(np.abs(self._residuals), 1 - self.miscoverage_level)
        )

        return WBCPResults(
            uncertainty=uncertainty,
            upper_bound=upper_bound,
            lower_bound=lower_bound,
            pred_value=y_pred,
            true_value=self.y_test,
            coverage=coverage,
            global_uncertainty=global_uncertainty,
        )
