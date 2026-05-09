import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import * as fs from 'fs/promises';
import * as path from 'path';
import { openDb } from '../db';
import { listAccounts, getNetWorthHistory, listTransactions, type TransactionRow } from '../db/storage';

const app = new Hono();

type DemoMode = 'poor' | 'rich';

// Stable per-session balances so the numbers don't change on every request.
const demoBalances = new Map<string, number>();

function isDemoDebt(accountId: string, type: string | null): boolean {
  if (type === 'credit' || type === 'loan') return true;
  // Deterministically make ~1 in 4 accounts a debt account.
  let hash = 0;
  for (let i = 0; i < accountId.length; i++) hash = (hash * 31 + accountId.charCodeAt(i)) & 0x7fffffff;
  return hash % 4 === 0;
}

function getDemoBalance(accountId: string, type: string | null, mode: DemoMode): number {
  const key = `${mode}/${accountId}`;
  if (demoBalances.has(key)) return demoBalances.get(key)!;

  let cents: number;
  if (isDemoDebt(accountId, type)) {
    const [min, max] = mode === 'poor' ? [800, 6_000] : [3_000, 22_000];
    cents = -Math.floor((Math.random() * (max - min) + min) * 100);
  } else if (mode === 'poor') {
    const [min, max] = type === 'investment' ? [500, 12_000] : [200, 4_000];
    cents = Math.floor((Math.random() * (max - min) + min) * 100);
  } else {
    const [min, max] = type === 'investment' ? [80_000, 600_000] : [15_000, 120_000];
    cents = Math.floor((Math.random() * (max - min) + min) * 100);
  }

  demoBalances.set(key, cents);
  return cents;
}

function applyDemoMask(name: string): string {
  // E.g. "Chequing 1234" -> "Chequing ••••"
  const masked = name.replace(/\d+/g, '••••');
  // If there were no digits, just append dots to show it's masked
  return masked === name ? `${name.split(' ')[0]} ••••` : masked;
}

app.get('/api/accounts', (c) => {
  const { db, close } = openDb();
  try {
    let accounts = listAccounts(db);

    const demo = c.req.query('demo') as DemoMode | undefined;
    if (demo === 'poor' || demo === 'rich') {
      accounts = accounts.map(a => ({
        ...a,
        accountId: applyDemoMask(a.accountId),
        accountName: applyDemoMask(a.accountName),
        amountCents: a.amountCents !== null
          ? getDemoBalance(`${a.institutionName}/${a.accountName}`, a.accountType, demo)
          : null,
      }));
    }

    return c.json(accounts);
  } finally {
    close();
  }
});

app.get('/api/net-worth', (c) => {
  const { db, close } = openDb();
  try {
    let history = getNetWorthHistory(db);

    const demo = c.req.query('demo') as DemoMode | undefined;
    if (demo === 'poor' || demo === 'rich') {
      // Anchor the chart end to the sum of fake balances so chart and cards always agree.
      const accounts = listAccounts(db);
      let runningTotal = accounts.reduce((sum, a) =>
        sum + (a.amountCents !== null
          ? getDemoBalance(`${a.institutionName}/${a.accountName}`, a.accountType, demo)
          : 0)
      , 0);
      if (runningTotal === 0) runningTotal = demo === 'rich' ? 15_000_000_00 : 5_000_000;

      // Generate 365 days of synthetic history ending today, simulating an upward trend
      const today = new Date();
      const points = [];
      for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        points.push({ date: d.toISOString().slice(0, 10), amountCents: runningTotal });
        const variance = (Math.random() * 0.02) - 0.005;
        runningTotal = Math.floor(runningTotal * (1 - variance));
      }
      history = points.reverse();
    }

    return c.json(history);
  } finally {
    close();
  }
});

