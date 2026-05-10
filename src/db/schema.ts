import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const institutions = sqliteTable('institutions', {
  id:   text('id').primaryKey(),
  name: text('name').notNull(),
  url:  text('url').notNull(),
});

export const accounts = sqliteTable('accounts', {
  id:                 integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }), // surrogate PK; used internally for FK references
  institutionId:      text('institution_id').notNull().references(() => institutions.id),
  accountId:          text('account_id').notNull(), // raw identifier as reported by the institution (e.g. last 4 digits); may change across syncs — use accounts.id for stable FK references
  name:               text('name').notNull(),
  type:               text('type'),
  currency:           text('currency'),
  // Denormalized from balances for O(1) current-balance reads. saveSync keeps these
  // in sync within the same transaction. Trade-off: the latest balance is stored twice
  // (here and in balances), but avoids a MAX(date) subquery or time-series join on
  // every dashboard load.
  latestDate:         text('latest_date'),
  latestAmountCents:  integer('latest_amount_cents'),
}, t => [uniqueIndex('accounts_institution_account').on(t.institutionId, t.accountId)]);

export const syncs = sqliteTable('syncs', {
  id:            integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  institutionId: text('institution_id').notNull().references(() => institutions.id),
  syncedAt:      text('synced_at').notNull(),
});

export const balances = sqliteTable('balances', {
  id:          integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  accountId:   integer('account_id', { mode: 'number' }).notNull().references(() => accounts.id),
  date:        text('date').notNull(),  // YYYY-MM-DD; one row per account per day
  amountCents: integer('amount_cents'),
}, t => [uniqueIndex('balances_account_date').on(t.accountId, t.date)]);

export const transactions = sqliteTable('transactions', {
  id:            integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  accountId:     integer('account_id', { mode: 'number' }).notNull().references(() => accounts.id),
  transactionId: text('transaction_id').notNull(),  // institution ID or sha256 hash of (accountId:datetime:description:amountCents)
  datetime:      text('datetime').notNull(),         // ISO 8601: YYYY-MM-DDTHH:MM:SS when time is known, YYYY-MM-DD otherwise
  description:   text('description').notNull(),
  amountCents:   integer('amount_cents').notNull(),  // signed; negative = debit
  currency:      text('currency'),
}, t => [uniqueIndex('transactions_account_txid').on(t.accountId, t.transactionId)]);

export const holdings = sqliteTable('holdings', {
  id:           integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  accountId:    integer('account_id', { mode: 'number' }).notNull().references(() => accounts.id),
  syncId:       integer('sync_id', { mode: 'number' }).notNull().references(() => syncs.id),
  symbol:       text('symbol').notNull(),
  name:         text('name'),
  quantity:     real('quantity').notNull(),
  pricePerUnit: integer('price_per_unit').notNull(),  // cents
  marketValue:  integer('market_value').notNull(),    // cents
  costBasis:    integer('cost_basis'),                // cents; nullable
  currency:     text('currency'),
}, t => [uniqueIndex('holdings_account_sync_symbol').on(t.accountId, t.syncId, t.symbol)]);
