import { Command } from 'commander';
import { login } from '../tasks/login';
import { fetchTransactions } from '../tasks/transactions';
import { createSession } from '../agent';
import { keychainLoad } from '../keychain';
import { openDb } from '../db';
import { saveTransactions, listAccounts, listTransactions, type TransactionRow } from '../db/storage';
import type { Transaction } from '../tasks/transactions';
import { prompt, readInstitutions, formatCents, launchBrowser } from './utils';

function printNewTransactionsTable(txs: Transaction[]): void {
  const entries = txs.map(t => ({
    date:        t.datetime.includes('T') ? t.datetime.slice(0, 16).replace('T', ' ') : t.datetime,
    description: t.description,
    amount:      t.currency
      ? `${t.currency} ${formatCents(Math.round(t.amount * 100))}`
      : formatCents(Math.round(t.amount * 100)),
  }));

  const w = {
    date:        Math.max('Date'.length,        ...entries.map(e => e.date.length)),
    description: Math.max('Description'.length,  ...entries.map(e => e.description.length)),
    amount:      Math.max('Amount'.length,       ...entries.map(e => e.amount.length)),
  };
  const fmt = (e: typeof entries[number]) => [
    e.date.padEnd(w.date),
    e.description.padEnd(w.description),
    e.amount.padStart(w.amount),
  ].join('  ');

  console.log(`    ${fmt({ date: 'Date', description: 'Description', amount: 'Amount' })}`);
  console.log(`    ${fmt({ date: '-'.repeat(w.date), description: '-'.repeat(w.description), amount: '-'.repeat(w.amount) })}`);
  for (const e of entries) console.log(`    ${fmt(e)}`);
  console.log();
}

function printTransactionsTable(rows: TransactionRow[], { demo }: { demo: boolean }): void {
  if (rows.length === 0) {
    console.log('No transactions found. Run: npm run cli -- transactions sync');
    return;
  }

  const entries = rows.map(r => ({
    date:        r.datetime.includes('T') ? r.datetime.slice(0, 16).replace('T', ' ') : r.datetime,
    institution: r.institutionName,
    account:     r.accountName,
    description: r.description,
    amount:      r.currency
      ? `${r.currency} ${formatCents(r.amountCents)}`
      : formatCents(r.amountCents),
  }));

  if (demo) {
    for (const e of entries) {
      e.amount = formatCents(Math.round((Math.random() * 2000 - 1000) * 100));
      e.description = '*** redacted ***';
    }
  }

  const w = {
    date:        Math.max('Date'.length,        ...entries.map(e => e.date.length)),
    institution: Math.max('Institution'.length,  ...entries.map(e => e.institution.length)),
    account:     Math.max('Account'.length,      ...entries.map(e => e.account.length)),
    description: Math.max('Description'.length,  ...entries.map(e => e.description.length)),
    amount:      Math.max('Amount'.length,       ...entries.map(e => e.amount.length)),
  };

  const fmt = (e: typeof entries[number]) => [
    e.date.padEnd(w.date),
    e.institution.padEnd(w.institution),
    e.account.padEnd(w.account),
    e.description.padEnd(w.description),
    e.amount.padStart(w.amount),
  ].join('  ');

  const header = fmt({
    date: 'Date', institution: 'Institution', account: 'Account',
    description: 'Description', amount: 'Amount',
  });
  const divider = fmt({
    date: '-'.repeat(w.date), institution: '-'.repeat(w.institution),
    account: '-'.repeat(w.account), description: '-'.repeat(w.description),
    amount: '-'.repeat(w.amount),
  });

  console.log();
  console.log(`  ${header}`);
  console.log(`  ${divider}`);
  for (const e of entries) {
    console.log(`  ${fmt(e)}`);
  }
  console.log();
}

