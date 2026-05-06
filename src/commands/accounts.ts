import { Command } from 'commander';
import { openDb } from '../db';
import { listAccounts } from '../db/storage';
import { printAccountsTable } from './utils';

export function makeAccountsCommand(): Command {
  const cmd = new Command('accounts').description('View stored account data');

  cmd
    .command('list')
    .description('List all accounts and their latest balances')
    .option('--demo', 'Hide sensitive data by randomizing balances and account numbers')
    .action((opts: { demo: boolean }) => {
      const { db, close } = openDb();
      try {
        const rows = listAccounts(db);
        if (rows.length === 0) {
          console.log('No accounts found. Run: npm run cli -- sync');
          return;
        }

        printAccountsTable(rows.map(row => ({
          institution: row.institutionName,
          account:     row.accountName,
          type:        row.accountType ?? '—',
          balance:     row.amountCents != null
            ? `$${(row.amountCents / 100).toLocaleString('en-CA', { minimumFractionDigits: 2 })}`
            : '—',
        })), opts.demo);
      } finally {
        close();
      }
    });

  return cmd;
}
