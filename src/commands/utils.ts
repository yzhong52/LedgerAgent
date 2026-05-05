import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { chromium } from 'playwright';
import type { BrowserContext } from 'playwright';
import { DATA_DIR } from '../db';

export interface Institution {
  name: string;
  url: string;
  username: string;
}

export const INSTITUTIONS_FILE = path.join(DATA_DIR, 'institutions.json');
export const PROFILE_DIR =
  process.env.OPENVAULT_PROFILE_DIR ?? path.join(DATA_DIR, 'browser-profile');

async function hasManifest(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(dir, 'manifest.json'));
    return stat.isFile();
  } catch {
    return false;
  }
}

async function discoverExtensionDirs(dir: string): Promise<string[]> {
  if (await hasManifest(dir)) return [dir];

  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const dirs = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async entry => {
        const childDir = path.join(dir, entry.name);
        return await hasManifest(childDir) ? childDir : null;
      }),
  );
  return dirs.filter((dir): dir is string => dir != null);
}

export async function launchBrowser(): Promise<BrowserContext> {
  await fs.mkdir(PROFILE_DIR, { recursive: true });
  const extensionDir = path.join(DATA_DIR, 'brower-extensions');
  await fs.mkdir(extensionDir, { recursive: true });
  const extensions = await discoverExtensionDirs(extensionDir);
  const args = ['--disable-blink-features=AutomationControlled'];
  if (extensions.length > 0) {
    const extensionList = extensions.join(',');
    args.push(`--disable-extensions-except=${extensionList}`);
    args.push(`--load-extension=${extensionList}`);
  }

  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chromium',
    args,
    // Playwright disables extensions by default; remove that flag when loading ours.
    ignoreDefaultArgs: extensions.length > 0 ? ['--disable-extensions'] : undefined,
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

export function printAccountsTable(entries: AccountEntry[]): void {
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
