import { Icon } from './Icons';

export type Page = 'dashboard' | 'accounts' | 'transactions';

interface SidebarProps {
  page: Page;
  setPage: (page: Page) => void;
  demo: boolean;
  setDemo: (demo: boolean) => void;
}

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard',    label: 'Overview',     icon: 'overview'      },
  { id: 'accounts',     label: 'Accounts',     icon: 'accounts'      },
  { id: 'transactions', label: 'Transactions', icon: 'transactions'  },
];

export function Sidebar({ page, setPage, demo, setDemo }: SidebarProps) {
  return (
    <div style={{
      width: 220, height: '100vh',
      background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border-sidebar)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      <div style={{
        padding: '20px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid var(--border-subtle)', minHeight: 60,
      }}>
        <img src="/favicon.png" alt="LedgerAgent" width={28} height={28} style={{ borderRadius: 8, flexShrink: 0 }}/>
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>LedgerAgent</span>
      </div>

      <nav style={{ padding: '10px 8px', flex: 1 }}>
        {NAV.map(item => {
          const active = page === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '9px 12px', marginBottom: 2,
                borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
                fontFamily: 'inherit', fontSize: 13.5, fontWeight: active ? 500 : 400,
                background: active ? 'var(--bg-nav-active)' : 'transparent',
                color: active ? 'var(--text-nav-active)' : 'var(--text-nav)',
                transition: 'background 0.12s, color 0.12s',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-nav-hover)'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <Icon name={item.icon} size={15}/>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: '12px 8px', borderTop: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => setDemo(!demo)}
          title="Toggle demo mode"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', padding: '8px 12px',
            borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
            fontFamily: 'inherit', fontSize: 13,
            background: demo ? 'var(--demo-bg)' : 'transparent',
            color: demo ? 'var(--demo-fg)' : 'var(--text-secondary)',
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background =
              demo ? 'var(--demo-bg-hover)' : 'var(--bg-nav-hover)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background =
              demo ? 'var(--demo-bg)' : 'transparent';
          }}
        >
          <Icon name="demo" size={15}/>
          {demo ? 'Demo: On' : 'Demo: Off'}
        </button>
      </div>
    </div>
  );
}
