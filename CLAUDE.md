# OpenVault — Codebase Guide

## What this project does

Logs into financial institution websites using a Claude-powered Playwright agent, extracts account/transaction data, and stores it locally. The browser runs visibly (not headless) so the user can observe and handle any unexpected prompts.

## Key files

- `src/login.ts` — the main Claude-powered login agent; institution-agnostic
- `src/wealthsimple.ts` — hardcoded Playwright login for Wealthsimple (no Claude); used as a reference and fallback
- `v0/` — original Rust + chromiumoxide implementation; kept for reference only, not built

## Running

```bash
npm run login          # Claude agent (Wealthsimple entry point)
DEBUG=1 npm run login  # Verbose: logs prompts to Claude + 1s pause per tool call
npm run wealthsimple   # Hardcoded Playwright script
```

Credentials are read from env vars; the script prompts interactively if not set:
- `OPENVAULT_WS_USERNAME`
- `OPENVAULT_WS_PASSWORD`
- `ANTHROPIC_API_KEY`

## Architecture of login.ts

The agent loop in `login()` sends the accessibility snapshot to Claude, executes the returned tool calls, feeds results back, and repeats until Claude calls `success`.

**Tools available to Claude:**
- `snapshot` — returns `page.locator('body').ariaSnapshot()`
- `fill` — uses Playwright `fill()` (no key events; fine for username/password)
- `type` — uses `pressSequentially()` (fires key events; required for OTP fields)
- `click` — `getByRole(role, { name })`; followed by `domcontentloaded` wait with 3s timeout
- `click_testid` — `getByTestId()`; escape hatch when role/name matches multiple elements
- `request_mfa_code` — prompts user for OTP code, returns it to Claude as the tool result
- `success` — terminates the loop

**Why `domcontentloaded` not `load` after clicks:** Wealthsimple and similar SPAs never fire a second `load` event during in-app navigation. Using `load` hangs indefinitely; `domcontentloaded` with a catch is the safe alternative.

**Why two fill tools:** `fill()` is fast and reliable for text inputs. OTP fields in SPAs often gate the submit button on keystroke events, which `fill()` doesn't fire. `pressSequentially()` simulates real typing.

**Error handling in tool execution:** Playwright errors (e.g. strict mode violations when a locator matches multiple elements) are caught and returned to Claude as the tool result string. Claude can then retry with a more specific selector (e.g. `click_testid`).

## Adding a new institution

1. Add a new entry point at the bottom of `src/login.ts` (or a new file) with the institution's login URL
2. Add an npm script in `package.json`
3. The login agent is institution-agnostic — no other changes needed unless the site has unusual behaviour

## Logs

Accessibility snapshots are saved to `logs/ws_<label>.txt` after each major step. These are gitignored and useful for debugging selector issues.
