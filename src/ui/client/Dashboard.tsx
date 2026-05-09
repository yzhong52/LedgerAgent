import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { AccountRow, NetWorthPoint, TransactionRow } from './api';
import { getInstColor, fmtCents, fmtCentsK } from './utils';
import { InstBadge } from './InstBadge';

const ACCENT = 260;

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: 'green' | 'red';
}) {
  const borderColor = accent === 'green' ? 'oklch(0.88 0.08 145)'
    : accent === 'red'   ? 'oklch(0.88 0.08 20)'
    : 'oklch(0.91 0.005 260)';
  const valueColor = accent === 'green' ? 'oklch(0.42 0.14 145)'
    : accent === 'red'   ? 'oklch(0.48 0.15 20)'
    : 'oklch(0.15 0.01 260)';

  return (
    <div style={{
      background: '#fff', borderRadius: 12,
      border: `1px solid ${borderColor}`,
      padding: '20px 24px', flex: 1, minWidth: 0,
    }}>
      <div style={{
        fontSize: 12, color: 'oklch(0.55 0.01 260)', fontWeight: 500,
        letterSpacing: '0.03em', textTransform: 'uppercase', marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 26, fontWeight: 500,
        letterSpacing: '-0.03em', marginBottom: 4, color: valueColor,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'oklch(0.55 0.01 260)' }}>{sub}</div>}
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
      background: '#fff', border: '1px solid oklch(0.91 0.005 260)',
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

export function Dashboard({ accounts, history, transactions, onViewAll }: Props) {
  const assetAccounts = accounts.filter(a => (a.amountCents ?? 0) > 0);
  const debtAccounts  = accounts.filter(a => (a.amountCents ?? 0) < 0);
  const netWorthCents = accounts.reduce((s, a) => s + (a.amountCents ?? 0), 0);
  const assetsCents   = assetAccounts.reduce((s, a) => s + (a.amountCents ?? 0), 0);
  const debtCents     = debtAccounts.reduce((s, a) => s + (a.amountCents ?? 0), 0);
  const chartData     = toMonthly(history, 12);
  const institutions  = Array.from(new Set(accounts.map(a => a.institutionName)));

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em' }}>{greeting()}</h1>
        <p style={{ fontSize: 14, color: 'oklch(0.55 0.01 260)', marginTop: 3 }}>Here's your financial snapshot for {formatDate(new Date())}.</p>
      </div>

      <div style={{ display: 'flex', gap: 14, marginBottom: 28 }}>
        <StatCard label="Net Worth"    value={fmtCents(netWorthCents)} sub={`${accounts.length} account${accounts.length !== 1 ? 's' : ''}`}/>
        <StatCard label="Total Assets" value={fmtCents(assetsCents)} sub={`${assetAccounts.length} account${assetAccounts.length !== 1 ? 's' : ''}`} accent="green"/>
        <StatCard label="Total Debt"   value={fmtCents(Math.abs(debtCents))} sub={`${debtAccounts.length} account${debtAccounts.length !== 1 ? 's' : ''}`} accent="red"/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <div style={{
          background: '#fff', borderRadius: 12,
          border: '1px solid oklch(0.91 0.005 260)', padding: '22px 24px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 18, color: 'oklch(0.35 0.01 260)' }}>
            Net Worth
          </div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={`oklch(0.55 0.18 ${ACCENT})`} stopOpacity={0.15}/>
                    <stop offset="100%" stopColor={`oklch(0.55 0.18 ${ACCENT})`} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.93 0.005 260)" vertical={false}/>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: 'oklch(0.6 0.01 260)' }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  dataKey="valueCents"
                  tick={{ fontSize: 11, fill: 'oklch(0.6 0.01 260)', fontFamily: "'DM Mono', monospace" }}
                  axisLine={false} tickLine={false}
                  tickFormatter={v => `$${(v / 100000).toFixed(0)}k`}
                  width={42}
                />
                <Tooltip content={<ChartTooltip/>}/>
                <Area
                  type="monotone" dataKey="valueCents"
                  stroke={`oklch(0.55 0.18 ${ACCENT})`} strokeWidth={2}
                  fill="url(#nwGrad)" dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{
              height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'oklch(0.6 0.01 260)', fontSize: 13,
            }}>
              No history yet — run a sync to populate the chart.
            </div>
          )}
        </div>

        <div style={{
          background: '#fff', borderRadius: 12,
          border: '1px solid oklch(0.91 0.005 260)', padding: '22px 24px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 18, color: 'oklch(0.35 0.01 260)' }}>
            Accounts
          </div>
          {institutions.length === 0 ? (
            <div style={{ fontSize: 13, color: 'oklch(0.6 0.01 260)' }}>
              No accounts yet — run a sync to get started.
            </div>
          ) : (
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
                        display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4,
                      }}>
                        <span style={{ fontWeight: 500 }}>{inst}</span>
                        <span style={{ fontFamily: "'DM Mono', monospace", color: 'oklch(0.35 0.01 260)' }}>
                          {fmtCentsK(bal)}
                        </span>
                      </div>
                      <div style={{
                        height: 4, borderRadius: 2,
                        background: 'oklch(0.93 0.005 260)', overflow: 'hidden',
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
          )}
        </div>
      </div>

      <div style={{
        marginTop: 14, background: '#fff', borderRadius: 12,
        border: '1px solid oklch(0.91 0.005 260)', padding: '22px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'oklch(0.35 0.01 260)' }}>Recent Transactions</div>
          {transactions.length > 0 && (
            <button onClick={onViewAll} style={{
              fontSize: 12, color: `oklch(0.50 0.18 ${ACCENT})`, background: 'none',
              border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit',
            }}>
              View all →
            </button>
          )}
        </div>
        {transactions.length === 0 ? (
          <div style={{ fontSize: 13, color: 'oklch(0.6 0.01 260)' }}>
            No transactions yet — run a sync to get started.
          </div>
        ) : (
          <div>
            {transactions.slice(0, 5).map((tx, i) => (
              <div key={tx.id} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '10px 0',
                borderBottom: i < Math.min(transactions.length, 5) - 1
                  ? '1px solid oklch(0.95 0.003 260)' : 'none',
              }}>
                <InstBadge name={tx.institutionName} size={28}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tx.description}
                  </div>
                  <div style={{ fontSize: 12, color: 'oklch(0.6 0.01 260)', marginTop: 1 }}>
                    {tx.accountName} · {tx.datetime.slice(0, 10)}
                  </div>
                </div>
                <div style={{
                  fontFamily: "'DM Mono', monospace", fontSize: 13.5, fontWeight: 500, flexShrink: 0,
                  color: tx.amountCents >= 0 ? 'oklch(0.42 0.14 145)' : 'oklch(0.15 0.01 260)',
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
