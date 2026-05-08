export interface AccountRow {
  institutionName: string;
  accountName: string;
  accountType: string | null;
  accountCurrency: string | null;
  accountId: string;
  latestDate: string | null;
  amountCents: number | null;
}

export interface NetWorthPoint {
  date: string;
  amountCents: number;
}

function getDemoParam(): string {
  const value = new URLSearchParams(window.location.search).get('demo');
  return (value === 'poor' || value === 'rich') ? `?demo=${value}` : '';
}

export async function fetchAccounts(): Promise<AccountRow[]> {
  const res = await fetch(`/api/accounts${getDemoParam()}`);
  if (!res.ok) throw new Error('Failed to fetch accounts');
  return res.json();
}

export async function fetchNetWorth(): Promise<NetWorthPoint[]> {
  const res = await fetch(`/api/net-worth${getDemoParam()}`);
  if (!res.ok) throw new Error('Failed to fetch net worth history');
  return res.json();
}
