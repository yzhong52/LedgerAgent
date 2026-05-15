import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from './schema';
import { getNetWorthHistory, saveSync, saveTransactions, listAccounts } from './storage';
import { type Db } from './index';
import { printAccountSyncResult } from '../commands/accounts';
import { printTransactionSyncResult } from '../commands/transactions';

function makeDb(): { sqlite: Database.Database; db: Db } {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'src/db/migrations') });
  return { sqlite, db };
}

const CHQ  = { name: 'Chequing', accountId: 'chq',  type: 'Chequing' as const, currency: 'CAD', balance: 1000 };
const SAV  = { name: 'Savings',  accountId: 'sav',  type: 'Savings'  as const, currency: 'CAD', balance: 2000 };
const RRSP = { name: 'RRSP',     accountId: 'rrsp', type: 'RRSP'     as const, currency: 'CAD', balance: 50000 };

// ---------------------------------------------------------------------------
// saveSync
// ---------------------------------------------------------------------------

describe('saveSync', () => {
  let sqlite: Database.Database;
  let db: Db;
  beforeEach(() => { ({ sqlite, db } = makeDb()); });
  afterEach(() => { sqlite.close(); });

  it('first sync: all accounts are new', () => {
    const diff = saveSync(db, 'TD', 'https://td.com', [CHQ, SAV]);
    expect(diff).toMatchObject({ added: [CHQ, SAV], updated: [], missing: [] });
  });

  it('re-sync unchanged: no diff', () => {
    saveSync(db, 'TD', 'https://td.com', [CHQ]);
    const diff = saveSync(db, 'TD', 'https://td.com', [CHQ]);
    expect(diff).toMatchObject({ added: [], updated: [], missing: [] });
  });

  it('balance change → updated with description', () => {
    saveSync(db, 'TD', 'https://td.com', [CHQ]);
    const diff = saveSync(db, 'TD', 'https://td.com', [{ ...CHQ, balance: 1500 }]);
    expect(diff.updated[0].changes).toEqual(['balance $1,000.00 → $1,500.00']);
  });

  it('missing account → reported but not deleted', () => {
    saveSync(db, 'TD', 'https://td.com', [CHQ, SAV]);
    const diff = saveSync(db, 'TD', 'https://td.com', [CHQ]);
    expect(diff.missing.map(a => a.accountName)).toEqual(['Savings']);
  });

  it('multiple field changes reported together', () => {
    saveSync(db, 'TD', 'https://td.com', [
      { name: 'Old', accountId: 'x', type: 'Savings', currency: 'CAD', balance: 100 },
    ]);
    const diff = saveSync(db, 'TD', 'https://td.com', [
      { name: 'New', accountId: 'x', type: 'Chequing', currency: 'USD', balance: 90 },
    ]);
    expect(diff.updated[0].changes).toEqual([
      'balance $100.00 → $90.00',
      'type Savings → Chequing',
      'currency CAD → USD',
      'name "Old" → "New"',
    ]);
  });
});

// ---------------------------------------------------------------------------
// saveTransactions
// ---------------------------------------------------------------------------

