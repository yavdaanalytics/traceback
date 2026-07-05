# Traceback Enhancements - Quick Start Guide

## What Changed?

Three major improvements to make traceback work better:

### 1. ✅ Global Git Hooks (Setup)
**Problem**: Had to run `npx traceback-setup` in every repo for the hook.  
**Solution**: One-time global setup that applies to ALL repos.

### 2. ✅ Intent Extraction (Context)
**Problem**: Sessions didn't capture *why* you created them (intent was NULL).  
**Solution**: Auto-extract intent from your first message in the session.

### 3. ✅ Semantic Search with Context (Search)
**Problem**: Searching for sessions returned only metadata, not commit details.  
**Solution**: Search results now include commit messages and files touched.

---

## Setup (One-Time)

### Step 1: Install Global Hooks
```bash
traceback-install-global-hook
```

This creates `~/.traceback/hooks/post-commit` and sets:
```
git config --global core.hooksPath ~/.traceback/hooks
```

**Result**: Every git commit on your machine will automatically index the session.

### Step 2: Setup MCP in Each Repo (For IDE Integration)
```bash
cd /path/to/your/repo
npx traceback-setup
```

This configures `.mcp.json` / `.vscode/mcp.json` / `.cursor/mcp.json` so your IDE can access traceback tools.

**Note**: With global hooks configured, setup will skip the per-repo hook installation.

---

## Usage - How It Works Now

### Scenario 1: "Why is this hook there?"

**Before** (Old Way):
1. Call `find_similar_sessions` query "git hook"
2. Get back: session ID, timestamp, distance score
3. *Had to manually* call `get_session_lineage` to see commits
4. *Had to manually* call `search_sessions_grep` to search files
5. Answer fragmented across multiple tool calls

**After** (New Way):
1. Call `find_similar_sessions` query "why is git post-commit hook important?"
2. Get back in ONE response:
   ```json
   {
     "session_id": "i-also-need-this-sprightly-zephyr",
     "slug": "i-also-need-this-sprightly-zephyr",
     "timestamp": 1688000000000,
     "linkedCommits": [
       {
         "sha": "36fd095",
         "message": "Add SETUP.md: comprehensive onboarding and troubleshooting guide",
         "filesTouched": ["SETUP.md", "README.md"]
       },
       {
         "sha": "225a90c",
         "message": "Document traceback-dashboard in README",
         "filesTouched": ["README.md"]
       }
     ]
   }
   ```
3. Claude can now synthesize the answer directly

---

### Scenario 2: "How to run traceback dashboard?"

**Query**: "how to run traceback"

**Response** (with context):
- Finds session about "setup"
- Returns linked commits: "Add SETUP.md" + "Document traceback-dashboard in README"
- Claude can read commit messages + SETUP.md content
- Answers with exact instructions

---

### Scenario 3: "What was I working on 2 days ago?"

**Query**: "what was i building"

**Response**:
- Finds sessions from 2 days ago (semantic + time filtering)
- Returns intent: "Help me implement feature X"
- Returns commits: "Add feature X" + "Fix bug in feature X"
- Full session context in one call

---

## What Gets Populated When?

| Field | When | Trigger |
|-------|------|---------|
| **session.intent** | On commit | Git hook fires → session indexed → intent auto-extracted from first user message |
| **session.started_at, ended_at** | On commit | Git hook fires → session metadata captured |
| **session_commit_links** | On commit | Git hook fires → session linked to commits |
| **files_touched** | On commit | Git hook fires → changed files tracked |
| **tool_invocations** | When tool called | You call `find_similar_sessions` or other MCP tool → invocation logged |
| **feedback** | When feedback given | You call `submit_feedback` MCP tool → recorded for learning |

---

## Testing the Enhancements

### Test 1: Verify Global Hooks
```bash
# Check git config
git config --global core.hooksPath
# Should output: /Users/YOUR_USER/.traceback/hooks (or C:\Users\... on Windows)

# Check hook file exists
ls ~/.traceback/hooks/post-commit
# Should exist and be executable
```

