/**
 * AnimBook Languages — streak math (Patch 10).
 *
 * Spec § 7.3 + § 11. A streak is the number of consecutive calendar
 * days (in the learner's local timezone) on which the learner
 * recorded at least one piece of activity. Streak math:
 *
 *   - Activity today (local): current += 1, longest = max(current, longest)
 *   - Activity yesterday (local): current += 1, longest = max(...)
 *   - Activity ≥ 2 days ago (local) OR never: current = 1 (start fresh)
 *   - No activity today AND last activity was yesterday: leave as-is
 *     (the streak is "at risk" but not yet broken — surfaces via the
 *     UI as a yellow badge instead of red)
 *   - No activity today AND last activity was ≥ 2 days ago: current = 0
 *
 * Dates are compared at day-granularity in the IANA tz. We avoid
 * `toLocaleDateString()` for portability and instead use
 * `Intl.DateTimeFormat` with `timeZone` to compute the calendar date
 * directly — same algorithm the JS `Temporal` proposal uses, just
 * without the proposal dependency.
 */
export type StreakResult = {
  /** Number of consecutive days of activity (including today if
   *  the learner has been active today). 0 when the streak has been
   *  broken. */
  currentStreakDays: number;
  /** All-time longest streak. Never decreases. */
  longestStreakDays: number;
  /** Today, in the learner's local timezone, as an ISO calendar date
   *  (`YYYY-MM-DD`). The caller stores this in
   *  `learner_stats.last_activity_date` so the next call can
   *  compute the delta without re-deriving the user's tz. */
  lastActivityDate: string;
};

/** Resolve "today" in a given IANA tz to a `YYYY-MM-DD` string. */
export function localDateInTz(now: Date, tz: string): string {
  // Intl.DateTimeFormat with timeZone gives the wall-clock parts for
  // the tz; we compose them into YYYY-MM-DD. This is the JS equivalent
  // of "calendar date in tz" without pulling in a date library.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/** Days between two `YYYY-MM-DD` strings, ignoring time-of-day. The
 *  calendar difference, in days, in the user's tz. Uses the tz to
 *  anchor "midnight" so DST transitions don't shift the count. */
export function daysBetween(aDate: string, bDate: string, tz: string): number {
  // Construct UTC midnights for each local date. We use the
  // `noon-in-tz` trick to avoid DST: noon in any tz is the same
  // UTC instant, so `Math.round((b - a) / 86_400_000)` is reliable.
  const aUtc = noonUtcForLocalDate(aDate, tz);
  const bUtc = noonUtcForLocalDate(bDate, tz);
  return Math.round((bUtc - aUtc) / 86_400_000);
}

/** Compute the midnight (in UTC) at noon of `YYYY-MM-DD` interpreted
 *  in `tz`. The noon trick avoids DST's 23- or 25-hour day issues. */
function noonUtcForLocalDate(localDate: string, tz: string): number {
  const [y, m, d] = localDate.split("-").map((s) => parseInt(s, 10));
  // Start with noon UTC on the local date — close enough to noon in
  // every tz that the date stays the same after conversion. Then
  // adjust if needed.
  let utc = Date.UTC(y, m - 1, d, 12, 0, 0);
  // Verify the conversion produces the local date we asked for; if
  // not, push forward by an hour until it does. Bounded at 26 hours
  // to handle the worst-case tz offset (Pacific/Apia at UTC+13).
  const target = localDate;
  for (let i = 0; i < 26; i++) {
    if (localDateInTz(new Date(utc), tz) === target) return utc;
    utc += 60 * 60 * 1000;
  }
  return utc;
}

/**
 * Decide whether activity `now` extends, resets, or leaves the
 * current streak untouched. Pure function so the route can call it
 * with the row values + the current UTC instant and write the
 * result back in a single transaction.
 *
 * @param args.lastActivityDate   the previous `last_activity_date`
 *                                value (ISO date string, `YYYY-MM-DD`),
 *                                or `null` for a brand-new stats row
 * @param args.currentStreakDays  the existing streak count (0 for new)
 * @param args.longestStreakDays  the existing all-time max (0 for new)
 * @param args.now                the moment the activity was recorded
 * @param args.tz                 the learner's IANA tz string
 */
export function bumpStreak(args: {
  lastActivityDate: string | null;
  currentStreakDays: number;
  longestStreakDays: number;
  now: Date;
  tz: string;
}): StreakResult {
  const safeTz = args.tz || "UTC";
  const today = localDateInTz(args.now, safeTz);

  // First-ever activity → streak starts at 1.
  if (!args.lastActivityDate) {
    return {
      currentStreakDays: 1,
      longestStreakDays: Math.max(1, args.longestStreakDays),
      lastActivityDate: today
    };
  }

  const delta = daysBetween(args.lastActivityDate, today, safeTz);

  if (delta < 0) {
    // Clock skew / a server clock that went backwards. Don't punish
    // the learner — keep the existing streak and refresh the date.
    return {
      currentStreakDays: args.currentStreakDays,
      longestStreakDays: args.longestStreakDays,
      lastActivityDate: args.lastActivityDate
    };
  }

  if (delta === 0) {
    // Same day — already counted. Don't bump (idempotent), but
    // also don't reset.
    return {
      currentStreakDays: Math.max(args.currentStreakDays, 1),
      longestStreakDays: args.longestStreakDays,
      lastActivityDate: today
    };
  }

  if (delta === 1) {
    // Consecutive day — extend the streak.
    const next = args.currentStreakDays + 1;
    return {
      currentStreakDays: next,
      longestStreakDays: Math.max(args.longestStreakDays, next),
      lastActivityDate: today
    };
  }

  // delta >= 2: the streak broke. Start fresh at 1 (today counts).
  return {
    currentStreakDays: 1,
    longestStreakDays: Math.max(args.longestStreakDays, 1),
    lastActivityDate: today
  };
}

/** Resolve the IANA tz for a Date. Falls back to UTC when the
 *  platform can't honour the tz (rare; happens on some embedded JS
 *  environments). */
export function resolveTz(tz: string | null | undefined, fallback = "UTC"): string {
  if (!tz) return fallback;
  try {
    // Throws RangeError if the tz isn't valid for this Intl.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}
