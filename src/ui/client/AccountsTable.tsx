import { useState } from 'react';
import type { AccountRow, HoldingRow } from './api';
import { fmtCents } from './utils';
import { Icon } from './Icons';
import { InstBadge } from './InstBadge';

function fmtQty(q: number): string {
  if (Number.isInteger(q)) return q.toLocaleString('en-CA');
  return q.toLocaleString('en-CA', { maximumFractionDigits: 4 });
}

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  'TFSA':       { bg: 'oklch(0.93 0.07 145)', text: 'oklch(0.32 0.14 145)' },
  'RRSP':       { bg: 'oklch(0.92 0.06 270)', text: 'oklch(0.33 0.15 270)' },
  'FHSA':       { bg: 'oklch(0.92 0.08 195)', text: 'oklch(0.33 0.13 195)' },
  'RRIF':       { bg: 'oklch(0.91 0.07 290)', text: 'oklch(0.36 0.14 290)' },
  'LIF':        { bg: 'oklch(0.91 0.07 290)', text: 'oklch(0.36 0.14 290)' },
  'LIRA':       { bg: 'oklch(0.92 0.06 260)', text: 'oklch(0.36 0.14 260)' },
  'RESP':       { bg: 'oklch(0.93 0.09 65)',  text: 'oklch(0.38 0.15 55)'  },
  'RDSP':       { bg: 'oklch(0.92 0.07 350)', text: 'oklch(0.38 0.14 350)' },
  'Brokerage':  { bg: 'oklch(0.92 0.07 240)', text: 'oklch(0.36 0.14 240)' },
  'Investment': { bg: 'oklch(0.92 0.07 240)', text: 'oklch(0.36 0.14 240)' },
};
const DEFAULT_TYPE_COLOR = { bg: 'oklch(0.94 0.005 260)', text: 'oklch(0.45 0.01 260)' };

function TypeBadge({ type }: { type: string }) {
  const { bg, text } = TYPE_COLORS[type] ?? DEFAULT_TYPE_COLOR;
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
      textTransform: 'uppercase', background: bg, color: text,
      padding: '2px 6px', borderRadius: 4,
    }}>
      {type}
    </span>
  );
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  'Cash':               { bg: 'oklch(0.93 0.06 145)', text: 'oklch(0.32 0.13 145)' },
  'Credit':             { bg: 'oklch(0.92 0.07 20)',  text: 'oklch(0.38 0.15 20)'  },
  'Brokerage':          { bg: 'oklch(0.92 0.07 240)', text: 'oklch(0.36 0.14 240)' },
  'Managed Investment': { bg: 'oklch(0.92 0.06 270)', text: 'oklch(0.33 0.15 270)' },
};

function CategoryBadge({ category }: { category: string }) {
  const { bg, text } = CATEGORY_COLORS[category] ?? DEFAULT_TYPE_COLOR;
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
      textTransform: 'uppercase', background: bg, color: text,
      padding: '2px 6px', borderRadius: 4,
    }}>
      {category}
    </span>
  );
}

type GroupBy = 'institution' | 'type';

interface Props {
  accounts: AccountRow[];
  holdings: HoldingRow[];
}

