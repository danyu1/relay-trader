from __future__ import annotations

from dataclasses import dataclass
from typing import List, Sequence

import numpy as np


@dataclass
class PerformanceStats:
    total_return: float
    annualized_return: float
    volatility: float
    sharpe: float
    sortino: float
    calmar: float
    max_drawdown: float
    equity_curve: List[float]
    drawdown_curve: List[float]


def compute_performance(
    equity_curve: Sequence[float],
    periods_per_year: int = 252,
) -> PerformanceStats:
    if len(equity_curve) < 2:
        return PerformanceStats(
            total_return=0.0,
            annualized_return=0.0,
            volatility=0.0,
            sharpe=0.0,
            sortino=0.0,
            calmar=0.0,
            max_drawdown=0.0,
            equity_curve=list(equity_curve),
            drawdown_curve=[0.0 for _ in equity_curve],
        )

    equity = np.array(equity_curve, dtype=float)
    rets = np.diff(equity) / equity[:-1]

    total_return = (equity[-1] / equity[0]) - 1.0

    mean_ret = rets.mean()
    vol = rets.std()
    downside = rets[rets < 0]
    downside_vol = downside.std() if downside.size > 0 else 0.0

    if vol == 0:
        sharpe = 0.0
    else:
        sharpe = (mean_ret * periods_per_year) / (vol * np.sqrt(periods_per_year))

    if downside_vol == 0:
        sortino = 0.0
    else:
        sortino = (mean_ret * periods_per_year) / (downside_vol * np.sqrt(periods_per_year))

    annualized_return = (1 + mean_ret) ** periods_per_year - 1

    #drawdown
    running_max = np.maximum.accumulate(equity)
    drawdown = (equity - running_max) / running_max
    max_dd = float(drawdown.min())

    calmar = (annualized_return / abs(max_dd)) if max_dd != 0 else 0.0

    return PerformanceStats(
        total_return=float(total_return),
        annualized_return=float(annualized_return),
        volatility=float(vol),
        sharpe=float(sharpe),
        sortino=float(sortino),
        calmar=float(calmar),
        max_drawdown=float(max_dd),
        equity_curve=list(equity_curve),
        drawdown_curve=list(drawdown),
    )
