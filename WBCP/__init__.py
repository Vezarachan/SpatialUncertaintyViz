"""
Weighted Bayesian Conformal Prediction (WBCP).

A general framework for weighted Bayesian conformal prediction that unifies
and extends:
- Standard Conformal Prediction (CP)
- Bayesian Quadrature CP (BQ-CP, Snell & Griffiths 2025)
- Weighted CP (Tibshirani et al. 2019)
- GeoConformal Prediction (GeoCP, Lou et al. 2025)
- Geographical Bayesian CP (GeoBCP)
- Localized CP (Guan et al. 2023)
- GeoSIMCP (joint spatial + feature weighting)

The key innovation is replacing BQ-CP's Dir(1,...,1) with a weighted Dirichlet
Dir(n_eff * w_1, ..., n_eff * w_n), where the weights can come from any
domain-specific importance weighting scheme.

Additional methods (GWQR, LSCP) that use local model fitting rather than
the weight-function paradigm are available in WBCP.methods.

Quick start::

    from WBCP import WeightedBayesianCP
    from WBCP.weights import spatial_kernel_weights

    weight_fn = spatial_kernel_weights(coord_calib, bandwidth=0.15)
    wbcp = WeightedBayesianCP(model.predict, x_calib, y_calib, weight_fn)
    results = wbcp.bayesian_conformalize(x_test, y_test, beta=0.9)
    print(results)
"""

from .core import WeightedBayesianCP
from .results import WBCPResults
from .utils import (
    effective_sample_size,
    weighted_quantile,
    bayesian_weighted_quantile,
)
from . import weights
from .methods import GWQRConformalPredictor, LSCPConformalPredictor
