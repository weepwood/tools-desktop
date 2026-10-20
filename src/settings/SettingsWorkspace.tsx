import { useEffect, useMemo, useState } from "react";
import { useNavigation } from "../lib/navigation";
import { useShortcutHandlers } from "../lib/shortcuts";
import { SettingsBody } from "./SettingsView";
import { SettingsSidebar } from "./SettingsSidebar";
import "./SettingsWorkspace.css";

/** Settings is a child page of the local workspace inside the app shell. */
export function SettingsWorkspace({ onBack }: { onBack: () => void }) {
  const { settingsCategory, view } = useNavigation();
  const [category, setCategory] = useState(settingsCategory ?? "general");

  useEffect(() => {
    if (view === "settings") setCategory(settingsCategory ?? "general");
  }, [view, settingsCategory]);

  useShortcutHandlers(useMemo<Record<string, () => void>>(
    (): Record<string, () => void> => view === "settings" ? { "open-settings": onBack } : {},
    [onBack, view],
  ));

  return (
    <section className="settings-page" aria-label="设置">
      <div className="settings-page-body">
        <SettingsSidebar active={category} onSelect={setCategory} />
        <div className="settings-page-main">
          <SettingsBody category={category} />
        </div>
      </div>
    </section>
  );
}
