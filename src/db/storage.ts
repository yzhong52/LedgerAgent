import { eq } from 'drizzle-orm';
import type { Account } from '../tasks/accounts';
import { ACCOUNT_TYPES } from '../tasks/accounts';
import { type Db } from '.';
import { institutions, accounts as accountsTable, syncs, balances } from './schema';

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

function parseCents(raw: string): number | null {
  // Handles "$12,345.67", "-$500", "($1,200.00)"
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/^\((.+)\)$/, '-$1');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : Math.round(n * 100);
}

export interface AccountRow {
  institutionName: string;
  accountName: string;
  accountType: string | null;
  accountCurrency: string | null;
  accountId: string;
  latestDate: string | null;
  amountCents: number | null;
}

export function listAccounts(db: Db): AccountRow[] {
  return db
    .select({
      institutionName: institutions.name,
      accountName:     accountsTable.name,
      accountType:     accountsTable.type,
      accountCurrency: accountsTable.currency,
      accountId:       accountsTable.id,
      latestDate:      accountsTable.latestDate,
      amountCents:     accountsTable.latestAmountCents,
    })
    .from(accountsTable)
    .innerJoin(institutions, eq(accountsTable.institutionId, institutions.id))
    .orderBy(institutions.name, accountsTable.name)
    .all();
}

export function saveSync(
  db: Db,
  institutionName: string,
  institutionUrl: string,
  accountList: Account[],
): void {
  const institutionId = slugify(institutionName);

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
      // institutionId prefix ensures global uniqueness — account names are only unique within an institution
      const accountId = `${institutionId}/${account.accountId ?? account.name}`;

      const amountCents = account.balance ? parseCents(account.balance) : null;

      tx.insert(accountsTable)
        .values({
          id: accountId, institutionId, name: account.name,
          type: normalizeType(account.type), currency: account.currency,
          latestDate: today, latestAmountCents: amountCents,
        })
        .onConflictDoUpdate({
          target: accountsTable.id,
          set: {
            type: normalizeType(account.type), currency: account.currency,
            latestDate: today, latestAmountCents: amountCents,
          },
        })
        .run();

      tx.insert(balances)
        .values({ accountId, date: today, amountCents })
        .onConflictDoUpdate({
          target: [balances.accountId, balances.date],
          set: { amountCents },
        })
        .run();
    }
  });
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
