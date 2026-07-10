# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.

Prefer one of:

1. **GitHub private vulnerability reporting** — use [Report a vulnerability](https://github.com/yavdaanalytics/traceback/security/advisories/new) on this repository.
2. Email **security@yavda.com** with a short description, impact, and steps to reproduce.

We aim to acknowledge reports within **7 days** and to share a remediation plan or fix timeline once the issue is confirmed.

## Scope notes

`traceback` is a **local** stdio MCP server (no network listener). Highest-priority issues include:

- Command injection via tool inputs (git/grep shell-outs)
- Path traversal or unintended file access outside configured repo/data dirs
- Secrets or session content leaking into telemetry payloads contrary to documented defaults

Out of scope: vulnerabilities solely in third-party IDEs or agent hosts that invoke this package.
