import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { chromium } from 'playwright';
import type { BrowserContext } from 'playwright';
import { DATA_DIR } from '../db';
import { applyDemo } from './demo_utils';

export interface Institution {
  name: string;
  url: string;
  username: string;
}

export const INSTITUTIONS_FILE = path.join(DATA_DIR, 'institutions.json');
export const PROFILE_DIR =
  process.env.OPENVAULT_PROFILE_DIR ?? path.join(DATA_DIR, 'browser-profile');

export async function launchBrowser(): Promise<BrowserContext> {
  await fs.mkdir(PROFILE_DIR, { recursive: true });

  // Prevents financial institution firewalls (e.g., Cloudflare, Akamai) from instantly
  // blocking the session. This flag suppresses `navigator.webdriver` and other internal
  // Blink-engine automation signals used for bot detection.
  // See: https://developer.chrome.com/docs/chromedriver/security-considerations
  const args = ['--disable-blink-features=AutomationControlled'];

  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    // Use official Google Chrome rather than Chromium so the Chrome Web Store
    // recognizes the browser and enables the "Add to Chrome" button.
    channel: 'chrome',
    args,
    // Playwright disables extensions by default; always remove that flag so extensions
    // already installed in the persistent profile also load correctly.
    // Also ignore --enable-automation so the Chrome Web Store allows installations.
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
  });
}

export async function readInstitutions(): Promise<Institution[]> {
  try {
    return JSON.parse(await fs.readFile(INSTITUTIONS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export async function writeInstitutions(institutions: Institution[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INSTITUTIONS_FILE, JSON.stringify(institutions, null, 2) + '\n');
}

export function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

export interface AccountEntry {
  institution?: string;
  account: string;
  type: string;
  balance: string;
}

export function printAccountsTable(entries: AccountEntry[], demo: boolean): void {
  if (demo) entries = entries.map(applyDemo);
  const showInstitution = entries.some(e => e.institution != null);
  const headers = { account: 'Account', type: 'Type', balance: 'Balance' };

  const width = (key: 'institution' | 'account' | 'type' | 'balance') =>
    Math.max(
      key === 'institution' ? 'Institution'.length : headers[key as keyof typeof headers].length,
      ...entries.map(e => (e[key] ?? '').length),
    );
  const w = {
    institution: showInstitution ? width('institution') : 0,
    account: width('account'),
    type: width('type'),
    balance: width('balance'),
  };

  const fmt = (e: AccountEntry) => [
    showInstitution ? (e.institution ?? '').padEnd(w.institution) : null,
    e.account.padEnd(w.account),
    e.type.padEnd(w.type),
    e.balance.padStart(w.balance),
  ].filter(Boolean).join('  ');

  const header = fmt({
    institution: 'Institution',
    account: 'Account',
    type: 'Type',
    balance: 'Balance',
  });
  const divider = fmt({
    institution: '-'.repeat(w.institution),
    account: '-'.repeat(w.account),
    type: '-'.repeat(w.type),
    balance: '-'.repeat(w.balance),
  });

  console.log();
  console.log(`  ${header}`);
  console.log(`  ${divider}`);
  for (const e of entries) {
    console.log(`  ${fmt(e)}`);
  }
  console.log();
}

export function promptPassword(question: string): Promise<string> {
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
      } else if (char === '') {
        process.exit();
      } else if (char === '') {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    });
  });
}
