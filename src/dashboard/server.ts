import http from "node:http";
import { parse } from "node:url";
import { queryInvocations, getAllSessions } from "../storage/sqlite.js";

export function createDashboardServer(repoRoot: string, sqlitePath: string, dataDir: string) {
  const server = http.createServer(async (req, res) => {
    const url = parse(req.url || "", true);
    const pathname = url.pathname || "";

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      if (pathname === "/api/telemetry") {
        const rows = queryInvocations(sqlitePath, {});

        // Group invocations by date and tool
        const byDate = new Map<string, Map<string, number>>();
        const byTool = new Map<string, { count: number; totalLatency: number; totalLineReduction: number }>();

        for (const row of rows) {
          const date = new Date(row.started_at).toISOString().split("T")[0];
          if (!byDate.has(date)) byDate.set(date, new Map());
          const toolCounts = byDate.get(date)!;
          toolCounts.set(row.tool_name, (toolCounts.get(row.tool_name) ?? 0) + 1);

          if (!byTool.has(row.tool_name)) {
            byTool.set(row.tool_name, { count: 0, totalLatency: 0, totalLineReduction: 0 });
          }
          const toolStats = byTool.get(row.tool_name)!;
          toolStats.count += 1;
          toolStats.totalLatency += row.duration_ms;
          if (row.baseline_lines && row.warm_lines_pulled) {
            const reduction = ((row.baseline_lines - row.warm_lines_pulled) / row.baseline_lines) * 100;
            toolStats.totalLineReduction += reduction;
          }
        }

        // Compute per-tool metrics
        const toolMetrics = Array.from(byTool.entries()).map(([toolName, stats]) => ({
          name: toolName,
          count: stats.count,
          avgLatencyMs: stats.count > 0 ? stats.totalLatency / stats.count : 0,
          avgLineReductionPercent:
            stats.count > 0 ? stats.totalLineReduction / stats.count : 0,
        }));

        // Time series
        const timeSeries = Array.from(byDate.entries())
          .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
          .map(([date, toolCounts]) => ({
            date,
            total: Array.from(toolCounts.values()).reduce((a, b) => a + b, 0),
            byTool: Object.fromEntries(toolCounts),
          }));

        // Session count
        const sessions = getAllSessions(sqlitePath);
        const sessionsByDate = new Map<string, number>();
        for (const s of sessions) {
          if (s.started_at) {
            const date = new Date(s.started_at).toISOString().split("T")[0];
            sessionsByDate.set(date, (sessionsByDate.get(date) ?? 0) + 1);
          }
        }

        const sessionTimeSeries = Array.from(sessionsByDate.entries())
          .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
          .map(([date, count]) => ({ date, count }));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            totalInvocations: rows.length,
            totalSessions: sessions.length,
            toolMetrics,
            invocationTimeSeries: timeSeries,
            sessionTimeSeries,
            repoRoot,
          }),
        );
        return;
      }

      if (pathname === "/" || pathname === "/index.html") {
        const html = generateDashboardHTML();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    } catch (err) {
      console.error("Dashboard error:", err);
      res.writeHead(500);
      res.end(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return server;
}

function generateDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>traceback Observability Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 2rem;
      line-height: 1.6;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #60a5fa, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle {
      color: #94a3b8;
      margin-bottom: 2rem;
      font-size: 0.95rem;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .metric-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 0.75rem;
      padding: 1.5rem;
      transition: all 0.3s ease;
    }
    .metric-card:hover {
      background: #293548;
      border-color: #475569;
    }
    .metric-label {
      color: #94a3b8;
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    .metric-value {
      font-size: 2rem;
      font-weight: 600;
      color: #60a5fa;
    }
    .chart-container {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 0.75rem;
      padding: 2rem;
      margin-bottom: 2rem;
      position: relative;
      height: 400px;
    }
    .chart-title {
      font-size: 1.125rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      color: #f1f5f9;
    }
    .tools-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .tool-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 0.5rem;
      padding: 1rem;
    }
    .tool-name {
      font-weight: 600;
      color: #f1f5f9;
      margin-bottom: 0.5rem;
    }
    .tool-stat {
      font-size: 0.875rem;
      color: #94a3b8;
      margin: 0.25rem 0;
    }
    .tool-stat-value {
      color: #60a5fa;
      font-weight: 500;
    }
    .loading {
      text-align: center;
      color: #94a3b8;
      padding: 2rem;
    }
    .error {
      background: #7c2d12;
      border: 1px solid #c2410c;
      color: #fed7aa;
      padding: 1rem;
      border-radius: 0.5rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>traceback Observability Dashboard</h1>
    <p class="subtitle">Session indexing, search efficiency, and warm-start effectiveness metrics</p>

    <div id="error-container"></div>
    <div id="loading" class="loading">Loading telemetry data...</div>
    <div id="content" style="display: none;">
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">Total Invocations</div>
          <div class="metric-value" id="total-invocations">—</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Indexed Sessions</div>
          <div class="metric-value" id="total-sessions">—</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Avg Line Reduction</div>
          <div class="metric-value" id="avg-line-reduction">—</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Avg Latency</div>
          <div class="metric-value" id="avg-latency">—</div>
        </div>
      </div>

      <div class="chart-container">
        <div class="chart-title">Invocation Activity Over Time</div>
        <canvas id="invocation-chart"></canvas>
      </div>

      <div class="chart-container">
        <div class="chart-title">Sessions Indexed Over Time</div>
        <canvas id="session-chart"></canvas>
      </div>

      <div>
        <div class="chart-title">Per-Tool Performance Metrics</div>
        <div class="tools-grid" id="tools-grid"></div>
      </div>
    </div>
  </div>

  <script>
    let invocationChart, sessionChart;

    async function loadTelemetry() {
      try {
        const res = await fetch('/api/telemetry');
        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
        const data = await res.json();

        // Update summary metrics
        document.getElementById('total-invocations').textContent = data.totalInvocations.toLocaleString();
        document.getElementById('total-sessions').textContent = data.totalSessions.toLocaleString();

        const avgLineReduction = data.toolMetrics.length > 0
          ? data.toolMetrics.reduce((sum, t) => sum + t.avgLineReductionPercent, 0) / data.toolMetrics.length
          : 0;
        document.getElementById('avg-line-reduction').textContent = \`\${avgLineReduction.toFixed(1)}%\`;

        const avgLatency = data.toolMetrics.length > 0
          ? data.toolMetrics.reduce((sum, t) => sum + t.avgLatencyMs, 0) / data.toolMetrics.length
          : 0;
        document.getElementById('avg-latency').textContent = \`\${avgLatency.toFixed(0)}ms\`;

        // Invocation time series chart
        const invCtx = document.getElementById('invocation-chart').getContext('2d');
        if (invocationChart) invocationChart.destroy();
        invocationChart = new Chart(invCtx, {
          type: 'line',
          data: {
            labels: data.invocationTimeSeries.map(d => d.date),
            datasets: [
              {
                label: 'Total Invocations',
                data: data.invocationTimeSeries.map(d => d.total),
                borderColor: '#60a5fa',
                backgroundColor: 'rgba(96, 165, 250, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6,
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: true, labels: { color: '#e2e8f0' } } },
            scales: {
              y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
              x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
            }
          }
        });

        // Session time series chart
        const sessCtx = document.getElementById('session-chart').getContext('2d');
        if (sessionChart) sessionChart.destroy();
        sessionChart = new Chart(sessCtx, {
          type: 'bar',
          data: {
            labels: data.sessionTimeSeries.map(d => d.date),
            datasets: [
              {
                label: 'Sessions Indexed',
                data: data.sessionTimeSeries.map(d => d.count),
                backgroundColor: '#a78bfa',
                borderColor: '#c4b5fd',
                borderWidth: 0,
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: true, labels: { color: '#e2e8f0' } } },
            scales: {
              y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' }, beginAtZero: true },
              x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
            }
          }
        });

        // Per-tool cards
        const toolsGrid = document.getElementById('tools-grid');
        toolsGrid.innerHTML = data.toolMetrics.map(tool => \`
          <div class="tool-card">
            <div class="tool-name">\${escapeHtml(tool.name)}</div>
            <div class="tool-stat">Invocations: <span class="tool-stat-value">\${tool.count}</span></div>
            <div class="tool-stat">Avg Latency: <span class="tool-stat-value">\${tool.avgLatencyMs.toFixed(1)}ms</span></div>
            <div class="tool-stat">Avg Line Reduction: <span class="tool-stat-value">\${tool.avgLineReductionPercent.toFixed(1)}%</span></div>
          </div>
        \`).join('');

        // Show content, hide loading
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';
      } catch (err) {
        document.getElementById('loading').style.display = 'none';
        const errorDiv = document.getElementById('error-container');
        errorDiv.innerHTML = \`<div class="error">Failed to load telemetry: \${escapeHtml(err.message)}</div>\`;
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Load on page load and refresh every 5 seconds
    loadTelemetry();
    setInterval(loadTelemetry, 5000);
  </script>
</body>
</html>`;
}
