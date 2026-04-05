# OpenVault

A local-first agentic tool that logs into your financial institutions, downloads transaction data, and stores it in a SQLite database on your machine. Nothing leaves your computer.

## How It Works

### 1. Browser Control

OpenVault launches a real Chrome window (not headless) using [chromiumoxide](https://github.com/mattsse/chromiumoxide), which communicates with Chrome via the Chrome DevTools Protocol (CDP). The browser is visible so you can complete MFA steps manually when required.

### 2. Accessibility Snapshot

Instead of reading raw HTML or taking screenshots, OpenVault calls `Accessibility.getFullAXTree` via CDP after each navigation. This returns the page's accessibility tree — a compact semantic representation of what's on screen:

```
[textbox @e1] "Username"
[textbox @e2] "Password"
[button @e3] "Sign In"
[link @e4] "Forgot password?"
```

Each interactive element is assigned a stable ref (`@e1`, `@e2`, ...) with its role and accessible name stored in memory. This is roughly 50–100x fewer tokens than raw HTML, and more stable than CSS selectors because it targets elements by *what they are* rather than *where they are* in the DOM.

### 3. The Agent Loop

The snapshot is sent to Claude along with the current task. Claude decides what to do next and responds with a tool call:

```
observe (snapshot) → reason (Claude) → act (tool call) → repeat
```

Available tools:

| Tool | What it does |
|---|---|
| `navigate` | Go to a URL |
| `click` | Click an element by ref |
| `type_text` | Type into an element by ref |
| `snapshot` | Refresh the accessibility snapshot |
| `wait_for_mfa` | Pause and prompt you to complete MFA |
| `done` | Signal task complete, return results |

### 4. Element Targeting

When Claude calls `click(@e3)`, OpenVault resolves the ref to its `role` and `name` from the last snapshot, then constructs an XPath expression to locate the element in the DOM:

```
// role=button, name="Sign In"
//button[normalize-space(.)='Sign In'] | //*[@role='button'][normalize-space(.)='Sign In']
```

This covers both native HTML elements (which have implicit ARIA roles) and elements with explicit `role=` attributes — no brittle CSS selectors, no hardcoded IDs.

### 5. Network Interception

Before any navigation, OpenVault registers a CDP network listener. Modern banking apps are single-page apps that fetch transaction data via internal API calls (XHR/fetch). If one of those responses is captured, the transactions are extracted directly from the JSON — bypassing DOM parsing entirely. The scraping path is only taken if no matching API response is intercepted.

### 6. Storage

Transactions are normalized into a canonical schema and stored in a local SQLite database (`~/.local/share/openvault/transactions.db`). Every sync attempt is recorded in a `sync_log` table — start time, finish time, status, and any error message.

---

## Development

```bash
# Navigate to TD EasyWeb and dump the accessibility tree to logs/td_landing_page.txt
cargo run --bin inspect_td
```

---

## Usage

```bash
# Save credentials to the OS keychain (macOS Keychain / libsecret on Linux)
openvault credentials-set td

# Sync transactions from TD EasyWeb
openvault sync td

# List transactions from the last 30 days
openvault list

# Filter by institution, look back 90 days
openvault list --institution td --days 90

# Show last sync status per institution
openvault status
```

Set your Anthropic API key before syncing:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## Architecture

```
src/
├── main.rs              # CLI entry point
├── cli.rs               # clap command definitions
├── agent/
│   ├── mod.rs           # Observe → reason → act loop
│   ├── claude.rs        # Claude API client (reqwest)
│   └── tools.rs         # Tool execution dispatch
├── browser/
│   ├── mod.rs           # Session: launch, snapshot, resolve refs
│   ├── ax.rs            # AX tree conversion: raw CDP nodes → compact LLM text
│   ├── snapshot.rs      # CDP GetFullAxTree → AxSummary via ax.rs
│   ├── actions.rs       # click/type/navigate via XPath
│   └── network.rs       # XHR/fetch response interception
├── connectors/
│   ├── mod.rs           # Connector trait + registry
│   └── td.rs            # TD EasyWeb connector
├── credentials/
│   └── mod.rs           # OS keychain read/write
└── db/
    └── mod.rs           # SQLite: schema, insert, query, sync log
```

---

## Requirements

- Rust (stable)
- Chrome or Chromium installed
- `ANTHROPIC_API_KEY` environment variable
