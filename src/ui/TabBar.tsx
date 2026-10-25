import { tab, type Tab } from '../state/store';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'aim', label: 'Aim', icon: '⌖' },
  { id: 'target', label: 'Target', icon: '◎' },
  { id: 'shots', label: 'Shots', icon: '☰' },
  { id: 'setup', label: 'Setup', icon: '⚙' },
];

export function TabBar() {
  return (
    <nav class="tabbar" aria-label="Screens">
      {TABS.map((t) => (
        <button key={t.id} class={tab.value === t.id ? 'active' : ''} aria-current={tab.value === t.id ? 'page' : undefined} onClick={() => (tab.value = t.id)}>
          <span class="tab-icon" aria-hidden="true">
            {t.icon}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
