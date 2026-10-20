import { useCallback, useEffect, useState } from "react";
import { isMacOS } from "./tauri";

/*
 * Keyboard shortcut system.
 *
 * Every app command lives in SHORTCUT_ACTIONS with a default combo.
 * User overrides persist to localStorage. Components install handlers
 * with useShortcutHandlers() and read/edit bindings with
 * useShortcuts() (the settings page). "primary" means Cmd on macOS
 * and Ctrl elsewhere, so defaults stay portable.
 */

export interface Combo {
  /** Logical key, lowercase ("b", ",", "arrowleft"). */
  key: string;
  /** Cmd on macOS, Ctrl on Windows/Linux. */
  primary?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export interface ShortcutAction {
  id: string;
  label: string;
  description: string;
  defaultCombo: Combo | null;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: "open-settings",
    label: "设置",
    description: "打开或关闭设置页面",
    defaultCombo: { key: ",", primary: true },
  },
  {
    id: "toggle-left",
    label: "左侧导航",
    description: "显示或隐藏左侧导航栏",
    defaultCombo: { key: "b", primary: true },
  },
];

/* ---- Persistence (module-level store with subscribers) ---- */

const STORAGE_KEY = "app:shortcuts";
type Overrides = Record<string, Combo | null>;

function loadOverrides(): Overrides {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Overrides;
  } catch {
    return {};
  }
}

let overrides: Overrides = loadOverrides();
const subscribers = new Set<() => void>();

function saveOverrides(next: Overrides) {
  overrides = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — overrides stay in-memory
  }
  subscribers.forEach((fn) => fn());
}

export function getBinding(id: string): Combo | null {
  if (id in overrides) return overrides[id];
  return SHORTCUT_ACTIONS.find((a) => a.id === id)?.defaultCombo ?? null;
}

/* ---- Matching ---- */

/** Set while the settings page records a new combo; suspends handlers. */
export let recordingActionId: string | null = null;
export function setRecording(id: string | null) {
  recordingActionId = id;
  subscribers.forEach((fn) => fn());
}

/**
 * Logical key from a keyboard event. Uses e.code for letters/digits
 * because macOS Alt changes e.key ("⌥B" reports "∫").
 */
export function keyFromEvent(e: KeyboardEvent): string {
  const code = e.code;
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  const punctuation: Record<string, string> = {
    Comma: ",",
    Period: ".",
    Slash: "/",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Minus: "-",
    Equal: "=",
    Backquote: "`",
  };
  if (code in punctuation) return punctuation[code];
  return e.key.toLowerCase();
}

export function matchesCombo(e: KeyboardEvent, combo: Combo): boolean {
  const primaryDown = isMacOS() ? e.metaKey : e.ctrlKey;
  return (
    keyFromEvent(e) === combo.key &&
    primaryDown === !!combo.primary &&
    e.altKey === !!combo.alt &&
    e.shiftKey === !!combo.shift
  );
}

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);

export function isModifierOnly(e: KeyboardEvent): boolean {
  return MODIFIER_KEYS.has(e.key);
}

/** Build a Combo from a recorded keydown. */
export function comboFromEvent(e: KeyboardEvent): Combo {
  return {
    key: keyFromEvent(e),
    primary: isMacOS() ? e.metaKey : e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
  };
}

/* ---- Display formatting ---- */

const KEY_GLYPHS: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  enter: "↩",
  escape: "⎋",
  backspace: "⌫",
  delete: "⌦",
  tab: "⇥",
  " ": "Space",
};

function displayKey(key: string): string {
  return KEY_GLYPHS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** "⌥⌘B" on macOS (standard ⌃⌥⇧⌘ order), "Ctrl+Alt+B" elsewhere. */
export function formatCombo(combo: Combo): string {
  if (isMacOS()) {
    let out = "";
    if (combo.alt) out += "⌥";
    if (combo.shift) out += "⇧";
    if (combo.primary) out += "⌘";
    return out + displayKey(combo.key);
  }
  const parts: string[] = [];
  if (combo.primary) parts.push("Ctrl");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  parts.push(displayKey(combo.key));
  return parts.join("+");
}

/* ---- Hooks ---- */

function useSubscription() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
}

/** Bindings + editing API (settings page, tooltips). */
export function useShortcuts() {
  useSubscription();

  const setBinding = useCallback((id: string, combo: Combo | null) => {
    saveOverrides({ ...overrides, [id]: combo });
  }, []);

  const resetAll = useCallback(() => {
    saveOverrides({});
  }, []);

  return {
    actions: SHORTCUT_ACTIONS.map((a) => ({ ...a, combo: getBinding(a.id) })),
    binding: getBinding,
    setBinding,
    resetAll,
    recordingActionId,
  };
}

/** Install handlers for shortcut actions while the component is mounted. */
export function useShortcutHandlers(handlers: Record<string, () => void>) {
  useSubscription();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (recordingActionId !== null) return;
      for (const id of Object.keys(handlers)) {
        const combo = getBinding(id);
        if (combo && matchesCombo(e, combo)) {
          e.preventDefault();
          handlers[id]();
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