export function makeTransactionsCommand(): Command {
  const cmd = new Command('transactions').description('Sync and view transaction data');

  cmd
    .command('sync')
    .description('Fetch and store recent transactions for all accounts')
    .option('-i, --institution <name>', 'Only sync this institution (case-insensitive)')
    .option('--accountId <id>', 'Only sync this account ID (requires --institution)')
    .option('--days <n>', 'Number of days of history to fetch (default: 30)', '30')
    .option('-v, --verbose', 'Show accessibility snapshots in the terminal')
    .action(async (opts: {
      institution?: string;
      accountId?: string;
      days: string;
      verbose: boolean;
    }) => {
      if (opts.accountId && !opts.institution) {
        console.log('--accountId requires --institution.');
        return;
      }

      if (opts.verbose) process.env.VERBOSE = '1';
      const lookbackDays = Math.max(1, parseInt(opts.days, 10) || 30);

      let institutions = await readInstitutions();
      if (opts.institution) {
        const filter = opts.institution.toLowerCase();
        institutions = institutions.filter(i => i.name.toLowerCase() === filter);
        if (institutions.length === 0) {
          console.log(
            `No institution named "${opts.institution}". Run: npm run cli -- institution add`,
          );
          return;
        }
      }
      if (institutions.length === 0) {
        console.log('No institutions saved. Run: npm run cli -- institution add');
        return;
      }

      const { db, close } = openDb();
      const context = await launchBrowser();
      try {
        const page = context.pages()[0] ?? await context.newPage();
        for (const inst of institutions) {
          const password = keychainLoad(inst.name, inst.username);
          if (!password) {
            console.warn(
              `No password found in Keychain for ${inst.name} (${inst.username}), skipping.`,
            );
            continue;
          }

          console.log(`\n🤖 Syncing transactions for ${inst.name}...`);
          const sessionDir = await createSession(inst.url);
          await login(page, inst.url, { username: inst.username, password }, inst.name, sessionDir);

          let accountsToSync: { name: string; accountId: string }[];
          if (opts.accountId) {
            const match = listAccounts(db).find(
              a => a.institutionName === inst.name && a.accountId.endsWith(opts.accountId!),
            );
            if (!match) {
              console.log(
                `Account "${opts.accountId}" not found under ${inst.name}. ` +
                `Run: npm run cli -- accounts sync --institution ${inst.name}`,
              );
              continue;
            }
            accountsToSync = [{ name: match.accountName, accountId: match.accountId }];
          } else {
            const dbAccounts = listAccounts(db).filter(a => a.institutionName === inst.name);
            if (dbAccounts.length === 0) {
              console.log(
                `No accounts found for ${inst.name}. ` +
                `Run: npm run cli -- accounts sync --institution ${inst.name}`,
              );
              continue;
            }
            accountsToSync = dbAccounts.map(a => ({ name: a.accountName, accountId: a.accountId }));
          }

          for (const account of accountsToSync) {
            try {
              const txs = await fetchTransactions(
                page, inst.name, account, lookbackDays, sessionDir,
              );
              const newTxs = saveTransactions(db, inst.name, account.accountId, txs);
              if (newTxs.length === 0) {
                console.log(`  (no new transactions for ${account.name})`);
              } else {
                console.log(`  ✓ ${newTxs.length} new transaction(s) for ${account.name}:`);
                printNewTransactionsTable(newTxs);
              }
            } catch (err) {
              console.error(
                `  ❌ Transactions failed for ${account.name}: ` +
                `${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }
      } catch (err) {
        console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        close();
        await prompt('\nPress Enter to close... ');
        await context.close();
      }
    });

  cmd
    .command('list')
    .description('List recent transactions')
    .option('-i, --institution <name>', 'Filter by institution name')
    .option('-a, --account <name>', 'Filter by account name')
    .option('--days <n>', 'Number of past days to show (default: 30)', '30')
    .option('--demo', 'Hide sensitive data')
    .action((opts: { institution?: string; account?: string; days: string; demo: boolean }) => {
      const days = Math.max(1, parseInt(opts.days, 10) || 30);
      const { db, close } = openDb();
      try {
        const rows = listTransactions(db, {
          institutionName: opts.institution,
          accountName:     opts.account,
          days,
        });
        printTransactionsTable(rows, { demo: opts.demo ?? false });
      } finally {
        close();
      }
    });

  return cmd;
}
