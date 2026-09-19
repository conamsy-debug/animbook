// Mobile-first tap zones + horizontal swipe gestures for the Reader.
//
// Tap zones: left third of the screen = prev, right two-thirds = next.
// Matches iBooks / Kindle convention so muscle memory carries over.
//
// Swipes: a horizontal drag of > 50px with less vertical drift flips the
// page. Vertical scrolling is left alone so users can still scroll through
// long captions. A small velocity component (px/ms) also triggers the
// flip for quick flicks.
//
// We don't fire when:
//   - the user is selecting text (window.getSelection())
//   - the touch starts inside a button, link, or form control
//   - the touch ends inside a different interactive element (e.g. tap
//     a button inside the bottom controls → button's onClick fires,
//     gesture stays silent)
//   - the drag has high vertical drift (probably a scroll)
//
// The hook attaches listeners to `ref.current` (typically the `<main>`
// element of the reader page). It cleans up on unmount.

import { useEffect, type RefObject } from "react";

interface ReaderGestureOptions {
  /** Pointer/touch starts on the left side of the page → flip prev. */
  onPrev?: () => void;
  /** Pointer/touch starts on the right side of the page → flip next. */
  onNext?: () => void;
  /** Disable when this is true (e.g. a modal is open). */
  disabled?: boolean;
  /** Min horizontal travel in px to count as a swipe. */
  swipeThreshold?: number;
  /** Min horizontal velocity in px/ms for a flick to count. */
  flickVelocity?: number;
  /** Max vertical drift as a fraction of horizontal travel (0..1). */
  maxVerticalDrift?: number;
}

const DEFAULT_OPTS: Required<Pick<ReaderGestureOptions, "swipeThreshold" | "flickVelocity" | "maxVerticalDrift">> = {
  swipeThreshold: 50,
  flickVelocity: 0.4,
  maxVerticalDrift: 0.6
};

interface TouchState {
  startX: number;
  startY: number;
  startT: number;
  /** Side of the screen at touchstart (used to choose prev/next on tap). */
  startSide: "left" | "right";
  /** Track if we already fired a tap-zone action. */
  fired: boolean;
}

/**
 * Check if a touch started inside an interactive element. We want the
 * page-flip gesture to coexist with buttons, links, and form fields.
 */
function isInteractiveTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest("button, a, input, textarea, select, [role='button'], [data-no-flip]")) return true;
  return false;
}

/**
 * Check if the user is currently selecting text. Used to skip tap-zone
 * flips so highlighting / word-tap still works.
 */
function hasTextSelection(): boolean {
  if (typeof window === "undefined") return false;
  const sel = window.getSelection?.();
  return Boolean(sel && sel.toString().length > 0);
}

export function useReaderGestures(
  ref: RefObject<HTMLElement | null>,
  options: ReaderGestureOptions = {}
): void {
  const { onPrev, onNext, disabled } = options;
  const swipeThreshold = options.swipeThreshold ?? DEFAULT_OPTS.swipeThreshold;
  const flickVelocity = options.flickVelocity ?? DEFAULT_OPTS.flickVelocity;
  const maxVerticalDrift = options.maxVerticalDrift ?? DEFAULT_OPTS.maxVerticalDrift;

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    let touch: TouchState | null = null;

    function onStart(ev: TouchEvent) {
      if (ev.touches.length !== 1) return;
      const t = ev.touches[0]!;
      if (isInteractiveTarget(ev.target)) return;
      const rect = el!.getBoundingClientRect();
      const x = t.clientX - rect.left;
      touch = {
        startX: t.clientX,
        startY: t.clientY,
        startT: performance.now(),
        startSide: x < rect.width / 2 ? "left" : "right",
        fired: false
      };
    }

    function onMove(ev: TouchEvent) {
      if (!touch || ev.touches.length !== 1) return;
      const t = ev.touches[0]!;
      const dx = t.clientX - touch.startX;
      const dy = t.clientY - touch.startY;
      // High vertical drift = probably a scroll, not a swipe.
      if (Math.abs(dy) > Math.abs(dx) * maxVerticalDrift && Math.abs(dy) > 20) {
        touch = null;
      }
    }

    function onEnd(ev: TouchEvent) {
      const t0 = touch;
      touch = null;
      if (!t0 || t0.fired) return;
      // If the user selected text, don't fire.
      if (hasTextSelection()) return;
      const t = ev.changedTouches[0]!;
      const dx = t.clientX - t0.startX;
      const dy = t.clientY - t0.startY;
      const dt = Math.max(1, performance.now() - t0.startT);

      // Decide: swipe or tap.
      const horizAbs = Math.abs(dx);
      const vertAbs = Math.abs(dy);
      // Fast flick (velocity-based) bypasses the distance threshold so
      // a quick 25px finger snap still counts even though 25 < threshold.
      const isFastFlick = Math.abs(dx / dt) >= flickVelocity;
      const isSwipe =
        (horizAbs >= swipeThreshold || isFastFlick) && vertAbs <= horizAbs * maxVerticalDrift;
      const isTap = horizAbs < 8 && vertAbs < 12 && dt < 350;

      if (isSwipe) {
        if (dx < 0) onNext?.();
        else if (dx > 0) onPrev?.();
      } else if (isTap) {
        if (t0.startSide === "left") onPrev?.();
        else onNext?.();
      }
    }

    function onCancel() {
      touch = null;
    }

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onCancel, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [ref, onPrev, onNext, disabled, swipeThreshold, flickVelocity, maxVerticalDrift]);
}
