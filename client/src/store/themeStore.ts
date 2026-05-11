import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem('nimbus-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyMode(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(mode);

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', mode === 'dark' ? '#111113' : '#FAFAFB');
  }

  swapSyncfusionTheme(mode);
}

function swapSyncfusionTheme(mode: ThemeMode) {
  const id = 'syncfusion-theme';
  let link = document.getElementById(id) as HTMLLinkElement | null;
  const href = mode === 'dark'
    ? '/syncfusion-tailwind-dark.css'
    : '/syncfusion-tailwind.css';
  if (link) {
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  } else {
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = getInitialMode();
  if (typeof window !== 'undefined') applyMode(initial);

  return {
    mode: initial,
    setMode: (mode) => {
      localStorage.setItem('nimbus-theme', mode);
      applyMode(mode);
      set({ mode });
    },
    toggle: () => {
      const next = get().mode === 'dark' ? 'light' : 'dark';
      get().setMode(next);
    },
  };
});
