import { useEffect, useState } from "react";
import {
  useShortcuts,
  setRecording,
  formatCombo,
  comboFromEvent,
  isModifierOnly,
} from "../lib/shortcuts";
import { SearchIcon, PencilIcon, TrashIcon } from "../lib/icons";
import "./ShortcutsSettings.css";

/**
 * Keyboard shortcuts editor: a searchable Command / Keybinding table.
 * Click a binding chip (or its pencil) to record a
 * new combo — Esc cancels; the trash unassigns. Defaults come from
 * SHORTCUT_ACTIONS in lib/shortcuts.ts.
 */
export function ShortcutsSettings() {
  const { actions, setBinding, resetAll, recordingActionId } = useShortcuts();
  const [query, setQuery] = useState("");

  // Capture-phase recorder so the pressed combo can't trigger the app
  // shortcut handlers while rebinding.
  useEffect(() => {
    if (recordingActionId === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      if (isModifierOnly(e)) return; // wait for a full combo
      setBinding(recordingActionId, comboFromEvent(e));
      setRecording(null);
    };
    const cancel = () => setRecording(null);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", cancel);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", cancel);
    };
  }, [recordingActionId, setBinding]);

  // Leaving the page mid-recording must not strand the flag.
  useEffect(() => () => setRecording(null), []);

  const visible = actions.filter(
    (a) =>
      a.label.toLowerCase().includes(query.toLowerCase()) ||
      a.description.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <div className="shortcuts-search">
        <SearchIcon />
        <input
          placeholder="搜索快捷键"
          aria-label="搜索快捷键"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="shortcuts-table">
        <div className="shortcuts-table-header">
          <span>操作</span>
          <span>快捷键</span>
        </div>

        {visible.map((action) => {
          const recording = recordingActionId === action.id;
          return (
            <div key={action.id} className="shortcuts-row">
              <div className="shortcuts-command">
                <div className="shortcuts-command-name">{action.label}</div>
                <div className="shortcuts-command-description">{action.description}</div>
              </div>

              <div className="shortcuts-binding">
                {recording ? (
                  <span className="shortcuts-chip" data-recording="true">
                    按下组合键…
                  </span>
                ) : action.combo ? (
                  <>
                    <button
                      className="shortcuts-chip"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setRecording(action.id)}
                    >
                      {formatCombo(action.combo)}
                    </button>
                    <button
                      className="icon-button shortcuts-row-action"
                      title="修改快捷键"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => setRecording(action.id)}
                    >
                      <PencilIcon />
                    </button>
                  </>
                ) : (
                  <button
                    className="shortcuts-unassigned"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setRecording(action.id)}
                  >
                    未设置
                  </button>
                )}
              </div>

              <div className="shortcuts-row-end">
                {action.combo && !recording && (
                  <button
                    className="icon-button shortcuts-row-action"
                    title="移除快捷键"
                    onClick={() => setBinding(action.id, null)}
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {visible.length === 0 && <div className="shortcuts-empty">没有匹配的快捷键</div>}
      </div>

      <button className="shortcuts-reset" onClick={resetAll}>
        恢复默认快捷键
      </button>
    </>
  );
}
