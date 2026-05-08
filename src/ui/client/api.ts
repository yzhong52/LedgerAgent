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

export type DemoMode = 'rich' | 'poor' | null;

export function demoModeFromUrl(): DemoMode {
  const value = new URLSearchParams(window.location.search).get('demo');
  return (value === 'poor' || value === 'rich') ? value : null;
}

function demoParam(demo: DemoMode): string {
  return demo ? `?demo=${demo}` : '';
}

export async function fetchAccounts(demo: DemoMode): Promise<AccountRow[]> {
  const res = await fetch(`/api/accounts${demoParam(demo)}`);
  if (!res.ok) throw new Error('Failed to fetch accounts');
  return res.json();
}

export async function fetchNetWorth(demo: DemoMode): Promise<NetWorthPoint[]> {
  const res = await fetch(`/api/net-worth${demoParam(demo)}`);
  if (!res.ok) throw new Error('Failed to fetch net worth history');
  return res.json();
}
