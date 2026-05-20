# LedgerAgent — Codebase Guide

## What this project does

Logs into financial institution websites using a Claude-powered Playwright agent, extracts account/transaction data, and stores it locally. The browser runs visibly (not headless) so the user can observe and handle any unexpected prompts.

## Key files

- `src/cli.ts` — CLI entry point; wires up all subcommands
- `src/commands/institution.ts` — `institution add` command
- `src/commands/accounts.ts` — `accounts sync`, `accounts list`, `accounts merge` commands
- `src/commands/transactions.ts` — `transactions sync`, `transactions list` commands
- `src/commands/config.ts` — `config gmail` command
- `src/commands/utils.ts` — shared CLI helpers: `prompt`, `promptPassword`, `readInstitutions`, `writeInstitutions`
- `src/keychain.ts` — macOS Keychain helpers
- `src/config.ts` — reads/writes `~/.ledgeragent/config.json` (non-sensitive settings)
- `src/gmail.ts` — Gmail IMAP polling for automatic MFA code retrieval
- `src/memory.ts` — per-institution, per-task agent memory; after each task Claude summarizes what worked into `~/.ledgeragent/memory/<institution>.md` and injects it into the next session's system prompt
- `src/agent/index.ts` — generic `runAgent()` loop, shared constants
- `src/agent/browser.ts` — shared Playwright tool definitions and executors
- `src/tasks/login.ts` — Claude-powered login agent (institution-agnostic)
- `src/tasks/accounts.ts` — Claude-powered account discovery agent
- `src/tasks/transactions.ts` — Claude-powered transaction fetch agent (per-account, configurable lookback)
- `src/db/schema.ts` — Drizzle table definitions
- `src/db/index.ts` — DB connection and auto-migration
- `src/db/storage.ts` — `saveSync()` / `saveTransactions()` write sync results; `listAccounts()` / `listTransactions()` read them back

## Running

```bash
npm run cli -- institution add                                        # Add an institution (saves credentials to Keychain)
npm run cli -- accounts sync                                          # Sync all accounts and balances
npm run cli -- accounts sync --institution TD                         # Sync a single institution by name
npm run cli -- accounts list                                          # List all stored accounts and latest balances
npm run cli -- transactions sync                                      # Fetch transactions (last 30 days) for all accounts
npm run cli -- transactions sync --institution TD --days 90           # Fetch 90 days for one institution
npm run cli -- transactions sync --institution TD --accountId 1234    # Fetch transactions for one account only
npm run cli -- transactions list                                      # List stored transactions (last 30 days)
npm run cli -- transactions list --institution TD                     # Filter by institution
npm run cli -- transactions list --days 7                             # Limit to last 7 days
npm run cli -- config gmail                                           # Configure Gmail for automatic MFA
```

## Architecture of login.ts

Instead of scraping HTML, LedgerAgent reads the page's ARIA accessibility tree after each action. This is far more compact than raw HTML and more stable than CSS selectors — elements are targeted by what they *are*, not where they happen to sit in the DOM:

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

Snapshots are taken automatically by the agent loop at the start of each turn (using `ariaSnapshot({ mode: 'ai' })`), which annotates every element with a stable ref like `[ref=e42]`. Claude does not call a snapshot tool explicitly.

**Tools available to Claude:**

| Tool | What it does |
|---|---|
| `fill` | Fills a form field by ARIA role + name using Playwright `fill()` (no key events) |
| `type` | Types character-by-character via `pressSequentially()` (fires key events; required for OTP fields) |
| `click` | Clicks by ARIA role + name; waits for `domcontentloaded` with 3s timeout |
| `click_ref` | Clicks by `[ref=eXX]` from the snapshot; preferred over `click` when ref is available |
| `fill_ref` | Fills a field by ref ID; preferred over `fill_js` when ref is available |
| `type_ref` | Types character-by-character into a field by ref ID |
| `click_testid` | Clicks by `data-testid`; escape hatch when role/name matches multiple elements |
| `click_text` | Clicks by visible text content; useful when ARIA name differs from label |
| `click_js` | JavaScript `.click()` via CSS selector; last resort when other click tools fail |
| `press_enter` | Presses Enter on a field by ARIA role + name; submits forms when button click fails |
| `request_mfa_code` | Checks Gmail for the OTP code automatically; falls back to prompting the user if not found |
| `success` | Terminates the loop |

