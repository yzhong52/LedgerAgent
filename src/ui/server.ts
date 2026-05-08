import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import * as fs from 'fs/promises';
import * as path from 'path';
import { openDb } from '../db';
import { listAccounts, getNetWorthHistory } from '../db/storage';

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
    if ((demo === 'poor' || demo === 'rich') && history.length > 0) {
      // Anchor the chart end to the sum of fake balances so chart and cards always agree.
      const accounts = listAccounts(db);
      let runningTotal = accounts.reduce((sum, a) =>
        sum + (a.amountCents !== null
          ? getDemoBalance(`${a.institutionName}/${a.accountName}`, a.accountType, demo)
          : 0)
      , 0);

      // Walk backwards through history, applying a random simulated market variance
      for (let i = history.length - 1; i >= 0; i--) {
        history[i].amountCents = runningTotal;
        // Going backwards: balance drops by -0.5% to +1.5% per day to simulate an upward trend
        const variance = (Math.random() * 0.02) - 0.005; 
        runningTotal = Math.floor(runningTotal * (1 - variance));
      }
    }

    return c.json(history);
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

const port = 3000;
console.log(`Starting OpenVault UI server on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port
});
