import { component$, event$, useContext, useStyles$ } from '@builder.io/qwik';
import { GlobalStore } from '../../context';
import { themeStorageKey } from '../router-head/theme-script';
import { SunAndMoon } from './sun-and-moon';
import themeToggle from './theme-toggle.css?inline';

export type ThemePreference = 'dark' | 'light';

export const colorSchemeChangeListener = (onColorSchemeChange: (isDark: boolean) => void) => {
  const listener = ({ matches: isDark }: MediaQueryListEvent) => {
    onColorSchemeChange(isDark);
  };
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (event) => listener(event));

  return () =>
    window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', listener);
};

export const setPreference = (theme: ThemePreference) => {
  localStorage.setItem(themeStorageKey, theme);
  reflectPreference(theme);
};

export const reflectPreference = (theme: ThemePreference) => {
  document.firstElementChild?.setAttribute('data-theme', theme);
};

export const getColorPreference = (): ThemePreference => {
  if (localStorage.getItem(themeStorageKey)) {
    return localStorage.getItem(themeStorageKey) as ThemePreference;
  } else {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
};

export const ThemeToggle = component$(() => {
  useStyles$(themeToggle);
  const state = useContext(GlobalStore);

  const onClick$ = event$(() => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    setPreference(state.theme);
  });

  return (
    <>
      <span class="lg:hidden">
        <button onClick$={onClick$}>{state.theme === 'light' ? 'Dark' : 'Light'} theme</button>
      </span>
      <span class="hidden lg:block">
        <button
          type="button"
          class="theme-toggle"
          id="theme-toggle"
          title="Toggles light & dark"
          aria-label={state.theme}
          aria-live="polite"
          onClick$={onClick$}
        >
          <SunAndMoon />
        </button>
      </span>
    </>
  );
});
