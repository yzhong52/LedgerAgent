import { useEffect, useState } from 'react';
import { fetchAccounts, fetchNetWorth, type AccountRow, type NetWorthPoint } from './api';
import { Sidebar } from './Sidebar';
import { Dashboard } from './Dashboard';
import { AccountsPage } from './AccountsTable';

type Page = 'dashboard' | 'accounts';

const PATHS: Record<Page, string> = { dashboard: '/', accounts: '/accounts' };
const PAGES: Record<string, Page> = { '/': 'dashboard', '/accounts': 'accounts' };

function pageFromPath(): Page {
  return PAGES[window.location.pathname] ?? 'dashboard';
}

export function App() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [netWorth, setNetWorth] = useState<NetWorthPoint[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [page,     setPage]     = useState<Page>(pageFromPath);

  useEffect(() => {
    Promise.all([fetchAccounts(), fetchNetWorth()])
      .then(([accs, hist]) => { setAccounts(accs); setNetWorth(hist); })
      .catch(err => { console.error(err); setError(err.message); })
      .finally(() => setLoading(false));
  }, []);

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
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar page={page} setPage={navigate}/>
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
          <Dashboard accounts={accounts} history={netWorth}/>
        )}
        {!loading && !error && page === 'accounts' && (
          <AccountsPage accounts={accounts}/>
        )}
      </main>
    </div>
  );
}
