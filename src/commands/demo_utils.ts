import type { AccountEntry } from './utils';

export function randomBalance(): string {
  const amount = Math.random() * 149500 + 500;
  return `$${amount.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function randomizeDigits(s: string): string {
  return s.replace(/\d+/g, digits => Array.from(digits, () => Math.floor(Math.random() * 10)).join(''));
}

export function applyDemo(entry: AccountEntry): AccountEntry {
  return {
    ...entry,
    account: randomizeDigits(entry.account),
    balance: entry.balance === '—' ? '—' : randomBalance(),
  };
}
