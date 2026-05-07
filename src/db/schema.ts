import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const institutions = sqliteTable('institutions', {
  id:   text('id').primaryKey(),
  name: text('name').notNull(),
  url:  text('url').notNull(),
});

export const accounts = sqliteTable('accounts', {
  id:                 text('id').primaryKey(),
  institutionId:      text('institution_id').notNull().references(() => institutions.id),
  name:               text('name').notNull(),
  type:               text('type'),
  currency:           text('currency'),
  // Denormalized from balances for O(1) current-balance reads. saveSync keeps these
  // in sync within the same transaction. Trade-off: the latest balance is stored twice
  // (here and in balances), but avoids a MAX(date) subquery or time-series join on
  // every dashboard load.
  latestDate:         text('latest_date'),
  latestAmountCents:  integer('latest_amount_cents'),
});

export const syncs = sqliteTable('syncs', {
  id:            integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  institutionId: text('institution_id').notNull().references(() => institutions.id),
  syncedAt:      text('synced_at').notNull(),
});

export const balances = sqliteTable('balances', {
  id:          integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  accountId:   text('account_id').notNull().references(() => accounts.id),
  date:        text('date').notNull(),  // YYYY-MM-DD; one row per account per day
  amountCents: integer('amount_cents'),
}, t => [uniqueIndex('balances_account_date').on(t.accountId, t.date)]);
