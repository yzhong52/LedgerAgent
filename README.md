# OpenVault — Agentic Financial Aggregator

Aggregate accounts, balances, and transactions from any financial institution — without API keys, screen-scraping hacks, or third-party integrations.

- **Universal.** Traditional aggregators break when banks change their UI or revoke API access. OpenVault uses an AI agent that reads the page the same way you do — works out of the box for any bank, any UI, with no setup per institution.
- **Private.** Your credentials never leave your machine. OpenVault opens a real browser, logs in as you, and saves data locally. No third party ever sees your account information.

## How It Works

### 1. Playwright Browser

OpenVault launches a real Chromium window (visible, not headless) using [Playwright](https://playwright.dev). The browser stays visible so you can watch what's happening and complete steps like MFA if needed.

### 2. Accessibility Snapshot

Instead of scraping HTML, OpenVault reads the page's [ARIA accessibility tree](https://developer.mozilla.org/en-US/docs/Glossary/Accessibility_tree) after each action:

```
- document "Investing summary | Wealthsimple":
  - navigation:
    - link "Investing"
    - link "Tax"
  - heading "Total equity" [level=2]
  - text "$258,486.25"
```

This is far more compact than raw HTML and more stable than CSS selectors — elements are targeted by what they *are*, not where they happen to sit in the DOM.

### 3. Claude Agent Loop

The snapshot is sent to Claude, which decides what action to take next and responds with a tool call. This repeats until login is complete:

```
snapshot → Claude → tool call → execute → snapshot → …
```

Available tools:

| Tool | What it does |
|---|---|
| `snapshot` | Refresh the accessibility tree |
| `fill` | Fill a form field by ARIA role + name |
| `type` | Type character-by-character (for OTP fields that need key events) |
| `click` | Click an element by ARIA role + name |
| `click_testid` | Click by `data-testid` (fallback when role/name is ambiguous) |
| `request_mfa_code` | Pause, prompt you for the OTP code, return it to Claude |
| `success` | Signal login complete |

### 4. MFA Flow

MFA is handled entirely within the agent loop. When Claude sees an OTP screen, it calls `request_mfa_code` — the tool pauses and prompts you for the code, then returns it to Claude as the tool result. Claude fills it in and continues. No manual handoff needed.

---

## Scripts

| Command | Description |
|---|---|
| `npm run login` | Claude-powered login (works for any institution) |
| `npm run wealthsimple` | Hardcoded Playwright login (Wealthsimple, no Claude) |

---

## Setup

```bash
npm install
npx playwright install chromium
```

Set environment variables:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENVAULT_WS_USERNAME=you@example.com
export OPENVAULT_WS_PASSWORD=yourpassword
```

---

## Running

```bash
# Claude-powered login (prompts for credentials if env vars not set)
npm run login

# Verbose debug mode — logs each prompt sent to Claude, pauses 1s per tool call
DEBUG=1 npm run login

# Original hardcoded Playwright script
npm run wealthsimple
```

---

## Project Structure

```
src/
  login.ts          # Claude-powered login agent (institution-agnostic)
  wealthsimple.ts   # Hardcoded Playwright login flow (reference / v1)
v0/                 # Original Rust + chromiumoxide implementation (reference)
logs/               # Accessibility snapshots saved during runs (gitignored)
```

---

## Requirements

- Node.js 18+
- `ANTHROPIC_API_KEY` environment variable
