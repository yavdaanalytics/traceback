import http from "node:http";
import { parse } from "node:url";
import { z } from "zod";
import { upsertTelemetryRollups } from "./collector-db.js";
import { buildPublicStats } from "./public-stats.js";
import { insertIQYavdaEvents, getIQYavdaStats } from "./iq-yavda-db.js";
import { TelemetryRollupBatchSchema } from "../telemetry/schema.js";

const IQYavdaEventSchema = z.object({
  install_id: z.string(),
  repo_id: z.string(),
  event_type: z.string(),
  ts: z.string(),
  detail: z.any().optional(),
});

const IQYavdaEventBatchSchema = z.object({
  events: z.array(IQYavdaEventSchema),
});

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function renderPublicPage(statsJson: string): string {
  const stats = JSON.parse(statsJson) as ReturnType<typeof buildPublicStats>;
  const toolRows = stats.tools
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.tool_name)}</td><td>${t.invocation_count}</td><td>${t.failure_count}</td><td>${t.line_reduction_pct.toFixed(1)}%</td><td>${t.avg_duration_ms_p50.toFixed(1)}</td><td>${t.avg_duration_ms_p95.toFixed(1)}</td></tr>`,
    )
    .join("");
  const versionRows = Object.entries(stats.versions)
    .map(([version, count]) => `<li>${escapeHtml(version)}: ${count} invocations</li>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>traceback Public Metrics</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f172a; color: #e2e8f0; }
    h1 { margin-bottom: 0.25rem; }
    .subtitle { color: #94a3b8; margin-bottom: 1.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; padding: 1rem; }
    .label { color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; }
    .value { font-size: 1.6rem; font-weight: 600; color: #60a5fa; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 0.75rem; overflow: hidden; }
    th, td { padding: 0.75rem 1rem; border-bottom: 1px solid #334155; text-align: left; }
    th { color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; }
    ul { margin: 0; padding-left: 1.25rem; }
  </style>
</head>
<body>
  <h1>traceback Public Metrics</h1>
  <p class="subtitle">Aggregated opt-in telemetry only. No transcripts, prompts, or file paths.</p>
  <div class="grid">
    <div class="card"><div class="label">Installs</div><div class="value">${stats.unique_installs}</div></div>
    <div class="card"><div class="label">Repos</div><div class="value">${stats.unique_repos}</div></div>
    <div class="card"><div class="label">Invocations</div><div class="value">${stats.total_invocations}</div></div>
    <div class="card"><div class="label">Line Reduction</div><div class="value">${stats.overall_line_reduction_pct.toFixed(1)}%</div></div>
    <div class="card"><div class="label">Token Reduction</div><div class="value">${stats.overall_token_reduction_pct.toFixed(1)}%</div></div>
    <div class="card"><div class="label">Layer4 Skip</div><div class="value">${stats.layer4_skip_pct.toFixed(1)}%</div></div>
  </div>
  <h2>By Version</h2>
  <ul>${versionRows || "<li>No data yet</li>"}</ul>
  <h2>By Tool</h2>
  <table>
    <thead><tr><th>Tool</th><th>Invocations</th><th>Failures</th><th>Line Reduction</th><th>p50 ms</th><th>p95 ms</th></tr></thead>
    <tbody>${toolRows || "<tr><td colspan='6'>No data yet</td></tr>"}</tbody>
  </table>
  <p class="subtitle">Updated: ${escapeHtml(stats.updated_at)}</p>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderIQYavdaDashboard(statsJson: string): string {
  const stats = JSON.parse(statsJson) as ReturnType<typeof getIQYavdaStats>;
  const eventTypeRows = Object.entries(stats.by_type)
    .map(([type, count]) => `<tr><td>${escapeHtml(type)}</td><td>${count}</td></tr>`)
    .join("");
  const recentRows = stats.recent_events
    .slice(0, 20)
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.event_type)}</td><td>${escapeHtml(e.install_id.slice(0, 8))}</td><td>${escapeHtml(e.repo_id.slice(0, 8))}</td><td>${escapeHtml(e.ts)}</td></tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>iq-yavda-brain Observability</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f172a; color: #e2e8f0; }
    h1 { margin-bottom: 0.25rem; }
    h2 { margin-top: 2rem; margin-bottom: 1rem; }
    .subtitle { color: #94a3b8; margin-bottom: 1.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 0.75rem; padding: 1rem; }
    .label { color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; }
    .value { font-size: 1.6rem; font-weight: 600; color: #10b981; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 0.75rem; overflow: hidden; }
    th, td { padding: 0.75rem 1rem; border-bottom: 1px solid #334155; text-align: left; font-size: 0.9rem; }
    th { color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; font-weight: 600; }
    .back-link { color: #60a5fa; text-decoration: none; font-size: 0.9rem; }
    .back-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <a href="/" class="back-link">← Back to Metrics</a>
  <h1>iq-yavda-brain Observability</h1>
  <p class="subtitle">Cross-repo AI agent brain statistics. Global install tracking, constraints, continuity, and extraction metrics.</p>
  <div class="grid">
    <div class="card"><div class="label">Installs</div><div class="value">${stats.total_installs}</div></div>
    <div class="card"><div class="label">Repos</div><div class="value">${stats.total_repos}</div></div>
    <div class="card"><div class="label">Total Events</div><div class="value">${stats.total_events}</div></div>
  </div>
  <h2>Event Types</h2>
  <table>
    <thead><tr><th>Type</th><th>Count</th></tr></thead>
    <tbody>${eventTypeRows || "<tr><td colspan='2'>No data yet</td></tr>"}</tbody>
  </table>
  <h2>Recent Events (Last 20)</h2>
  <table>
    <thead><tr><th>Event Type</th><th>Install</th><th>Repo</th><th>Timestamp</th></tr></thead>
    <tbody>${recentRows || "<tr><td colspan='4'>No events yet</td></tr>"}</tbody>
  </table>
</body>
</html>`;
}

export function createMetricsCollectorServer(dbPath: string): http.Server {
  return http.createServer(async (req, res) => {
    const url = parse(req.url || "", true);
    const pathname = url.pathname || "";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      if (req.method === "POST" && pathname === "/v1/rollups") {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as unknown;
        const rollups = TelemetryRollupBatchSchema.parse(parsed);
        const count = upsertTelemetryRollups(dbPath, rollups);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: count }));
        return;
      }

      if (req.method === "GET" && pathname === "/api/public/stats") {
        const stats = buildPublicStats(dbPath);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(stats, null, 2));
        return;
      }

      if (req.method === "POST" && pathname === "/v1/iq-yavda-events") {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as unknown;
        const batch = IQYavdaEventBatchSchema.parse(parsed);
        const count = insertIQYavdaEvents(dbPath, batch.events);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: count }));
        return;
      }

      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        const stats = buildPublicStats(dbPath);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPublicPage(JSON.stringify(stats)));
        return;
      }

      if (req.method === "GET" && pathname === "/iq-yavda") {
        const stats = getIQYavdaStats(dbPath);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderIQYavdaDashboard(JSON.stringify(stats)));
        return;
      }

      if (req.method === "GET" && pathname === "/api/iq-yavda/stats") {
        const stats = getIQYavdaStats(dbPath);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(stats, null, 2));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
}
