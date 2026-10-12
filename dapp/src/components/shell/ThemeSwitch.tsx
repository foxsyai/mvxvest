import { ThemeChoice, useTheme } from 'hooks';

const NEXT: Record<ThemeChoice, ThemeChoice> = {
  dark: 'light',
  light: 'system',
  system: 'dark'
};
const LABEL: Record<ThemeChoice, string> = {
  system: 'as your system',
  light: 'light',
  dark: 'dark'
};

const icon = (choice: ThemeChoice) => {
  const stroke = {
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none'
  };
  if (choice === 'dark')
    return (
      <path {...stroke} d='M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z' />
    );
  if (choice === 'light')
    return (
      <g {...stroke}>
        <circle cx='12' cy='12' r='4' />
        <path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' />
      </g>
    );
  // As the system: a circle half dark, half light.
  return (
    <g>
      <circle cx='12' cy='12' r='8' {...stroke} />
      <path d='M12 4a8 8 0 0 1 0 16z' fill='currentColor' />
    </g>
  );
};

/** One icon: the moon (dark), the sun (light) or half and half (system). */
export const ThemeSwitch = () => {
  const { choice, choose } = useTheme();
  return (
    <button
      type='button'
      onClick={() => choose(NEXT[choice])}
      aria-label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[NEXT[choice]]}.`}
      title={`Theme: ${LABEL[choice]}. Press for ${LABEL[NEXT[choice]]}.`}
      className='shrink-0 rounded-lg border border-line p-2 text-muted hover:border-accent hover:text-ink'
    >
      <svg width='16' height='16' viewBox='0 0 24 24' aria-hidden>
        {icon(choice)}
      </svg>
    </button>
  );
};
