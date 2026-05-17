# Plan: Structured Agent State

## Problem

The agent occasionally enters navigation loops, revisiting pages it has already seen. The root cause
is that the conversation history is too lossy to reliably track collection state.

The current implementation already compresses history: instead of keeping the full ARIA snapshot,
it stores the agent's own one-sentence page summary (see `archiveSnapshot` in `src/agent/index.ts`).
The problem is that a one-sentence prose summary cannot reliably answer "have I already found the
TFSA account balance?" — which is what causes the loops.

## Proposed Solution

## Implementation Sketch

Each turn in `runAgent` becomes two sequential LLM calls:

### Call 1 — Summarize

**Input:**
- Previous cumulative summary (empty on turn 0)
- Current ARIA snapshot

**Prompt:** "Here is what we have found so far: `{summary}`. Here is the current page:
`{snapshot}`. Update the summary to incorporate what you now see. Be specific about account names,
balances, and any data already collected."

**Output:** Updated cumulative summary as a typed JSON object. Stored as `currentSummary` for this
turn and passed as the previous summary on the next turn. Example shape for the accounts task:

```json
{
  "pages_visited": ["dashboard", "accounts overview", "credit card detail"],
  "data_collected": {
    "accounts": [
      { "name": "TFSA", "balance": "$12,340", "found": true },
      { "name": "RRSP", "balance": null, "found": false }
    ]
  },
  "next_objective": "Find RRSP balance — not yet visited"
}
```

Using structured JSON (rather than prose) makes the state machine-readable: the agent loop can
inspect `data_collected` directly and enforce completion without relying solely on the model's
judgment (e.g. short-circuit to `success` when all items have `found: true`).

### Call 2 — Act

**Input:**
- Current cumulative summary (output of Call 1)
- Available tools

**Prompt:** "Here is what we have found so far: `{summary}`. Have we collected everything needed
for the goal? If yes, call `success`. If not, call the appropriate tool to continue."

**Output:** Tool call(s) — either a navigation/interaction action or `success`.

### Changes to `runAgent`

1. Replace the single `callWithTools` call per turn with two calls: `callSummarize` (no tools,
   just text output) then `callAct` (tools only, no history — stateless).
2. Drop the `messages` conversation history array and `archiveSnapshot` entirely — state is carried
   solely through `currentSummary`.
3. The summarizer can be wired to a cheaper model (configurable via a new `summaryModel` param on
   `runAgent`).
4. Log both calls per turn in `conversation_<task>.md` — label them `### Turn N — Summarize` and
   `### Turn N — Act`.
