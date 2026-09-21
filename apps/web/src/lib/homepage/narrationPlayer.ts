// Pure state-machine helpers for the homepage living card's narration
// player. The actual <audio> element lives inside LivingCard — these
// helpers just describe the transitions and the rendered output for
// each state, so we can unit-test them without a DOM.

export type PlayerState = "idle" | "playing" | "paused" | "ended";

export type PlayerEvent =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "END" }
  | { type: "RESET" };

/** Initial state — the player hasn't been touched yet. The play button
 *  reads "Play narration". Progress is 0. */
export const INITIAL_STATE: PlayerState = "idle";

/** State machine. Only valid transitions are encoded; anything else
 *  returns the current state unchanged (defensive — UI buttons can
 *  fire while audio is buffering). */
export function transition(state: PlayerState, event: PlayerEvent): PlayerState {
  switch (event.type) {
    case "PLAY":
      // PLAY from any state moves to playing. Even from "ended" —
      // pressing play after the audio finishes replays from the top.
      return "playing";
    case "PAUSE":
      // PAUSE is only meaningful while playing. From idle / ended it's
      // a no-op (the audio element will ignore pause() at those times).
      if (state === "playing") return "paused";
      return state;
    case "END":
      // END is fired by the <audio> `ended` event. From any state
      // that was actively playing, snap to ended. Other states stay.
      if (state === "playing" || state === "paused") return "ended";
      return state;
    case "RESET":
      // Explicit reset (e.g. on unmount). Goes back to idle.
      return INITIAL_STATE;
    default:
      return state;
  }
}

/** `aria-label` for the play/pause toggle. The brief says the label
 *  switches between "Play narration" and "Pause narration". For ended,
 *  we keep it as "Play narration" — pressing play replays. */
export function ariaLabelFor(state: PlayerState): string {
  switch (state) {
    case "playing": return "Pause narration";
    case "paused":
    case "idle":
    case "ended":
      return "Play narration";
  }
}

/** Which icon to render in the play/pause toggle. Play filled when
 *  paused/idle/ended, Pause filled when playing. */
export function iconFor(state: PlayerState): "play" | "pause" {
  return state === "playing" ? "pause" : "play";
}
