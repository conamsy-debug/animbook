/**
 * AnimBook TV — multi-shelf focus.
 *
 * Each `.focus-shelf` is a focus group; up/down jumps between shelves,
 * left/right moves inside the shelf.
 */
import { useEffect, useRef } from "react";

export function useTvShelfFocus() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    function getShelves(): HTMLElement[] {
      return Array.from(root!.querySelectorAll<HTMLElement>(".focus-shelf"));
    }

    function getFocusable(shelf: HTMLElement): HTMLElement[] {
      return Array.from(shelf.querySelectorAll<HTMLElement>(".focusable"));
    }

    function focusItem(el: HTMLElement) {
      el.focus();
      el.classList.add("is-focused");
      el.scrollIntoView({ block: "nearest", behavior: "smooth", inline: "center" });
    }

    // Tag each shelf by its index so we can navigate between them.
    const shelves = getShelves();
    let activeShelf = 0;

    if (shelves[0]) {
      const first = getFocusable(shelves[0])[0];
      if (first) focusItem(first);
    }

    const onKey = (event: KeyboardEvent) => {
      const liveShelves = getShelves();
      if (liveShelves.length === 0) return;
      const currentShelfIdx = Math.max(0, Math.min(activeShelf, liveShelves.length - 1));
      const items = getFocusable(liveShelves[currentShelfIdx]);
      if (items.length === 0) return;
      const current = items.findIndex((el) => el === document.activeElement);
      let next = current < 0 ? 0 : current;
      let handled = false;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        if (current === items.length - 1 && event.key === "ArrowDown") {
          // jump to next shelf
          activeShelf = Math.min(currentShelfIdx + 1, liveShelves.length - 1);
          const firstOfNext = getFocusable(liveShelves[activeShelf])[0];
          if (firstOfNext) {
            items.forEach((el) => el.classList.remove("is-focused"));
            focusItem(firstOfNext);
          }
          handled = true;
        } else {
          next = (current + 1) % items.length;
          handled = true;
        }
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        if (current === 0 && event.key === "ArrowUp") {
          activeShelf = Math.max(currentShelfIdx - 1, 0);
          const firstOfPrev = getFocusable(liveShelves[activeShelf])[0];
          if (firstOfPrev) {
            items.forEach((el) => el.classList.remove("is-focused"));
            focusItem(firstOfPrev);
          }
          handled = true;
        } else {
          next = (current - 1 + items.length) % items.length;
          handled = true;
        }
      }

      if (handled) {
        event.preventDefault();
        if (current >= 0) items[current]?.classList.remove("is-focused");
        focusItem(items[next] ?? null);
      }
    };

    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, []);

  return { containerRef };
}