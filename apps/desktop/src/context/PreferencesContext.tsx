/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type PreferencesState = {
  openMarkdownInApp: boolean;
};

type PreferencesContextValue = PreferencesState & {
  setOpenMarkdownInApp: (next: boolean) => void;
};

const STORAGE_KEY = 'goalrate.desktop.preferences';

const defaultPreferences: PreferencesState = {
  openMarkdownInApp: true,
};

function readPreferences(): PreferencesState {
  if (typeof window === 'undefined') {
    return defaultPreferences;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return defaultPreferences;
    }
    const parsed = JSON.parse(stored) as Partial<PreferencesState>;
    return {
      openMarkdownInApp: parsed.openMarkdownInApp ?? defaultPreferences.openMarkdownInApp,
    };
  } catch (error) {
    console.warn('Failed to read preferences:', error);
    return defaultPreferences;
  }
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<PreferencesState>(() => readPreferences());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const setOpenMarkdownInApp = useCallback((next: boolean) => {
    setState((prev) => ({ ...prev, openMarkdownInApp: next }));
  }, []);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      ...state,
      setOpenMarkdownInApp,
    }),
    [setOpenMarkdownInApp, state]
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
}
