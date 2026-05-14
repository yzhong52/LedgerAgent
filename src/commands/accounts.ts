import { Command } from 'commander';
import { login } from '../tasks/login';
import { exploreAccounts, type AccountType } from '../tasks/accounts';
import { exploreHoldings } from '../tasks/holdings';
import { createSession } from '../agent';
import { keychainLoad } from '../keychain';
import { openDb } from '../db';
import { saveSync, saveHoldings, listAccounts, mergeAccounts, type AccountRow, type AccountSyncDiff } from '../db/storage';
import { prompt, readInstitutions, printAccountsTable, printHoldingsTable, formatCents, selectFromList, launchBrowser } from './utils';

function accountLabels(rows: AccountRow[], { showInstitution }: { showInstitution: boolean }): string[] {
  const items = rows.map(row => {
    const bal = row.amountCents != null ? formatCents(row.amountCents) : '—';
    return {
      institution: row.institutionName,
      name:        row.accountName,
      type:        row.accountType ?? '—',
      balance:     row.accountCurrency && bal !== '—' ? `${row.accountCurrency} ${bal}` : bal,
    };
  });
  const w = {
    institution: showInstitution ? Math.max(...items.map(i => i.institution.length)) : 0,
    name:        Math.max(...items.map(i => i.name.length)),
    type:        Math.max(...items.map(i => i.type.length)),
    balance:     Math.max(...items.map(i => i.balance.length)),
  };
  return items.map(i => [
    showInstitution ? i.institution.padEnd(w.institution) : null,
    i.name.padEnd(w.name),
    i.type.padEnd(w.type),
    i.balance.padStart(w.balance),
  ].filter(Boolean).join('  '));
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
    })), { demo: opts.demo, showInstitution: false });
  }
}

export function makeAccountsCommand(): Command {
  const cmd = new Command('accounts').description('Sync and view account data');

  cmd
    .command('sync')
    .description('Login and sync all accounts and balances')
    .option('-i, --institution <name>', 'Only sync this institution (case-insensitive)')
    .option('-v, --verbose', 'Show accessibility snapshots in the terminal')
    .option('--demo', 'Hide sensitive data by randomizing balances and account numbers')
    .action(async (opts: { institution?: string; verbose: boolean; demo: boolean }) => {
      if (opts.verbose) process.env.VERBOSE = '1';
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

          console.log(`\n🤖 Syncing ${inst.name}... ⏳`);
          const sessionDir = await createSession(inst.url);
          await login(page, inst.url, { username: inst.username, password }, inst.name, sessionDir);

          const existingAccountsMsg = listAccounts(db)
            .filter(a => a.institutionName === inst.name)
            .map(a => {
              const accountId = a.accountId !== a.accountName ? a.accountId : undefined;
              return {
                name: a.accountName,
                accountId,
                type: (a.accountType ?? undefined) as AccountType | undefined,
                currency: a.accountCurrency ?? undefined,
              };
            });

          const accounts = await exploreAccounts(page, inst.name, sessionDir, existingAccountsMsg);
          const diff: AccountSyncDiff = saveSync(db, inst.name, inst.url, accounts);

          const allSyncedAccounts = listAccounts(db).filter(a => a.institutionName === inst.name);
          const investmentAccounts = accounts.filter(
            a => a.category === 'Brokerage' || a.category === 'Managed Investment',
          );
          for (const account of investmentAccounts) {
            const row = allSyncedAccounts.find(
              r => r.accountId === (account.accountId ?? account.name),
            );
            if (!row) continue;
            const holdings = await exploreHoldings(page, inst.name, account, sessionDir);
            saveHoldings(db, row.id, holdings);
            console.log(`  Holdings for ${account.name}:`);
            printHoldingsTable(holdings);
          }

          console.log();
          printAccountSyncResult(
            inst.name, diff,
            allSyncedAccounts,
            { demo: opts.demo },
          );
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
    .description('List all accounts and their latest balances')
    .option('--demo', 'Hide sensitive data by randomizing balances and account numbers')
    .action((opts: { demo: boolean }) => {
      const { db, close } = openDb();
      try {
        const rows = listAccounts(db);
        if (rows.length === 0) {
          console.log('No accounts found. Run: npm run cli -- accounts sync');
          return;
        }

        const entries = rows.map(row => ({
          institution: row.institutionName,
          account:     row.accountName,
          accountId:   row.accountId !== row.accountName ? row.accountId : undefined,
          type:        row.accountType ?? '—',
          currency:    row.accountCurrency ?? undefined,
          balance:     row.amountCents != null ? formatCents(row.amountCents) : '—',
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

        const srcIdx = await selectFromList(
          accountLabels(rows, { showInstitution: true }),
          'Source account to merge FROM (will be deleted):',
        );

        const src = rows[srcIdx];
        const tgtRows = rows.filter((r, i) => i !== srcIdx && r.institutionName === src.institutionName);
        if (tgtRows.length === 0) {
          console.log(`  No other accounts found under ${src.institutionName}. Nothing to merge into.`);
          return;
        }
        const tgtIdx = await selectFromList(
          accountLabels(tgtRows, { showInstitution: true }),
          'Target account to merge INTO:',
        );

        const tgt = tgtRows[tgtIdx];
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
