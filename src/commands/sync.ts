import * as path from 'path';
import { Command } from 'commander';
import { login } from '../tasks/login';
import { exploreAccounts, type ExistingAccountHint } from '../tasks/accounts';
import { exploreHoldings } from '../tasks/holdings';
import { fetchTransactions } from '../tasks/transactions';
import { createSession } from '../agent';
import { keychainLoad } from '../keychain';
import { openDb, DATA_DIR } from '../db';
import { saveSync, saveHoldings, saveTransactions, listAccounts } from '../db/storage';
import {
  prompt, readInstitutions, launchBrowser, printHoldingsTable, selectFromList, confirm,
  type Institution,
} from './utils';
import { printAccountSyncResult } from './accounts';
import { printTransactionSyncResult } from './transactions';
import { DEFAULT_MODEL } from '../agent/model_providers';

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
    .option('--model <id>', 'Model ID to use — Claude (claude-*) or Ollama (e.g. qwen2.5-coder:14b-instruct-q8_0)', DEFAULT_MODEL)
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

      const syncInstitution = async (inst: Institution) => {
        const password = keychainLoad(inst.name, inst.username);
        if (!password) {
          console.warn(`No password found in Keychain for ${inst.name} (${inst.username}), skipping.`);
          return;
        }

        const slug = inst.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const profileDir = path.join(DATA_DIR, `browser-profile-${slug}`);
        const context = await launchBrowser(profileDir);
        try {
          const page = context.pages()[0] ?? await context.newPage();

          console.log(`\n🤖 Syncing ${inst.name}... ⏳`);
          const sessionDir = await createSession(inst.name);
          const loggedIn = await login(
            page,
            inst.url,
            { username: inst.username, password },
            inst.name,
            sessionDir,
            opts.model,
          );

          if (!loggedIn) {
            console.log(`\n⚠️ Login aborted for ${inst.name} — skipping sync.`);
            return;
          }

          if (!opts.skipAccounts) {
            // --- Accounts ---
            console.log(`\n  📋 Accounts`);
            const existingAccounts: ExistingAccountHint[] = listAccounts(db)
              .filter(a => a.institutionName === inst.name)
              .map(a => ({
                dbId: a.id,
                name: a.accountName,
                // institutionAccountId falls back to name when no real ID was found; omit if so
                institutionAccountId: a.accountId !== a.accountName ? a.accountId : undefined,
              }));

            const accounts = await exploreAccounts(
              page,
              inst.name,
              sessionDir,
              existingAccounts,
              opts.model,
            );
            const diff = saveSync(db, inst.name, inst.url, accounts);
            const allSyncedAccounts = listAccounts(db).filter(
              a => a.institutionName === inst.name,
            );
            printAccountSyncResult(inst.name, diff, allSyncedAccounts, { demo: opts.demo });

            if (!opts.skipHoldings) {
              const investmentAccounts = accounts.filter(
                a =>
                  a.category === 'Self-Directed Investing' ||
                  a.category === 'Managed Investing' ||
                  // Legacy category names:
                  a.category === 'Brokerage' ||
                  a.category === 'Managed Investment',
              );
              for (const account of investmentAccounts) {
                const row = allSyncedAccounts.find(
                  r => r.accountId === (account.accountId ?? account.name),
                );
                if (!row) continue;
                const holdings = await exploreHoldings(
                  page,
                  inst.name,
                  account,
                  sessionDir,
                  opts.model,
                );
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
                return;
              }
              accountsToSync = [{ name: match.accountName, accountId: match.accountId }];
            } else {
              const dbAccounts = listAccounts(db).filter(a => a.institutionName === inst.name);
              if (dbAccounts.length === 0) {
                console.log(
                  `No accounts found for ${inst.name}. ` +
                  `Run: npm run cli -- sync --institution ${inst.name}`,
                );
                return;
              }
              accountsToSync = dbAccounts.map(a => ({
                name: a.accountName,
                accountId: a.accountId,
              }));
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
        } finally {
          await context.close();
        }
      };

      try {
        for (const inst of institutions) {
          try {
            await syncInstitution(inst);
          } catch (err) {
            console.error(
              `\n❌ ${inst.name}: ` +
              `${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } finally {
        close();
        await prompt('\nPress Enter to close... ');
      }
    });
}
