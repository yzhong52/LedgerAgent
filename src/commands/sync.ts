import { Command } from 'commander';
import { login } from '../tasks/login';
import { exploreAccounts, type AccountType } from '../tasks/accounts';
import { exploreHoldings } from '../tasks/holdings';
import { fetchTransactions } from '../tasks/transactions';
import { createSession } from '../agent';
import { keychainLoad } from '../keychain';
import { openDb } from '../db';
import { saveSync, saveHoldings, saveTransactions, listAccounts } from '../db/storage';
import { prompt, readInstitutions, launchBrowser, printHoldingsTable, selectFromList, confirm } from './utils';
import { printAccountSyncResult } from './accounts';
import { printTransactionSyncResult } from './transactions';

export function makeSyncCommand(): Command {
  return new Command('sync')
    .description('Sync accounts and transactions for all institutions (login once per institution)')
    .option('-i, --institution <name>', 'Only sync this institution (case-insensitive)')
    .option('--all', 'Sync all institutions non-interactively')
    .option('--days <n>', 'Number of days of transaction history to fetch (default: 30)', '30')
    .option('--accountId <id>', 'Only sync this account ID for transactions (requires --institution)')
    .option('--skip-accounts', 'Skip account discovery; only fetch transactions')
    .option('--skip-holdings', 'Skip holdings fetch after account discovery')
    .option('--skip-transactions', 'Skip transaction fetch; only sync accounts')
    .option('-v, --verbose', 'Show accessibility snapshots in the terminal')
    .option('--demo', 'Hide sensitive data by randomizing balances and account numbers')
    .option('--model <id>', 'Claude model ID to use (overrides the default)', 'claude-haiku-4-5-20251001')
    .action(async (opts: {
      institution?: string;
      all?: boolean;
      days: string;
      accountId?: string;
      skipAccounts: boolean;
      skipHoldings: boolean;
      skipTransactions: boolean;
      verbose: boolean;
      demo: boolean;
      model: string;
    }) => {
      if (opts.accountId && !opts.institution) {
        console.log('--accountId requires --institution.');
        return;
      }

      if (opts.verbose) process.env.VERBOSE = '1';
      const lookbackDays = Math.max(1, parseInt(opts.days, 10) || 30);

      let institutions = await readInstitutions();
      if (institutions.length === 0) {
        console.log('No institutions saved. Run: npm run cli -- institution add');
        return;
      }

      const interactive = !opts.all && !opts.institution && !opts.accountId;
      if (interactive) {
        const choices = ['All', ...institutions.map(i => i.name)];
        const idx = await selectFromList(choices, 'Choose an institution to sync:');
        if (idx > 0) institutions = [institutions[idx - 1]];
        opts.skipTransactions = !(await confirm('Sync transactions?'));
        opts.skipHoldings = !(await confirm('Sync holdings?'));
      } else if (opts.institution) {
        const filter = opts.institution.toLowerCase();
        institutions = institutions.filter(i => i.name.toLowerCase() === filter);
        if (institutions.length === 0) {
          console.log(`No institution named "${opts.institution}". Run: npm run cli -- institution add`);
          return;
        }
      }

      const { db, close } = openDb();
      const context = await launchBrowser();
      try {
        const page = context.pages()[0] ?? await context.newPage();
        for (const inst of institutions) {
          const password = keychainLoad(inst.name, inst.username);
          if (!password) {
            console.warn(`No password found in Keychain for ${inst.name} (${inst.username}), skipping.`);
            continue;
          }

          console.log(`\n🤖 Syncing ${inst.name}... ⏳`);
          const sessionDir = await createSession(inst.url);
          await login(page, inst.url, { username: inst.username, password }, inst.name, sessionDir, opts.model);

          if (!opts.skipAccounts) {
            // --- Accounts ---
            console.log(`\n  📋 Accounts`);
            const existingAccounts = listAccounts(db)
              .filter(a => a.institutionName === inst.name)
              .map(a => {
                // accountId falls back to name when no real ID was found; omit the hint if so
                const accountId = a.accountId !== a.accountName ? a.accountId : undefined;
                return {
                  name: a.accountName,
                  accountId,
                  type: (a.accountType ?? undefined) as AccountType | undefined,
                  currency: a.accountCurrency ?? undefined,
                };
              });

            const accounts = await exploreAccounts(page, inst.name, sessionDir, existingAccounts, opts.model);
            const diff = saveSync(db, inst.name, inst.url, accounts);
            const allSyncedAccounts = listAccounts(db).filter(a => a.institutionName === inst.name);
            printAccountSyncResult(inst.name, diff, allSyncedAccounts, { demo: opts.demo });

            if (!opts.skipHoldings) {
              const investmentAccounts = accounts.filter(
                a => a.category === 'Brokerage' || a.category === 'Managed Investment',
              );
              for (const account of investmentAccounts) {
                const row = allSyncedAccounts.find(
                  r => r.accountId === (account.accountId ?? account.name),
                );
                if (!row) continue;
                const holdings = await exploreHoldings(page, inst.name, account, sessionDir, opts.model);
                saveHoldings(db, row.id, holdings);
                console.log(`  Holdings for ${account.name}:`);
                printHoldingsTable(holdings);
              }
            }
          }

          if (!opts.skipTransactions) {
            // --- Transactions ---
            console.log(`\n  💳 Transactions (last ${lookbackDays} days)`);

            let accountsToSync: { name: string; accountId: string }[];
            if (opts.accountId) {
              const match = listAccounts(db).find(
                a => a.institutionName === inst.name && a.accountId.endsWith(opts.accountId!),
              );
              if (!match) {
                console.log(
                  `Account "${opts.accountId}" not found under ${inst.name}. ` +
                  `Run: npm run cli -- sync --institution ${inst.name}`,
                );
                continue;
              }
              accountsToSync = [{ name: match.accountName, accountId: match.accountId }];
            } else {
              const dbAccounts = listAccounts(db).filter(a => a.institutionName === inst.name);
              if (dbAccounts.length === 0) {
                console.log(
                  `No accounts found for ${inst.name}. ` +
                  `Run: npm run cli -- sync --institution ${inst.name}`,
                );
                continue;
              }
              accountsToSync = dbAccounts.map(a => ({ name: a.accountName, accountId: a.accountId }));
            }

            for (const account of accountsToSync) {
              try {
                const txs = await fetchTransactions(
                  page, inst.name,
                  { name: account.name, accountId: account.accountId },
                  lookbackDays, sessionDir, opts.model,
                );
                const newTxs = saveTransactions(db, inst.name, account.accountId, txs);
                printTransactionSyncResult(account.name, newTxs, txs.length);
              } catch (err) {
                console.error(
                  `  ❌ Transactions failed for ${account.name}: ` +
                  `${err instanceof Error ? err.message : String(err)}`,
                );
              }
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
}
