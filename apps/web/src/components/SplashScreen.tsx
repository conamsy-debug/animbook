import { useEffect } from "react";
import { LogoMark } from "./Logo";

interface Props {
  /**
   * How long the splash stays on screen (ms). The brief asks for
   * 1 second, so we default to 1000.
   */
  durationMs?: number;
  /** Called when the splash should unmount. */
  onComplete: () => void;
}

/**
 * SplashScreen — first thing that opens the AnimBook site.
 *
 * Renders the LogoMark + wordmark centered over a dark backdrop,
 * fades in, holds, fades out, then calls `onComplete`. Total time on
 * screen: ~1s. Reduced-motion users get a static display with no
 * entrance animation (still hidden by the fade-out at durationMs).
 *
 * Clicking or pressing Escape dismisses early so the user is never
 * trapped behind the splash on a slow device or a JS error.
 */
export function SplashScreen({ durationMs = 1000, onComplete }: Props) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hold = reduced ? Math.min(durationMs, 200) : durationMs;
    const t = window.setTimeout(onComplete, hold);
    return () => window.clearTimeout(t);
    // We intentionally want this effect to run only once per mount of
    // the splash. `durationMs` is a stable prop in practice; the
    // exhaustive-deps warning would force us to re-arm the timer on
    // any prop change which is exactly the opposite of what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onComplete();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="ab-splash"
      role="presentation"
      aria-hidden
      onClick={onComplete}
      data-testid="ab-splash"
    >
      <div className="ab-splash-mark">
        <LogoMark size={92} title="AnimBook" />
        <span className="ab-splash-word">AnimBook</span>
      </div>
    </div>
  );
}
