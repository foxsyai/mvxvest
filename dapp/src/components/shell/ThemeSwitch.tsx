import { ThemeChoice, useTheme } from 'hooks';

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: 'light',
  light: 'dark',
  dark: 'system'
};
const LABEL: Record<ThemeChoice, string> = {
  system: 'Auto',
  light: 'Light',
  dark: 'Dark'
};

/** Cycles Auto (the system's setting), Light and Dark. */
export const ThemeSwitch = () => {
  const { choice, choose } = useTheme();
  return (
    <button
      type='button'
      onClick={() => choose(NEXT[choice])}
      title={`Theme: ${LABEL[choice]}. Press for ${LABEL[NEXT[choice]]}.`}
      className='rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-muted hover:border-accent hover:text-ink'
    >
      {LABEL[choice]}
    </button>
  );
};
