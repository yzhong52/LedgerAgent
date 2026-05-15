import { Command } from 'commander';
import { openDb } from '../db';
import { listAccounts, mergeAccounts, type AccountRow, type AccountSyncDiff } from '../db/storage';
import { prompt, printAccountsTable, formatCents, selectFromList } from './utils';

function accountLabels(
  rows: AccountRow[],
  { showInstitution }: { showInstitution: boolean },
): { header: string; labels: string[] } {
  const items = rows.map(row => {
    const bal = row.amountCents != null ? formatCents(row.amountCents) : '—';
    return {
      institution: row.institutionName,
      name:        row.accountName,
      type:        row.accountType ?? '—',
      category:    row.accountCategory ?? '—',
      balance:     row.accountCurrency && bal !== '—' ? `${row.accountCurrency} ${bal}` : bal,
      updated:     row.latestDate,
    };
  });
  const w = {
    institution: showInstitution ? Math.max('Institution'.length, ...items.map(i => i.institution.length)) : 0,
    name:        Math.max('Account'.length,     ...items.map(i => i.name.length)),
    type:        Math.max('Type'.length,        ...items.map(i => i.type.length)),
    category:    Math.max('Category'.length,    ...items.map(i => i.category.length)),
    balance:     Math.max('Balance'.length,     ...items.map(i => i.balance.length)),
    updated:     Math.max('Last Updated'.length,...items.map(i => i.updated.length)),
  };
  const header = [
    showInstitution ? 'Institution'.padEnd(w.institution) : null,
    'Account'.padEnd(w.name),
    'Type'.padEnd(w.type),
    'Category'.padEnd(w.category),
    'Balance'.padStart(w.balance),
    'Last Updated'.padEnd(w.updated),
  ].filter(Boolean).join('  ');
  const labels = items.map(i => [
    showInstitution ? i.institution.padEnd(w.institution) : null,
    i.name.padEnd(w.name),
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

        const { header: srcHeader, labels: srcLabels } = accountLabels(rows, { showInstitution: true });
        const srcIdx = await selectFromList(
          srcLabels,
          'Choose an account to merge from (will be deleted):',
          new Set(),
          srcHeader,
        );

        const src = rows[srcIdx];
        const tgtRows = rows.filter((r, i) => i !== srcIdx && r.institutionName === src.institutionName);
        if (tgtRows.length === 0) {
          console.log(`  No other accounts found under ${src.institutionName}. Nothing to merge into.`);
          return;
        }

        // Insert source into the display list at its natural sorted position so the user
        // can see it alongside candidates. It is dimmed and skipped during navigation.
        const allRows = [...tgtRows, src].sort((a, b) => a.accountName.localeCompare(b.accountName));
        const srcDisplayIdx = allRows.indexOf(src);
        const { header: tgtHeader, labels: tgtLabels } = accountLabels(allRows, { showInstitution: false });
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
        const confirm = await prompt('  Confirm (y/N): ');
        if (confirm.trim().toLowerCase() !== 'y') {
          console.log('  Aborted.');
          return;
        }

        mergeAccounts(db, src.id, tgt.id);
        console.log(`  Done. "${src.accountName}" merged into "${tgt.accountName}".`);
      } finally {
        close();
      }
    });

  return cmd;
}
