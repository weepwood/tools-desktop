import { useEffect, useRef, useState } from "react";
import { useNavigation } from "../lib/navigation";
import {
  GearIcon,
} from "../lib/icons";
import "./AccountArea.css";

const ACCOUNT = {
  name: "XIMA",
  email: "本地文件工具",
  initials: "XI",
};

const HOVER_CLOSE_DELAY = 250;

/**
 * Account row pinned to the bottom of the left sidebar. Hovering or
 * clicking it opens a popover menu above; it closes on mouse-leave,
 * Esc, or an outside click. Menu entries are wired only where the
 * scaffold has something to show (Settings).
 */
export function AccountArea() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number>(undefined);
  // True while the menu is open because of hover but hasn't yet been
  // "claimed" by a click. The first click on a hover-opened menu should
  // keep it open (adopt it) rather than toggle it shut.
  const hoverOpened = useRef(false);
  const { navigate } = useNavigation();

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const close = () => {
    hoverOpened.current = false;
    setOpen(false);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(close, HOVER_CLOSE_DELAY);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => cancelClose, []);

  return (
    <div
      ref={rootRef}
      className="account-area"
      // Only cancels a pending close (e.g. moving row → menu); opening
      // is triggered by the row itself, not the padded container.
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
    >
      {open && (
        <div className="account-menu" role="menu">
          <div className="account-menu-header">
            <div className="account-menu-header-row">
              <GearIcon />
              <span>{ACCOUNT.email}</span>
            </div>
          </div>

          <div className="account-menu-separator" />

          <button
            className="account-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("settings");
            }}
          >
            <GearIcon />
            <span>设置</span>
          </button>
        </div>
      )}

      <button
        className="account-row"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseEnter={() => {
          cancelClose();
          if (!open) hoverOpened.current = true;
          setOpen(true);
        }}
        onClick={() => {
          // A click on a hover-opened menu claims it (keeps it open);
          // any later click toggles as usual.
          if (hoverOpened.current) {
            hoverOpened.current = false;
            setOpen(true);
          } else {
            setOpen((o) => !o);
          }
        }}
      >
        <div className="account-avatar">{ACCOUNT.initials}</div>
        <div className="account-identity">
          <div className="account-name">{ACCOUNT.name}</div>
          <div className="account-plan">{ACCOUNT.email}</div>
        </div>
      </button>
    </div>
  );
}
