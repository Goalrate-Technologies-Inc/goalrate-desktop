/**
 * Theme Context and Provider
 *
 * Provides dark mode support based on system preference.
 * Uses class-based dark mode (adds/removes 'dark' class on document root).
 * Automatically follows the operating system's theme setting.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** Current theme based on system preference */
  theme: ResolvedTheme;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') {
    return;
  }
  try {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  } catch {
    // Document may not be available in test environments
  }
}

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Theme provider that automatically follows system preference.
 * No manual theme switching - always matches OS dark/light mode.
 */
export function ThemeProvider({ children }: ThemeProviderProps): React.ReactElement {
  const [theme, setTheme] = useState<ResolvedTheme>(getSystemTheme);

  // Apply theme class to document
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for system theme changes
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    try {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent): void => {
        setTheme(e.matches ? 'dark' : 'light');
      };

      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } catch {
      // matchMedia may not be available in test environments
      return undefined;
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access the current theme.
 * Returns the system-detected theme (light or dark).
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * Hook to get current theme without requiring ThemeProvider.
 * Watches the document's dark class for changes.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  useEffect(() => {
    // Check for dark class on document
    const checkTheme = (): void => {
      if (typeof document !== 'undefined') {
        setResolvedTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
      }
    };

    checkTheme();

    // Watch for class changes
    const observer = new MutationObserver(checkTheme);
    if (typeof document !== 'undefined') {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }

    return () => observer.disconnect();
  }, []);

  return resolvedTheme;
}
