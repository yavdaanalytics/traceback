# Traceback SKILL.md Installation Gap

## Problem Identified

### What the Documentation Says

**`/c/source/traceback/SETUP.md` line 32** (Global Setup section):
```
- **Skills** — `SKILL.md` synced to `~/.cursor/skills/traceback` and `~/.claude/skills/traceback`
```

✅ **Correct:** Skills should be GLOBAL ONLY, available to ALL repositories.

**Per-repo setup section (lines 45-50)** lists what `--repo-only` installs:
- Git post-commit hook
- MCP server registration
- Per-IDE warm-start hooks
- Local excludes
- CLAUDE.md onboarding

❌ **Gap:** Does NOT mention SKILL.md — which is correct (skills are global, not per-repo).

---

### What the Code Actually Does

**`/c/source/traceback-global-install/src/cli/setup.ts` lines 104-110:**
```typescript
const targets = [
  { label: "Cursor project", path: join(projectCursorDir, "traceback", SKILL_FILE_NAME) },
  { label: "Cursor global", path: join(globalCursorDir, "traceback", SKILL_FILE_NAME) },
  { label: "Claude Code", path: join(claudeDir, "traceback", SKILL_FILE_NAME) },
];
```

❌ **Bug:** Writes SKILL.md to THREE locations:
1. `.cursor/skills/traceback/SKILL.md` (per-project)
2. `~/.cursor/skills/traceback/SKILL.md` (global)
3. `~/.claude/skills/traceback/SKILL.md` (global)

**Result:** Per-repo SKILL.md copies are unnecessary, wasteful, and create false expectations.

---

## What Should Happen

### Installation Output (Should be):
```
✓ created global skill at ~/.claude/skills/traceback/SKILL.md
✓ created global skill at ~/.cursor/skills/traceback/SKILL.md
```

### NOT:
```
✓ created Cursor project skill at .cursor/skills/traceback/SKILL.md
✓ created global skill at ~/.cursor/skills/traceback/SKILL.md
✓ created global skill at ~/.claude/skills/traceback/SKILL.md
```

---

## Required Changes

### 1. Update `/c/source/traceback/SETUP.md`

**Add to global setup section (after line 32):**
```markdown
**Per-repo setup does NOT install skills** — skills are global and available to all repositories on the machine after the initial `traceback-setup`. Per-repo setup only refreshes MCP configs and onboarding.
```

**OR more explicitly, create a "Host Skill Availability" section:**
```markdown
## Host Skills (Global Installation Only)

SKILL.md provides host-first routing metadata (deciding when to invoke traceback MCP). 
It is installed **globally** during `traceback-setup`:

- **Claude Code:** `~/.claude/skills/traceback/SKILL.md` — loaded as skill for all repos
- **Cursor:** `~/.cursor/skills/traceback/SKILL.md` — loaded as skill for all repos

Once installed globally, the skill gate is active for **all repositories** on the machine. 
No per-repo skill installation is needed or recommended.

To refresh skills after updating traceback:
```bash
# Full global update:
traceback-setup

# Or refresh skills only (if other setup already done):
traceback-setup --doctor  # verify existing installation
```
```

### 2. Update `/c/source/traceback-global-install/src/cli/setup.ts`

**Function `installTracebackSkills()` (line 93) should only write global locations:**

