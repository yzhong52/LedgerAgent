import type { TransactionRow } from './api';
import { fmtCents } from './utils';
import { InstBadge } from './InstBadge';

interface Props {
  transactions: TransactionRow[];
}

function formatDateHeading(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function TransactionsPage({ transactions }: Props) {
  const grouped = new Map<string, TransactionRow[]>();
  for (const tx of transactions) {
    const day = tx.datetime.slice(0, 10);
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)!.push(tx);
  }
  const days = Array.from(grouped.keys()).sort((a, b) => b.localeCompare(a));

  return (
    <div style={{ padding: '32px 36px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em' }}>Transactions</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 3 }}>
          {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
          {days.length > 0 && ` · ${formatDateHeading(days[days.length - 1])} – ${formatDateHeading(days[0])}`}
        </p>
      </div>

      {transactions.length === 0 && (
        <div style={{
          background: 'var(--bg-card)', borderRadius: 12,
          border: '1px solid var(--border-card)',
          padding: '40px 24px', textAlign: 'center',
          color: 'var(--text-tertiary)', fontSize: 14,
        }}>
          No transactions yet — run a sync to get started.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {days.map(day => {
          const txs = grouped.get(day)!;
          const dayTotal = txs.reduce((s, t) => s + t.amountCents, 0);
          return (
            <div key={day}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginBottom: 8, padding: '0 12px',
              }}>
                <div style={{
                  fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: 'var(--text-secondary)',
                }}>
                  {formatDateHeading(day)}
                </div>
                <div style={{
                  fontSize: 12, fontFamily: "'DM Mono', monospace",
                  color: dayTotal >= 0 ? 'var(--text-positive)' : 'var(--text-secondary)',
                }}>
                  {dayTotal >= 0 ? '+' : ''}{fmtCents(dayTotal)}
                </div>
              </div>

              <div style={{
                background: 'var(--bg-card)', borderRadius: 12,
                border: '1px solid var(--border-card)', overflow: 'hidden',
              }}>
                {txs.map((tx, i) => (
                  <div key={tx.id} style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '13px 20px',
                    borderBottom: i < txs.length - 1 ? '1px solid var(--border-row)' : 'none',
                  }}>
                    <InstBadge name={tx.institutionName} size={32}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{tx.description}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {tx.institutionName} · {tx.accountName}
                        {tx.currency && ` · ${tx.currency}`}
                      </div>
                    </div>
                    <div style={{
                      fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 500, flexShrink: 0,
                      color: tx.amountCents >= 0 ? 'var(--text-positive)' : 'var(--text-primary)',
                    }}>
                      {tx.amountCents >= 0 ? '+' : ''}{fmtCents(tx.amountCents)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
