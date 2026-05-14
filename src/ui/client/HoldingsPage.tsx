import type { HoldingRow } from './api';
import { fmtCents } from './utils';
import { InstBadge } from './InstBadge';

interface Props {
  holdings: HoldingRow[];
}

const MONO: React.CSSProperties = { fontFamily: "'DM Mono', monospace" };

const COLS = '90px 1fr 90px 120px 130px 120px';

function HeaderRow() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS,
      padding: '9px 20px',
      borderBottom: '1px solid var(--border-row)',
      fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
      textTransform: 'uppercase', color: 'var(--text-secondary)',
    }}>
      <span>Symbol</span>
      <span>Name</span>
      <span style={{ textAlign: 'right' }}>Qty</span>
      <span style={{ textAlign: 'right' }}>Price / unit</span>
      <span style={{ textAlign: 'right' }}>Market Value</span>
      <span style={{ textAlign: 'right' }}>Gain / Loss</span>
    </div>
  );
}

function HoldingRow({ holding, last }: { holding: HoldingRow; last: boolean }) {
  const gainLoss = holding.costBasisCents != null
    ? holding.marketValueCents - holding.costBasisCents
    : null;
  const gainColor = gainLoss == null
    ? 'var(--text-tertiary)'
    : gainLoss >= 0 ? 'var(--text-positive)' : 'var(--text-negative)';

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COLS,
      padding: '13px 20px', alignItems: 'center',
      borderBottom: last ? 'none' : '1px solid var(--border-row)',
    }}>
      <span style={{ ...MONO, fontWeight: 600, fontSize: 13 }}>{holding.symbol}</span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 16 }}>
        {holding.name ?? '—'}
      </span>
      <span style={{ ...MONO, fontSize: 13, textAlign: 'right' }}>
        {holding.quantity.toLocaleString('en-CA', { maximumFractionDigits: 4 })}
      </span>
      <span style={{ ...MONO, fontSize: 13, textAlign: 'right' }}>
        {fmtCents(holding.pricePerUnitCents)}
      </span>
      <span style={{ ...MONO, fontSize: 13, fontWeight: 500, textAlign: 'right' }}>
        {fmtCents(holding.marketValueCents)}
      </span>
      <span style={{ ...MONO, fontSize: 13, textAlign: 'right', color: gainColor }}>
        {gainLoss == null ? '—' : (gainLoss >= 0 ? '+' : '') + fmtCents(gainLoss)}
      </span>
    </div>
  );
}

export function HoldingsPage({ holdings }: Props) {
  const grouped = new Map<string, HoldingRow[]>();
  for (const h of holdings) {
    const key = `${h.institutionName}::${h.accountName}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(h);
  }
  const groups = Array.from(grouped.entries());
  const totalMv = holdings.reduce((s, h) => s + h.marketValueCents, 0);

  return (
    <div style={{ padding: '32px 36px', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em' }}>Holdings</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 3 }}>
          {holdings.length} position{holdings.length !== 1 ? 's' : ''}
          {holdings.length > 0 && ` · ${fmtCents(totalMv)} total`}
        </p>
      </div>

      {holdings.length === 0 && (
        <div style={{
          background: 'var(--bg-card)', borderRadius: 12,
          border: '1px solid var(--border-card)',
          padding: '40px 24px', textAlign: 'center',
          color: 'var(--text-tertiary)', fontSize: 14,
        }}>
          No holdings yet — run a sync on a brokerage account to get started.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {groups.map(([key, rows]) => {
          const [institutionName, accountName] = key.split('::');
          const accountTotal = rows.reduce((s, h) => s + h.marketValueCents, 0);
          const accountGainLoss = rows.every(h => h.costBasisCents != null)
            ? rows.reduce((s, h) => s + h.marketValueCents - h.costBasisCents!, 0)
            : null;

          return (
            <div key={key}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 8, padding: '0 12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <InstBadge name={institutionName} size={28}/>
                  <div>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{accountName}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
                      {institutionName}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  {accountGainLoss != null && (
                    <span style={{
                      ...MONO, fontSize: 12,
                      color: accountGainLoss >= 0 ? 'var(--text-positive)' : 'var(--text-negative)',
                    }}>
                      {accountGainLoss >= 0 ? '+' : ''}{fmtCents(accountGainLoss)}
                    </span>
                  )}
                  <span style={{ ...MONO, fontSize: 13, fontWeight: 500 }}>
                    {fmtCents(accountTotal)}
                  </span>
                </div>
              </div>

              <div style={{
                background: 'var(--bg-card)', borderRadius: 12,
                border: '1px solid var(--border-card)', overflow: 'hidden',
              }}>
                <HeaderRow/>
                {rows.map((h, i) => (
                  <HoldingRow key={h.symbol} holding={h} last={i === rows.length - 1}/>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
