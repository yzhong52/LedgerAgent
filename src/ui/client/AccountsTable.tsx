import { useState } from 'react';
import type { AccountRow } from './api';
import { fmtCents } from './utils';
import { Icon } from './Icons';
import { InstBadge } from './InstBadge';

type GroupBy = 'institution' | 'type';

export function AccountsPage({ accounts }: { accounts: AccountRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('institution');

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
                  {accts.map((a, i) => (
                    <div key={a.accountId} style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: groupBy === 'institution'
                        ? '13px 22px 13px 72px'
                        : '13px 22px 13px 22px',
                      borderBottom: i < accts.length - 1 ? '1px solid oklch(0.95 0.003 260)' : 'none',
                      background: 'oklch(0.985 0.003 60)',
                    }}>
                      {groupBy === 'type' && (
                        <InstBadge name={a.institutionName} size={28}/>
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                          {a.accountName}
                          {a.accountId && (
                            <span style={{
                              fontSize: 11, fontWeight: 400,
                              color: 'oklch(0.6 0.01 260)', background: 'oklch(0.96 0.005 260)',
                              padding: '2px 6px', borderRadius: 4, fontFamily: "'DM Mono', monospace",
                            }}>
                              {a.accountId}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'oklch(0.6 0.01 260)', marginTop: 2 }}>
                          {groupBy === 'type'
                            ? [a.institutionName, a.accountCurrency].filter(Boolean).join(' · ')
                            : [a.accountType, a.accountCurrency].filter(Boolean).join(' · ')}
                          {a.latestDate && ` · synced ${a.latestDate}`}
                        </div>
                      </div>
                      <div style={{
                        fontFamily: "'DM Mono', monospace", fontSize: 15, fontWeight: 500,
                        color: (a.amountCents ?? 0) >= 0 ? 'oklch(0.15 0.01 260)' : 'oklch(0.5 0.15 20)',
                      }}>
                        {fmtCents(a.amountCents)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
