import * as fs from 'fs/promises';
import { Command } from 'commander';
import { chromium } from 'playwright';
import { login } from '../tasks/login';
import { exploreAccounts } from '../tasks/accounts';
import { keychainLoad } from '../keychain';
import { openDb } from '../db';
import { saveSync } from '../db/storage';
import { prompt, readInstitutions, printAccountsTable, PROFILE_DIR } from './utils';

export function makeSyncCommand(): Command {
  return new Command('sync')
    .description('Login to all saved institutions and sync accounts')
    .option(
      '-i, --institution <name>',
      'Only sync the institution with this name (case-insensitive)',
    )
    .option('-v, --verbose', 'Show accessibility snapshots in the terminal')
    .action(async (opts: { institution?: string; verbose?: boolean }) => {
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

      await fs.mkdir(PROFILE_DIR, { recursive: true });

      const { db, close } = openDb();
      const context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        channel: 'chrome',
        args: ['--disable-blink-features=AutomationControlled'],
      });

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

          console.log(`\n🤖 Syncing ${inst.name}...`);
          await login(page, inst.url, { username: inst.username, password }, inst.name);

          const accounts = await exploreAccounts(page, inst.name);
          saveSync(db, inst.name, inst.url, accounts);

          console.log(`\n${inst.name} accounts:`);
          printAccountsTable(accounts.map(a => ({
            account: a.name,
            type:    a.type ?? '—',
            balance: a.balance ?? '—',
          })));
        }
      } finally {
        close();
        await prompt('\nPress Enter to close... ');
        await context.close();
      }
    });
}
