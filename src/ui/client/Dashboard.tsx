import { useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { AccountRow, NetWorthPoint, TransactionRow, HoldingRow } from './api';
import { getInstColor, fmtCents, fmtCentsK } from './utils';
import { InstBadge } from './InstBadge';

const CHART_LIGHT = {
  stroke: 'oklch(0.55 0.18 260)',
  grid:   'oklch(0.93 0.005 260)',
  tick:   'oklch(0.6 0.01 260)',
};
const CHART_DARK = {
  stroke: 'oklch(0.65 0.18 260)',
  grid:   'oklch(0.25 0.01 260)',
  tick:   'oklch(0.55 0.01 260)',
};

function useDarkMode(): boolean {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const [dark, setDark] = useState(mq.matches);
  useEffect(() => {
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return dark;
}

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: 'green' | 'red';
}) {
  const borderColor = accent === 'green' ? 'var(--border-accent-green)'
    : accent === 'red'   ? 'var(--border-accent-red)'
    : 'var(--border-card)';
  const valueColor = accent === 'green' ? 'var(--text-positive)'
    : accent === 'red'   ? 'var(--text-negative)'
    : 'var(--text-primary)';

  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 12,
      border: `1px solid ${borderColor}`,
      padding: '20px 24px', flex: 1, minWidth: 0,
    }}>
      <div style={{
        fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500,
        letterSpacing: '0.03em', textTransform: 'uppercase', marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 26, fontWeight: 500,
        letterSpacing: '-0.03em', marginBottom: 4, color: valueColor,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{sub}</div>}
    </div>
  );
}

function toMonthly(history: NetWorthPoint[], months: number) {
  const byMonth = new Map<string, number>();
  for (const p of history) byMonth.set(p.date.slice(0, 7), p.amountCents);
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-months)
    .map(([month, cents]) => ({
      month: new Date(month + '-01T12:00:00').toLocaleDateString('en-CA', { month: 'short' }),
      valueCents: cents,
    }));
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-card)',
      borderRadius: 8, padding: '8px 14px', fontSize: 13,
    }}>
      <div style={{ fontWeight: 500, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: "'DM Mono', monospace" }}>{fmtCentsK(payload[0].value)}</div>
    </div>
  );
}

