/**
 * Playback speed for the reader.
 *
 * - Six levels, matching the standard set people know from video players.
 * - One default per vertical: WELLNESS/FAITH/KIDS get a gentler pace so a
 *   meditation session, a prayer, or a picture book doesn't race.
 * - The reader's choice is remembered per browser in localStorage and beats
 *   the vertical default the next time they open any book.
 */

export const SPEED_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;
export type Speed = (typeof SPEED_LEVELS)[number];

/** What each speed feels like, in plain language. */
export const SPEED_HINTS: Record<Speed, string> = {
  0.5: "Very slow",
  0.75: "Slow",
  1.0: "Normal",
  1.25: "Faster",
  1.5: "Fast",
  2.0: "Very fast"
};

/**
 * Defaults per vertical — the rate a fresh reader gets the first time they
 * open a book in that vertical. Their choice (if they pick one) overrides this
 * for every book from then on.
 *
 * Only canonical Speed values are allowed (the six the menu offers). Wellness
 * is the only vertical that defaults slower; everything else opens at 1.0× and
 * the reader can pick a different pace from the menu.
 */
const VERTICAL_DEFAULT: Record<string, Speed> = {
  WELLNESS: 0.75,
  FAITH: 1.0,
  KIDS: 1.0,
  VERSE: 1.0,
  TRAVEL: 1.0,
  CONSUMER: 1.0,
  COMICS: 1.0,
  DOCS: 1.0,
  EDU: 1.0,
  BUSINESS: 1.0,
  LAW: 1.0,
  ORIGINALS: 1.0
};

export function defaultSpeedForVertical(vertical: string | undefined | null): Speed {
  if (!vertical) return 1.0;
  return VERTICAL_DEFAULT[vertical] ?? 1.0;
}

const STORAGE_KEY = "animbook:speed";

interface StoredSpeed {
  speed: number;
}

function isSpeed(v: number): v is Speed {
  return SPEED_LEVELS.includes(v as Speed);
}

/**
 * The speed the reader chose last time. Falls back to the vertical default
 * if nothing has been stored yet, or if the stored value isn't one of the
 * six canonical levels.
 */
export function readStoredSpeed(vertical: string | undefined | null): Speed {
  const fallback = defaultSpeedForVertical(vertical);
  try {
    if (typeof window === "undefined") return fallback;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as StoredSpeed;
    if (typeof parsed.speed === "number" && isSpeed(parsed.speed)) return parsed.speed;
  } catch {
    // ignore — return fallback
  }
  return fallback;
}

export function persistSpeed(speed: Speed): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ speed }));
  } catch {
    // ignore
  }
}

/** Render a 1.0× / 0.85× label. Keeps one decimal, drops trailing zero. */
export function formatSpeed(speed: Speed): string {
  if (speed === 1.0) return "1×";
  const text = speed.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
  return `${text}×`;
}
