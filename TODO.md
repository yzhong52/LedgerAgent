# Pending work

## Credential exposure

Passwords are currently sent to the Claude API in plaintext inside the system prompt (`src/tasks/login.ts` → `buildSystemPrompt`). With `VERBOSE=1`, tool inputs are also printed to the console, which can include the password value when Claude calls the `fill` tool.

Things to fix:
- Don't embed the password directly in the system prompt — instead inject it only as a tool result when Claude calls a dedicated `get_credentials` tool (or similar), so it never appears in logged prompts
- Scrub or redact password-like values before printing tool inputs in verbose mode
