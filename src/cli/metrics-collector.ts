#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { createMetricsCollectorServer } from "../metrics/collector-server.js";

const host = process.env.TRACEBACK_METRICS_HOST ?? "127.0.0.1";
const port = parseInt(process.env.TRACEBACK_METRICS_PORT ?? "5566", 10);
const dbPath =
  process.env.TRACEBACK_METRICS_DB?.trim() ?? join(homedir(), ".traceback", "metrics-collector.db");

const server = createMetricsCollectorServer(dbPath);

server.listen(port, host, () => {
  console.log(`traceback-metrics: listening on http://${host}:${port}`);
  console.log(`traceback-metrics: db ${dbPath}`);
  console.log("traceback-metrics: POST /v1/rollups, GET /api/public/stats, GET /");
});

process.on("SIGINT", () => {
  console.log("\ntraceback-metrics: shutting down");
  server.close(() => process.exit(0));
});
