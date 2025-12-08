import math

from relaytrader.core.broker import SimpleBroker
from relaytrader.core.types import Bar, OrderType


def _bar(ts: int, open_: float, high: float, low: float, close: float) -> Bar:
    return Bar(timestamp=ts, symbol="AAPL", open=open_, high=high, low=low, close=close, volume=1_000_000)


def test_stop_order_triggers_and_fills():
    broker = SimpleBroker(initial_cash=100_000, symbol="AAPL", commission_per_trade=1.0, slippage_bps=10.0)
    # place stop buy at 105
    broker.buy("AAPL", qty=10, order_type=OrderType.STOP, stop_price=105.0)
    # bar that triggers stop (high above stop), close at 106
    fills = broker.on_bar(_bar(1, 100.0, 106.0, 99.0, 106.0))
    assert len(fills) == 1
    fill = fills[0]
    assert math.isclose(fill.price, 106.0, rel_tol=1e-6)
    # slippage 10 bps on notional = price * qty * 0.001
    expected_slippage = 106.0 * 10 * (10.0 / 10_000)
    assert math.isclose(fill.slippage, expected_slippage, rel_tol=1e-9)
    # portfolio cash should decrease by price*qty + commission + slippage
    assert math.isclose(
        broker.portfolio.cash,
        100_000 - (fill.price * fill.qty) - fill.commission - fill.slippage,
        rel_tol=1e-6,
    )
    # equity should include position marked at close
    broker.portfolio.update_equity({"AAPL": 106.0})
    assert broker.portfolio.equity > 0


def test_stop_limit_requires_limit_condition():
    broker = SimpleBroker(initial_cash=100_000, symbol="AAPL")
    broker.buy(
        "AAPL",
        qty=5,
        order_type=OrderType.STOP_LIMIT,
        stop_price=105.0,
        limit_price=104.5,
    )
    # trigger stop (high >= 105) but limit not satisfied (low 104.8 > limit 104.5)
    fills = broker.on_bar(_bar(1, 104.0, 105.2, 104.8, 105.0))
    assert fills == []
    # next bar satisfies limit
    fills = broker.on_bar(_bar(2, 104.0, 105.5, 104.0, 104.2))
    assert len(fills) == 1
    assert math.isclose(fills[0].price, 104.5, rel_tol=1e-6) or fills[0].price <= 104.5
