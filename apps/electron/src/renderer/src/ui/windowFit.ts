import { useEffect, useState } from "react";

/* Keeps the tray window fitted to the panel without resizing it on every animation frame.

   Resizing a native window is slow and, on Windows, visibly jumpy: the window repaints a frame late,
   and because it grows away from the taskbar its top edge moves too. So the window only changes size
   twice per change in the panel:
   - when the panel needs more room, the window grows at once to that height plus some headroom, so
     the rest of the animation plays inside it with no further resizes;
   - once the panel has been still for a moment, the window shrinks to fit it exactly.
   The panel is pinned to the window edge that faces the tray (bottom for a Windows taskbar, top for
   the macOS menu bar), so both resizes happen in transparent space and never move the panel. */

const MIN = 80;
const MAX = 600;
const HEADROOM = 180; // enough for the settings view or a couple of new rows in one step
const SETTLE_MS = 400; // longer than any panel animation
const MAC = /Mac/i.test(navigator.userAgent);

/* Height the panel wants: its current height, with the scrolling list swapped for the list's full
   content (the list itself stops growing at its CSS max-height). */
function naturalHeight(panel: HTMLElement) {
  const height = panel.getBoundingClientRect().height;
  const list = panel.querySelector<HTMLElement>(".sp-list");
  if (!list) return Math.ceil(height);
  const max = parseFloat(getComputedStyle(list).maxHeight) || Infinity;
  return Math.ceil(height - list.clientHeight + Math.min(list.scrollHeight, max));
}

function anchoredToBottom() {
  // The macOS menu bar is always at the top, so the panel always hangs from the top. Guessing from the
  // window's position flipped sides whenever a tall window got near the bottom of the screen, and the
  // panel jumped from one edge to the other.
  if (MAC) return false;
  const top = window.screenY - (screen as Screen & { availTop?: number }).availTop!;
  const bottom = (screen as Screen & { availTop?: number }).availTop! + screen.availHeight - (window.screenY + window.outerHeight);
  if (Number.isFinite(top) && Number.isFinite(bottom) && Math.min(top, bottom) < 48) return bottom < top;
  return true;
}

export function useWindowFit(
  panelRef: React.RefObject<HTMLDivElement | null>,
  resize: ((height: number) => void) | null,
  deps: unknown[]
) {
  const [atBottom, setAtBottom] = useState(anchoredToBottom);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || !resize) return;
    let windowH = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const send = (h: number) => {
      windowH = h;
      resize(h);
    };
    const report = () => {
      setAtBottom(anchoredToBottom());
      const h = Math.max(MIN, Math.min(naturalHeight(el), MAX));
      if (h > windowH) send(Math.min(MAX, h + HEADROOM));
      clearTimeout(settle);
      // On macOS the window keeps its size while it is open, so closing a server never resizes the
      // window under the user; it is fitted again once it has been hidden.
      if (MAC) return;
      settle = setTimeout(() => {
        if (windowH !== h) send(h);
        setAtBottom(anchoredToBottom());
      }, SETTLE_MS);
    };
    const fitWhileHidden = () => {
      if (!MAC || document.visibilityState !== "hidden") return;
      const h = Math.max(MIN, Math.min(naturalHeight(el), MAX));
      if (windowH !== h) send(h);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    const recheck = () => setAtBottom(anchoredToBottom());
    window.addEventListener("focus", recheck);
    window.addEventListener("blur", fitWhileHidden);
    document.addEventListener("visibilitychange", recheck);
    document.addEventListener("visibilitychange", fitWhileHidden);
    return () => {
      ro.disconnect();
      clearTimeout(settle);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("blur", fitWhileHidden);
      document.removeEventListener("visibilitychange", recheck);
      document.removeEventListener("visibilitychange", fitWhileHidden);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return atBottom;
}
