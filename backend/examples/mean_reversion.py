from relaytrader.core.strategy import Strategy
from relaytrader.core.types import Bar, OrderType


class MeanReversion(Strategy):
    def on_bar(self, bar: Bar) -> None:
        z = self.zscore(bar.symbol, 'close', 50)
        if z is None:
            return

        pos = self.context.get_position_qty(bar.symbol)

        if z > 2 and pos > 0:
            self.sell(bar.symbol, pos, OrderType.MARKET)
        elif z < -2 and pos >= 0:
            self.buy(bar.symbol, 1, OrderType.MARKET)
