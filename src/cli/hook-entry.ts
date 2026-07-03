#!/usr/bin/env node
import { runPostCommitHook } from "../git/hook-runtime.js";

const repoPath = process.argv[2] ?? process.cwd();
await runPostCommitHook(repoPath);
