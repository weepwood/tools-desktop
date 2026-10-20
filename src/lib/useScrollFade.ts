import { useEffect, type RefObject } from "react";

/**
 * Marks a scroll container with `data-scroll-fade="more"` while there is
 * content below the fold, so the stylesheet can fade the last few pixels
 * instead of slicing a line of text in half at the panel edge.
 *
 * Kept as an attribute rather than an inline style so the fade stays in the
 * stylesheet (and respects `prefers-reduced-*` if it ever needs to).
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      el.dataset.scrollFade = remaining > 4 ? "more" : "none";
    };

    update();
    el.addEventListener("scroll", update, { passive: true });

    // Content and viewport both change size (resize, disclosure open/close,
    // async rows), so watch the box and the subtree rather than just scroll.
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const mutation = new MutationObserver(update);
    mutation.observe(el, { childList: true, subtree: true });

    return () => {
      el.removeEventListener("scroll", update);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [ref]);
}
