"""
Manual trading simulation engine for options backtesting.
"""
import logging
from typing import Optional
import numpy as np

from .annotations import (
    TradeAnnotation,
    OptionSettings,
    SimulatedTrade,
    ManualBacktestStats,
)
from .options_pricing import (
    black_scholes_price,
    black_scholes_greeks,
    simple_payoff,
    time_to_expiry_years,
)

logger = logging.getLogger(__name__)


class ManualSimulator:
    """Simulate manual option trades using annotations."""

    def __init__(
        self,
        annotations: list[TradeAnnotation],
        timestamps: list[int],
        price_series: list[float],
        option_settings: OptionSettings,
    ):
        """
        Initialize the manual simulator.

        Args:
            annotations: List of trade annotations
            timestamps: Timestamps from dataset (milliseconds)
            price_series: Price series from dataset
            option_settings: Option pricing settings
        """
        self.annotations = sorted(annotations, key=lambda a: a.timestamp)
        self.timestamps = timestamps
        self.price_series = price_series
        self.settings = option_settings

        # Apply scenario adjustment to price series
        self.adjusted_prices = self._apply_scenario(price_series)

    def _apply_scenario(self, prices: list[float]) -> list[float]:
        """Apply bull/bear scenario to price series."""
        if self.settings.scenario == "base":
            return prices

        adjustment = 1.0 + self.settings.scenario_move_pct
        if self.settings.scenario == "bear":
            adjustment = 1.0 - self.settings.scenario_move_pct

        return [p * adjustment for p in prices]

    def _find_price_at_timestamp(self, target_ts: int) -> Optional[tuple[int, float]]:
        """Find the closest price at or after the target timestamp."""
        for i, ts in enumerate(self.timestamps):
            if ts >= target_ts:
                return i, self.adjusted_prices[i]
        return None

    def _price_option(
        self,
        annotation: TradeAnnotation,
        current_ts: int,
        spot_price: float,
    ) -> tuple[float, dict[str, float]]:
        """
        Price an option at a given timestamp.

        Returns:
            Tuple of (premium, greeks)
        """
        time_to_expiry = time_to_expiry_years(current_ts, annotation.expiry)

        if self.settings.use_black_scholes and time_to_expiry > 0:
            premium = black_scholes_price(
                option_type=annotation.type,
                spot_price=spot_price,
                strike=annotation.strike,
                time_to_expiry=time_to_expiry,
                volatility=self.settings.implied_volatility,
                risk_free_rate=self.settings.risk_free_rate,
            )
            greeks = black_scholes_greeks(
                option_type=annotation.type,
                spot_price=spot_price,
                strike=annotation.strike,
                time_to_expiry=time_to_expiry,
                volatility=self.settings.implied_volatility,
                risk_free_rate=self.settings.risk_free_rate,
            )
        else:
            # At expiration or simple mode: intrinsic value
            if annotation.type == "call":
                premium = max(0, spot_price - annotation.strike)
            else:
                premium = max(0, annotation.strike - spot_price)
            greeks = {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}

        return premium, greeks

    def simulate(self) -> tuple[list[SimulatedTrade], ManualBacktestStats]:
        """
        Run the manual simulation.

        Returns:
            Tuple of (simulated_trades, stats)
        """
        simulated_trades: list[SimulatedTrade] = []
        total_premium_spent = 0.0
        total_premium_received = 0.0
        total_commission = 0.0

        for annotation in self.annotations:
            # Find entry point
            entry_result = self._find_price_at_timestamp(annotation.timestamp)
            if entry_result is None:
                logger.warning(f"Annotation {annotation.id} timestamp {annotation.timestamp} is beyond dataset range")
                continue

            entry_idx, entry_spot = entry_result

            # Price the option at entry
            entry_premium, entry_greeks = self._price_option(
                annotation,
                self.timestamps[entry_idx],
                entry_spot,
            )

            # Use user-provided premium if available
            if annotation.premium is not None:
                entry_premium = annotation.premium

            # Calculate costs
            total_cost = entry_premium * annotation.contracts * 100  # Options are per 100 shares
            commission = self.settings.commission_per_contract * annotation.contracts

            if annotation.action == "buy":
                total_premium_spent += total_cost
                total_commission += commission
            else:
                total_premium_received += total_cost
                total_commission += commission

            # Determine exit point (expiration or end of dataset)
            exit_idx = len(self.timestamps) - 1
            for i in range(entry_idx, len(self.timestamps)):
                expiry_years = time_to_expiry_years(self.timestamps[i], annotation.expiry)
                if expiry_years <= 0:
                    exit_idx = i
                    break

            exit_spot = self.adjusted_prices[exit_idx]
            exit_premium, _ = self._price_option(
                annotation,
                self.timestamps[exit_idx],
                exit_spot,
            )

            # Calculate payoff
            if annotation.action == "buy":
                # Bought option, sell at exit
                payoff = (exit_premium - entry_premium) * annotation.contracts * 100 - commission
            else:
                # Sold option, buy back at exit
                payoff = (entry_premium - exit_premium) * annotation.contracts * 100 - commission

            status = "expired" if time_to_expiry_years(self.timestamps[exit_idx], annotation.expiry) <= 0 else "closed"

            simulated_trade = SimulatedTrade(
                annotation_id=annotation.id,
                entry_timestamp=self.timestamps[entry_idx],
                entry_price=entry_spot,
                option_premium_paid=entry_premium if annotation.action == "buy" else 0,
                exit_timestamp=self.timestamps[exit_idx],
                exit_price=exit_spot,
                option_premium_received=exit_premium if annotation.action == "buy" else 0,
                payoff=payoff,
                status=status,
                delta=entry_greeks.get("delta"),
                gamma=entry_greeks.get("gamma"),
                theta=entry_greeks.get("theta"),
                vega=entry_greeks.get("vega"),
            )

            simulated_trades.append(simulated_trade)

        # Calculate statistics
        stats = self._calculate_stats(
            simulated_trades,
            total_premium_spent,
            total_premium_received,
            total_commission,
        )

        return simulated_trades, stats

    def _calculate_stats(
        self,
        trades: list[SimulatedTrade],
        total_premium_spent: float,
        total_premium_received: float,
        total_commission: float,
    ) -> ManualBacktestStats:
        """Calculate statistics from simulated trades."""
        if not trades:
            return ManualBacktestStats(
                total_premium_spent=0,
                total_premium_received=0,
                net_premium=0,
                max_payoff=0,
                min_payoff=0,
                net_pnl=0,
                win_rate=0,
                num_trades=0,
                num_winners=0,
                num_losers=0,
                avg_win=0,
                avg_loss=0,
                max_win=0,
                max_loss=0,
                return_on_capital=0,
            )

        payoffs = [t.payoff for t in trades]
        winners = [p for p in payoffs if p > 0]
        losers = [p for p in payoffs if p < 0]

        net_pnl = sum(payoffs)
        net_premium = total_premium_received - total_premium_spent

        return ManualBacktestStats(
            total_premium_spent=total_premium_spent,
            total_premium_received=total_premium_received,
            net_premium=net_premium,
            max_payoff=max(payoffs) if payoffs else 0,
            min_payoff=min(payoffs) if payoffs else 0,
            net_pnl=net_pnl,
            win_rate=len(winners) / len(trades) if trades else 0,
            num_trades=len(trades),
            num_winners=len(winners),
            num_losers=len(losers),
            avg_win=sum(winners) / len(winners) if winners else 0,
            avg_loss=sum(losers) / len(losers) if losers else 0,
            max_win=max(winners) if winners else 0,
            max_loss=min(losers) if losers else 0,
            return_on_capital=net_pnl / total_premium_spent if total_premium_spent > 0 else 0,
        )
