import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/*
 * Minimal two-view "router": the app shell and the settings view.
 * Swap for a real router if the app grows actual routes.
 */

export type View = "shell" | "settings";

interface NavigateOptions {
  /** When navigating to settings, pre-select this category id. */
  settingsCategory?: string;
}

interface NavigationContextValue {
  view: View;
  /** Category the settings view should open to, set by the last navigate(). */
  settingsCategory?: string;
  navigate: (v: View, opts?: NavigateOptions) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>("shell");
  const [settingsCategory, setSettingsCategory] = useState<string>();

  const navigate = useCallback((v: View, opts?: NavigateOptions) => {
    setView(v);
    if (opts?.settingsCategory !== undefined) setSettingsCategory(opts.settingsCategory);
  }, []);

  const value = useMemo(
    () => ({ view, settingsCategory, navigate }),
    [view, settingsCategory, navigate],
  );
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used inside <NavigationProvider>");
  return ctx;
}
