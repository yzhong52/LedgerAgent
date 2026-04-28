import { Command } from 'commander';
import { chromium } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { login } from './tasks/login';
import { findAccounts } from './tasks/accounts';
import { keychainSave, keychainLoad } from './keychain';
import { openDb, DATA_DIR } from './db';
import { saveSync } from './storage';
import { loadConfig, saveConfig } from './config';

interface Institution {
  name: string;
  url: string;
  username: string;
}

const INSTITUTIONS_FILE = path.join(DATA_DIR, 'accounts.json');
const PROFILE_DIR       = process.env.OPENVAULT_PROFILE_DIR ?? path.join(DATA_DIR, 'browser-profile');

async function readInstitutions(): Promise<Institution[]> {
  try {
    return JSON.parse(await fs.readFile(INSTITUTIONS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

async function writeInstitutions(institutions: Institution[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INSTITUTIONS_FILE, JSON.stringify(institutions, null, 2) + '\n');
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

function promptPassword(question: string): Promise<string> {
  process.stdout.write(question);
  process.stdin.setRawMode?.(true);
  return new Promise(resolve => {
    let value = '';
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', function handler(ch) {
      const char = ch.toString();
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(value);
      } else if (char === '') {
        process.exit();
      } else if (char === '') {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    });
  });
}

const program = new Command();

program
  .name('openvault')
  .description('Agentic financial data aggregator');

const institution = program.command('institution').description('Manage saved institutions');

institution
  .command('add')
  .description('Add a new institution and save credentials to Keychain')
  .action(async () => {
    const name     = await prompt('Institution name (e.g. Wealthsimple): ');
    const url      = await prompt('Login URL: ');
    const username = await prompt('Username or email: ');
    const password = await promptPassword('Password: ');

    const institutions = await readInstitutions();
    const existing = institutions.findIndex(i => i.name === name && i.username === username);
    if (existing >= 0) {
      institutions[existing] = { name, url, username };
    } else {
      institutions.push({ name, url, username });
    }

    await writeInstitutions(institutions);
    keychainSave(name, username, password);
    console.log(`Saved ${name} (${username})`);
  });

program
  .command('sync')
  .description('Login to all saved institutions and print accounts')
  .option('-i, --institution <name>', 'Only sync the institution with this name (case-insensitive)')
  .action(async (opts: { institution?: string }) => {
    let institutions = await readInstitutions();
    if (opts.institution) {
      const filter = opts.institution.toLowerCase();
      institutions = institutions.filter(i => i.name.toLowerCase() === filter);
      if (institutions.length === 0) {
        console.log(`No institution named "${opts.institution}". Run: npm run cli institution add`);
        return;
      }
    }
    if (institutions.length === 0) {
      console.log('No institutions saved. Run: npm run cli institution add');
      return;
    }

    await fs.mkdir(PROFILE_DIR, { recursive: true });

    const { db, close } = openDb();
    const context = await chromium.launchPersistentContext(
      PROFILE_DIR,
      {
        headless: false,
        channel: 'chrome',
        args: ['--disable-blink-features=AutomationControlled'],
      },
    );

    try {
      const page = context.pages()[0] ?? await context.newPage();

      for (const inst of institutions) {
        const password = keychainLoad(inst.name, inst.username);
        if (!password) {
          console.warn(`No password found in Keychain for ${inst.name} (${inst.username}), skipping.`);
          continue;
        }

        console.log(`\nSyncing ${inst.name}...`);
        await login(page, inst.url, { username: inst.username, password }, inst.name);

        const accounts = await findAccounts(page);
        saveSync(db, inst.name, inst.url, accounts);

        console.log(`\n${inst.name} accounts:`);
        for (const account of accounts) {
          const parts = [account.name, account.type, account.balance].filter(Boolean);
          console.log(' ', parts.join(' — '));
        }
      }
    } finally {
      close();
      await prompt('\nPress Enter to close... ');
      await context.close();
    }
  });

const config = program.command('config').description('Manage OpenVault configuration');

config
  .command('gmail')
  .description('Save Gmail credentials for MFA email reading')
  .action(async () => {
    console.log(`
OpenVault can read MFA codes sent to your Gmail automatically, so you don't
have to copy-paste them during sync.

This requires a Gmail App Password — a 16-character code that lets OpenVault
read your email without needing your Google account password.

How to generate one:
  1. Go to https://myaccount.google.com/apppasswords
  2. Sign in and click "Create a new app password"
  3. Name it "OpenVault", click Create
  4. Copy the 16-character password shown (no spaces)

More info: faq/how_to_config_gmail_for_mfa.md
`);
    const existing = await loadConfig();
    const existingEmail = existing.gmailAddress ?? '';

    const emailInput = await prompt(
      existingEmail ? `Gmail address [${existingEmail}]: ` : 'Gmail address: ',
    );
    const newEmail = emailInput.trim() || existingEmail;

    // Look up the stored password for whichever email was chosen
    const existingPassword = newEmail ? (keychainLoad('gmail', newEmail) ?? '') : '';
    const maskedPassword = existingPassword.length >= 2
      ? existingPassword[0] + '*'.repeat(existingPassword.length - 2) + existingPassword.at(-1)
      : existingPassword ? '*'.repeat(existingPassword.length) : '';
    const passwordInput = await promptPassword(
      maskedPassword ? `App Password [${maskedPassword}]: ` : 'App Password (16 chars, no spaces): ',
    );
    const newPassword = passwordInput.trim() || existingPassword;

    if (!newEmail || !newPassword) {
      console.log('Aborted — email and password are both required.');
      return;
    }

    await saveConfig({ gmailAddress: newEmail });
    keychainSave('gmail', newEmail, newPassword);
    console.log(`Saved Gmail credentials for ${newEmail}`);
  });

program.parse();
