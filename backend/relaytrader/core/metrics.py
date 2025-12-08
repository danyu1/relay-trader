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


@dataclass
class TradeStats:
    total_pnl: float
    total_commission: float
    total_slippage: float
    net_pnl: float
    win_rate: float
    avg_win: float
    avg_loss: float
    num_trades: int
    turnover: float


def compute_trade_stats(fills: Sequence, initial_cash: float) -> tuple[TradeStats, list[float]]:
    """
    Compute realized P&L metrics from fills and return per-fill realized P&L (net of fees).
    """
    current_qty = 0.0
    avg_cost = 0.0
    realized_list: list[float] = []

    total_commission = 0.0
    total_slippage = 0.0
    gross_notional = 0.0

    for fill in fills:
        total_commission += fill.commission
        total_slippage += fill.slippage
        gross_notional += abs(fill.qty * fill.price)

        signed_qty = fill.qty if fill.side.value == "BUY" else -fill.qty
        realized = 0.0

        if current_qty == 0:
            current_qty = signed_qty
            avg_cost = fill.price
        elif current_qty * signed_qty > 0:
            # same side, add to position
            new_qty = current_qty + signed_qty
            avg_cost = (abs(current_qty) * avg_cost + abs(signed_qty) * fill.price) / abs(new_qty)
            current_qty = new_qty
        else:
            # reducing/closing or flipping
            sign = 1.0 if current_qty > 0 else -1.0
            close_qty = min(abs(current_qty), abs(signed_qty))
            realized += close_qty * (fill.price - avg_cost) * sign
            current_qty += signed_qty
            if current_qty == 0:
                avg_cost = 0.0
            elif current_qty * sign < 0:
                # flipped
                avg_cost = fill.price
        net_realized = realized - fill.commission - fill.slippage
        realized_list.append(net_realized)

    wins = [r for r in realized_list if r > 0]
    losses = [r for r in realized_list if r < 0]
    num_trades = len([r for r in realized_list if r != 0])
    win_rate = (len(wins) / num_trades) if num_trades > 0 else 0.0
    avg_win = sum(wins) / len(wins) if wins else 0.0
    avg_loss = sum(losses) / len(losses) if losses else 0.0

    turnover = (gross_notional / initial_cash) if initial_cash > 0 else 0.0
    total_pnl = sum(realized_list) + total_commission + total_slippage  # before fees
    net_pnl = sum(realized_list)

    trade_stats = TradeStats(
        total_pnl=float(total_pnl),
        total_commission=float(total_commission),
        total_slippage=float(total_slippage),
        net_pnl=float(net_pnl),
        win_rate=float(win_rate),
        avg_win=float(avg_win),
        avg_loss=float(avg_loss),
        num_trades=num_trades,
        turnover=float(turnover),
    )
    return trade_stats, realized_list
