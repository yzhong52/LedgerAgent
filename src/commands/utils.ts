import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { chromium } from 'playwright';
import type { BrowserContext } from 'playwright';
import { DATA_DIR } from '../db';
import { applyDemo } from './demo_utils';
import type { Holding } from '../tasks/holdings';

export interface Institution {
  name: string;
  url: string;
  username: string;
}

export const INSTITUTIONS_FILE = path.join(DATA_DIR, 'institutions.json');
export const PROFILE_DIR =
  process.env.LEDGERAGENT_PROFILE_DIR ?? path.join(DATA_DIR, 'browser-profile');

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

export function formatCents(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const formatted = abs.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `-$${formatted}` : `$${formatted}`;
}

// Display-only struct for printAccountsTable.
export interface AccountEntry {
  institution: string;
  account: string;
  accountId?: string;
  type: string;
  currency?: string;
  balance: string;
  lastUpdated: string;
}

export function printAccountsTable(
  entries: AccountEntry[],
  { demo, showInstitution }: { demo: boolean; showInstitution: boolean },
): void {
  if (demo) entries = entries.map(applyDemo);
  const headers = { account: 'Account', accountId: 'ID', type: 'Type', balance: 'Balance', lastUpdated: 'Last Updated' };
  const showAccountId = entries.some(e => e.accountId != null);

  const formatted = entries.map(e => ({
    ...e,
    balance: e.currency && e.balance !== '—' ? `${e.currency} ${e.balance}` : e.balance,
  }));

  const width = (key: 'institution' | 'account' | 'accountId' | 'type' | 'balance' | 'lastUpdated') =>
    Math.max(
      key === 'institution' ? 'Institution'.length : headers[key as keyof typeof headers].length,
      ...formatted.map(e => (e[key] ?? '').length),
    );
  const w = {
    institution: showInstitution ? width('institution') : 0,
    account: width('account'),
    accountId: showAccountId ? width('accountId') : 0,
    type: width('type'),
    balance: width('balance'),
    lastUpdated: width('lastUpdated'),
  };

  const fmt = (e: typeof formatted[number]) => [
    showInstitution ? (e.institution ?? '').padEnd(w.institution) : null,
    e.account.padEnd(w.account),
    showAccountId ? (e.accountId ?? '').padEnd(w.accountId) : null,
    e.type.padEnd(w.type),
    e.balance.padStart(w.balance),
    e.lastUpdated ?? '',
  ].filter(Boolean).join('  ');

  const header = fmt({
    institution: 'Institution', account: 'Account', accountId: 'ID', type: 'Type',
    balance: 'Balance', lastUpdated: 'Last Updated',
  });
  const divider = fmt({
    institution: '-'.repeat(w.institution),
    account: '-'.repeat(w.account),
    accountId: '-'.repeat(w.accountId),
    type: '-'.repeat(w.type),
    balance: '-'.repeat(w.balance),
    lastUpdated: '-'.repeat(w.lastUpdated),
  });

  console.log();
  console.log(`  ${header}`);
  console.log(`  ${divider}`);
  for (const e of formatted) {
    console.log(`  ${fmt(e)}`);
  }
  console.log();
}

export function printHoldingsTable(holdings: Holding[]): void {
  if (holdings.length === 0) {
    console.log('  (no positions)');
    return;
  }

  const showName      = holdings.some(h => h.name != null);
  const showCostBasis = holdings.some(h => h.costBasis != null);

  const rows = holdings.map(h => ({
    symbol:      h.symbol,
    name:        h.name ?? '',
    qty:         h.quantity.toLocaleString('en-CA', { maximumFractionDigits: 6 }),
    price:       formatCents(Math.round(h.pricePerUnit * 100)),
    marketValue: h.currency && h.currency !== 'CAD'
      ? `${h.currency} ${formatCents(Math.round(h.marketValue * 100))}`
      : formatCents(Math.round(h.marketValue * 100)),
    costBasis:   h.costBasis != null ? formatCents(Math.round(h.costBasis * 100)) : '—',
  }));

  const w = {
    symbol:      Math.max('Symbol'.length,       ...rows.map(r => r.symbol.length)),
    name:        Math.max('Name'.length,         ...rows.map(r => r.name.length)),
    qty:         Math.max('Qty'.length,          ...rows.map(r => r.qty.length)),
    price:       Math.max('Price'.length,        ...rows.map(r => r.price.length)),
    marketValue: Math.max('Market Value'.length, ...rows.map(r => r.marketValue.length)),
    costBasis:   Math.max('Cost Basis'.length,   ...rows.map(r => r.costBasis.length)),
  };

  const fmt = (r: typeof rows[number]) => [
    r.symbol.padEnd(w.symbol),
    showName      ? r.name.padEnd(w.name)           : null,
    r.qty.padStart(w.qty),
    r.price.padStart(w.price),
    r.marketValue.padStart(w.marketValue),
    showCostBasis ? r.costBasis.padStart(w.costBasis) : null,
  ].filter(Boolean).join('  ');

  const header = fmt({
    symbol: 'Symbol', name: 'Name', qty: 'Qty', price: 'Price',
    marketValue: 'Market Value', costBasis: 'Cost Basis',
  });
  const divider = fmt({
    symbol:      '-'.repeat(w.symbol),
    name:        '-'.repeat(w.name),
    qty:         '-'.repeat(w.qty),
    price:       '-'.repeat(w.price),
    marketValue: '-'.repeat(w.marketValue),
    costBasis:   '-'.repeat(w.costBasis),
  });

  console.log(`  ${header}`);
  console.log(`  ${divider}`);
  for (const r of rows) console.log(`  ${fmt(r)}`);
  console.log();
}

export function selectFromList(
  items: string[],
  label: string,
  skipIndices: Set<number> = new Set(),
  header?: string,
): Promise<number> {
  const firstSelectable = items.findIndex((_, i) => !skipIndices.has(i));
  let selected = firstSelectable === -1 ? 0 : firstSelectable;

  const render = (first: boolean) => {
    if (!first) process.stdout.write(`\x1b[${items.length}A`);
    for (let i = 0; i < items.length; i++) {
      if (skipIndices.has(i)) {
        process.stdout.write(`\x1b[2K\x1b[2m    ${items[i]}\x1b[0m\n`);
      } else if (i === selected) {
        process.stdout.write(`\x1b[2K\x1b[7m  > ${items[i]}\x1b[0m\n`);
      } else {
        process.stdout.write(`\x1b[2K    ${items[i]}\n`);
      }
    }
  };

  process.stdout.write(`\n  ${label}\n`);
  if (header) process.stdout.write(`\x1b[4m    ${header}\x1b[0m\n`);
  render(true);

  return new Promise(resolve => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    const onData = (ch: string) => {
      if (ch === '\x1b[A') {
        let next = selected - 1;
        while (next >= 0 && skipIndices.has(next)) next--;
        if (next >= 0) { selected = next; render(false); }
      } else if (ch === '\x1b[B') {
        let next = selected + 1;
        while (next < items.length && skipIndices.has(next)) next++;
        if (next < items.length) { selected = next; render(false); }
      } else if (ch === '\r' || ch === '\n') {
        process.stdout.write('\n');
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        resolve(selected);
      } else if (ch === '\x03') {
        process.exit();
      }
    };

    process.stdin.on('data', onData);
  });
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
