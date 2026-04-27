# OpenVault — Agentic Financial Aggregator

Aggregate accounts, balances, and transactions from any financial institution — without API keys, screen-scraping hacks, or third-party integrations.

- **Universal.** Traditional aggregators break when banks change their UI or revoke API access. OpenVault uses an AI agent that reads the page the same way you do — works out of the box for any bank, any UI, with no setup per institution.
- **Private.** Your credentials never leave your machine. OpenVault opens a real browser, logs in as you, and saves data locally. No third party ever sees your account information.

## Setup

```bash
npm install
npx playwright install chromium
```

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Usage

**Add an account** (saves credentials to macOS Keychain):

```bash
npm run cli account add
```

You'll be prompted for the institution name, login URL, username or email, and password. Credentials are stored in the macOS Keychain — you won't be asked again.

**Sync all accounts** (login and print balances):

```bash
npm run cli sync
```

**Sync a single account** by name:

```bash
npm run cli -- sync --account TD
```

Opens a real Chrome window, logs into each saved account, and prints the accounts and balances to the console.

**Debug mode** — logs each prompt sent to Claude and pauses 1s per tool call:

```bash
DEBUG=1 npm run cli sync
```

## Project Structure

```
src/
  cli.ts          # CLI entry point (account add, sync)
  login.ts        # Claude-powered login agent (institution-agnostic)
  accounts.ts     # Claude-powered account discovery agent
  keychain.ts     # macOS Keychain helpers
  wealthsimple.ts # Hardcoded Playwright login (reference)
~/.openvault/
  accounts.json   # Saved account metadata (no passwords)
  browser-profile/ # Persistent Chrome profile
```

## Requirements

- Node.js 18+
- macOS (Keychain is used for credential storage)
- Google Chrome installed
- `ANTHROPIC_API_KEY` environment variable
