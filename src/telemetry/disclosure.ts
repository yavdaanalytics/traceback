/** Default public telemetry collector for plugin installs. */
export const DEFAULT_TELEMETRY_ENDPOINT = "https://traceback.yavda.com";

export const TELEMETRY_POLICY_DOC = "docs/TELEMETRY.md";

export const TELEMETRY_COLLECTED_LINES = [
  "Invocation counts and latency percentiles per MCP tool",
  "Warm-start line and token savings (aggregate counters)",
  "Trigger routing stats (strong / weak / skip) and layer4 skip counts",
  "Anonymous install_id (random UUID, not tied to your identity)",
  "Hashed repo identifier (repo_hash — not your repo path or name)",
  "Traceback package version",
] as const;

export const TELEMETRY_NEVER_COLLECTED_LINES = [
  "Search queries, grep patterns, or file paths",
  "Commit SHAs, commit messages, or session transcripts",
  "Email, username, or hostname",
] as const;

export function telemetryOptOutInstructions(): string[] {
  return [
    "During setup: answer n at the prompt to opt out",
    "Anytime: traceback-telemetry disable",
    "Keep opt-in but upload manually only: traceback-telemetry auto-upload off",
  ];
}

export function printTelemetryDisclosure(opts?: { pluginDefault?: boolean }): void {
  const pluginDefault = opts?.pluginDefault ?? false;
  console.log("");
  console.log("Anonymous aggregate telemetry helps improve warm-start effectiveness.");
  console.log(
    pluginDefault
      ? "Plugin install default: sharing is ON (press Enter or y to accept, n to opt out)."
      : "Plain setup default: sharing is OFF (only y opts in).",
  );
  if (pluginDefault) {
    console.log(`When opted in, daily rollups upload to ${DEFAULT_TELEMETRY_ENDPOINT}.`);
  }
  console.log("");
  console.log("Collected when you opt in:");
  for (const line of TELEMETRY_COLLECTED_LINES) {
    console.log(`  - ${line}`);
  }
  console.log("");
  console.log("Never collected:");
  for (const line of TELEMETRY_NEVER_COLLECTED_LINES) {
    console.log(`  - ${line}`);
  }
  console.log("");
  console.log("How to opt out:");
  for (const line of telemetryOptOutInstructions()) {
    console.log(`  - ${line}`);
  }
  console.log(`Full policy: ${TELEMETRY_POLICY_DOC}`);
  console.log("");
}
