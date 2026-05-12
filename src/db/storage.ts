
import { createHash } from 'crypto';
import { eq, desc, and, gte } from 'drizzle-orm';
import type { Account } from '../tasks/accounts';
import { ACCOUNT_TYPES, ACCOUNT_CATEGORIES } from '../tasks/accounts';
import type { Transaction } from '../tasks/transactions';
import type { Holding } from '../tasks/holdings';
import { type Db } from '.';
import {
  institutions, accounts as accountsTable, syncs, balances,
  transactions as transactionsTable, holdings as holdingsTable,
} from './schema';

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function normalizeType(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  return ACCOUNT_TYPES.find(t => t.toLowerCase() === raw.toLowerCase()) ?? raw.toLowerCase();
}

function normalizeCategory(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return ACCOUNT_CATEGORIES.find(c => c.toLowerCase() === raw.toLowerCase()) ?? undefined;
}


export interface AccountRow {
  id: number;
  institutionName: string;
  accountName: string;
  accountType: string | null;
  accountCategory: string | null;
  accountCurrency: string | null;
  accountId: string;
  latestDate: string | null;
  amountCents: number | null;
}

export function listAccounts(db: Db): AccountRow[] {
  return db
    .select({
      id:              accountsTable.id,
      institutionName: institutions.name,
      accountName:     accountsTable.name,
      accountType:     accountsTable.type,
      accountCategory: accountsTable.category,
      accountCurrency: accountsTable.currency,
      accountId:       accountsTable.accountId,
      latestDate:      accountsTable.latestDate,
      amountCents:     accountsTable.latestAmountCents,
    })
    .from(accountsTable)
    .innerJoin(institutions, eq(accountsTable.institutionId, institutions.id))
    .orderBy(institutions.name, accountsTable.name)
    .all();
}

export interface AccountChange {
  account: Account;
  changes: string[];
}

export interface AccountSyncDiff {
  added:   Account[];
  updated: AccountChange[];
  missing: AccountRow[];
}

export function saveSync(
  db: Db,
  institutionName: string,
  institutionUrl: string,
  accountList: Account[],
): AccountSyncDiff {
  const institutionId = slugify(institutionName);

  const existing = listAccounts(db).filter(r => r.institutionName === institutionName);
  const existingByAccountId = new Map(existing.map(r => [r.accountId, r]));
  const incomingIds = new Set(accountList.map(a => a.accountId ?? a.name));

  const added: Account[] = [];
  const updated: AccountChange[] = [];
  const missing: AccountRow[] = existing.filter(r => !incomingIds.has(r.accountId));

  for (const account of accountList) {
    const rawAccountId = account.accountId ?? account.name;
    const prev = existingByAccountId.get(rawAccountId);
    if (!prev) {
      added.push(account);
    } else {
      const changes: string[] = [];
      const newCents = account.balance != null ? Math.round(account.balance * 100) : null;
      if (prev.amountCents !== newCents) {
        const fmt = (c: number | null) => {
          if (c == null) return '—';
          const abs = Math.abs(c) / 100;
          const s = abs.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return c < 0 ? `-$${s}` : `$${s}`;
        };
        changes.push(`balance ${fmt(prev.amountCents)} → ${fmt(newCents)}`);
      }
      const newType = normalizeType(account.type) ?? null;
      if ((prev.accountType ?? null) !== newType) {
        changes.push(`type ${prev.accountType ?? '—'} → ${newType ?? '—'}`);
      }
      const newCategory = normalizeCategory(account.category) ?? null;
      if ((prev.accountCategory ?? null) !== newCategory) {
        changes.push(`category ${prev.accountCategory ?? '—'} → ${newCategory ?? '—'}`);
      }
      if ((prev.accountCurrency ?? null) !== (account.currency ?? null)) {
        changes.push(`currency ${prev.accountCurrency ?? '—'} → ${account.currency ?? '—'}`);
      }
      if (prev.accountName !== account.name) {
        changes.push(`name "${prev.accountName}" → "${account.name}"`);
      }
      if (changes.length > 0) updated.push({ account, changes });
    }
  }

  db.transaction((tx) => {
    tx.insert(institutions)
      .values({ id: institutionId, name: institutionName, url: institutionUrl })
      .onConflictDoUpdate({
        target: institutions.id,
        set: { name: institutionName, url: institutionUrl },
      })
      .run();

    const now = new Date();
    const today = toDateString(now);

    tx.insert(syncs)
      .values({ institutionId, syncedAt: now.toISOString() })
      .run();

    for (const account of accountList) {
      const rawAccountId = account.accountId ?? account.name;
      const amountCents = account.balance != null ? Math.round(account.balance * 100) : null;

      const { id: intId } = tx.insert(accountsTable)
        .values({
          institutionId, accountId: rawAccountId, name: account.name,
          type: normalizeType(account.type), category: normalizeCategory(account.category),
          currency: account.currency, latestDate: today, latestAmountCents: amountCents,
        })
        .onConflictDoUpdate({
          target: [accountsTable.institutionId, accountsTable.accountId],
          set: {
            type: normalizeType(account.type), category: normalizeCategory(account.category),
            currency: account.currency, latestDate: today, latestAmountCents: amountCents,
          },
        })
        .returning({ id: accountsTable.id })
        .get();

      tx.insert(balances)
        .values({ accountId: intId, date: today, amountCents })
        .onConflictDoUpdate({
          target: [balances.accountId, balances.date],
          set: { amountCents },
        })
        .run();
    }
  });

  return { added, updated, missing };
}

