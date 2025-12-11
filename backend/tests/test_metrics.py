import math

from relaytrader.core.metrics import compute_trade_stats
from relaytrader.core.types import Fill, Side


def make_fill(order_id: int, timestamp: int, side: Side, qty: float, price: float) -> Fill:
    return Fill(
        order_id=order_id,
        timestamp=timestamp,
        symbol="AAPL",
        side=side,
        qty=qty,
        price=price,
        commission=0.0,
        slippage=0.0,
    )


def test_compute_trade_stats_win_rate_and_totals():
    fills = [
        make_fill(1, 1, Side.BUY, 1, 100.0),
        make_fill(2, 2, Side.SELL, 1, 110.0),
        make_fill(3, 3, Side.BUY, 1, 120.0),
        make_fill(4, 4, Side.SELL, 1, 115.0),
    ]

    stats, realized = compute_trade_stats(fills, initial_cash=1_000.0)

    assert realized == [0.0, 10.0, 0.0, -5.0]
    assert stats.num_trades == 2
    assert math.isclose(stats.win_rate, 0.5)
    assert math.isclose(stats.avg_win, 10.0)
    assert math.isclose(stats.avg_loss, -5.0)
    assert math.isclose(stats.net_pnl, 5.0)
    assert math.isclose(stats.total_pnl, 5.0)


def test_compute_trade_stats_no_closed_trades():
    fills = [
        make_fill(1, 1, Side.BUY, 1, 100.0),
        make_fill(2, 2, Side.BUY, 1, 101.0),
    ]

    stats, realized = compute_trade_stats(fills, initial_cash=1_000.0)

    assert realized == [0.0, 0.0]
    assert stats.num_trades == 0
    assert stats.win_rate == 0.0
    assert stats.avg_win == 0.0
    assert stats.avg_loss == 0.0
    assert stats.net_pnl == 0.0