interface Props {
  accounts: AccountRow[];
  history: NetWorthPoint[];
  transactions: TransactionRow[];
  holdings: HoldingRow[];
  onViewAll: () => void;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(d: Date) {
  const day = d.getDate();
  const suffix = [, 'st', 'nd', 'rd'][day % 100 > 10 && day % 100 < 14 ? 0 : day % 10] ?? 'th';
  return d.toLocaleDateString('en-CA', { month: 'long' }) + ' ' + day + suffix + ', ' + d.getFullYear();
}

export function Dashboard({ accounts, history, transactions, holdings, onViewAll }: Props) {
  const dark = useDarkMode();
  const chartColors = dark ? CHART_DARK : CHART_LIGHT;
  const [holdingsOpen, setHoldingsOpen] = useState(true);

  const assetAccounts   = accounts.filter(a => (a.amountCents ?? 0) > 0);
  const debtAccounts    = accounts.filter(a => (a.amountCents ?? 0) < 0);
  const netWorthCents   = accounts.reduce((s, a) => s + (a.amountCents ?? 0), 0);
  const assetsCents     = assetAccounts.reduce((s, a) => s + (a.amountCents ?? 0), 0);
  const debtCents       = debtAccounts.reduce((s, a) => s + (a.amountCents ?? 0), 0);
  const chartData       = toMonthly(history, 12);
  const institutions    = Array.from(new Set(accounts.map(a => a.institutionName)));
  const topHoldings     = holdings.slice(0, 6);
  const totalHoldingsMv = holdings.reduce((s, h) => s + h.marketValueCents, 0);

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em' }}>{greeting()}</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 3 }}>Here's your financial snapshot for {formatDate(new Date())}.</p>
      </div>

      <div style={{ display: 'flex', gap: 14, marginBottom: 28 }}>
        <StatCard label="Net Worth"    value={fmtCents(netWorthCents)} sub={`${accounts.length} account${accounts.length !== 1 ? 's' : ''}`}/>
        <StatCard label="Total Assets" value={fmtCents(assetsCents)} sub={`${assetAccounts.length} account${assetAccounts.length !== 1 ? 's' : ''}`} accent="green"/>
        <StatCard label="Total Debt"   value={fmtCents(Math.abs(debtCents))} sub={`${debtAccounts.length} account${debtAccounts.length !== 1 ? 's' : ''}`} accent="red"/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <div style={{
          background: 'var(--bg-card)', borderRadius: 12,
          border: '1px solid var(--border-card)', padding: '22px 24px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 18, color: 'var(--text-muted)' }}>
            Net Worth
          </div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={chartColors.stroke} stopOpacity={0.15}/>
                    <stop offset="100%" stopColor={chartColors.stroke} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false}/>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: chartColors.tick }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  dataKey="valueCents"
                  tick={{ fontSize: 11, fill: chartColors.tick, fontFamily: "'DM Mono', monospace" }}
                  axisLine={false} tickLine={false}
                  tickFormatter={v => `$${(v / 100000).toFixed(0)}k`}
                  width={42}
                />
                <Tooltip content={<ChartTooltip/>}/>
                <Area
                  type="monotone" dataKey="valueCents"
                  stroke={chartColors.stroke} strokeWidth={2}
                  fill="url(#nwGrad)" dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{
              height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-tertiary)', fontSize: 13,
            }}>
              No history yet — run a sync to populate the chart.
            </div>
          )}
        </div>

        <div style={{
          background: 'var(--bg-card)', borderRadius: 12,
          border: '1px solid var(--border-card)', padding: '22px 24px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 18, color: 'var(--text-muted)' }}>
            Accounts
          </div>
          {institutions.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
              No accounts yet — run a sync to get started.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {institutions.map(inst => {
                  const bal = accounts
                    .filter(a => a.institutionName === inst && (a.amountCents ?? 0) > 0)
                    .reduce((s, a) => s + (a.amountCents ?? 0), 0);
                  const pct = assetsCents > 0 ? Math.round(bal / assetsCents * 100) : 0;
                  return (
                    <div key={inst} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <InstBadge name={inst} size={24}/>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          display: 'flex', justifyContent: 'space-between',
                          fontSize: 12.5, marginBottom: 4,
                        }}>
                          <span style={{ fontWeight: 500 }}>{inst}</span>
                          <span style={{ fontFamily: "'DM Mono', monospace", color: 'var(--text-muted)' }}>
                            {fmtCentsK(bal)}
                          </span>
                        </div>
                        <div style={{
                          height: 4, borderRadius: 2,
                          background: 'var(--bg-progress)', overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%', width: `${pct}%`,
                            background: getInstColor(inst), borderRadius: 2,
                          }}/>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {topHoldings.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <button
                    onClick={() => setHoldingsOpen(o => !o)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', border: 'none', background: 'none',
                      padding: '0 0 10px 0', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    <span style={{
                      fontSize: 13, fontWeight: 500, color: 'var(--text-muted)',
                      borderTop: '1px solid var(--border-subtle)',
                      paddingTop: 12, width: '100%', textAlign: 'left', display: 'block',
                    }}>
                      Top Holdings
                    </span>
                    <span style={{
                      transform: holdingsOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.18s', color: 'var(--text-tertiary)',
                      marginTop: 12, flexShrink: 0,
                    }}>▶</span>
                  </button>
                  {holdingsOpen && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {topHoldings.map(h => {
                        const pct = totalHoldingsMv > 0
                          ? Math.round(h.marketValueCents / totalHoldingsMv * 100) : 0;
                        return (
                          <div key={`${h.accountName}/${h.symbol}`} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                          }}>
                            <span style={{
                              fontFamily: "'DM Mono', monospace", fontSize: 11.5,
                              fontWeight: 600, width: 44, flexShrink: 0,
                              color: 'var(--text-primary)',
                            }}>
                              {h.symbol}
                            </span>
                            <span style={{
                              flex: 1, minWidth: 0, fontSize: 11.5,
                              color: 'var(--text-secondary)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {h.name ?? h.accountName}
                            </span>
                            <span style={{
                              fontFamily: "'DM Mono', monospace", fontSize: 11.5,
                              color: 'var(--text-muted)', flexShrink: 0,
                            }}>
                              {fmtCentsK(h.marketValueCents)}
                            </span>
                            <span style={{
                              fontFamily: "'DM Mono', monospace", fontSize: 10.5,
                              color: 'var(--text-tertiary)', flexShrink: 0, width: 30,
                              textAlign: 'right',
                            }}>
                              {pct}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div style={{
        marginTop: 14, background: 'var(--bg-card)', borderRadius: 12,
        border: '1px solid var(--border-card)', padding: '22px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>Recent Transactions</div>
          {transactions.length > 0 && (
            <button onClick={onViewAll} style={{
              fontSize: 12, color: 'var(--text-link)', background: 'none',
              border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit',
            }}>
              View all →
            </button>
          )}
        </div>
        {transactions.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
            No transactions yet — run a sync to get started.
          </div>
        ) : (
          <div>
            {transactions.slice(0, 5).map((tx, i) => (
              <div key={tx.id} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '10px 0',
                borderBottom: i < Math.min(transactions.length, 5) - 1
                  ? '1px solid var(--border-row)' : 'none',
              }}>
                <InstBadge name={tx.institutionName} size={28}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tx.description}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1 }}>
                    {tx.accountName} · {tx.datetime.slice(0, 10)}
                  </div>
                </div>
                <div style={{
                  fontFamily: "'DM Mono', monospace", fontSize: 13.5, fontWeight: 500, flexShrink: 0,
                  color: tx.amountCents >= 0 ? 'var(--text-positive)' : 'var(--text-primary)',
                }}>
                  {tx.amountCents >= 0 ? '+' : ''}{fmtCents(tx.amountCents)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
