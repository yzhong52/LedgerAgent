import React, { useEffect, useState } from 'react';
import { fetchAccounts, fetchNetWorth, type AccountRow, type NetWorthPoint } from './api';
import { NetWorthChart } from './NetWorthChart';
import { AccountsTable } from './AccountsTable';

export function App() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [history, setHistory] = useState<NetWorthPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchAccounts(), fetchNetWorth()])
      .then(([accs, hist]) => {
        setAccounts(accs);
        setHistory(hist);
      })
      .catch((err) => {
        console.error(err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: 40, color: '#6b7280' }}>Loading data...</div>;
  }

  if (error) {
    return <div style={{ padding: 40, color: '#ef4444' }}>Error: {error}</div>;
  }

  return (
    <div>
      <h1 style={{ marginBottom: 40, fontSize: '28px', fontWeight: 700 }}>OpenVault Net Worth</h1>
      
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#374151', paddingBottom: 10 }}>Net Worth Over Time</h2>
      {history.length > 0 ? (
        <NetWorthChart data={history} />
      ) : (
        <p style={{ color: '#6b7280', margin: '20px 0 40px' }}>No history available yet. Run a sync to populate chart.</p>
      )}
      
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#374151', paddingBottom: 10 }}>Current Balances</h2>
      {accounts.length > 0 ? (
        <AccountsTable accounts={accounts} />
      ) : (
        <p style={{ color: '#6b7280', margin: '20px 0' }}>No accounts available yet. Run a sync to populate balances.</p>
      )}
    </div>
  );
}
