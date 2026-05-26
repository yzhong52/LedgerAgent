# LedgerAgent — Agentic Financial Aggregator

Aggregate accounts, balances, and transactions from any financial institution — without API keys, screen-scraping hacks, or third-party integrations.

- **Universal.** Traditional aggregators break when banks change their UI or revoke API access. LedgerAgent uses an AI agent that reads the page the same way you do — works out of the box for any bank, any UI, with no setup per institution.
- **Private.** Your credentials never leave your machine. LedgerAgent opens a real browser, logs in as you, and saves data locally. No third party ever sees your account information.

## Setup

Install dependencies and Playwright:

```bash
npm install
npx playwright install chromium
```

**Choose a model provider** — LedgerAgent supports Anthropic Claude (default) or a locally-running Ollama model:

**Anthropic (default)** — save your API key to Keychain:

```bash
npm run cli -- config anthropic
```

**Ollama** — install [Ollama](https://ollama.com), pull a model, and pass `--model` when syncing:

```bash
ollama pull qwen3.5:9b
npm run cli -- sync --model qwen3.5:9b
```

No API key is needed when using Ollama. Set `OLLAMA_HOST` to override the default endpoint (`http://localhost:11434/v1`).

Optionally, configure Gmail for automatic MFA code retrieval:

```bash
npm run cli -- config gmail
```

## Quick start

Add an institution:

```bash
npm run cli -- institution add
```

Sync accounts, balances, and transactions:

```bash
npm run cli -- sync --institution "TD"
```

List stored accounts and transactions:

```bash
npm run cli -- accounts list
npm run cli -- transactions list
```

## Local storage

LedgerAgent stores all data on your machine:

- Institution metadata is saved in `~/.ledgeragent/accounts.json`
- Passwords are saved in macOS Keychain
- Synced balances and transactions are saved in `~/.ledgeragent/data.db`
- Browser session state is saved in `~/.ledgeragent/browser-profile`
- Per-institution agent memory is saved in `~/.ledgeragent/memory/`
- Debug snapshots are saved in `~/.ledgeragent/logs/`

## How it works

Each sync runs a three-step agent pipeline per institution:

1. **Login** (`src/tasks/login.ts`) — navigates to the institution's login page, fills credentials, handles MFA, and waits for the dashboard.
2. **Account discovery** (`src/tasks/accounts.ts`) — scans the dashboard to discover all accounts, types, and balances.
3. **Transaction fetch** (`src/tasks/transactions.ts`) — navigates to each account's transaction history and extracts recent transactions for the configured lookback window (default: 30 days).

After each step, the agent reflects on what worked and what didn't, and writes a short set of notes that are injected into the next session. This means the agent gets faster and more reliable over time for each institution it's seen before.

## Usage

**Add an institution** (saves credentials to macOS Keychain):

```bash
npm run cli -- institution add
```

You'll be prompted for the institution name, login URL, username or email, and password. Credentials are stored in the macOS Keychain — you won't be asked again.

**Sync accounts and transactions:**

```bash
npm run cli -- sync                                                     # interactive: choose institution
npm run cli -- sync --institution "TD"                                  # one institution only
npm run cli -- sync --all                                               # all institutions non-interactively
npm run cli -- sync --skip-transactions                                 # accounts and balances only
npm run cli -- sync --institution "TD" --days 90                        # wider transaction window
npm run cli -- sync --institution "TD" --accountId 1234 --skip-accounts # one account only
```

Opens a real Chrome window, logs in, discovers all accounts and balances, and saves them to a local SQLite database. Fetches transactions for the configured lookback window (default: 30 days). Run `sync` before listing accounts if none are stored yet.

**List stored accounts and latest balances:**

```bash
npm run cli -- accounts list
```

**List recent transactions:**

```bash
npm run cli -- transactions list
npm run cli -- transactions list --institution "TD" --account "Chequing" --days 7
```

## MFA

LedgerAgent handles MFA automatically when possible. When a verification code screen appears, it first checks your Gmail inbox for the code — if found, it fills it in without any input from you. If Gmail isn't configured or no code arrives within 60 seconds, it falls back to prompting you to enter the code manually.

**Configure Gmail for automatic MFA** (one-time setup):

```bash
npm run cli -- config gmail
```

See [faq/how_to_config_gmail_for_mfa.md](faq/how_to_config_gmail_for_mfa.md) for setup instructions, including how to forward SMS codes to Gmail if your institution sends MFA codes by text.

**Test your Gmail setup** at any time:

```bash
# search last 5 minutes for MFA codes
npm run cli -- config gmail-test
# search last 30 minutes
npm run cli -- config gmail-test --since 30m
```

## Troubleshooting

- If you see an Anthropic authentication error, run `npm run cli -- config anthropic` to save your API key to Keychain (not needed when using Ollama).
- If browser launch fails, make sure Google Chrome is installed and `npx playwright install chromium` has been run.
- If MFA auto-fill does not work, run `npm run cli -- config gmail` and verify the Gmail App Password.
- If a login flow breaks after an institution changes its UI, inspect the saved accessibility snapshots in `~/.ledgeragent/logs/`. Sessions are grouped into timestamp-first subfolders named with the institution (e.g. `2025-05-28_143022_123_wealthsimple/`). The 20 most recent sessions overall are kept automatically.
- For more verbose agent output, run `DEBUG=1 npm run cli -- sync`.

## Requirements

- Node.js 18+
- macOS (Keychain is used for credential storage)
- Google Chrome
- Anthropic API key **or** [Ollama](https://ollama.com) running locally
