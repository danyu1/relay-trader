from pathlib import Path
import pandas as pd

from relaytrader.core.data import inspect_csv


def test_inspect_csv_valid(tmp_path: Path):
    csv = tmp_path / "ok.csv"
    df = pd.DataFrame(
        {
            "timestamp": [1, 2, 3],
            "open": [10, 11, 12],
            "high": [11, 12, 13],
            "low": [9, 10, 11],
            "close": [10.5, 11.5, 12.5],
            "volume": [100, 110, 120],
        }
    )
    df.to_csv(csv, index=False)
    meta = inspect_csv(csv)
    assert meta["rows"] == 3
    assert meta["start"] == 1
    assert meta["end"] == 3
    assert set(meta["columns"]) == set(df.columns)


def test_inspect_csv_rejects_missing_columns(tmp_path: Path):
    csv = tmp_path / "bad.csv"
    df = pd.DataFrame({"timestamp": [1, 2], "close": [1, 2]})
    df.to_csv(csv, index=False)
    try:
        inspect_csv(csv)
    except Exception as e:
        assert "Missing required columns" in str(e)
    else:
        raise AssertionError("inspect_csv should have failed for missing columns")


def test_inspect_csv_rejects_non_numeric_timestamp(tmp_path: Path):
    csv = tmp_path / "bad_ts.csv"
    df = pd.DataFrame(
        {
          "timestamp": ["a", "b"],
          "open": [10, 11],
          "high": [11, 12],
          "low": [9, 10],
          "close": [10, 11],
          "volume": [100, 110],
        }
    )
    df.to_csv(csv, index=False)
    try:
        inspect_csv(csv)
    except Exception as e:
        assert "timestamp" in str(e)
    else:
        raise AssertionError("inspect_csv should have failed for non-numeric timestamps")