describe('saveTransactions', () => {
  let sqlite: Database.Database;
  let db: Db;
  beforeEach(() => {
    ({ sqlite, db } = makeDb());
    saveSync(db, 'TD', 'https://td.com', [CHQ]);
  });
  afterEach(() => { sqlite.close(); });

  const COFFEE = { datetime: '2026-05-01', description: 'Coffee', amount: -5.00 };
  const LUNCH  = { datetime: '2026-05-02', description: 'Lunch',  amount: -12.50 };

  it('returns newly inserted transactions', () => {
    const newTxs = saveTransactions(db, 'TD', 'chq', [COFFEE, LUNCH]);
    expect(newTxs.map(t => t.description)).toEqual(['Coffee', 'Lunch']);
  });

  it('idempotent: re-syncing same transactions returns empty', () => {
    saveTransactions(db, 'TD', 'chq', [COFFEE]);
    expect(saveTransactions(db, 'TD', 'chq', [COFFEE])).toHaveLength(0);
  });

  it('returns only the new ones in a mixed sync', () => {
    saveTransactions(db, 'TD', 'chq', [COFFEE]);
    const newTxs = saveTransactions(db, 'TD', 'chq', [COFFEE, LUNCH]);
    expect(newTxs.map(t => t.description)).toEqual(['Lunch']);
  });

  it('returns empty for unknown account', () => {
    expect(saveTransactions(db, 'TD', 'unknown', [COFFEE])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Example console output — shows what accounts sync and transactions sync print
// ---------------------------------------------------------------------------

describe('example console output', () => {
  let sqlite: Database.Database;
  let db: Db;
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    ({ sqlite, db } = makeDb());
    spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { process.stdout.write(args.join(' ') + '\n'); });
  });
  afterEach(() => { spy.mockRestore(); sqlite.close(); });

  it('accounts sync result', () => {
    saveSync(db, 'TD', 'https://td.com', [CHQ, SAV]);
    const diff = saveSync(db, 'TD', 'https://td.com', [{ ...CHQ, balance: 1500 }, RRSP]);
    printAccountSyncResult('TD', diff, listAccounts(db).filter(a => a.institutionName === 'TD'), { demo: false });
    expect(spy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n')).toMatchInlineSnapshot(`
      "  + 1 new account(s) discovered:

        Account  ID    Type         Balance  Last Updated
        -------  ----  ----  --------------  ------------
        RRSP     rrsp  RRSP  CAD $50,000.00  —

        ~ 1 account(s) updated:
            Chequing: balance $1,000.00 → $1,500.00

        - 1 account(s) no longer found
          (kept for historical records; delete manually if desired)
            Savings

        Current accounts for TD:

        Account   ID    Type             Balance  Last Updated
        --------  ----  --------  --------------  ------------
        Chequing  chq   Chequing   CAD $1,500.00  2026-05-15
        RRSP      rrsp  RRSP      CAD $50,000.00  2026-05-15
        Savings   sav   Savings    CAD $2,000.00  2026-05-15
      "
    `);
  });

  it('transactions sync result — new rows', () => {
    saveSync(db, 'TD', 'https://td.com', [CHQ]);
    const newTxs = saveTransactions(db, 'TD', 'chq', [
      { datetime: '2026-05-06', description: 'Progression Bouldering', amount: -23.10 },
      { datetime: '2026-05-05', description: 'Anthropic',              amount: -313.60 },
      { datetime: '2026-04-25', description: 'Payroll deposit',        amount: 3200.00 },
    ]);
    printTransactionSyncResult('Chequing', newTxs, 5);
    expect(spy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n')).toMatchInlineSnapshot(`
      "  ✓ 3 new transaction(s) for Chequing (2 already stored):
          Date        Description                Amount
          ----------  ----------------------  ---------
          2026-05-06  Progression Bouldering    -$23.10
          2026-05-05  Anthropic                -$313.60
          2026-04-25  Payroll deposit         $3,200.00
      "
    `);
  });

  it('transactions sync result — no new rows', () => {
    saveSync(db, 'TD', 'https://td.com', [CHQ]);
    saveTransactions(db, 'TD', 'chq', [{ datetime: '2026-05-06', description: 'Coffee', amount: -5 }]);
    const newTxs = saveTransactions(db, 'TD', 'chq', [{ datetime: '2026-05-06', description: 'Coffee', amount: -5 }]);
    printTransactionSyncResult('Chequing', newTxs, 1);
    expect(spy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n')).toMatchInlineSnapshot(`"  (no new transactions for Chequing (1 already stored))"`);
  });
});

// ---------------------------------------------------------------------------
// getNetWorthHistory
// ---------------------------------------------------------------------------

describe('getNetWorthHistory', () => {
  let sqlite: Database.Database;
  let db: Db;

  beforeEach(() => {
    ({ sqlite, db } = makeDb());
    db.insert(schema.institutions).values({ id: 'td', name: 'TD', url: 'https://td.com' }).run();
    db.insert(schema.accounts).values([
      { institutionId: 'td', accountId: 'chequing', name: 'Chequing', type: 'Chequing', currency: 'CAD', latestDate: '2026-05-15' },
      { institutionId: 'td', accountId: 'savings',  name: 'Savings',  type: 'Savings',  currency: 'CAD', latestDate: '2026-05-15' },
    ]).run();
  });
  afterEach(() => { sqlite.close(); });

  it('carries forward previous balances for accounts not updated on a given day', () => {
    const [chequing, savings] = db
      .select({ id: schema.accounts.id }).from(schema.accounts).orderBy(schema.accounts.accountId).all();

    db.insert(schema.balances).values([
      { accountId: chequing.id, date: '2026-05-01', amountCents: 100000 },
      { accountId: savings.id,  date: '2026-05-01', amountCents: 200000 },
      { accountId: chequing.id, date: '2026-05-02', amountCents: 50000  },
      { accountId: chequing.id, date: '2026-05-04', amountCents: 60000  },
      { accountId: savings.id,  date: '2026-05-04', amountCents: 210000 },
    ]).run();

    expect(getNetWorthHistory(db)).toEqual([
      { date: '2026-05-01', amountCents: 300000 },
      { date: '2026-05-02', amountCents: 250000 }, // savings carried forward
      { date: '2026-05-03', amountCents: 250000 }, // full day gap carried forward
      { date: '2026-05-04', amountCents: 270000 },
    ]);
  });
});
