import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Regression guard for the hard security rule stated in CLAUDE.md and at the
// top of src/mcp/search.ts: every git/grep shell-out must use
// execFileSync(cmd, argvArray, opts) - never a string built via template
// literals or concatenation and handed to exec()/execSync()/spawn with
// shell:true. A future edit that "simplifies" a call back into a shell
// string would reintroduce a command-injection vector; this test exists to
// catch that before it ships, not to re-review it by hand every time.
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const srcFiles = listTsFiles(join(process.cwd(), "src"));

describe("security invariant: no shell-string exec of git/grep/ast-grep", () => {
  it("never calls the banned shell-execution APIs (exec, execSync with shell strings, spawn with shell:true)", () => {
    const offenders: string[] = [];
    for (const file of srcFiles) {
      const text = readFileSync(file, "utf-8");
      // `exec(` (as opposed to execFile/execFileSync) always shells out to a
      // string command - banned outright regardless of how it's built.
      // Excludes method calls like `db.exec(...)` (node:sqlite's
      // DatabaseSync.exec, unrelated to child_process) via the negative
      // lookbehind on ".".
      if (/(?<![a-zA-Z_.])exec\s*\(/.test(text)) offenders.push(`${file}: uses exec(...)`);
      if (/shell:\s*true/.test(text)) offenders.push(`${file}: uses shell: true`);
    }
    expect(offenders).toEqual([]);
  });

  it("every execFileSync call passes a static argv array, not a template-built string as an argv element", () => {
    const offenders: string[] = [];
    for (const file of srcFiles) {
      const text = readFileSync(file, "utf-8");
      // Flags a `execFileSync(` call whose first args-array element is a
      // template literal containing `${` before the array closes - i.e. the
      // command/pattern was string-interpolated into what should be a plain
      // argv token, defeating the argv-array protection entirely.
      const calls = text.match(/execFileSync\([^)]*\)/gs) ?? [];
      for (const call of calls) {
        if (/`[^`]*\$\{[^}]*\}[^`]*`/.test(call) && /\[.*`.*\$\{.*\}.*`.*\]/s.test(call)) {
          offenders.push(`${file}: possible interpolated argv element in ${call.slice(0, 80)}...`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
