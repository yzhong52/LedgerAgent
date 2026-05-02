# OpenVault — Codebase Guide

## What this project does

Logs into financial institution websites using a Claude-powered Playwright agent, extracts account/transaction data, and stores it locally. The browser runs visibly (not headless) so the user can observe and handle any unexpected prompts.

## Key files

- `src/cli.ts` — CLI entry point; wires up all subcommands
- `src/commands/institution.ts` — `institution add` command
- `src/commands/sync.ts` — `sync` command
- `src/commands/accounts.ts` — `accounts list` command
- `src/commands/config.ts` — `config gmail` command
- `src/commands/utils.ts` — shared CLI helpers: `prompt`, `promptPassword`, `readInstitutions`, `writeInstitutions`
- `src/keychain.ts` — macOS Keychain helpers
- `src/config.ts` — reads/writes `~/.openvault/config.json` (non-sensitive settings)
- `src/gmail.ts` — Gmail IMAP polling for automatic MFA code retrieval
- `src/memory.ts` — per-institution, per-task agent memory; after each task Claude summarizes what worked into `~/.openvault/memory/<institution>.md` and injects it into the next session's system prompt
- `src/agent/index.ts` — generic `runAgent()` loop, shared constants
- `src/agent/browser.ts` — shared Playwright tool definitions and executors
- `src/tasks/login.ts` — Claude-powered login agent (institution-agnostic)
- `src/tasks/accounts.ts` — Claude-powered account discovery agent
- `src/db/schema.ts` — Drizzle table definitions
- `src/db/index.ts` — DB connection and auto-migration
- `src/db/storage.ts` — `saveSync()` writes sync results; `listAccounts()` reads accounts with latest balances

## Running

```bash
npm run cli -- institution add          # Add an institution (saves credentials to Keychain)
npm run cli -- sync                     # Sync all institutions
npm run cli -- sync --institution TD    # Sync a single institution by name
npm run cli -- accounts list            # List all stored accounts and latest balances
npm run cli -- config gmail             # Configure Gmail for automatic MFA
DEBUG=1 npm run cli -- sync             # Verbose: logs prompts to Claude + 1s pause per tool call
```

## Architecture of login.ts

Instead of scraping HTML, OpenVault reads the page's ARIA accessibility tree after each action. This is far more compact than raw HTML and more stable than CSS selectors — elements are targeted by what they *are*, not where they happen to sit in the DOM:

```
- document "Investing summary | Wealthsimple":
  - navigation:
    - link "Investing"
    - link "Tax"
  - heading "Total equity" [level=2]
  - text "$258,486.25"
```

The agent loop in `login()` sends this snapshot to Claude, executes the returned tool calls, feeds results back, and repeats until Claude calls `success`:

```
snapshot → Claude → tool call → execute → snapshot → …
```

**Tools available to Claude:**

| Tool | What it does |
|---|---|
| `snapshot` | Returns `page.locator('body').ariaSnapshot()` |
| `fill` | Fills a form field by ARIA role + name using Playwright `fill()` (no key events) |
| `type` | Types character-by-character via `pressSequentially()` (fires key events; required for OTP fields) |
| `click` | Clicks by ARIA role + name; waits for `domcontentloaded` with 3s timeout |
| `click_testid` | Clicks by `data-testid`; escape hatch when role/name matches multiple elements |
| `click_text` | Clicks by visible text content; useful when ARIA name differs from label |
| `click_js` | JavaScript `.click()` via `evaluate()`; bypasses Playwright visibility checks |
| `press_enter` | Presses Enter on a field by ARIA role + name; submits forms when button click fails |
| `request_mfa_code` | Checks Gmail for the OTP code automatically; falls back to prompting the user if not found |
| `success` | Terminates the loop |

**MFA flow:** When Claude sees an OTP screen it calls `request_mfa_code` — the tool first polls Gmail for the code (up to 60s); if found it returns automatically, otherwise it prompts the user. Claude fills the code in and continues.

**Why `domcontentloaded` not `load` after clicks:** Wealthsimple and similar SPAs never fire a second `load` event during in-app navigation. Using `load` hangs indefinitely; `domcontentloaded` with a catch is the safe alternative.

**Why two fill tools:** `fill()` is fast and reliable for text inputs. OTP fields in SPAs often gate the submit button on keystroke events, which `fill()` doesn't fire. `pressSequentially()` simulates real typing.

**Error handling in tool execution:** Playwright errors (e.g. strict mode violations when a locator matches multiple elements) are caught and returned to Claude as the tool result string. Claude can then retry with a more specific selector (e.g. `click_testid`). Session notes are persisted to `~/.openvault/memory/<institution>.md` and injected into the system prompt on the next session so the agent doesn't repeat the same mistake.

## Agent memory

OpenVault keeps lightweight per-institution memory so the agent can carry forward what it learned from previous runs without hardcoding institution-specific logic.

**Where it lives:** Memory is stored in `~/.openvault/memory/<institution>.md`, where `<institution>` is a lowercase slug such as `wealthsimple.md`.

**Format:** Each file is Markdown with one section per task, for example:

```md
# wealthsimple

## login
- Prefer `click_testid("login-form-submit-ftux")` over `click(button "Log in")`

## accounts
- Accounts are visible directly on the dashboard after login
```

**Tasks using memory today:** `login` and `accounts`.

**How notes are generated:** After a task completes successfully, the task passes its recorded tool events to `generateSessionNotes()` in `src/memory.ts`. That function asks Claude to summarize what worked, what failed, and any unusual page structure worth remembering next time.

**How notes are reused:** On the next run for the same institution and task, `loadMemoryNotes()` reads the relevant Markdown section and `formatMemoryForPrompt()` appends it to the task's system prompt.

**What gets filtered out:** Empty summaries are discarded, and obviously bad summaries such as "please provide session data" are dropped instead of being saved back into memory.

## Adding a new institution

Run `npm run cli -- institution add`. The login agent is institution-agnostic — no code changes needed unless the site has unusual behaviour (e.g. non-standard OTP fields). Check saved snapshots in `~/.openvault/logs/` to see what the agent observed.

## Logs

Accessibility snapshots are saved to `logs/<hostname>_<YYYY-MM-DD>_<HHMMSS>/<n>.txt` after each `snapshot` tool call — one folder per agent session, named by host and time. The 10 most recent sessions per host are kept; older ones are pruned automatically.

## Adding a new task

Add a new file under `src/tasks/` (e.g. `transactions.ts`). Import `runAgent` from `../agent` and browser tools from `../agent/browser`. Define task-specific tools, a system prompt, and export a single async function.

## Conventions

- **No hardcoded tool name strings.** Tool names that are referenced in multiple places (e.g. `SUCCESS_TOOL` in `src/agent/index.ts`) must be defined as a named constant and imported — never duplicated as string literals.
- **100-character line width limit.** Keep all code lines at or under 100 characters. Break long function signatures, call arguments, and imports across multiple lines. Exception: string literals inside LLM prompt templates (tool descriptions, system prompt text) are left as-is since they are semantic content, not code.
