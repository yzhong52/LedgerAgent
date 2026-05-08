import { Icon } from './Icons';
import { type DemoMode } from './api';

type Page = 'dashboard' | 'accounts';

interface SidebarProps {
  page: Page;
  setPage: (page: Page) => void;
  demo: DemoMode;
  setDemo: (demo: DemoMode) => void;
}

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Overview', icon: 'overview' },
  { id: 'accounts',  label: 'Accounts',  icon: 'accounts'  },
];

const ACCENT = 260;

const DEMO_CYCLE: DemoMode[] = [null, 'rich', 'poor'];
const DEMO_LABEL: Record<NonNullable<DemoMode>, string> = { rich: 'Rich', poor: 'Poor' };
const DEMO_BG:    Record<NonNullable<DemoMode>, string> = { rich: 'oklch(0.93 0.07 145)', poor: 'oklch(0.93 0.07 20)' };
const DEMO_BG_HV: Record<NonNullable<DemoMode>, string> = { rich: 'oklch(0.88 0.09 145)', poor: 'oklch(0.88 0.09 20)' };
const DEMO_FG:    Record<NonNullable<DemoMode>, string> = { rich: 'oklch(0.38 0.14 145)', poor: 'oklch(0.42 0.15 20)' };

export function Sidebar({ page, setPage, demo, setDemo }: SidebarProps) {
  function cycleDemo() {
    const next = DEMO_CYCLE[(DEMO_CYCLE.indexOf(demo) + 1) % DEMO_CYCLE.length];
    setDemo(next);
  }
  return (
    <div style={{
      width: 220, minHeight: '100vh',
      background: 'oklch(0.99 0.003 60)',
      borderRight: '1px solid oklch(0.92 0.005 260)',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      <div style={{
        padding: '20px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid oklch(0.93 0.005 260)', minHeight: 60,
      }}>
        <img src="/favicon.png" alt="OpenVault" width={28} height={28} style={{ borderRadius: 8, flexShrink: 0 }}/>
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>OpenVault</span>
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
                background: active ? `oklch(0.94 0.04 ${ACCENT})` : 'transparent',
                color: active ? `oklch(0.45 0.18 ${ACCENT})` : 'oklch(0.45 0.01 260)',
                transition: 'background 0.12s, color 0.12s',
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'oklch(0.95 0.005 260)'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <Icon name={item.icon} size={15}/>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: '12px 8px', borderTop: '1px solid oklch(0.93 0.005 260)' }}>
        <button
          onClick={cycleDemo}
          title="Cycle demo mode: off → rich → poor"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', padding: '8px 12px',
            borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
            fontFamily: 'inherit', fontSize: 13,
            background: demo ? DEMO_BG[demo] : 'transparent',
            color: demo ? DEMO_FG[demo] : 'oklch(0.55 0.01 260)',
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background =
              demo ? DEMO_BG_HV[demo] : 'oklch(0.95 0.005 260)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background =
              demo ? DEMO_BG[demo] : 'transparent';
          }}
        >
          <Icon name="demo" size={15}/>
          {demo ? `Demo: ${DEMO_LABEL[demo]}` : 'Demo: Off'}
        </button>
      </div>
    </div>
  );
}
