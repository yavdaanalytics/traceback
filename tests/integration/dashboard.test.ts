import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDashboardServer } from "../../src/dashboard/server.js";
import { insertToolInvocation, upsertSession } from "../../src/storage/sqlite.js";

let tmpDir: string;
let dbPath: string;
let dataDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "traceback-dashboard-test-"));
  dbPath = join(tmpDir, "traceback.db");
  dataDir = join(tmpDir, "lancedb");
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("dashboard server", () => {
  it("serves the HTML dashboard at root", async () => {
    const server = createDashboardServer(tmpDir, dbPath, dataDir);

    const response = await new Promise<{ status: number; body: string }>((resolve) => {
      server.once("request", (req, res) => {
        req.url = "/";
        let body = "";
        res.on("finish", () => {
          resolve({ status: res.statusCode || 200, body });
        });
        const origEnd = res.end.bind(res);
        res.end = function (chunk?: any) {
          if (typeof chunk === "string") body = chunk;
          return origEnd(chunk);
        };
      });

      // Simulate a request
      const req = { url: "/" } as any;
      const res = {
        writeHead: () => res,
        setHeader: () => res,
        end: (chunk?: any) => {
          resolve({ status: 200, body: typeof chunk === "string" ? chunk : "" });
        },
        statusCode: 200,
        on: () => res,
      } as any;
      server.emit("request", req, res);
    });

    expect(response.body).toContain("traceback Observability Dashboard");
    expect(response.body).toContain("chart.js");
    expect(response.body).toContain("Invocation Activity Over Time");
    server.close();
  });

  it("provides telemetry API with empty data", async () => {
    const server = createDashboardServer(tmpDir, dbPath, dataDir);

    // Insert some test data
    insertToolInvocation(dbPath, {
      tool_name: "find_similar_sessions",
      mcp_method_name: "tools/call",
      input_args: JSON.stringify({ query: "test" }),
      started_at: Date.now(),
      duration_ms: 25,
      ok: 1,
      error_message: null,
      git_depth_days: 5,
      matched_ref: "ref-123",
      delta_window_scale: 1,
      warm_lines_pulled: 180,
      global_lines_skipped: 45200,
      baseline_lines: 45200,
    });

    upsertSession(dbPath, {
      session_id: "sess-test",
      adapter_id: "claude-code",
      project_path: "/test-repo",
      git_branch: "main",
      started_at: Date.now(),
      ended_at: null,
      slug: null,
      raw_path: "/test-path",
      intent: null,
    });

    const response = await new Promise<{ status: number; body: string }>((resolve) => {
      const req = { url: "/api/telemetry" } as any;
      const chunks: string[] = [];
      const res = {
        writeHead: (status: number) => {
          res.statusCode = status;
          return res;
        },
        setHeader: () => res,
        end: (chunk?: any) => {
          if (typeof chunk === "string") chunks.push(chunk);
          resolve({ status: res.statusCode || 200, body: chunks.join("") });
        },
        statusCode: 200,
        on: () => res,
      } as any;

      server.emit("request", req, res);
    });

    const data = JSON.parse(response.body);
    expect(data.totalInvocations).toBe(1);
    expect(data.totalSessions).toBe(1);
    expect(data.toolMetrics).toHaveLength(1);
    expect(data.toolMetrics[0].name).toBe("find_similar_sessions");
    expect(data.toolMetrics[0].count).toBe(1);
    expect(data.toolMetrics[0].avgLatencyMs).toBe(25);
    expect(data.invocationTimeSeries).toHaveLength(1);
    expect(data.sessionTimeSeries).toHaveLength(1);

    server.close();
  });
});
