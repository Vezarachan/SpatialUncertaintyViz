"""Dataset loading and metadata service."""
import os
import pandas as pd
import numpy as np
from config import DATASETS_DIR, UPLOADS_DIR, BUILTIN_DATASETS

_metadata_cache = None


def get_metadata():
    """Load and cache metadata from Metadata.xlsx."""
    global _metadata_cache
    if _metadata_cache is not None:
        return _metadata_cache

    path = os.path.join(DATASETS_DIR, "Metadata.xlsx")
    if not os.path.exists(path):
        _metadata_cache = {}
        return _metadata_cache

    xl = pd.ExcelFile(path)
    _metadata_cache = {}
    for sheet in xl.sheet_names:
        df = xl.parse(sheet)
        if len(df.columns) >= 3:
            meta = {}
            for _, row in df.iterrows():
                col_name = row.iloc[0]
                full_name = row.iloc[2] if len(row) > 2 else None
                desc = row.iloc[3] if len(row) > 3 else None
                if pd.notna(col_name):
                    meta[str(col_name)] = {
                        "full_name": str(full_name) if pd.notna(full_name) else str(col_name),
                        "description": str(desc) if pd.notna(desc) else "",
                    }
            _metadata_cache[sheet] = meta
    return _metadata_cache


def list_datasets():
    """List all available datasets (built-in + uploaded)."""
    datasets = []
    for name, info in BUILTIN_DATASETS.items():
        filepath = os.path.join(DATASETS_DIR, info["file"])
        if os.path.exists(filepath):
            df = pd.read_csv(filepath, nrows=0)
            n_rows = sum(1 for _ in open(filepath)) - 1
            datasets.append({
                "name": name,
                "builtin": True,
                "rows": n_rows,
                "columns": list(df.columns),
                "description": info.get("description", ""),
                "config": {
                    "target": info["target"],
                    "features": info["features"],
                    "coords": info["coords"],
                    "coord_type": info["coord_type"],
                    "region": info.get("region"),
                },
            })

    # Uploaded datasets
    if os.path.exists(UPLOADS_DIR):
        for f in os.listdir(UPLOADS_DIR):
            if f.endswith(".csv"):
                filepath = os.path.join(UPLOADS_DIR, f)
                df = pd.read_csv(filepath, nrows=0)
                n_rows = sum(1 for _ in open(filepath)) - 1
                name = os.path.splitext(f)[0]
                datasets.append({
                    "name": name,
                    "builtin": False,
                    "rows": n_rows,
                    "columns": list(df.columns),
                    "description": "Uploaded dataset",
                    "config": None,
                })
    return datasets


def load_dataset(name):
    """Load a dataset into a pandas DataFrame."""
    if name in BUILTIN_DATASETS:
        filepath = os.path.join(DATASETS_DIR, BUILTIN_DATASETS[name]["file"])
    else:
        filepath = os.path.join(UPLOADS_DIR, f"{name}.csv")

    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Dataset not found: {name}")

    return pd.read_csv(filepath)


def preview_dataset(name, n_rows=10):
    """Preview first n rows of a dataset."""
    df = load_dataset(name)
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    return {
        "columns": list(df.columns),
        "numeric_columns": numeric_cols,
        "dtypes": {c: str(df[c].dtype) for c in df.columns},
        "rows": df.head(n_rows).values.tolist(),
        "n_total": len(df),
    }


def get_dataset_metadata(name):
    """Get metadata for a built-in dataset."""
    metadata = get_metadata()
    if name in BUILTIN_DATASETS:
        sheet = BUILTIN_DATASETS[name].get("metadata_sheet")
        if sheet and sheet in metadata:
            return metadata[sheet]
    return {}


def save_uploaded(file_storage):
    """Save an uploaded file and return its name."""
    filename = file_storage.filename
    if not filename.endswith(".csv"):
        raise ValueError("Only CSV files are supported")

    safe_name = "".join(c for c in os.path.splitext(filename)[0] if c.isalnum() or c in "_-")
    filepath = os.path.join(UPLOADS_DIR, f"{safe_name}.csv")
    file_storage.save(filepath)

    # Validate it's readable
    df = pd.read_csv(filepath, nrows=1)
    return safe_name
