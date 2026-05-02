# Pending work

## Logging verbosity levels

Currently there are two env-var flags (`VERBOSE=1`, `DEBUG=1`) where `DEBUG` implies `VERBOSE`, plus a `--verbose` CLI flag on the `sync` command. This is a bit inconsistent.

**Idea:** Replace with two named CLI flags `--verbose` / `--debug` (or a numeric `--log-level`) so the hierarchy is explicit and discoverable, and env vars aren't needed for normal use.

Things to reconcile:
- `VERBOSE` in `src/agent/index.ts` and `src/agent/cache.ts` are read directly from `process.env`
- `--verbose` flag on `sync` sets `process.env.VERBOSE = '1'` as a side effect
- `DEBUG=1` is env-var only (not wired to a CLI flag)
- `CLAUDE.md` documents `DEBUG=1` but not `VERBOSE=1`

## Remove snapshot as an explicit tool

Instead of Claude calling `snapshot` to see the page, the agent should automatically
include the current ARIA snapshot in every tool result — i.e. after executing any
action, append the updated page state to the response fed back to Claude.

Benefits:
- Claude always has fresh page context without spending a turn on `snapshot`
- Eliminates a round-trip per navigation step
- The `snapshot` tool can be removed from the tool list entirely, simplifying the prompt

Implementation sketch:
- After each tool call in the `onTool` loop, take an ARIA snapshot (we're already doing
  this implicitly for caching — reuse that result) and append it to the tool result string
- Remove `snapshot` from `BROWSER_TOOLS` and its executor in `src/agent/browser.ts`
- Update system prompts across all tasks to reflect that snapshots are automatic

## Credential exposure

Passwords are currently sent to the Claude API in plaintext inside the system prompt (`src/tasks/login.ts` → `buildSystemPrompt`). With `VERBOSE=1`, tool inputs are also printed to the console, which can include the password value when Claude calls the `fill` tool.

Things to fix:
- Don't embed the password directly in the system prompt — instead inject it only as a tool result when Claude calls a dedicated `get_credentials` tool (or similar), so it never appears in logged prompts
- Scrub or redact password-like values before printing tool inputs in verbose mode
