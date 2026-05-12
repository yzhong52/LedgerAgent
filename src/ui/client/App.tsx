import { useEffect, useState } from 'react';
import {
  fetchAccounts, fetchNetWorth, fetchTransactions, fetchHoldings, demoModeFromUrl,
  type AccountRow, type NetWorthPoint, type TransactionRow, type HoldingRow, type DemoMode,
} from './api';
import { Sidebar, type Page } from './Sidebar';
import { Dashboard } from './Dashboard';
import { AccountsPage } from './AccountsTable';
import { TransactionsPage } from './TransactionsPage';

const PATHS: Record<Page, string> = {
  dashboard: '/', accounts: '/accounts', transactions: '/transactions',
};
const PAGES: Record<string, Page> = {
  '/': 'dashboard', '/accounts': 'accounts', '/transactions': 'transactions',
};

const DEMO_STORAGE_KEY = 'ledgeragent:demo';

function pageFromPath(): Page {
  return PAGES[window.location.pathname] ?? 'dashboard';
}

function loadDemo(): boolean {
  if (localStorage.getItem(DEMO_STORAGE_KEY) === 'true') return true;
  return demoModeFromUrl();
}

function saveDemo(demo: boolean) {
  if (demo) localStorage.setItem(DEMO_STORAGE_KEY, 'true');
  else localStorage.removeItem(DEMO_STORAGE_KEY);
}

export function App() {
  const [accounts,     setAccounts]     = useState<AccountRow[]>([]);
  const [netWorth,     setNetWorth]     = useState<NetWorthPoint[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [holdings,     setHoldings]     = useState<HoldingRow[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [page,         setPage]         = useState<Page>(pageFromPath);
  const [demo,         setDemo]         = useState<boolean>(loadDemo);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchAccounts(demo), fetchNetWorth(demo), fetchTransactions(demo), fetchHoldings(demo)])
      .then(([accs, hist, txs, hlds]) => {
        setAccounts(accs); setNetWorth(hist); setTransactions(txs); setHoldings(hlds);
      })
      .catch(err => { console.error(err); setError(err.message); })
      .finally(() => setLoading(false));
  }, [demo]);

  useEffect(() => {
    const onPopState = () => setPage(pageFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(p: Page) {
    if (p !== page) {
      window.history.pushState({}, '', PATHS[p]);
      setPage(p);
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar page={page} setPage={navigate} demo={demo} setDemo={d => { saveDemo(d); setDemo(d); }}/>
      <main style={{ flex: 1, overflowY: 'auto', paddingBottom: 60 }}>
        {loading && (
          <div style={{ padding: '32px 36px', color: 'oklch(0.6 0.01 260)', fontSize: 14 }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ padding: '32px 36px', color: 'oklch(0.5 0.15 20)', fontSize: 14 }}>
            Error: {error}
          </div>
        )}
        {!loading && !error && page === 'dashboard' && (
          <Dashboard
            accounts={accounts} history={netWorth} transactions={transactions}
            holdings={holdings} onViewAll={() => navigate('transactions')}
          />
        )}
        {!loading && !error && page === 'accounts' && (
          <AccountsPage accounts={accounts} holdings={holdings}/>
        )}
        {!loading && !error && page === 'transactions' && (
          <TransactionsPage transactions={transactions}/>
        )}
      </main>
    </div>
  );
}
