#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createDashboardServer } from "../dashboard/server.js";
import { defaultDataDir, defaultSqlitePath } from "../ingest/indexer.js";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf-8",
  stdio: ["pipe", "pipe", "ignore"],
}).trim();

const port = parseInt(process.env.TRACEBACK_DASHBOARD_PORT ?? "5555", 10);
const sqlitePath = defaultSqlitePath(repoRoot);
const dataDir = defaultDataDir(repoRoot);

const server = createDashboardServer(repoRoot, sqlitePath, dataDir);

server.listen(port, "127.0.0.1", () => {
  console.log(`traceback dashboard: listening on http://127.0.0.1:${port}`);
  console.log(`repo: ${repoRoot}`);
  console.log(`db: ${sqlitePath}`);
  console.log(`Press Ctrl+C to stop`);
});

process.on("SIGINT", () => {
  console.log("\ntraceback dashboard: shutting down");
  server.close(() => process.exit(0));
});
