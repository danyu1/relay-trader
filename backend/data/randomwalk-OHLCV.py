import pandas as pd
import numpy as np

np.random.seed(42)

bars = 3000
prices = np.cumsum(np.random.randn(bars)) + 100  # random walk
df = pd.DataFrame({
    "timestamp": pd.date_range(start="2020-01-01", periods=bars, freq="D"),
    "open": prices + np.random.randn(bars),
    "high": prices + np.abs(np.random.randn(bars)),
    "low": prices - np.abs(np.random.randn(bars)),
    "close": prices + np.random.randn(bars),
    "volume": np.random.randint(100000, 5000000, size=bars),
})

df.to_csv("AAPL_3000bars.csv", index=False)
print("Saved AAPL_3000bars.csv with", len(df), "bars")
