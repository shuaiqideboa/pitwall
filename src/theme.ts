// Light or dark interface, chosen by the player on the home page and
// remembered in this browser. Dark is the default look.

export type Theme = 'dark' | 'light';

const THEME_KEY = 'pitwall-theme';

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Show the game in this theme (styles.css switches on `data-theme`), and remember it. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the choice just lasts for this visit.
  }
}