```typescript
export function installTracebackSkills(repoRoot: string, packageDistDir: string = distDir): void {
  const sourcePath = resolveSkillSourcePath(repoRoot, packageDistDir);
  if (!sourcePath) {
    console.warn(
      `traceback: ${SKILL_FILE_NAME} not found at repo root or npm package root - skipping skill installation`,
    );
    return;
  }
  const source = readFileSync(sourcePath, "utf-8");
  const content = source.includes(SKILL_MARKER) ? source : `${source.trimEnd()}\n\n${SKILL_MARKER}\n`;

  // ONLY write to global directories, NOT project directories
  const globalCursorDir = process.env.TRACEBACK_CURSOR_SKILLS_DIR?.trim() || join(homedir(), ".cursor", "skills");
  const claudeDir = process.env.TRACEBACK_CLAUDE_SKILLS_DIR?.trim() || join(homedir(), ".claude", "skills");
  
  const targets = [
    { label: "Cursor global", path: join(globalCursorDir, "traceback", SKILL_FILE_NAME) },
    { label: "Claude Code global", path: join(claudeDir, "traceback", SKILL_FILE_NAME) },
  ];

  for (const target of targets) {
    const result = writeIfChanged(target.path, content);
    if (result === "unchanged") {
      console.log(`traceback: ${target.label} skill already up to date at ${target.path}`);
    } else {
      console.log(`traceback: ${result} ${target.label} skill at ${target.path}`);
    }
  }
}
```

**Remove this line from targets array:**
```typescript
// DELETE THIS:
{ label: "Cursor project", path: join(projectCursorDir, "traceback", SKILL_FILE_NAME) },
```

### 3. Update `--repo-only` mode to NOT install skills

**In `installTracebackSkills()` or its caller**, skip skill installation when running `--repo-only`:

```typescript
// In main setup flow, before calling installTracebackSkills:
if (!opts.repoOnly) {
  console.log("\n🎯 Installing traceback skill metadata...");
  installTracebackSkills(repoRoot, distDir);
} else {
  console.log("\n📝 Skipping global skill installation (--repo-only mode)");
  console.log("   Skills are already installed globally. Skills are per-machine, not per-repo.");
}
```

---

## Verification

After changes, running setup should output:

**Global (first time):**
```
✅ Global traceback setup complete!
  • Portable MCP: ~/.cursor/mcp.json, ~/.claude/.mcp.json
  • Global git hooks: ~/.traceback/hooks
  • Global skills: ~/.cursor/skills/traceback, ~/.claude/skills/traceback
  • Skills available to ALL repositories on this machine
  • Run `traceback-setup --repo-only` in each repo to add MCP config and CLAUDE.md onboarding
```

**Per-repo (`--repo-only`):**
```
✅ Per-repo traceback setup complete!
  • MCP configuration: .mcp.json / .cursor/mcp.json / .vscode/mcp.json
  • Warm-start hooks: .cursor/hooks.json, .github/hooks/ (when present)
  • Onboarding: CLAUDE.md updated
  • Global skills are already available (no per-repo skill installation needed)
```

---

## Status

- [x] **Problem identified** — Code writes project skills; docs say global-only
- [x] **Docs reviewed** — traceback/SETUP.md vs. traceback-global-install/SETUP.md
- [ ] **Code fix pending** — Remove `projectCursorDir` from `installTracebackSkills()`
- [ ] **Docs updated** — Add explicit "Global Skills Only" section to SETUP.md
- [ ] **User cleanup** — Remove per-repo `.claude/SKILL.md` copies from all repos

---

## User Action Items

### Immediate (before code changes):

Remove the per-repo SKILL.md files I created (they should NOT exist):

```powershell
@(
    "C:\source\powerbi-embedded-analytics\.claude\SKILL.md",
    "C:\source\iq-yavda\.claude\SKILL.md",
    "C:\source\ai-agent-db-answers\.claude\SKILL.md"
) | ForEach-Object {
    if (Test-Path $_) {
        Remove-Item $_ -Force
        Write-Host "Removed per-repo SKILL.md: $_"
    }
}

# Verify only global ones remain:
Get-Item "$env:USERPROFILE\.claude\skills\traceback\SKILL.md" -ErrorAction SilentlyContinue
Get-Item "$env:USERPROFILE\.cursor\skills\traceback\SKILL.md" -ErrorAction SilentlyContinue
```

### Verify system-wide availability:

After cleanup, skills should be available in **ALL** repos:

```bash
# Test in any repo:
cd C:\source\any-repo
# Skills loaded from ~/.claude/skills/traceback/ and ~/.cursor/skills/traceback/
# No .claude/SKILL.md needed or expected
```
