import { Command } from 'commander';
import { openDb } from '../db';
import { listAccounts } from '../db/storage';
import { printAccountsTable, formatCents } from './utils';

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

        const entries = rows.map(row => {
          const dbIdPart = row.accountId.split('/').slice(1).join('/');
          return {
            institution: row.institutionName,
            account:     row.accountName,
            accountId:   dbIdPart !== row.accountName ? dbIdPart : undefined,
            type:        row.accountType ?? '—',
            currency:    row.accountCurrency ?? undefined,
            balance:     row.amountCents != null ? formatCents(row.amountCents) : '—',
          };
        });
        printAccountsTable(entries, { demo: opts.demo, showInstitution: true });
      } finally {
        close();
      }
    });

  return cmd;
}
