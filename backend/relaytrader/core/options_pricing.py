"""
Options pricing models for manual trading simulation.
"""
import math
from datetime import datetime
from typing import Literal
import numpy as np
from scipy import stats


def black_scholes_price(
    option_type: Literal["call", "put"],
    spot_price: float,
    strike: float,
    time_to_expiry: float,  # in years
    volatility: float,
    risk_free_rate: float = 0.05,
) -> float:
    """
    Calculate option price using Black-Scholes model.

    Args:
        option_type: "call" or "put"
        spot_price: Current underlying price
        strike: Strike price
        time_to_expiry: Time to expiration in years
        volatility: Implied volatility (e.g., 0.30 for 30%)
        risk_free_rate: Risk-free rate (e.g., 0.05 for 5%)

    Returns:
        Option price (premium)
    """
    if time_to_expiry <= 0:
        # At expiration, use intrinsic value
        if option_type == "call":
            return max(0, spot_price - strike)
        else:
            return max(0, strike - spot_price)

    if volatility <= 0 or spot_price <= 0 or strike <= 0:
        return 0.0

    # Calculate d1 and d2
    d1 = (math.log(spot_price / strike) + (risk_free_rate + 0.5 * volatility**2) * time_to_expiry) / (
        volatility * math.sqrt(time_to_expiry)
    )
    d2 = d1 - volatility * math.sqrt(time_to_expiry)

    if option_type == "call":
        price = spot_price * stats.norm.cdf(d1) - strike * math.exp(-risk_free_rate * time_to_expiry) * stats.norm.cdf(d2)
    else:  # put
        price = strike * math.exp(-risk_free_rate * time_to_expiry) * stats.norm.cdf(-d2) - spot_price * stats.norm.cdf(-d1)

    return max(0, price)


def black_scholes_greeks(
    option_type: Literal["call", "put"],
    spot_price: float,
    strike: float,
    time_to_expiry: float,
    volatility: float,
    risk_free_rate: float = 0.05,
) -> dict[str, float]:
    """
    Calculate option Greeks using Black-Scholes model.

    Returns:
        Dictionary with delta, gamma, theta, vega
    """
    if time_to_expiry <= 0 or volatility <= 0 or spot_price <= 0 or strike <= 0:
        return {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}

    d1 = (math.log(spot_price / strike) + (risk_free_rate + 0.5 * volatility**2) * time_to_expiry) / (
        volatility * math.sqrt(time_to_expiry)
    )
    d2 = d1 - volatility * math.sqrt(time_to_expiry)

    # Delta
    if option_type == "call":
        delta = stats.norm.cdf(d1)
    else:
        delta = stats.norm.cdf(d1) - 1

    # Gamma (same for calls and puts)
    gamma = stats.norm.pdf(d1) / (spot_price * volatility * math.sqrt(time_to_expiry))

    # Theta
    term1 = -(spot_price * stats.norm.pdf(d1) * volatility) / (2 * math.sqrt(time_to_expiry))
    if option_type == "call":
        term2 = -risk_free_rate * strike * math.exp(-risk_free_rate * time_to_expiry) * stats.norm.cdf(d2)
        theta = (term1 + term2) / 365  # Per day
    else:
        term2 = risk_free_rate * strike * math.exp(-risk_free_rate * time_to_expiry) * stats.norm.cdf(-d2)
        theta = (term1 + term2) / 365  # Per day

    # Vega (same for calls and puts)
    vega = spot_price * stats.norm.pdf(d1) * math.sqrt(time_to_expiry) / 100  # Per 1% change in volatility

    return {
        "delta": delta,
        "gamma": gamma,
        "theta": theta,
        "vega": vega,
    }


def simple_payoff(
    option_type: Literal["call", "put"],
    spot_price: float,
    strike: float,
    premium_paid: float,
) -> float:
    """
    Calculate simple option payoff at expiration.

    Args:
        option_type: "call" or "put"
        spot_price: Current underlying price
        strike: Strike price
        premium_paid: Premium paid for the option

    Returns:
        Net payoff (profit/loss)
    """
    if option_type == "call":
        intrinsic_value = max(0, spot_price - strike)
    else:
        intrinsic_value = max(0, strike - spot_price)

    return intrinsic_value - premium_paid


def time_to_expiry_years(current_timestamp: int, expiry_date_str: str) -> float:
    """
    Calculate time to expiry in years.

    Args:
        current_timestamp: Current time in milliseconds
        expiry_date_str: Expiry date in YYYY-MM-DD format

    Returns:
        Time to expiry in years
    """
    current_dt = datetime.fromtimestamp(current_timestamp / 1000)
    expiry_dt = datetime.strptime(expiry_date_str, "%Y-%m-%d")

    days_to_expiry = (expiry_dt - current_dt).days
    return max(0, days_to_expiry / 365.0)
