# Transactions Feature — Implementation Plan

## Overview

Add per-account transaction history: fetch, store, and display recent transactions alongside the
existing account balance data. The sync command fetches transactions for each account after
discovering balances. A new `transactions list` CLI command reads them back.

Default lookback window is 30 days, configurable via `--days` on both `sync` and `transactions list`.

---

## Files to change

### 1. `src/db/schema.ts` ✅
Add a `transactions` table:

| Column          | Type    | Notes                                                            |
|-----------------|---------|------------------------------------------------------------------|
| `id`            | integer | autoincrement PK                                                 |
| `account_id`    | integer | FK → `accounts.id`                                              |
| `transaction_id`| text    | institution ID, or sha256(accountId:date:description:amountCents)|
| `date`          | text    | YYYY-MM-DD                                                       |
| `description`   | text    | merchant / payee name                                            |
| `amount_cents`  | integer | signed; negative = debit                                         |
| `currency`      | text    | ISO 4217; NULL for domestic                                      |

Unique index on `(account_id, transaction_id)` prevents duplicates across syncs.

### 2. `src/db/storage.ts` ✅
- `saveTransactions(db, institutionName, rawAccountId, txList)` — looks up the account's integer
  PK, then bulk-inserts with `ON CONFLICT DO NOTHING`.  
  Dedup key: institution-provided `transactionId` if the agent found one; otherwise a 16-char
  hex prefix of `sha256(rawAccountId:date:description:amountCents)`.
- `listTransactions(db, filters?)` — joins transactions → accounts → institutions.  
  Optional filters: `institutionName`, `accountName`, `days` (cutoff date computed from `Date.now()`).

### 3. `src/agent/index.ts` ✅
Add optional `maxTurns` parameter (default `MAX_TURNS = 20`) to `runAgent()`.
Transactions may require navigating to an account page, adjusting date filters, and paginating —
up to 40 turns is safer.

### 4. `src/tasks/transactions.ts` ✅
New task following the `accounts.ts` pattern:

- **`Transaction` interface** — `{ date, description, amount, transactionId?, currency? }`
- **`REPORT_TRANSACTIONS` tool** — Claude calls this when done; `amount` is a signed number.
- **`buildSystemPrompt`** — tells Claude which account to target, the since-date, and how to
  handle pagination.  Memory notes (`## transactions` section) are injected for institution-specific
  navigation quirks.
- **`fetchTransactions(page, institutionName, account, lookbackDays, sessionDir)`** — runs the
  agent with `maxTurns = 40`; saves session notes to memory on completion.

### 5. `src/commands/sync.ts` 🔲
- Add `--days <n>` option (default `30`).
- After `saveSync()`, loop over each discovered account and call `fetchTransactions` then
  `saveTransactions`. Errors per account are caught and logged without aborting the rest.

### 6. `src/commands/transactions.ts` 🔲
New `transactions list` subcommand:

| Option              | Default | Description                         |
|---------------------|---------|-------------------------------------|
| `-i, --institution` | —       | filter by institution name          |
| `-a, --account`     | —       | filter by account name              |
| `--days <n>`        | `30`    | show transactions from last N days  |
| `--demo`            | —       | randomize amounts for screenshots   |

Output columns: Date · Institution · Account · Description · Amount (right-aligned).

### 7. `src/cli.ts` 🔲
Register the `transactions` command group.

---

## Data flow (sync)

```
login()
  └─ exploreAccounts()
       └─ saveSync()            ← accounts + balances written
            └─ for each account:
                 fetchTransactions(account, lookbackDays)
                   └─ saveTransactions()   ← transactions written
```

## Dedup strategy

| Scenario                          | Dedup key                                      |
|-----------------------------------|------------------------------------------------|
| Institution exposes a tx ID       | Institution's own ID                           |
| No tx ID visible                  | `sha256(rawAccountId:date:description:cents)[:16]` |

Re-syncing the same day produces identical hashes → `ON CONFLICT DO NOTHING` silently skips them.

## Open questions / future work

- **Categorisation** — add a `category` column and let Claude tag transactions (groceries, dining,
  transport, …) as a post-processing step.
- **Full history on first sync** — today we always fetch `--days` worth. A "first sync" flag could
  trigger a deeper pull (e.g. 365 days) automatically.
- **`transactions export`** — CSV export subcommand.
