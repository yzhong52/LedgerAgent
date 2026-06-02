import { Command } from 'commander';
import { openDb } from '../db';
import {
  listAccounts, mergeAccounts, deleteAccount, listBalances,
  type AccountRow, type AccountSyncDiff,
} from '../db/storage';
import { promptConfirm, printAccountsTable, formatCents, selectFromList } from './utils';

function accountLabels(
  rows: AccountRow[],
  { showInstitution }: { showInstitution: boolean },
): { header: string; labels: string[] } {
  const items = rows.map(row => {
    const bal = row.amountCents != null ? formatCents(row.amountCents) : '—';
    return {
      institution: row.institutionName,
      name:        row.accountName,
      id:          row.accountId,
      type:        row.accountType ?? '—',
      category:    row.accountCategory ?? '—',
      balance:     row.accountCurrency && bal !== '—' ? `${row.accountCurrency} ${bal}` : bal,
      updated:     row.latestDate,
    };
  });
  const w = {
    institution: showInstitution ? Math.max('Institution'.length, ...items.map(i => i.institution.length)) : 0,
    name:        Math.max('Account'.length,     ...items.map(i => i.name.length)),
    id:          Math.max('ID'.length, ...items.map(i => i.id.length)),
    type:        Math.max('Type'.length,        ...items.map(i => i.type.length)),
    category:    Math.max('Category'.length,    ...items.map(i => i.category.length)),
    balance:     Math.max('Balance'.length,     ...items.map(i => i.balance.length)),
    updated:     Math.max('Last Updated'.length,...items.map(i => i.updated.length)),
  };
  const header = [
    showInstitution ? 'Institution'.padEnd(w.institution) : null,
    'Account'.padEnd(w.name),
    'ID'.padEnd(w.id),
    'Type'.padEnd(w.type),
    'Category'.padEnd(w.category),
    'Balance'.padStart(w.balance),
    'Last Updated'.padEnd(w.updated),
  ].filter(Boolean).join('  ');
  const labels = items.map(i => [
    showInstitution ? i.institution.padEnd(w.institution) : null,
    i.name.padEnd(w.name),
    i.id.padEnd(w.id),
    i.type.padEnd(w.type),
    i.category.padEnd(w.category),
    i.balance.padStart(w.balance),
    i.updated.padEnd(w.updated),
  ].filter(Boolean).join('  '));
  return { header, labels };
}

function printAccountSyncDiff(
  institutionName: string,
  diff: AccountSyncDiff,
  opts: { demo: boolean },
): void {
  if (diff.added.length > 0) {
    console.log(`  + ${diff.added.length} new account(s) discovered:`);
    printAccountsTable(diff.added.map(a => ({
      institution: institutionName,
      account:     a.name,
      accountId:   a.accountId,
      type:        a.type ?? '—',
      currency:    a.currency ?? undefined,
      balance:     a.balance != null ? formatCents(Math.round(a.balance * 100)) : '—',
      lastUpdated: '—',
    })), { demo: opts.demo, showInstitution: false });
  }
  if (diff.updated.length > 0) {
    console.log(`  ~ ${diff.updated.length} account(s) updated:`);
    for (const { account, changes } of diff.updated)
      console.log(`      ${account.name}: ${changes.join(', ')}`);
    console.log();
  }
  if (diff.missing.length > 0) {
    console.log(`  - ${diff.missing.length} account(s) no longer found`);
    console.log(`    (kept for historical records; delete manually if desired)`);
    for (const a of diff.missing) console.log(`      ${a.accountName}`);
    console.log();
  }
  if (diff.added.length === 0 && diff.updated.length === 0 && diff.missing.length === 0) {
    console.log(`  (no changes for ${institutionName})`);
  }
}

export function printAccountSyncResult(
  institutionName: string,
  diff: AccountSyncDiff,
  allAccounts: AccountRow[],
  opts: { demo: boolean },
): void {
  printAccountSyncDiff(institutionName, diff, opts);
  if (allAccounts.length > 0) {
    console.log(`  Current accounts for ${institutionName}:`);
    printAccountsTable(allAccounts.map(row => ({
      institution: row.institutionName,
      account:     row.accountName,
      accountId:   row.accountId !== row.accountName ? row.accountId : undefined,
      type:        row.accountType ?? '—',
      category:    row.accountCategory ?? undefined,
      currency:    row.accountCurrency ?? undefined,
      balance:     row.amountCents != null ? formatCents(row.amountCents) : '—',
      lastUpdated: row.latestDate,
    })), { demo: opts.demo, showInstitution: false });
  }
}

