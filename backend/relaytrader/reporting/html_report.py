from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any

from ..core.backtest import BacktestResult


def _escape_html(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def generate_html_report(result: BacktestResult, output_path: str | Path) -> Path:
    """
    Generate a standalone HTML report for a backtest.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    stats = result.stats
    config = result.config

    equity = stats.equity_curve
    #simple x-axis as bar index (0..N-1)
    x_values = list(range(len(equity)))

    created_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")

    #we will JSON-encode arrays so JS can consume them safely
    equity_json = json.dumps(equity)
    x_json = json.dumps(x_values)

    #trades & orders as plain dicts
    trades_json = json.dumps(result.trades)
    orders_json = json.dumps(result.orders)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Backtest Report - { _escape_html(config.symbol) }</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {{
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 1.5rem;
      background: #0f172a;
      color: #e5e7eb;
    }}
    h1, h2, h3 {{
      color: #f9fafb;
    }}
    .container {{
      max-width: 1100px;
      margin: 0 auto;
    }}
    .card {{
      background: #020617;
      border-radius: 0.75rem;
      padding: 1.25rem 1.5rem;
      margin-bottom: 1.25rem;
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.9);
      border: 1px solid #1f2937;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
    }}
    .stat-label {{
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #9ca3af;
    }}
    .stat-value {{
      font-size: 1.1rem;
      font-weight: 600;
      color: #f9fafb;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }}
    th, td {{
      padding: 0.4rem 0.5rem;
      text-align: left;
      border-bottom: 1px solid #111827;
      white-space: nowrap;
    }}
    th {{
      background: #020617;
      position: sticky;
      top: 0;
      z-index: 1;
    }}
    .table-container {{
      max-height: 300px;
      overflow: auto;
      border-radius: 0.5rem;
      border: 1px solid #111827;
    }}
    code {{
      background: #111827;
      padding: 0.1rem 0.35rem;
      border-radius: 0.25rem;
      font-size: 0.8rem;
    }}
    a {{
      color: #38bdf8;
    }}
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>Backtest Report</h1>
      <p style="color:#9ca3af;font-size:0.9rem;">Generated {created_at}</p>
      <p style="font-size:0.95rem;">
        <strong>Symbol:</strong> { _escape_html(config.symbol) } &mdash;
        <strong>Initial Cash:</strong> {config.initial_cash:,.2f} &mdash;
        <strong>Commission per trade:</strong> {config.commission_per_trade:.4f}
      </p>
    </div>

    <div class="card">
      <h2>Performance Summary</h2>
      <div class="grid">
        <div>
          <div class="stat-label">Total Return</div>
          <div class="stat-value">{stats.total_return * 100:.2f}%</div>
        </div>
        <div>
          <div class="stat-label">Annualized Return</div>
          <div class="stat-value">{stats.annualized_return * 100:.2f}%</div>
        </div>
        <div>
          <div class="stat-label">Volatility (periodic)</div>
          <div class="stat-value">{stats.volatility * 100:.2f}%</div>
        </div>
        <div>
          <div class="stat-label">Sharpe (no RF)</div>
          <div class="stat-value">{stats.sharpe:.2f}</div>
        </div>
        <div>
          <div class="stat-label">Max Drawdown</div>
          <div class="stat-value">{stats.max_drawdown * 100:.2f}%</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Equity Curve</h2>
      <canvas id="equityChart" height="220"></canvas>
    </div>

    <div class="card">
      <h2>Trades</h2>
      <div class="table-container">
        <table id="tradesTable">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Order ID</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Commission</th>
              <th>Slippage</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2>Orders</h2>
      <div class="table-container">
        <table id="ordersTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Type</th>
              <th>Status</th>
              <th>Qty</th>
              <th>Limit</th>
              <th>Stop</th>
              <th>Filled</th>
              <th>Avg Fill</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- Chart.js from CDN -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    const equityData = {equity_json};
    const xValues = {x_json};
    const trades = {trades_json};
    const orders = {orders_json};

    // Equity chart
    const ctx = document.getElementById('equityChart').getContext('2d');
    new Chart(ctx, {{
      type: 'line',
      data: {{
        labels: xValues,
        datasets: [{{
          label: 'Equity',
          data: equityData,
          borderWidth: 2,
          fill: false,
        }}]
      }},
      options: {{
        responsive: true,
        plugins: {{
          legend: {{
            display: false
          }}
        }},
        scales: {{
          x: {{
            title: {{
              display: true,
              text: 'Bar index'
            }}
          }},
          y: {{
            title: {{
              display: true,
              text: 'Equity'
            }},
            ticks: {{
              callback: function(value) {{
                return value.toLocaleString();
              }}
            }}
          }}
        }}
      }}
    }});

    function populateTable(id, rows, columns) {{
      const tbody = document.getElementById(id).querySelector('tbody');
      tbody.innerHTML = '';
      rows.forEach(row => {{
        const tr = document.createElement('tr');
        columns.forEach(col => {{
          const td = document.createElement('td');
          let val = row[col];
          if (val === null || typeof val === 'undefined') {{
            val = '';
          }}
          td.textContent = val;
          tr.appendChild(td);
        }});
        tbody.appendChild(tr);
      }});
    }}

    populateTable('tradesTable', trades, [
      'timestamp', 'order_id', 'symbol', 'side', 'qty', 'price', 'commission', 'slippage'
    ]);

    populateTable('ordersTable', orders, [
      'id', 'symbol', 'side', 'order_type', 'status', 'qty',
      'limit_price', 'stop_price', 'filled_qty', 'avg_fill_price'
    ]);
  </script>
</body>
</html>
"""

    output_path.write_text(html, encoding="utf-8")
    return output_path
