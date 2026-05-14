import React from 'react';

interface IconProps { name: string; size?: number; }

export function Icon({ name, size = 16 }: IconProps) {
  const icons: Record<string, React.ReactNode> = {
    overview: (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".9"/>
        <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".4"/>
        <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".4"/>
        <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".4"/>
      </svg>
    ),
    accounts: (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <rect x="1" y="4" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4 4V3a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="8" cy="9" r="1.5" fill="currentColor"/>
      </svg>
    ),
    chevron: (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    transactions: (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M3 1.5h10v13l-2-1.5-2 1.5-2-1.5-2 1.5V1.5z"
              stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    holdings: (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <rect x="1"  y="7" width="3" height="8" rx="1" fill="currentColor" opacity=".5"/>
        <rect x="6"  y="3" width="3" height="12" rx="1" fill="currentColor" opacity=".8"/>
        <rect x="11" y="5" width="3" height="10" rx="1" fill="currentColor"/>
        <path d="M1.5 6L6 2.5l5 2 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    demo: (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M6 1.5h4M6 1.5V6L2.5 13h11L10 6V1.5"
              stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="7" cy="10.5" r="1" fill="currentColor" opacity=".6"/>
      </svg>
    ),
  };
  return <>{icons[name] ?? null}</>;
}