export function AccountsPage({ accounts, holdings }: Props) {
  const [expanded,        setExpanded]        = useState<string | null>(null);
  const [expandedHolding, setExpandedHolding] = useState<string | null>(null);
  const [groupBy,         setGroupBy]         = useState<GroupBy>('institution');
  const institutions = Array.from(new Set(accounts.map(a => a.institutionName)));

  const groups: { key: string; label: string; accts: AccountRow[] }[] =
    groupBy === 'institution'
      ? institutions.map(inst => ({
          key: inst,
          label: inst,
          accts: accounts.filter(a => a.institutionName === inst),
        }))
      : Array.from(new Set(accounts.map(a => a.accountType ?? 'Unknown'))).map(type => ({
          key: type,
          label: type,
          accts: accounts.filter(a => (a.accountType ?? 'Unknown') === type),
        }));

  const handleGroupBy = (mode: GroupBy) => {
    setGroupBy(mode);
    setExpanded(null);
  };

  return (
    <div style={{ padding: '32px 36px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em' }}>Accounts</h1>
          <p style={{ fontSize: 14, color: 'oklch(0.55 0.01 260)', marginTop: 3 }}>
            {accounts.length} account{accounts.length !== 1 ? 's' : ''} across{' '}
            {institutions.length} institution{institutions.length !== 1 ? 's' : ''}
          </p>
        </div>

        <select
          value={groupBy}
          onChange={e => handleGroupBy(e.target.value as GroupBy)}
          style={{
            padding: '5px 10px', borderRadius: 7,
            border: '1px solid oklch(0.88 0.005 260)',
            background: '#fff', color: 'oklch(0.3 0.01 260)',
            fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit',
            cursor: 'pointer', outline: 'none',
          }}
        >
          <option value="institution">By institution</option>
          <option value="type">By type</option>
        </select>
      </div>

      {accounts.length === 0 && (
        <div style={{
          background: '#fff', borderRadius: 12,
          border: '1px solid oklch(0.91 0.005 260)',
          padding: '40px 24px', textAlign: 'center',
          color: 'oklch(0.6 0.01 260)', fontSize: 14,
        }}>
          No accounts yet — run <code style={{ fontFamily: "'DM Mono', monospace" }}>sync</code> to get started.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groups.map(({ key, label, accts }) => {
          const total = accts.reduce((s, a) => s + (a.amountCents ?? 0), 0);
          const open  = expanded === key;

          return (
            <div key={key} style={{
              background: '#fff', borderRadius: 12,
              border: '1px solid oklch(0.91 0.005 260)', overflow: 'hidden',
            }}>
              <button
                onClick={() => setExpanded(open ? null : key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  width: '100%', padding: '16px 22px',
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'oklch(0.98 0.003 60)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                {groupBy === 'institution' ? (
                  <InstBadge name={label} size={36}/>
                ) : (
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: 'oklch(0.93 0.015 260)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Icon name="accounts" size={18}/>
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: 12.5, color: 'oklch(0.6 0.01 260)', marginTop: 2 }}>
                    {accts.length} account{accts.length !== 1 ? 's' : ''}
                    {groupBy === 'type' && (() => {
                      const insts = Array.from(new Set(accts.map(a => a.institutionName)));
                      return ` · ${insts.join(', ')}`;
                    })()}
                  </div>
                </div>
                <div style={{ marginRight: 8 }}>
                  <div style={{
                    fontFamily: "'DM Mono', monospace", fontSize: 17, fontWeight: 500,
                    color: total >= 0 ? 'oklch(0.15 0.01 260)' : 'oklch(0.5 0.15 20)',
                  }}>
                    {fmtCents(total)}
                  </div>
                </div>
                <div style={{
                  transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.18s', color: 'oklch(0.6 0.01 260)',
                }}>
                  <Icon name="chevron" size={16}/>
                </div>
              </button>

              {open && (
                <div style={{ borderTop: '1px solid oklch(0.93 0.005 260)' }}>
                  {accts.map((a, i) => {
                    const acctHoldings = holdings.filter(
                      h => h.institutionName === a.institutionName && h.accountName === a.accountName,
                    );
                    const holdingKey = `${a.institutionName}/${a.accountName}`;
                    const holdingOpen = expandedHolding === holdingKey;
                    const hasHoldings = acctHoldings.length > 0;
                    const isLast = i === accts.length - 1;

                    return (
                      <div key={a.accountId}>
                        <div
                          onClick={hasHoldings
                            ? () => setExpandedHolding(holdingOpen ? null : holdingKey)
                            : undefined}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 14,
                            padding: groupBy === 'institution'
                              ? '13px 22px 13px 72px'
                              : '13px 22px 13px 22px',
                            borderBottom: !holdingOpen && !isLast
                              ? '1px solid oklch(0.95 0.003 260)' : 'none',
                            background: 'oklch(0.985 0.003 60)',
                            cursor: hasHoldings ? 'pointer' : 'default',
                          }}
                          onMouseEnter={hasHoldings
                            ? e => { (e.currentTarget as HTMLElement).style.background = 'oklch(0.975 0.005 60)'; }
                            : undefined}
                          onMouseLeave={hasHoldings
                            ? e => { (e.currentTarget as HTMLElement).style.background = 'oklch(0.985 0.003 60)'; }
                            : undefined}
                        >
                          {groupBy === 'type' && (
                            <InstBadge name={a.institutionName} size={28}/>
                          )}
                          <div style={{ flex: 1 }}>
                            <div style={{
                              fontSize: 13.5, fontWeight: 500,
                              display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                              {a.accountName}
                              {a.accountId && (
                                <span style={{
                                  fontSize: 11, fontWeight: 400, color: 'oklch(0.6 0.01 260)',
                                  background: 'oklch(0.96 0.005 260)', padding: '2px 6px',
                                  borderRadius: 4, fontFamily: "'DM Mono', monospace",
                                }}>
                                  {a.accountId}
                                </span>
                              )}
                            </div>
                            <div style={{
                              fontSize: 12, color: 'oklch(0.6 0.01 260)', marginTop: 4,
                              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                            }}>
                              {a.accountType && <TypeBadge type={a.accountType}/>}
                              {a.accountCategory && <CategoryBadge category={a.accountCategory}/>}
                              {a.accountCurrency && <span>{a.accountCurrency}</span>}
                              {a.latestDate && (
                                <span>{a.accountCurrency ? '· ' : ''}synced {a.latestDate}</span>
                              )}
                            </div>
                          </div>
                          <div style={{
                            fontFamily: "'DM Mono', monospace", fontSize: 15, fontWeight: 500,
                            color: (a.amountCents ?? 0) >= 0
                              ? 'oklch(0.15 0.01 260)' : 'oklch(0.5 0.15 20)',
                          }}>
                            {fmtCents(a.amountCents)}
                          </div>
                          {hasHoldings && (
                            <div style={{
                              marginLeft: 6, flexShrink: 0,
                              transform: holdingOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                              transition: 'transform 0.18s', color: 'oklch(0.6 0.01 260)',
                            }}>
                              <Icon name="chevron" size={13}/>
                            </div>
                          )}
                        </div>

                        {holdingOpen && (
                          <div style={{
                            background: 'oklch(0.972 0.006 60)',
                            borderTop: '1px solid oklch(0.93 0.005 260)',
                            borderBottom: !isLast ? '1px solid oklch(0.95 0.003 260)' : 'none',
                          }}>
                            <div style={{
                              padding: '6px 22px 6px 88px',
                              display: 'grid',
                              gridTemplateColumns: '56px 1fr auto auto',
                              gap: '0 12px',
                              fontSize: 11, fontWeight: 500,
                              color: 'oklch(0.55 0.01 260)',
                              letterSpacing: '0.03em', textTransform: 'uppercase',
                              borderBottom: '1px solid oklch(0.93 0.005 260)',
                            }}>
                              <span>Symbol</span>
                              <span>Name</span>
                              <span style={{ textAlign: 'right' }}>Qty · Price</span>
                              <span style={{ textAlign: 'right' }}>Value</span>
                            </div>
                            {acctHoldings.map(h => (
                              <div key={h.symbol} style={{
                                padding: '9px 22px 9px 88px',
                                display: 'grid',
                                gridTemplateColumns: '56px 1fr auto auto',
                                gap: '0 12px',
                                alignItems: 'center',
                              }}>
                                <span style={{
                                  fontFamily: "'DM Mono', monospace",
                                  fontSize: 12.5, fontWeight: 600,
                                  color: 'oklch(0.25 0.01 260)',
                                }}>
                                  {h.symbol}
                                </span>
                                <span style={{
                                  fontSize: 12.5, color: 'oklch(0.5 0.01 260)',
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                  {h.name ?? ''}
                                </span>
                                <span style={{
                                  fontFamily: "'DM Mono', monospace",
                                  fontSize: 11.5, color: 'oklch(0.55 0.01 260)',
                                  textAlign: 'right', whiteSpace: 'nowrap',
                                }}>
                                  {fmtQty(h.quantity)} @ {fmtCents(h.pricePerUnitCents)}
                                </span>
                                <span style={{
                                  fontFamily: "'DM Mono', monospace",
                                  fontSize: 13, fontWeight: 500,
                                  color: 'oklch(0.15 0.01 260)',
                                  textAlign: 'right',
                                }}>
                                  {fmtCents(h.marketValueCents)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
