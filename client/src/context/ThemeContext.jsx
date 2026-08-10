import { useEffect, useState } from 'react';
import { ThemeContext } from './theme-context';

// Compatibility export: application consumers now import the hook from its
// Fast Refresh-safe module, while existing external imports remain valid.
// eslint-disable-next-line react-refresh/only-export-components
export { useTheme } from './theme-context';

const STORAGE_KEY = 'theme';
const TRANSITION_CLASS = 'theme-transitioning';
const TRANSITION_DURATION = 300;

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(
    () => localStorage.getItem(STORAGE_KEY) || 'dark'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    document.documentElement.classList.add(TRANSITION_CLASS);
    setTimeout(
      () => document.documentElement.classList.remove(TRANSITION_CLASS),
      TRANSITION_DURATION
    );
    setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
