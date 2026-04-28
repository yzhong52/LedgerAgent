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

## How it works

Each sync runs a three-step agent pipeline per institution:

1. **Login** (`src/tasks/login.ts`) — navigates to the institution's login page, fills credentials, handles MFA, and waits for the dashboard.
2. **Accounts** (`src/tasks/explore.ts`) — scans the dashboard to discover all accounts, types, and balances. <!-- TODO: rename explore.ts → accounts.ts -->
3. **Transactions** — downloads the latest activity and transactions for each account. <!-- TODO: implement src/tasks/transactions.ts -->

After each step, the agent reflects on what worked and what didn't, and writes a short set of notes that are injected into the next session. This means the agent gets faster and more reliable over time for each institution it's seen before.

## Usage

**Add an institution** (saves credentials to macOS Keychain):

```bash
npm run cli -- institution add
```

You'll be prompted for the institution name, login URL, username or email, and password. Credentials are stored in the macOS Keychain — you won't be asked again.

**Sync all institutions:**

```bash
npm run cli -- sync
```

Opens a real Chrome window, logs into each saved institution, extracts all accounts and balances, and saves them to a local SQLite database.

## MFA

OpenVault handles MFA automatically when possible. When a verification code screen appears, it first checks your Gmail inbox for the code — if found, it fills it in without any input from you. If Gmail isn't configured or no code arrives within 60 seconds, it falls back to prompting you to enter the code manually.

**Configure Gmail for automatic MFA** (one-time setup):

```bash
npm run cli -- config gmail
```

See [faq/how_to_config_gmail_for_mfa.md](faq/how_to_config_gmail_for_mfa.md) for setup instructions, including how to forward SMS codes to Gmail if your institution sends MFA codes by text.

## Requirements

- Node.js 18+
- macOS (Keychain is used for credential storage)
- Google Chrome installed
- `ANTHROPIC_API_KEY` environment variable
