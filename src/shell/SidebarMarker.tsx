import { useLayoutEffect, useRef, useState } from "react";

export function useSidebarMarker(activeKey: string, enabled = true) {
  const navRef = useRef<HTMLElement>(null);
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const activeItem = enabled
      ? nav?.querySelector<HTMLElement>('.sidebar-item[data-active="true"]')
      : null;

    if (!nav || !activeItem) {
      setTop(null);
      return;
    }

    const navRect = nav.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();
    setTop(itemRect.top - navRect.top + nav.scrollTop + (itemRect.height - 16) / 2);
  }, [activeKey, enabled]);

  return { navRef, top };
}

export function SidebarMarker({ top }: { top: number | null }) {
  return (
    <span
      className="sidebar-selection-marker"
      data-visible={top !== null}
      aria-hidden="true"
      style={{ top: top ?? 0 }}
    />
  );
}
