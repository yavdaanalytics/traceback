import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // node:sqlite's DatabaseSync and lancedb's Connection are cached as
    // module-level singletons keyed on first-call path (see CLAUDE.md), so
    // each test file must stick to one sqlite/lancedb path for its own
    // duration. Running test files in separate workers keeps that isolated
    // across files; this is the default ("threads" pool, isolate: true).
  },
});