export interface NetWorthPoint {
  date: string;
  amountCents: number;
}

export function getNetWorthHistory(db: Db): NetWorthPoint[] {
  const allBalances = db
    .select({
      accountId: balances.accountId,
      date: balances.date,
      amountCents: balances.amountCents,
    })
    .from(balances)
    .orderBy(balances.date)
    .all();

  const balancesByDate = new Map<string, typeof allBalances>();
  for (const b of allBalances) {
    if (!balancesByDate.has(b.date)) balancesByDate.set(b.date, []);
    balancesByDate.get(b.date)!.push(b);
  }

  const explicitDates = Array.from(balancesByDate.keys()).sort();
  if (explicitDates.length === 0) return [];

  const currentBalances: Record<string, number> = {};
  const result: NetWorthPoint[] = [];

  let currentDate = explicitDates[0];
  const endDate = explicitDates[explicitDates.length - 1];

  while (currentDate <= endDate) {
    if (balancesByDate.has(currentDate)) {
      for (const b of balancesByDate.get(currentDate)!) {
        if (b.amountCents !== null) {
          currentBalances[b.accountId] = b.amountCents;
        }
      }
    }

    let dailyTotal = 0;
    for (const amount of Object.values(currentBalances)) {
      dailyTotal += amount;
    }

    result.push({ date: currentDate, amountCents: dailyTotal });

    // Advance to the next calendar day
    const [y, m, d] = currentDate.split('-').map(Number);
    const nextDate = new Date(Date.UTC(y, m - 1, d + 1));
    currentDate = nextDate.toISOString().slice(0, 10);
  }

  return result;
}

export interface TransactionRow {
  id: number;
  institutionName: string;
  accountName: string;
  datetime: string;
  description: string;
  amountCents: number;
  currency: string | null;
}

export function saveTransactions(
  db: Db,
  institutionName: string,
  rawAccountId: string,
  txList: Transaction[],
): Transaction[] {
  const institutionId = slugify(institutionName);

  const account = db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(
      eq(accountsTable.institutionId, institutionId),
      eq(accountsTable.accountId, rawAccountId),
    ))
    .get();

  if (!account) return [];

  const inserted: Transaction[] = [];

  db.transaction((tx) => {
    for (const t of txList) {
      const amountCents = Math.round(t.amount * 100);
      const txId = t.transactionId ?? createHash('sha256')
        .update(`${rawAccountId}:${t.datetime}:${t.description}:${amountCents}`)
        .digest('hex')
        .slice(0, 16);

      const rows = tx.insert(transactionsTable)
        .values({
          accountId: account.id,
          transactionId: txId,
          datetime: t.datetime,
          description: t.description,
          amountCents,
          currency: t.currency,
        })
        .onConflictDoNothing()
        .returning({
          datetime:    transactionsTable.datetime,
          description: transactionsTable.description,
          amountCents: transactionsTable.amountCents,
          currency:    transactionsTable.currency,
        })
        .all();

      if (rows.length > 0) {
        inserted.push({ ...t, amount: rows[0].amountCents / 100 });
      }
    }
  });

  return inserted;
}