**MFA flow:** When Claude sees an OTP screen it calls `request_mfa_code` — the tool first polls Gmail for the code (up to 60s); if found it returns automatically, otherwise it prompts the user. Claude fills the code in and continues.

**Why `domcontentloaded` not `load` after clicks:** Wealthsimple and similar SPAs never fire a second `load` event during in-app navigation. Using `load` hangs indefinitely; `domcontentloaded` with a catch is the safe alternative.

**Why two fill tools:** `fill()` is fast and reliable for text inputs. OTP fields in SPAs often gate the submit button on keystroke events, which `fill()` doesn't fire. `pressSequentially()` simulates real typing.

**Error handling in tool execution:** Playwright errors (e.g. strict mode violations when a locator matches multiple elements) are caught and returned to Claude as the tool result string. Claude can then retry with a more specific selector (e.g. `click_testid`). Session notes are persisted to `~/.ledgeragent/memory/<institution>.md` and injected into the system prompt on the next session so the agent doesn't repeat the same mistake.

## Agent memory

LedgerAgent keeps lightweight per-institution memory so the agent can carry forward what it learned from previous runs without hardcoding institution-specific logic.

**Where it lives:** Memory is stored in `~/.ledgeragent/memory/<institution>.md`, where `<institution>` is a lowercase slug such as `wealthsimple.md`.

**Format:** Each file is Markdown with one section per task, for example:

```md
# wealthsimple

## login
- Prefer `click_testid("login-form-submit-ftux")` over `click(button "Log in")`

## accounts
- Accounts are visible directly on the dashboard after login
```

**Tasks using memory today:** `login`, `accounts`, and `transactions`.

**How notes are generated:** After a task completes successfully, the task passes its recorded tool events to `generateSessionNotes()` in `src/memory.ts`. That function asks Claude to summarize what worked, what failed, and any unusual page structure worth remembering next time.

**How notes are reused:** On the next run for the same institution and task, `loadMemoryNotes()` reads the relevant Markdown section and `formatMemoryForPrompt()` appends it to the task's system prompt.

**What gets filtered out:** Empty summaries are discarded, and obviously bad summaries such as "please provide session data" are dropped instead of being saved back into memory.

## Adding a new institution

Run `npm run cli -- institution add`. The login agent is institution-agnostic — no code changes needed unless the site has unusual behaviour (e.g. non-standard OTP fields). Check saved snapshots in `~/.ledgeragent/logs/` to see what the agent observed.

## Logs

Each agent session writes to `logs/<YYYY-MM-DD>_<HHMMSS>_<mmm>_<institution>/`:

- `conversation_<task>.md` — full conversation log in Markdown for a specific task (e.g.
  `conversation_login.md`, `conversation_transactions_wealthsimple_credit_card.md`). Each turn
  contains:
  - **User → Agent**: the tool results and page snapshot sent to the model
  - **`stop_reason`**: why the model stopped (`tool_use` = normal, `max_tokens` = response was
    truncated — a common cause of empty or malformed tool inputs)
  - **Agent → User**: the tool calls the model returned
- `snapshots/snapshot_<task>_<n>.txt` — individual accessibility snapshots taken after each
  action, named to match the corresponding `conversation_<task>.md` log

The 20 most recent sessions overall are kept; older sessions are pruned automatically.

## Adding a new task

Add a new file under `src/tasks/`. Import `runAgent` from `../agent` and browser tools from
`../agent/browser`. Define task-specific tools, a system prompt, and export a single async
function. Use `transactions.ts` as a reference — it shows the full pattern including memory
integration, per-tool event tracking, and passing `maxTurns` to `runAgent`.

## After making changes

Run `npm run lint` after every code change and fix any errors before reporting the task as complete.

## Conventions

- **No hardcoded tool name strings.** Tool names that are referenced in multiple places (e.g. `SUCCESS_TOOL` in `src/agent/index.ts`) must be defined as a named constant and imported — never duplicated as string literals.
- **100-character line width limit.** Keep all code lines at or under 100 characters. Break long function signatures, call arguments, and imports across multiple lines. Exception: string literals inside LLM prompt templates (tool descriptions, system prompt text) are left as-is since they are semantic content, not code.
