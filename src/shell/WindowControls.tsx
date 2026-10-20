import { closeWindow, isMacOS, minimizeWindow, toggleMaximizeWindow } from "../lib/tauri";
import { CloseIcon, MaximizeIcon, MinusIcon } from "../lib/icons";
import "./WindowControls.css";

/**
 * Windows / Linux window controls.
 *
 * Extracted so the shell and the settings screen render the exact same
 * buttons: settings used to have no window controls at all, which meant the
 * window could only be closed from the app screen. On macOS the traffic
 * lights belong to the system, so nothing is rendered.
 */
export function WindowControls() {
  if (isMacOS()) return null;
  return (
    <div className="window-controls">
      <button
        className="icon-button"
        title="最小化"
        aria-label="最小化"
        onClick={() => void minimizeWindow()}
      >
        <MinusIcon />
      </button>
      <button
        className="icon-button"
        title="最大化"
        aria-label="最大化或还原"
        onClick={() => void toggleMaximizeWindow()}
      >
        <MaximizeIcon />
      </button>
      <button
        className="icon-button window-controls-close"
        title="关闭"
        aria-label="关闭窗口"
        onClick={() => void closeWindow()}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