export function listTransactions(
  db: Db,
  filters: { institutionName?: string; accountName?: string; days?: number } = {},
): TransactionRow[] {
  // Cutoff is date-only; ISO string prefix comparison works because YYYY-MM-DD < YYYY-MM-DDTHH:MM:SS
  const cutoff = filters.days != null
    ? new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : undefined;

  const conditions = [
    cutoff != null ? gte(transactionsTable.datetime, cutoff) : undefined,
    filters.institutionName != null ? eq(institutions.name, filters.institutionName) : undefined,
    filters.accountName != null ? eq(accountsTable.name, filters.accountName) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c != null);

  const base = db
    .select({
      id:              transactionsTable.id,
      institutionName: institutions.name,
      accountName:     accountsTable.name,
      datetime:        transactionsTable.datetime,
      description:     transactionsTable.description,
      amountCents:     transactionsTable.amountCents,
      currency:        transactionsTable.currency,
    })
    .from(transactionsTable)
    .innerJoin(accountsTable, eq(transactionsTable.accountId, accountsTable.id))
    .innerJoin(institutions, eq(accountsTable.institutionId, institutions.id));

  if (conditions.length > 0) {
    return base.where(and(...conditions)).orderBy(desc(transactionsTable.datetime)).all();
  }
  return base.orderBy(desc(transactionsTable.datetime)).all();
}

export interface HoldingRow {
  institutionName: string;
  accountName: string;
  symbol: string;
  name: string | null;
  quantity: number;
  pricePerUnitCents: number;
  marketValueCents: number;
  costBasisCents: number | null;
  currency: string | null;
}

export function listHoldings(db: Db): HoldingRow[] {
  const rows = db
    .select({
      internalAccountId: accountsTable.id,
      date:              holdingsTable.date,
      institutionName:   institutions.name,
      accountName:       accountsTable.name,
      symbol:            holdingsTable.symbol,
      name:              holdingsTable.name,
      quantity:          holdingsTable.quantity,
      pricePerUnitCents: holdingsTable.pricePerUnit,
      marketValueCents:  holdingsTable.marketValue,
      costBasisCents:    holdingsTable.costBasis,
      currency:          holdingsTable.currency,
    })
    .from(holdingsTable)
    .innerJoin(accountsTable, eq(holdingsTable.accountId, accountsTable.id))
    .innerJoin(institutions, eq(accountsTable.institutionId, institutions.id))
    .all();

  // For each account, keep only the rows from the latest date
  const latestDate = new Map<number, string>();
  for (const r of rows) {
    const cur = latestDate.get(r.internalAccountId) ?? '';
    if (r.date > cur) latestDate.set(r.internalAccountId, r.date);
  }

  return rows
    .filter(r => latestDate.get(r.internalAccountId) === r.date)
    .sort((a, b) => b.marketValueCents - a.marketValueCents)
    .map(({ internalAccountId: _a, date: _d, ...rest }) => rest);
}

// accountId is the internal surrogate PK (accounts.id), not the institution-reported string ID
// which can change across syncs.
export function saveHoldings(db: Db, accountId: number, holdingList: Holding[]): void {
  const today = toDateString(new Date());

  db.transaction((tx) => {
    for (const h of holdingList) {
      tx.insert(holdingsTable)
        .values({
          accountId,
          date:         today,
          symbol:       h.symbol,
          name:         h.name,
          quantity:     h.quantity,
          pricePerUnit: Math.round(h.pricePerUnit * 100),
          marketValue:  Math.round(h.marketValue * 100),
          costBasis:    h.costBasis != null ? Math.round(h.costBasis * 100) : null,
          currency:     h.currency,
        })
        .onConflictDoUpdate({
          target: [holdingsTable.accountId, holdingsTable.date, holdingsTable.symbol],
          set: {
            name:         h.name,
            quantity:     h.quantity,
            pricePerUnit: Math.round(h.pricePerUnit * 100),
            marketValue:  Math.round(h.marketValue * 100),
            costBasis:    h.costBasis != null ? Math.round(h.costBasis * 100) : null,
            currency:     h.currency,
          },
        })
        .run();
    }
  });
}

export function mergeAccounts(db: Db, sourceId: number, targetId: number): void {
  db.transaction((tx) => {
    const sourceBalances = tx
      .select({ date: balances.date, amountCents: balances.amountCents })
      .from(balances)
      .where(eq(balances.accountId, sourceId))
      .all();

    for (const row of sourceBalances) {
      tx.insert(balances)
        .values({ accountId: targetId, date: row.date, amountCents: row.amountCents })
        .onConflictDoNothing()
        .run();
    }

    const latest = tx
      .select({ date: balances.date, amountCents: balances.amountCents })
      .from(balances)
      .where(eq(balances.accountId, targetId))
      .orderBy(desc(balances.date))
      .limit(1)
      .all();

    if (latest.length > 0) {
      tx.update(accountsTable)
        .set({ latestDate: latest[0].date, latestAmountCents: latest[0].amountCents })
        .where(eq(accountsTable.id, targetId))
        .run();
    }

    tx.delete(balances).where(eq(balances.accountId, sourceId)).run();
    tx.delete(accountsTable).where(eq(accountsTable.id, sourceId)).run();
  });
}
