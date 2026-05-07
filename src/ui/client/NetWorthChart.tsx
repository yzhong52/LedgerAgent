import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { NetWorthPoint } from './api';

export function NetWorthChart({ data }: { data: NetWorthPoint[] }) {
  const formatCurrency = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-CA')}`;
  
  return (
    <div style={{ height: 350, width: '100%', marginBottom: 40, marginTop: 10 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.5} />
          <XAxis 
            dataKey="date" 
            tick={{ fill: '#6b7280', fontSize: 12 }}
            tickMargin={10}
            minTickGap={30}
          />
          <YAxis 
            tickFormatter={formatCurrency}
            tick={{ fill: '#6b7280', fontSize: 12 }}
            domain={['auto', 'auto']}
            width={80}
            tickMargin={10}
          />
          <Tooltip 
            formatter={(value: any) => [formatCurrency(Number(value) || 0), 'Net Worth']}
            labelFormatter={(label) => `Date: ${label}`}
            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
          />
          <Line 
            type="monotone" 
            dataKey="amountCents" 
            stroke="#2563eb" 
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 6, fill: '#2563eb', stroke: '#fff', strokeWidth: 2 }} 
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
