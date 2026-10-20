import { useLayoutEffect, useRef, useState } from "react";
import {
  SearchIcon,
  GearIcon,
  KeyboardIcon,
  MailIcon,
  PluginIcon,
  TerminalIcon,
} from "../lib/icons";
import { searchSettings } from "./settingsSearch";
import type { ComponentType, SVGProps } from "react";
import { SidebarMarker, useSidebarMarker } from "../shell/SidebarMarker";
import "./SettingsSidebar.css";

export interface SettingsCategory {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  section: string;
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: "general", label: "常规", icon: GearIcon, section: "应用" },
  { id: "mail", label: "邮件通知", icon: MailIcon, section: "应用" },
  { id: "appearance", label: "外观", icon: PluginIcon, section: "应用" },
  { id: "shortcuts", label: "快捷键", icon: KeyboardIcon, section: "应用" },
  { id: "advanced", label: "高级", icon: TerminalIcon, section: "系统" },
];

interface SettingsSidebarProps {
  active: string;
  visible: boolean;
  onSelect: (id: string) => void;
}

/**
 * Settings navigation: search field, then categories grouped by section.
 * Returning to the workspace is handled by the page header, so this column
 * starts directly with search.
 */
export function SettingsSidebar({ active, visible, onSelect }: SettingsSidebarProps) {
  const [query, setQuery] = useState("");
  const [animateMarker, setAnimateMarker] = useState(false);
  const markerHasEntered = useRef(false);

  const sections = [...new Set(SETTINGS_CATEGORIES.map((c) => c.section))];
  const trimmed = query.trim();
  const results = trimmed ? searchSettings(query, SETTINGS_CATEGORIES) : [];
  const marker = useSidebarMarker(active, visible && !trimmed);

  useLayoutEffect(() => {
    if (!visible) {
      markerHasEntered.current = false;
      setAnimateMarker(false);
      return;
    }
    if (marker.top === null || markerHasEntered.current) return;

    const frame = window.requestAnimationFrame(() => {
      markerHasEntered.current = true;
      setAnimateMarker(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visible, marker.top]);

  const openResult = (id: string) => {
    setQuery("");
    onSelect(id);
  };

  return (
    <aside className="settings-sidebar">
      <div className="settings-search">
        <SearchIcon />
        <input
          placeholder="搜索设置…"
          aria-label="搜索设置"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {trimmed ? (
        <div className="settings-sidebar-nav settings-search-results">
          {results.length === 0 ? (
            <div className="settings-search-empty">没有匹配“{trimmed}”的设置</div>
          ) : (
            results.map(({ categoryId, labelMatch, rows }) => {
              const cat = SETTINGS_CATEGORIES.find((c) => c.id === categoryId);
              if (!cat) return null;
              const Icon = cat.icon;
              // Rows that matched, or the category label itself when only
              // the label matched (e.g. searching "profile").
              const snippets =
                rows.length > 0 ? rows.map((r) => r.title) : labelMatch ? [cat.label] : [];
              return (
                <button
                  key={categoryId}
                  className="settings-search-result"
                  onClick={() => openResult(categoryId)}
                >
                  <div className="settings-search-result-category">
                    <Icon className="sidebar-item-icon" />
                    <span>{cat.label}</span>
                  </div>
                  {snippets.map((text, i) => (
                    <div key={i} className="settings-search-result-snippet">
                      {text}
                    </div>
                  ))}
                </button>
              );
            })
          )}
        </div>
      ) : (
        <nav className="settings-sidebar-nav" ref={marker.navRef}>
          <SidebarMarker top={marker.top} animate={animateMarker} />
          {sections.map((section) => (
            <div key={section}>
              <div className="sidebar-section-title">{section}</div>
              {SETTINGS_CATEGORIES.filter((c) => c.section === section).map(
                ({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    className="sidebar-item"
                    data-active={id === active}
                    onClick={() => onSelect(id)}
                  >
                    <Icon className="sidebar-item-icon" />
                    <span className="sidebar-item-label">{label}</span>
                  </button>
                ),
              )}
            </div>
          ))}
        </nav>
      )}
    </aside>
  );
}
