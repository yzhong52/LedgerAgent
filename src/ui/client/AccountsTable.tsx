import React from 'react';
import type { AccountRow } from './api';

export function AccountsTable({ accounts }: { accounts: AccountRow[] }) {
    const sorted = [...accounts].sort((a, b) => {
        const instCmp = a.institutionName.localeCompare(b.institutionName);
        if (instCmp !== 0) return instCmp;
        return a.accountName.localeCompare(b.accountName);
    });

    const formatCurrency = (cents: number | null, currency: string | null) => {
        if (cents === null) return '—';
        const val = Math.abs(cents) / 100;
        const str = val.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formatted = cents < 0 ? `-$${str}` : `$${str}`;
        return currency ? `${currency} ${formatted}` : formatted;
    };

    return (
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: 10 }}>
            <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ padding: '12px 8px', fontWeight: 600 }}>Institution</th>
                    <th style={{ padding: '12px 8px', fontWeight: 600 }}>Account</th>
                    <th style={{ padding: '12px 8px', fontWeight: 600 }}>Type</th>
                    <th style={{ padding: '12px 8px', fontWeight: 600, textAlign: 'right' }}>Balance</th>
                </tr>
            </thead>
            <tbody>
                {sorted.map((a) => (
                    <tr key={`${a.institutionName}-${a.accountName}`} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '12px 8px' }}>{a.institutionName}</td>
                        <td style={{ padding: '12px 8px' }}>{a.accountName}</td>
                        <td style={{ padding: '12px 8px', color: '#6b7280' }}>{a.accountType || '—'}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 500 }}>
                            {formatCurrency(a.amountCents, a.accountCurrency)}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
