"""Model training service."""
import numpy as np
from sklearn.model_selection import train_test_split


def three_way_split(X, y, coords, train_ratio=0.8, random_seed=42):
    """Split data into train / calibration / test sets.
    train_ratio of data for training, remaining split equally into calib/test.
    """
    X_train, X_rest, y_train, y_rest, coord_train, coord_rest = train_test_split(
        X, y, coords, train_size=train_ratio, random_state=random_seed
    )
    X_calib, X_test, y_calib, y_test, coord_calib, coord_test = train_test_split(
        X_rest, y_rest, coord_rest, train_size=0.5, random_state=random_seed
    )
    return {
        "X_train": X_train, "y_train": y_train, "coord_train": coord_train,
        "X_calib": X_calib, "y_calib": y_calib, "coord_calib": coord_calib,
        "X_test": X_test, "y_test": y_test, "coord_test": coord_test,
    }


def train_model(model_type, X_train, y_train, model_params=None):
    """Train a base prediction model. Returns (model, predict_fn, model_name)."""
    model_params = model_params or {}

    if model_type == "ols":
        from sklearn.linear_model import LinearRegression
        model = LinearRegression()
        model.fit(X_train, y_train)
        return model, model.predict, "OLS Linear Regression"

    elif model_type == "random_forest":
        from sklearn.ensemble import RandomForestRegressor
        model = RandomForestRegressor(
            n_estimators=model_params.get("n_estimators", 100),
            max_depth=model_params.get("max_depth", None),
            min_samples_leaf=model_params.get("min_samples_leaf", 1),
            random_state=42,
            n_jobs=-1,
        )
        model.fit(X_train, y_train)
        return model, model.predict, "Random Forest"

    elif model_type == "xgboost":
        from xgboost import XGBRegressor
        model = XGBRegressor(
            n_estimators=model_params.get("n_estimators", 100),
            max_depth=model_params.get("max_depth", 6),
            learning_rate=model_params.get("learning_rate", 0.1),
            random_state=42,
            n_jobs=-1,
            verbosity=0,
        )
        model.fit(X_train, y_train)
        return model, model.predict, "XGBoost"

    elif model_type == "gwr":
        # GWR requires coordinates - use spatial lag as proxy
        # Full mgwr integration would require libpysal
        from sklearn.linear_model import Ridge
        model = Ridge(alpha=1.0)
        model.fit(X_train, y_train)
        return model, model.predict, "GWR (Ridge proxy)"

    else:
        raise ValueError(f"Unknown model type: {model_type}")


def compute_metrics(y_true, y_pred):
    """Compute regression metrics."""
    residuals = y_true - y_pred
    rmse = float(np.sqrt(np.mean(residuals ** 2)))
    mae = float(np.mean(np.abs(residuals)))
    ss_res = np.sum(residuals ** 2)
    ss_tot = np.sum((y_true - np.mean(y_true)) ** 2)
    r2 = float(1 - ss_res / (ss_tot + 1e-14))
    return {"rmse": round(rmse, 4), "mae": round(mae, 4), "r2": round(r2, 4)}
