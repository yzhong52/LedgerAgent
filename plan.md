# Sync Reporting Improvements

## Goal

Replace terse sync output with meaningful diffs showing exactly what changed.

## Accounts sync output (target)

```
Wealthsimple accounts:

  + 2 new account(s) discovered:
      Chequing          Chequing   CAD   $32,647.78
      Credit card       Credit     CAD    $2,208.15

  ~ 3 account(s) updated:
      TFSA Managed      balance $23,000.00 → $23,148.93
      RRSP              balance $149,000.00 → $149,296.08
      Non-registered    balance $471,100.00 → $471,352.24

  - 1 account no longer found (kept for history; delete manually if desired):
      Old Savings       Savings    CAD
```

## Transactions sync output (target)

```
  ✓ 12 new transaction(s) for Wealthsimple credit card:

  Date        Description              Amount
  ----------  -----------------------  ----------
  2026-05-06  Progression Bouldering     -$23.10
  2026-05-05  Anthropic                 -$313.60
  ...

  (no change for Chequing — 0 new transactions)
```

---

## Implementation plan

### Step 1 — `src/db/storage.ts`: `saveSync` returns a diff  🔲

Add types:

```typescript
export interface AccountChange {
  account: Account;
  changes: string[];   // human-readable field diffs, e.g. "balance $1,000 → $1,100"
}

export interface AccountSyncDiff {
  added:   Account[];
  updated: AccountChange[];
  missing: AccountRow[];   // in DB but absent from new sync; NOT deleted
}
```

Change `saveSync` return type from `void` to `AccountSyncDiff`.

Implementation:
1. Before the transaction, query existing accounts for this institution.
2. Build a map keyed by `accountId`.
3. Categorise each incoming account as `added` (not in map) or compare fields for `updated`.
4. Find `missing` = rows in map whose `accountId` does not appear in new list.
5. Perform the upsert exactly as today (no schema changes).
6. Return the diff.

Fields to diff for "updated": `balance`, `type`, `currency`, `name`.

### Step 2 — `src/db/storage.ts`: `saveTransactions` returns new rows  🔲

Change return type from `void` to `Transaction[]` (the subset that were actually
inserted, not skipped by `ON CONFLICT DO NOTHING`).

Implementation: accumulate rows returned by `.returning()` on each insert;
only rows that were not conflicts come back.

### Step 3 — `src/commands/accounts.ts`: use diff for output  🔲

Replace the current `printAccountsTable` call after `saveSync` with diff-driven output:
- `+` section: added accounts (name, type, currency, balance)
- `~` section: updated accounts (name + list of changed fields)
- `-` section: missing accounts (name + note about historical retention)
- Omit any section with 0 entries.

### Step 4 — `src/commands/transactions.ts`: show new-transactions table  🔲

Replace `console.log(\`  ✓ ${txs.length} transaction(s) saved…\`)` with:
- If 0 new: `  (no new transactions for <account>)`
- If >0: count line + compact table (date, description, amount) of the new rows only.

---

## Files changed

| File | Change |
|---|---|
| `src/db/storage.ts` | `saveSync` → returns `AccountSyncDiff`; `saveTransactions` → returns `Transaction[]` |
| `src/commands/accounts.ts` | diff-based output in `sync` action |
| `src/commands/transactions.ts` | new-transaction table in `sync` action |
