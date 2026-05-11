# Investment Support Plan — Net Worth Tracking

## What's done

- **`holdings` table** — schema + migration `0005_holdings`; `UNIQUE(accountId, syncId, symbol)`
- **`tasks/holdings.ts`** — agent task that navigates to the portfolio/holdings page and reports
  all positions; auto-triggered after `accounts sync`
- **`saveHoldings()` / `listHoldings()`** — storage layer for holdings
- **UI — Accounts page** — holdings drill-down per investment account (chevron expand)
- **UI — Dashboard** — collapsible Top Holdings panel showing top 6 positions
- **UI — Type badges** — color-coded pill badges for account types (TFSA, RRSP, etc.)

---

## Remaining work

### New column: `accounts.category`

Add a `category TEXT` column to the `accounts` table with four values:

| Value | Meaning | Holdings sync |
|-------|---------|---------------|
| `Cash` | Spendable money — Chequing, Savings, TFSA savings, etc. | No |
| `Credit` | Liability — Credit card, Mortgage, Line of Credit | No |
| `Brokerage` | Self-directed investment account — user picks positions | Yes |
| `Managed Investment` | Managed/robo-advisor — manager picks positions | Yes (agent returns empty if positions not exposed) |

`category` drives **behavior** (holdings sync trigger, liability sign, UI grouping).
`type` (TFSA, RRSP, Chequing, …) stays as **display metadata** — the tax wrapper or account
style as reported by the institution. Both fields are independent and orthogonal.

Examples:
- TFSA savings account → `category: Cash, type: TFSA`
- TFSA self-directed ETF account → `category: Brokerage, type: TFSA`
- RRSP robo-advisor → `category: Managed Investment, type: RRSP`
- Regular credit card → `category: Credit, type: Credit`

### Schema changes

1. Add `category TEXT` column to `accounts` (nullable for backwards compatibility with existing rows)
2. Drop `Brokerage` and `Investment` from the `type` enum in `src/tasks/accounts.ts` — these
   concepts are now captured by `category` and are redundant in `type`

### Agent changes

- Update `exploreAccounts` system prompt to instruct the agent to report `category` for each
  account using the four values above
- Update the `report_accounts` tool schema to include `category` as a reported field
- Update `saveSync()` to persist `category` alongside existing fields

### Holdings sync trigger

Replace the current `type`-based trigger in `src/commands/accounts.ts`:
```
// Before
accounts.filter(a => a.type === 'Investment' || a.type === 'Brokerage')

// After
accounts.filter(a => a.category === 'Brokerage' || a.category === 'Managed Investment')
```

### UI changes

- Show `category` badge alongside (or instead of) the type badge in the Accounts page where
  it adds clarity — e.g. a TFSA row would show both `[TFSA]` (type) and `[Brokerage]` (category)
- Use `category` for any grouping or filtering logic in the UI
