/**
 * AnimBook TV — focus manager.
 *
 * Implements D-pad navigation for tvOS Safari / AirPlay. The TV browser
 * exposes ArrowLeft/ArrowRight/ArrowUp/ArrowDown + Enter via the standard
 * keyboard event. This hook wires every focusable element into a single
 * roving tabindex so the cursor moves deterministically.
 */
import { useEffect, useRef, useState, useCallback } from "react";

export function useFocusGroup(selector: string) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const focusElement = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    el.focus();
    el.classList.add("is-focused");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const getItems = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selector));

    const clearFocused = () => {
      getItems().forEach((el) => el.classList.remove("is-focused"));
    };

    const onKey = (event: KeyboardEvent) => {
      const items = getItems();
      if (items.length === 0) return;
      const current = items.findIndex((el) => el === document.activeElement);
      let next = current < 0 ? 0 : current;
      let handled = false;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        next = (current + 1) % items.length;
        handled = true;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        next = (current - 1 + items.length) % items.length;
        handled = true;
      } else if (event.key === "Enter" || event.key === " ") {
        const el = items[current] ?? items[0];
        if (el) {
          el.click();
          handled = true;
        }
      }

      if (handled) {
        event.preventDefault();
        clearFocused();
        focusElement(items[next]);
        setFocusedIndex(next);
      }
    };

    // Initialize the first focusable element on mount.
    clearFocused();
    const initialItems = getItems();
    if (initialItems[0]) focusElement(initialItems[0]);
    setFocusedIndex(0);

    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      getItems().forEach((el) => el.classList.remove("is-focused"));
    };
  }, [selector, focusElement]);

  return { containerRef, focusedIndex };
}