import { useMemo, useRef } from "react";
import { usePersistedState } from "../lib/usePersistedState";

export interface Tab {
  id: number;
  title: string;
}

const DEFAULT_TABS: Tab[] = [{ id: 1, title: "Welcome" }];

export interface TabsApi {
  tabs: Tab[];
  activeTab: Tab | null;
  addTab: () => void;
  closeTab: (id: number) => void;
  selectTab: (id: number) => void;
  cycle: (dir: 1 | -1) => void;
}

/**
 * Tab workspace state for the main view, shared between the title-bar
 * strip (which renders the tabs) and MainContent (which renders the
 * active tab's content). Open tabs and the active tab persist across
 * launches.
 */
export function useTabs(): TabsApi {
  const [tabs, setTabs] = usePersistedState<Tab[]>("app:tabs", DEFAULT_TABS);
  const [activeId, setActiveId] = usePersistedState<number | null>(
    "app:active-tab",
    DEFAULT_TABS[0].id,
  );

  // Monotonic id source, seeded past any persisted tab id so reopened
  // tabs never collide with existing ones.
  const idCounter = useRef(tabs.reduce((max, t) => Math.max(max, t.id), 0));
  const nextId = () => (idCounter.current += 1);

  // Self-heals a dangling activeId (e.g. persisted id no longer present).
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;

  const addTab = () => {
    const id = nextId();
    setTabs((prev) => [...prev, { id, title: `Tab ${id}` }]);
    setActiveId(id);
  };

  const closeTab = (id: number) => {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    // Only the active tab needs a new selection; closing a background
    // tab leaves the current one focused.
    if (activeTab?.id === id) {
      const fallback = remaining[Math.min(idx, remaining.length - 1)];
      setActiveId(fallback ? fallback.id : null);
    }
  };

  const cycle = (dir: 1 | -1) => {
    if (tabs.length === 0) return;
    const i = tabs.findIndex((t) => t.id === activeTab?.id);
    const base = i === -1 ? 0 : i;
    setActiveId(tabs[(base + dir + tabs.length) % tabs.length].id);
  };

  return useMemo(
    () => ({ tabs, activeTab, addTab, closeTab, selectTab: (id: number) => setActiveId(id), cycle }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, activeTab],
  );
}
