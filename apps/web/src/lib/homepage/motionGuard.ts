// Helper for "should we play this heavy media?" decisions on the
// homepage. The browser exposes three signals that matter:
//   - navigator.connection.saveData  → user opted into data saver
//   - navigator.connection.effectiveType → "2g" / "slow-2g" suggest
//                                          we should not autoplay
//   - matchMedia("(prefers-reduced-motion: reduce)").matches →
//     user prefers less motion (autoplay is a form of motion)
//
// All three default to false when the API isn't available. Use
// shouldAutoplayVideo() as the gate around autoplaying video
// elements (hero, comparison clip) so a slow phone on data saver
// sees the still instead of a heavy MP4.

interface ConnectionInfo {
  saveData?: boolean;
  effectiveType?: string;
}

declare global {
  interface Navigator {
    connection?: ConnectionInfo;
  }
}

/** True when the user has explicitly opted into reduced data usage OR is
 *  on a slow connection OR has prefers-reduced-motion set. */
export function shouldAutoplayVideo(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  } catch { /* ignore */ }
  try {
    const conn = navigator.connection;
    if (conn?.saveData) return false;
    if (conn?.effectiveType && /^(slow-2g|2g)$/.test(conn.effectiveType)) return false;
  } catch { /* ignore */ }
  return true;
}