### Test 2: Verify Intent Extraction
```bash
# Make a test commit
git commit --allow-empty -m "test: verify intent extraction"

# Check database
sqlite3 data/traceback.db "SELECT slug, intent FROM sessions WHERE intent IS NOT NULL LIMIT 1"
# Should show: session_slug | your first message here
```

### Test 3: Test Semantic Search with Context
1. In **Claude Code** or **VS Code Claude extension**
2. Use the traceback MCP tools
3. Call: `find_similar_sessions`
4. Query: `"git commit hook setup"`
5. **Expected response**: Should include:
   - ✓ Session metadata
   - ✓ Linked commits list
   - ✓ Commit messages
   - ✓ Files touched per commit

---

## FAQ

### Q: Do I need to set up per-repo hooks anymore?
**A**: No. Global hooks are now the default. Just run `npx traceback-setup` for IDE configuration.

### Q: Will existing sessions get intent populated?
**A**: No, existing sessions stay as-is. But on the *next* commit, new sessions will have intent extracted automatically.

### Q: Can I see tool_invocations data?
**A**: Yes, once you call traceback MCP tools. They're recorded automatically via the `withTelemetry()` wrapper.

### Q: How do I give feedback to downweight bad sessions?
**A**: Call the `submit_feedback` MCP tool with `verdict: "reject"` and the session ID. This increases penalty_weight, lowering future recall scores.

### Q: What if I have a repo without git sessions?
**A**: Global hooks are still installed, but traceback will only index repos that have IDE sessions (Claude Code, Cursor, VS Code + Claude extension).

---

## Architecture After Enhancements

```
IDE (Claude Code / VS Code / Cursor)
  │
  └─► MCP Server (dist/mcp/index.js)
       │
       └─► find_similar_sessions
            │
            ├─ Searches session embeddings (vector DB)
            ├─ Applies penalty weights (feedback)
            └─► 🆕 Fetches linked commits + context
                 ├─ Commit messages
                 ├─ Files touched
                 └─ Returns enriched SessionWithContext
       │
       └─► Data Layer (auto-indexed by global git hook)
            ├─► Git Hook (Global: ~/.traceback/hooks/post-commit)
            │    └─ Triggered on every commit
            │       ├─ Indexes session metadata
            │       ├─ Links commits to sessions
            │       ├─ 🆕 Extracts intent
            │       └─ Tracks files touched
            │
            ├─► LanceDB (session embeddings for ANN)
            └─► SQLite (sessions, commits, files, linkage, feedback)
```

---

## Next Steps

1. **Install global hooks** (one-time):
   ```bash
   traceback-install-global-hook
   ```

2. **Setup each repo** (for MCP config):
   ```bash
   cd /path/to/repo && npx traceback-setup
   ```

3. **Test in Claude Code**:
   - Call `find_similar_sessions` with a natural language query
   - Verify results include commit context

4. **Use feedback** to improve search:
   - If a result is wrong, call `submit_feedback` with `verdict: "reject"`
   - Traceback will down-weight that session for future searches

5. **Monitor dashboard** (optional):
   ```bash
   traceback-dashboard
   # Opens http://127.0.0.1:5555
   # Shows tool invocations, latency, warm-start effectiveness
   ```

---

## Performance & Observability

After using traceback, check the efficiency report:
```bash
traceback-dashboard
# or in Claude Code: call get_efficiency_report MCP tool
```

Metrics tracked:
- **Warm-start line reduction**: How many lines of code you didn't have to grep
- **Per-tool latency**: How fast each tool responds
- **Recall@1**: Does the first search result answer your question?
- **Session penalty distribution**: Which sessions are being down-weighted due to feedback

---

**That's it!** Global hooks + intent + context = faster, smarter semantic search.
