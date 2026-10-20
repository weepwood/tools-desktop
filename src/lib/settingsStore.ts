import { useCallback, useEffect, useState } from "react";
import { isTauri } from "./tauri";

/*
 * App settings persist through the Electron main process (and fall back to
 * localStorage in a plain browser). Extend AppSettings + DEFAULT_SETTINGS
 * to make a preference available throughout the app.
 */

/**
 * Which structural parts of the UI are enabled. HALO ships one window layout,
 * so this is down to the navigation rail; the old tab strip / right inspector /
 * bottom dock flags were permanently false and have been removed with the
 * panels they described.
 */
export interface UIVisibility {
  leftSidebar: boolean;
}

export type NoticePosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

export interface AppSettings {
  displayName: string;
  language: "auto" | "en" | "sl" | "de";
  reduceMotion: "system" | "on" | "off";
  uiFont: "system" | "segoe" | "yahei" | "dengxian" | "source-han";
  notifications: boolean;
  noticePosition: NoticePosition;
  telemetry: boolean;
  /** Keep an icon in the menu bar / system tray. Read by Rust at startup. */
  showInMenuBar: boolean;
  /** When launching at login, start hidden in the menu bar. */
  startMinimized: boolean;
  ui: UIVisibility;
}

export const DEFAULT_SETTINGS: AppSettings = {
  displayName: "",
  language: "auto",
  reduceMotion: "system",
  uiFont: "system",
  notifications: true,
  noticePosition: "bottom-right",
  telemetry: false,
  showInMenuBar: true,
  startMinimized: false,
  ui: {
    leftSidebar: true,
  },
};

const STORE_FILE = "settings.json";
const FALLBACK_KEY = "app:settings";
const UI_FONT_KEY = "app:ui-font";
const UI_FONTS = ["system", "segoe", "yahei", "dengxian", "source-han"] as const;

type Listener = (s: AppSettings) => void;

/** Merge persisted settings over the defaults, deep-merging nested `ui`. */
function withDefaults(saved: Partial<AppSettings> | null | undefined): AppSettings {
  const uiFont = UI_FONTS.find((font) => font === saved?.uiFont) ?? "system";
  const noticePosition = ["top-left", "top-right", "bottom-left", "bottom-right", "center"]
    .find((position) => position === saved?.noticePosition) as NoticePosition | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    uiFont,
    noticePosition: noticePosition ?? DEFAULT_SETTINGS.noticePosition,
    // Only the navigation rail is configurable; legacy scaffold keys in an old
    // settings file are ignored instead of resurrecting dead panels.
    ui: { leftSidebar: saved?.ui?.leftSidebar !== false },
  };
}

let current: AppSettings = { ...DEFAULT_SETTINGS };
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<Listener>();

async function load(): Promise<void> {
  if (loaded) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        if (isTauri()) {
          const saved = await window.halo!.invoke<Partial<AppSettings> | null>("settings_get", { file: STORE_FILE });
          current = withDefaults(saved);
        } else {
          const raw = localStorage.getItem(FALLBACK_KEY);
          if (raw) current = withDefaults(JSON.parse(raw));
        }
      } catch (e) {
        console.warn("Failed to load settings, using defaults:", e);
      }
      try {
        localStorage.setItem(UI_FONT_KEY, current.uiFont);
      } catch {}
      loaded = true;
      listeners.forEach((l) => l(current));
    })();
  }
  return loadPromise;
}

async function persist(next: AppSettings) {
  current = next;
  try {
    localStorage.setItem(UI_FONT_KEY, next.uiFont);
  } catch {}
  listeners.forEach((l) => l(current));
  try {
    if (isTauri()) {
      await window.halo!.invoke("settings_set", { file: STORE_FILE, settings: next });
    } else {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(next));
    }
  } catch (e) {
    console.warn("Failed to persist settings:", e);
  }
}

/** Read + update app settings; re-renders on change from anywhere. */
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(current);

  useEffect(() => {
    const listener: Listener = (s) => setSettings({ ...s });
    listeners.add(listener);
    void load();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const update = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    void persist({ ...current, [key]: value });
  }, []);

  const reset = useCallback(() => {
    void persist({ ...DEFAULT_SETTINGS });
  }, []);

  return { settings, update, reset };
}