const DEMO_MERCHANTS: { desc: string; cents: number }[] = [
  { desc: 'Direct Deposit – Payroll',  cents:  285000 },
  { desc: 'Grocery Store',             cents:   -8432 },
  { desc: 'Restaurant',                cents:   -4521 },
  { desc: 'Netflix',                   cents:   -1999 },
  { desc: 'Gas Station',               cents:   -6234 },
  { desc: 'Amazon.ca',                 cents:   -3499 },
  { desc: 'Coffee Shop',               cents:    -645 },
  { desc: 'Gym Membership',            cents:   -4999 },
  { desc: 'TTC Transit',               cents:    -350 },
  { desc: 'Pharmacy',                  cents:   -2341 },
  { desc: 'Spotify',                   cents:   -1099 },
  { desc: 'Hydro Bill',                cents:  -12300 },
  { desc: 'ATM Withdrawal',            cents:  -20000 },
  { desc: 'Grocery Store',             cents:   -6210 },
  { desc: 'Internet Bill',             cents:   -8500 },
  { desc: 'Tim Hortons',               cents:    -387 },
  { desc: 'Restaurant',                cents:   -7823 },
  { desc: 'Direct Deposit – Payroll',  cents:  285000 },
  { desc: 'Gas Station',               cents:   -5100 },
  { desc: 'Apple Store',               cents:  -14999 },
];

const demoCachedTxs = new Map<string, TransactionRow[]>();

function generateDemoTransactions(demo: DemoMode): TransactionRow[] {
  if (demoCachedTxs.has(demo)) return demoCachedTxs.get(demo)!;

  // Irregular day offsets: some days have 2-3 transactions, some are skipped
  const DAY_OFFSETS = [0, 0, 1, 3, 3, 3, 5, 7, 8, 8, 10, 12, 12, 15, 17, 17, 19, 21, 21, 24];
  const now = new Date();
  const txs: TransactionRow[] = DEMO_MERCHANTS.map((m, i) => {
    const date = new Date(now);
    date.setDate(date.getDate() - DAY_OFFSETS[i]);
    const scale = demo === 'poor' && m.cents > 0 ? 0.35 : 1;
    return {
      id: -(i + 1),
      institutionName: i % 3 === 0 ? 'TD Bank' : i % 3 === 1 ? 'Wealthsimple' : 'Tangerine',
      accountName: m.cents > 0 ? 'Chequing ••••' : i % 4 === 0 ? 'Savings ••••' : 'Chequing ••••',
      datetime: date.toISOString().slice(0, 10),
      description: m.desc,
      amountCents: Math.round(m.cents * scale),
      currency: 'CAD',
    };
  });

  demoCachedTxs.set(demo, txs);
  return txs;
}

app.get('/api/transactions', (c) => {
  const demo = c.req.query('demo') as DemoMode | undefined;
  const daysParam = c.req.query('days');
  const days = daysParam ? parseInt(daysParam, 10) : 90;

  if (demo === 'poor' || demo === 'rich') {
    return c.json(generateDemoTransactions(demo));
  }

  const { db, close } = openDb();
  try {
    return c.json(listTransactions(db, { days }));
  } finally {
    close();
  }
});

app.get('/favicon.png', async (c) => {
  const iconPath = path.join(process.cwd(), 'src/ui/public/LedgerAgent.png');
  try {
    const content = await fs.readFile(iconPath);
    return c.body(content as unknown as ReadableStream, 200, { 'Content-Type': 'image/png' });
  } catch {
    return c.notFound();
  }
});

app.get('/icons/:file', async (c) => {
  const file = c.req.param('file');
  const iconPath = path.join(process.cwd(), 'src/ui/public/icons', file);
  try {
    const content = await fs.readFile(iconPath);
    return c.body(content as unknown as ReadableStream, 200, { 'Content-Type': 'image/png' });
  } catch {
    return c.notFound();
  }
});

app.get('/dist/bundle.js', async (c) => {
  const bundlePath = path.join(process.cwd(), 'dist/ui/bundle.js');
  try {
    const content = await fs.readFile(bundlePath, 'utf8');
    return c.text(content, 200, {
      'Content-Type': 'application/javascript',
    });
  } catch (err) {
    return c.text('Bundle not found. Ensure esbuild ran before starting the server.', 404);
  }
});

async function serveIndex(c: Context) {
  const htmlPath = path.join(process.cwd(), 'src/ui/public/index.html');
  try {
    const content = await fs.readFile(htmlPath, 'utf8');
    return c.html(content);
  } catch {
    return c.text('index.html not found.', 404);
  }
}

app.get('/', (c) => serveIndex(c));
app.get('/accounts', (c) => serveIndex(c));
app.get('/transactions', (c) => serveIndex(c));

const port = 3000;
console.log(`Starting OpenVault UI server on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port
});
