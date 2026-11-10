const THEME_KEY = 'wamux_theme';

export function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function setDark(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
}
