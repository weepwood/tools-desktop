import { useRef, useState, type ReactNode } from "react";
import type { Combo } from "./shortcuts";
import { formatCombo } from "./shortcuts";
import "./Tooltip.css";

interface TooltipProps {
  label: string;
  /** Optional shortcut rendered as a kbd chip after the label. */
  shortcut?: Combo | null;
  /** Horizontal anchor, for buttons near a window edge. */
  align?: "center" | "left" | "right";
  children: ReactNode;
}

const SHOW_DELAY = 450;

/**
 * Hover tooltip: dark pill under the target with the action name and
 * its keyboard shortcut. Pure CSS positioning — wrap a single button.
 */
export function Tooltip({ label, shortcut, align = "center", children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<number>(undefined);

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(true), SHOW_DELAY);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setVisible(false);
  };

  return (
    <span
      className="tooltip-anchor"
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
    >
      {children}
      {visible && (
        <span className="tooltip" data-align={align} role="tooltip">
          <span>{label}</span>
          {shortcut && <kbd className="tooltip-kbd">{formatCombo(shortcut)}</kbd>}
        </span>
      )}
    </span>
  );
}
