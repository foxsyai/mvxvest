import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'mvxvest:theme';

const read = (): ThemeChoice => {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
};

const apply = (choice: ThemeChoice) => {
  const dark =
    choice === 'dark' ||
    (choice === 'system' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  // sdk-dapp's own panels (connect, signing, toasts) follow the same theme.
  document.documentElement.setAttribute(
    'data-mvx-theme',
    dark ? 'mvx:dark-theme' : 'mvx:light-theme'
  );
};

/** Light, dark or the system's setting; remembered in this browser only. */
export const useTheme = () => {
  const [choice, setChoice] = useState<ThemeChoice>(read);

  useEffect(() => {
    apply(choice);
    if (choice !== 'system') return;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const follow = () => apply('system');
    media?.addEventListener?.('change', follow);
    return () => media?.removeEventListener?.('change', follow);
  }, [choice]);

  const choose = useCallback((next: ThemeChoice) => {
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    setChoice(next);
  }, []);

  return { choice, choose };
};