export function makeAccountsCommand(): Command {
  const cmd = new Command('accounts').description('Sync and view account data');

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

        const entries = rows.map(row => ({
          institution: row.institutionName,
          account:     row.accountName,
          accountId:   row.accountId !== row.accountName ? row.accountId : undefined,
          type:        row.accountType ?? '—',
          category:    row.accountCategory ?? undefined,
          currency:    row.accountCurrency ?? undefined,
          balance:     row.amountCents != null ? formatCents(row.amountCents) : '—',
          lastUpdated: row.latestDate,
        }));
        printAccountsTable(entries, { demo: opts.demo, showInstitution: true });
      } finally {
        close();
      }
    });

  cmd
    .command('merge')
    .description('Merge one account into another, combining their history. Balances, transactions, and holdings are re-parented to the target; duplicates (same date for balances/holdings, same transactionId for transactions) are dropped in favour of the target\'s existing data. The source account is then permanently deleted.')
    .action(async () => {
      const { db, close } = openDb();
      try {
        const rows = listAccounts(db);
        if (rows.length < 2) {
          console.log('Need at least two accounts to merge.');
          return;
        }

        const { header: srcHeader, labels: srcLabels } = accountLabels(
          rows,
          { showInstitution: true },
        );
        const srcIdx = await selectFromList(
          srcLabels,
          'Choose an account to merge from (will be deleted):',
          new Set(),
          srcHeader,
        );

        const src = rows[srcIdx];
        const tgtRows = rows.filter(
          (r, i) => i !== srcIdx && r.institutionName === src.institutionName,
        );
        if (tgtRows.length === 0) {
          console.log(
            `  No other accounts found under ${src.institutionName}. Nothing to merge into.`,
          );
          return;
        }

        // Insert source into the display list at its natural sorted position so the user
        // can see it alongside candidates. It is dimmed and skipped during navigation.
        const allRows = [...tgtRows, src].sort((a, b) =>
          a.accountName.localeCompare(b.accountName),
        );
        const srcDisplayIdx = allRows.indexOf(src);
        const { header: tgtHeader, labels: tgtLabels } = accountLabels(
          allRows,
          { showInstitution: false },
        );
        const displayLabels = tgtLabels.map(
          (label, i) => i === srcDisplayIdx ? `${label}  ← merging from this` : label,
        );
        const skipIndices = new Set([srcDisplayIdx]);

        const displayIdx = await selectFromList(
          displayLabels,
          `Choose an account from ${src.institutionName} to merge into:`,
          skipIndices,
          tgtHeader,
        );
        const tgt = allRows[displayIdx];
        console.log(`  Merge "${src.accountName}" (${src.institutionName})`);
        console.log(`    into "${tgt.accountName}" (${tgt.institutionName})?`);
        console.log(`  Balances, transactions, and holdings will be re-parented to the target.`);
        console.log(`  Duplicates (same date or transaction ID) keep the target's existing data.`);
        console.log(`  The source account will be permanently deleted.`);
        console.log();
        if (!await promptConfirm('  Confirm (y/N): ')) {
          console.log('  Aborted.');
          return;
        }

        mergeAccounts(db, src.id, tgt.id);
        console.log(`  Done. "${src.accountName}" merged into "${tgt.accountName}".`);
      } finally {
        close();
      }
    });

  cmd
    .command('checkpoints')
    .description('Show the full balance history for a selected account')
    .action(async () => {
      const { db, close } = openDb();
      try {
        const rows = listAccounts(db);
        if (rows.length === 0) {
          console.log('No accounts found. Run: npm run cli -- sync');
          return;
        }

        const { header, labels } = accountLabels(rows, { showInstitution: true });
        const idx = await selectFromList(labels, 'Choose an account:', new Set(), header);
        const account = rows[idx];
        const checkpoints = listBalances(db, account.id);

        if (checkpoints.length === 0) {
          console.log(`  No balance history found for "${account.accountName}".`);
          return;
        }

        console.log(`\n  Balance history for ${account.accountName} (${account.institutionName}):\n`);

        const currency = account.accountCurrency;
        const rows2 = checkpoints.map((cp, i) => {
          const prev = checkpoints[i + 1];
          let change = '';
          if (prev?.amountCents != null && cp.amountCents != null) {
            const delta = cp.amountCents - prev.amountCents;
            const sign = delta >= 0 ? '+' : '';
            change = `${sign}${formatCents(delta)}`;
          }
          const bal = cp.amountCents != null
            ? (currency ? `${currency} ${formatCents(cp.amountCents)}` : formatCents(cp.amountCents))
            : '—';
          return { date: cp.date, balance: bal, change };
        });

        const wDate    = Math.max('Date'.length,    ...rows2.map(r => r.date.length));
        const wBalance = Math.max('Balance'.length,  ...rows2.map(r => r.balance.length));
        const wChange  = Math.max('Change'.length,   ...rows2.map(r => r.change.length));

        const fmt = (date: string, balance: string, change: string) =>
          `  ${date.padEnd(wDate)}  ${balance.padStart(wBalance)}  ${change.padStart(wChange)}`;

        console.log(fmt('Date', 'Balance', 'Change'));
        console.log(fmt('-'.repeat(wDate), '-'.repeat(wBalance), '-'.repeat(wChange)));
        for (const r of rows2) console.log(fmt(r.date, r.balance, r.change));
        console.log();
      } finally {
        close();
      }
    });

  cmd
    .command('delete')
    .description('Permanently delete an account and all its history (balances, transactions, holdings)')
    .action(async () => {
      const { db, close } = openDb();
      try {
        const rows = listAccounts(db);
        if (rows.length === 0) {
          console.log('No accounts found.');
          return;
        }

        const { header, labels } = accountLabels(rows, { showInstitution: true });
        const idx = await selectFromList(labels, 'Choose an account to delete:', new Set(), header);
        const account = rows[idx];

        console.log(`  Delete "${account.accountName}" (${account.institutionName})?`);
        console.log(`  All balances, transactions, and holdings for this account will be permanently deleted.`);
        console.log();
        if (!await promptConfirm('  Confirm (y/N): ')) {
          console.log('  Aborted.');
          return;
        }

        deleteAccount(db, account.id);
        console.log(`  Done. "${account.accountName}" deleted.`);
      } finally {
        close();
      }
    });

  return cmd;
}
