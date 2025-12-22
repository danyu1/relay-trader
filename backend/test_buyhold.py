#!/usr/bin/env python3
"""Quick test of buy and hold calculation"""

# Simulate buy and hold
initial_cash = 100_000
qty = 10_000
buy_price = 0.05
commission = 1.0

# Buy
cost = qty * buy_price + commission
cash_after_buy = initial_cash - cost
print(f"Initial cash: ${initial_cash:,.2f}")
print(f"Buy {qty:,} shares at ${buy_price:.2f} = ${qty * buy_price:.2f}")
print(f"Commission: ${commission:.2f}")
print(f"Total cost: ${cost:.2f}")
print(f"Cash after buy: ${cash_after_buy:,.2f}")
print()

# Final price
final_price = 0.60
position_value = qty * final_price
final_equity = cash_after_buy + position_value

print(f"Final price: ${final_price:.2f}")
print(f"Position value: ${position_value:,.2f}")
print(f"Final equity: ${final_equity:,.2f}")
print(f"Return: {((final_equity / initial_cash) - 1) * 100:.2f}%")
