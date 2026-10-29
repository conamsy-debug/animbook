/**
 * Brain shot writer â€” the multi-shot system.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Every page used to own ONE clip of about five seconds, made by animating a
 * still with one fixed motion template ("Small, natural movement â€¦ Slow camera
 * push-in"), and the player looped that clip for the whole page. The result is
 * a moving photograph: the picture never changes, the motion is the same on
 * every page of every book, and a page whose narration runs thirty seconds
 * shows the same five seconds four times.
 *
 * WHAT A SHOT IS
 *
 * A shot is one clip inside a page, covering one BEAT of that page's
 * narration. A page with four beats has four shots, each with its own
 * narration span, its own first frame, and its own prompt. The player plays
 * them in order while the voice reads, so the picture keeps moving with the
 * words and never loops a single clip.
 *
 * `Page.videoUrl` is untouched and remains the fallback for every book that
 * has no shot rows, so nothing that shipped before this change changes
 * behaviour.
 *
 * WHY THE PROMPTS ARE SO FLAKY ABOUT BODY MECHANICS
 *
 * A video model given "a woman by the water" produces a woman who barely
 * moves, because nothing in the sentence says what her body does. Given an
 * explicit start position -> end position for each body part, it produces an
 * action. So the shot prompt is not a description of a scene, it is a
 * description of movement: hands, arms, head, eyes, legs, torso, each one
 * saying where it starts and where it ends.
 *
 * WHY CHARACTERS ARE DESCRIBED BY LOOK AND NEVER BY NAME
 *
 * Prompting a video model with a name gets you a different person every
 * time. So the book carries a character BIBLE: one fixed `look` sentence per
 * character, reused word for word in every shot prompt of the book, and the
 * character is referred to by a role label ("the woman in the coral
 * headwrap"), never by name. The writer validates that each character in
 * frame appears in the prompt with their exact look wording.
 */
import { spawn } from "node:child_process";
import { prisma } from "../db.js";
import { callAnthropic } from "./bookBrain.js";
import { resolveFfprobe } from "./ffmpegBin.js";

/* --------------------------------------------------------------------- *
 * Types
 * --------------------------------------------------------------------- */

/** One character of the book's shot bible. */
export interface ShotCharacterDraft {
  /** How the character is referred to in prompts. Never their name. */
  roleLabel: string;
  /** The fixed appearance wording, reused verbatim in every shot prompt. */
  look: string;
  /** How this character moves, reused verbatim in every shot prompt. */
  motion?: string;
}

/** One shot as the Brain writes it, before it is validated and persisted. */
export interface ShotDraft {
  /** The exact words of the beat this shot covers. */
  narrationText: string;
  /** Which bible characters are in this shot, by role label. */
  charactersInFrame: string[];
  /** The motion prompt for the clip. */
  shotPrompt: string;
  /** The prompt for the first frame the clip is generated from. */
  stillPrompt: string;
}

/** A validated shot, with its narration span resolved. */
export interface ShotPlan {
  order: number;
  narrationText: string;
  narrationStartMs: number;
  narrationEndMs: number;
  shotPrompt: string;
  stillPrompt: string;
  /** Role labels of the characters visible in this shot. */
  charactersInFrame: string[];
  durationSeconds: number;
}

/* --------------------------------------------------------------------- *
 * Constants
 * --------------------------------------------------------------------- */

/**
 * Clip lengths the provider can actually render.
 *
 * MiniMax's video API only accepts 6 or 10 seconds (768P), or 6 seconds at
 * 1080P. A shot's narration span can be shorter than its clip â€” the player
 * cuts the clip at the end of the span â€” but never longer than the longest
 * clip, or the last part of the narration would play over frozen footage.
 */
export const SHOT_CLIP_SECONDS = 6;
export const SHOT_CLIP_SECONDS_LONG = 10;
export const MAX_SHOT_NARRATION_MS = SHOT_CLIP_SECONDS_LONG * 1000;

/** Average narration speed used when the real audio duration is unknown. */
const FALLBACK_WORDS_PER_MINUTE = 150;

/* --------------------------------------------------------------------- *
 * Prompts
 * --------------------------------------------------------------------- */

/**
 * The character-bible prompt.
 *
 * The bible is written ONCE per book and reused for every shot in it, which
 * is the only way the same person can look the same in shot 2 and shot 40.
 */
export const CHARACTER_BIBLE_SYSTEM = `You are the AnimBook character bible writer for a book that is being turned into short film shots.
Return ONE JSON object: {"characters": [...]}.

Each entry:
  "roleLabel" - how this character is referred to inside shot prompts. A ROLE LABEL, never a name: "the woman in the coral headwrap", "the fisherman in the blue coat". It must be unmistakable in a list of similar people.
  "look"      - ONE sentence fixing exactly how this character looks: age, build, skin tone, hair, one signature garment. Nothing else. Never mention their name. Never pair "young" with "male" or "female". Do not describe the body in a way that contradicts the story.
  "motion"    - ONE sentence fixing how this character moves: their posture, their pace, their habitual gesture, the way they hold their hands.

Rules:
- One entry per character who APPEARS on screen. Do not include people who are only mentioned in the narration.
- The same look and motion wording will be copied word for word into every shot prompt in this book, so it must be specific enough that no two characters could be confused.
- Never write a name anywhere in this output.
- Return valid JSON only. No prose.`;

/**
 * The beat splitter.
 *
 * Beats are planned FIRST so the shot writer knows how many seconds of
 * narration each shot has to cover. A shot whose action needs more time than
 * its narration span would be cut off mid-gesture, so short beats are merged
 * before a single prompt is written.
 */
export const BEAT_SPLITTER_SYSTEM = `You are the AnimBook beat splitter. You cut a page of narration into BEATS, one per video shot.

Return ONE JSON object and NOTHING else:

  {"beats": ["...", "..."]}

Each beat is a run of words copied VERBATIM from the page text. Together the beats must cover the page text in order, with no gaps, no overlaps and no words invented or dropped.

Rules:
- Return EXACTLY the number of beats the task asks for. That count is already worked out from the length of the narration - do not add a beat and do not drop one.
- The beats must be as equal in length as the text allows, and each one must be long enough to carry a visible action.
- Split on the story's own seams: a change of place, a change of action, a change of who is on screen. Never split mid-clause and never split a single short sentence into two.
- Do not add commentary, labels or punctuation that is not in the text.
- Return valid JSON only. No prose.`;

/**
 * The shot prompt.
 *
 * The ordering matters: the count comes first so the model has decided how
 * many people are in frame before it describes anybody, and the camera comes
 * late so it is a decision rather than a default.
 */
export const SHOT_WRITER_SYSTEM = `You are the AnimBook shot writer. You are given BEATS - already cut runs of narration words, each with the number of seconds of narration it covers. You write one video shot per beat.

Return ONE JSON object and NOTHING else. The ONLY keys you may use are:

  {"shots": [
     {"narration_text": "...",
      "characters_in_frame": ["..."],
      "shot_prompt": "...",
      "still_prompt": "..."}
  ]}

Do not add beat_number, beat_text, narration_seconds, shot_description, character_action, camera_movement, mood_tags or any other key. Everything belongs inside shot_prompt and still_prompt.

  narration_text      - the beat text, copied VERBATIM back to you.
  characters_in_frame - the role labels of the characters visible in this shot, chosen from the character bible you are given. Empty list for a shot with no people.
  shot_prompt         - the prompt for the clip.
  still_prompt        - the prompt for the FIRST FRAME the clip is generated from.

THE SHOT PROMPT MUST CONTAIN, IN THIS ORDER:

1. THE COUNT. The very first words state exactly how many people and animals are in frame: "Exactly one woman in frame." / "Exactly two people and one dog in frame." / "No people or animals in frame." It must agree with characters_in_frame.

2. THE CHARACTERS. For every character in frame, paste their look from the bible WORD FOR WORD, then say how that character is moving. Only characters in characters_in_frame may appear. A character who is not in frame is not mentioned at all.

3. NO CONTRADICTORY BODY POSITIONS. Within one shot the body must be in ONE consistent arrangement at any instant. You may not say "her arms hang at her sides" AND "her hands are clasped behind her back" - those are two different arm positions and the model cannot hold both. Decide where the arms are, then keep them there until the shot says they move. The same applies to hands, legs, head and eyes: if the hands are behind her back at the start, they cannot also be at her sides, and if the head is level it cannot also be dipped.

4. THE ACTION, WITH BODY MECHANICS. State every movement as a start position and an end position, and cover the body parts: hands, arms, head, eyes, legs, torso. "She looks out" is not an action. "Her chin lifts from her chest to level, her eyes open and settle on the boat, her right hand slides off the rail and comes to rest at her side" is an action. Say what each body part does and in what order.

5. THE BIBLE'S MOTION IS A HABIT, NOT A LOCK. The character's motion sentence from the bible describes how they move when nothing in the story demands otherwise. When the narration describes a specific ACTION, that action OVERRIDES the habit and the habit must not be repeated. If the beat says she counts the boats, do not write that she walks with her hands clasped behind her back - write that her right hand comes forward from behind her back, her right index finger extends and points at the first boat, then moves to point at the second and third boats in turn, her lips move silently as she counts, then her hand lowers back to her side. Use the habit only for the parts of the shot where the story leaves her alone.

6. EFFECTS, TIED TO THEIR CAUSE. Whenever something moves because of something else, say so in the SAME sentence: the scarf lifts because a gust comes off the water, the reflection breaks because a boat's hull cuts it, her shadow slides because the sun has moved, ripples spread from where a fish broke the surface, the bag tumbles because the wind blows it. Never let an effect float free of its cause, and never describe an effect in a sentence that does not also say what causes it.

7. THE ENVIRONMENT'S OWN MOTION. Say what moves around them: waves rolling in and breaking, boats rocking on their mooring, gulls crossing from left to right, rain falling past the streetlight, leaves turning over in the wind, traffic passing behind. Say it explicitly; do not imply it.

8. THE CAMERA. State the camera and its movement in plain words: "Locked-off static shot." / "Slow pan left." / "Slow tilt down." / "The camera follows her walking." / "Tracking left along the quay." Choose ONE camera movement, name it, and never leave the camera unstated. "Slow camera push-in" is only acceptable when the shot genuinely calls for a push-in.

9. WHAT ENTERS. If nothing new enters the frame, say so in as many words: "Nothing enters the frame." If something does enter, the shot must call for it and describe it.

10. NO TEXT. Never mention text, letters, words, titles, captions, subtitles, signs, logos or watermarks, and never ask for any.

PACE THE ACTION TO THE VISIBLE SPAN. Each beat comes with the number of seconds of narration it covers. That is how long the shot is actually ON SCREEN, and the whole visible action must fit inside it: the gesture must FINISH before the narration ends. If the span is 4 seconds, write an action that completes in about 4 seconds. Do not plan a sequence of movements that needs longer than the span, and do not begin an action that cannot finish.

KEEP THE LIGHT CONTINUOUS. Every shot on the same page must share the same time of day and the same light - the same dawn, the same overcast afternoon, the same warm low sun. Only the narration may change it. If you are given other shots from this page, match their light exactly.

THE STILL PROMPT IS THE FIRST FRAME OF THAT CLIP. It must describe EXACTLY the state the shot STARTS in: the same pose and the same limb positions at the opening instant, the same lighting and the same time of day, the same objects in the same places, the same camera angle. It is a photograph of the opening frame, so it contains no movement, no camera move and nothing entering the frame - but it must be the frame the clip actually begins from, not a different pose of the same scene.

THE STILL SHOWS THE BODY BEFORE THE FIRST MOVEMENT. The clip is generated FROM the still, so the still is the instant BEFORE the shot's first action. If the shot's first action is "her right hand comes forward from behind her back, her right index finger extends and points at the first boat", the still must show her right hand STILL BEHIND HER BACK, with the index finger not yet extended - not already raised and pointing. Write the still from the pose the clip opens on, never from the pose the clip ends on.

Return valid JSON only. No prose.`;

/**
 * The first-frame rewriter.
 *
 * When a still shows a pose the clip only reaches later, the whole page is
 * usually rewritten, and a page rewrite can break something that was already
 * right. This asks for the ONE prompt that is wrong, with the clip it belongs
 * to in front of it, and changes nothing else.
 */
export const STILL_REWRITER_SYSTEM = `You are the AnimBook first-frame writer. You rewrite ONE photograph prompt so that it shows the exact instant a video clip OPENS on.

Return ONE JSON object and NOTHING else:
  {"still_prompt": "..."}

THE FIRST FRAME IS THE INSTANT BEFORE THE CLIP'S FIRST MOVEMENT. The clip is generated FROM this photograph, so the photograph must show the body as it is when the clip begins - never a pose the clip arrives at later. If the clip's first action brings her right hand forward from behind her back, the photograph shows that hand STILL BEHIND HER BACK. If the clip opens with her finger pointing at a boat, the photograph shows her finger pointing at that boat.

Keep everything else exactly as it was: the same time of day, the same light, the same objects in the same places, the same camera angle, and the character's look word for word. Change ONLY the body pose.

The prompt is a photograph, so it contains no movement, no camera move and nothing entering the frame. It must open with the count phrase, exactly as the clip opens: "Exactly one woman in frame." / "No people or animals in frame."

Return valid JSON only. No prose.`;

/* --------------------------------------------------------------------- *
 * Prompt validation
 * --------------------------------------------------------------------- */

const CAMERA_WORDS = [
  "locked-off",
  "locked off",
  "static shot",
  "pan left",
  "pan right",
  "tilt up",
  "tilt down",
  "push in",
  "push-in",
  "pull back",
  "pull out",
  "tracking shot",
  "follows",
  "handheld",
  "dolly",
  "crane",
  "orbit",
  "camera holds",
  "camera stays"
];

const BODY_PARTS = ["hand", "arm", "head", "eye", "leg", "torso", "shoulder", "chest", "hip", "finger", "elbow", "knee", "chin", "wrist"];
const BODY_VERBS = [
  "lift", "lower", "raise", "drop", "turn", "twist", "reach", "push", "pull",
  "step", "walk", "swing", "sway", "slide", "grip", "release", "open",
  "close", "blink", "nod", "tilt", "fold", "unfold", "settle", "draw",
  "clench", "relax", "shift", "plant", "cross", "uncross", "rest"
];
const ENVIRONMENT_WORDS = [
  "wave", "water", "ripple", "roll", "rock", "sway", "drift", "flutter",
  "flap", "breeze", "wind", "rain", "cloud", "smoke", "steam", "dust",
  "bird", "gull", "boat", "barge", "traffic", "crowd", "leaf", "leaves",
  "branch", "fog", "mist", "light", "shadow", "lamp", "lantern", "reflection",
  "wake", "foam", "spray", "current", "tide", "rope", "rigging", "canopy",
  "curtain", "flag", "signboard", "awning", "fire", "flame", "steam"
];
const CAUSE_WORDS = [
  "because", "caused by", "driven by", "pushed by", "blown by", "carried by",
  "lifted by", "thrown by", "spread from", "made by", "due to", "thanks to",
  "as the", "as she", "as he", "as it", "as they", "as a", "as an", "as ",
  "from the", "from a", "from an", "from where", "from under", "from over",
  "from behind", "so the", "which makes", "and so", "off the", "out of",
  "under the", "under a", "where a", "where the", "when the", "while the",
  "while a", "once the", "since the", "after the", "before the", "with the",
  "with a", "with her", "with his", "with their"
];

/**
 * Dynamic effects. An effect only counts when it can CHANGE - a static
 * "the light is low" is not an effect, a "the light slides across the water"
 * is. Every sentence that mentions one of these must also say what causes
 * it, in that same sentence.
 */
const EFFECT_WORDS = [
  "shadow", "scarf", "cloth", "smoke", "steam", "ripple", "reflection",
  "spray", "foam", "flame", "dust", "mist", "rain", "glint", "gleam",
  "sheen", "gust", "breeze", "wake", "splash", "foam"
];

/** Light only counts as an effect when it is doing something. */
const LIGHT_EFFECT_VERBS = [
  "slide", "slides", "sliding", "shift", "shifts", "shifting", "move",
  "moves", "moving", "change", "changes", "changing", "strengthen",
  "strengthens", "strengthening", "fade", "fades", "fading", "dim",
  "dims", "brighten", "brightens", "lengthen", "lengthens", "stretch",
  "stretches", "sweep", "sweeps", "climb", "climbs", "warm", "warms",
  "cool", "cools", "spill", "spills", "fall", "falls", "reach", "reaches"
];

/**
 * Body positions that cannot both be true at the same instant. The writer
 * must pick ONE arrangement per shot: an arm cannot hang at the side while
 * the hands are clasped behind the back.
 */
const POSE_STATES: Array<{ id: string; re: RegExp }> = [
  {
    id: "arms-at-sides",
    re: /\b(?:arms?|elbows?)\s+(?:are\s+|hang(?:ing)?\s+|rest(?:ing)?\s+|dangl(?:e|ing)\s+)(?:loose(?:ly)?\s+)?(?:at\s+(?:her|his|their|its)\s+sides?|down)\b/i
  },
  {
    id: "arms-crossed",
    re: /\b(?:arms?)\s+(?:are\s+|is\s+)?(?:crossed|folded\s+across)\b/i
  },
  {
    id: "hands-behind-back",
    re: /\b(?:hands?|fingers?)\s+(?:are\s+|remain\s+|stay\s+|is\s+)?(?:clasp(?:ed)?|folded|resting|tucked|held)\b[^.]{0,40}\bbehind\b/i
  },
  {
    id: "hands-forward",
    re: /\b(?:hands?|arms?|fingers?)\s+(?:are\s+|)(?:reach(?:ing|ed)?|extend(?:ing|ed)?|come(?:s)?\s+(?:forward|out)|come(?:s)?\s+up|move(?:s)?\s+forward)\b/i
  },
  {
    id: "hands-at-side",
    re: /\b(?:hands?)\s+(?:are\s+|)(?:at\s+(?:her|his|their)\s+sides?|down\s+by\s+(?:her|his|their)\s+side)\b/i
  },
  {
    id: "chin-up",
    re: /\bchin\s+(?:is\s+|)(?:up|raised|lifted)\b/i
  },
  {
    id: "chin-down",
    re: /\bchin\s+(?:is\s+|)(?:down|lowered|tucked)\b/i
  },
  {
    id: "eyes-open",
    re: /\beyes\s+(?:are\s+)(?:open|wide)\b/i
  },
  {
    id: "eyes-closed",
    re: /\beyes\s+(?:are\s+)(?:closed|shut)\b/i
  },
  {
    id: "seated",
    re: /\b(?:she|he|her|his|their|it)\s+(?:sits|sitting|is\s+seated)\b|\b(?:the\s+)?(?:woman|man|figure|person|child|girl|boy|fisherman|child)\s+(?:sits|sitting|is\s+seated)\b/i
  },
  {
    id: "standing-still",
    re: /\b(?:she|he|her|his|their)\s+(?:stands|standing)\s+(?:still|stationary|motionless)\b|\b(?:the\s+)?(?:woman|man|figure|person)\s+(?:stands|standing)\s+(?:still|stationary|motionless)\b/i
  }
];

/* --------------------------------------------------------------------- *
 * The OPENING state of a shot.
 *
 * The clip is generated FROM the first frame, so the first frame has to show
 * the body BEFORE the shot's first movement - not after it. "Her right hand
 * comes forward from behind her back" starts with the hand BEHIND her back,
 * so a still that already has the hand raised and pointing is a still of the
 * wrong instant, and the clip would begin by snapping into a pose it is
 * already in.
 *
 * A "position" is where a limb is. A "reach" is a position the shot moves
 * INTO. A "source" is the position it moves FROM.
 * --------------------------------------------------------------------- */

/** Where a limb can be. */
const POSITIONS: Array<{ id: string; re: RegExp }> = [
  { id: "behind-back", re: /\bbehind\s+(?:her|his|their|the)\s+back\b/i },
  { id: "at-side", re: /\b(?:at|down\s+to|back\s+down\s+to|to)\s+(?:her|his|their)\s+sides?\b/i },
  { id: "pointing", re: /\b(?:pointing|points\s+at|point\s+at|points\s+forward)\b/i },
  {
    id: "raised-front",
    re: /\b(?:raised\s+in\s+front|held\s+up|held\s+forward|comes?\s+forward|reach(?:es)?\s+forward|extend(?:s|ed|ing)?\s+forward|index\s+finger\s+extend(?:s|ed|ing)?)\b/i
  },
  { id: "chin-level", re: /\bchin\s+(?:is\s+|remains\s+|stays\s+)?level\b/i },
  { id: "chin-down", re: /\bchin\s+(?:dips?|drops?|lowers?|tucks?|is\s+down)\b/i },
  { id: "eyes-down", re: /\beyes\s+(?:lower|drop|are\s+down|fall)\b/i }
];

/**
 * How each position is described to the Brain.
 *
 * The rule messages are read by a language model, so they have to be written
 * in words the model can act on - "at-side" is not something a writer can put
 * in a photograph.
 */
const POSITION_LABELS: Record<string, string> = {
  "behind-back": "her hands behind her back",
  "at-side": "her hand at her side",
  pointing: "her finger pointing",
  "raised-front": "her hand raised in front of her",
  "chin-level": "her chin level",
  "chin-down": "her chin lowered",
  "eyes-down": "her eyes lowered"
};

/** The readable name of a position. */
function positionLabel(id: string): string {
  return POSITION_LABELS[id] ?? id;
}

/**
 * The position a limb is in BEFORE the shot's first movement.
 *
 * The whole "from ..." phrase is matched, so the phrase can be cut out of the
 * clause before the clause is scanned for the position the movement REACHES.
 */
const SOURCE_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "behind-back", re: /\bfrom\s+behind\s+(?:her|his|their|the)\s+back\b/i },
  { id: "at-side", re: /\bfrom\s+(?:her|his|their)\s+sides?\b/i },
  { id: "pointing", re: /\bfrom\s+(?:the\s+)?pointing(?:\s+position)?\b/i },
  { id: "chin-level", re: /\bfrom\s+level\b/i }
];

/** Words that say a limb TRAVELS. */
const MOVE_VERBS = [
  "come", "comes", "coming", "move", "moves", "moving", "extend", "extends",
  "extending", "point", "points", "pointing", "lower", "lowers", "lowering",
  "raise", "raises", "raising", "dip", "dips", "dipping", "lift", "lifts",
  "lifting", "slide", "slides", "sliding", "reach", "reaches", "reaching",
  "turn", "turns", "turning", "carry", "carries", "track", "tracks", "curl",
  "curls", "curling", "draw", "draws", "push", "pushes", "pull", "pulls",
  "walk", "walks", "step", "steps", "shift", "shifts", "open", "opens",
  "close", "closes", "nod", "nods", "tilt", "tilts", "drop", "drops",
  "release", "releases", "swing", "swings", "settle", "settles"
];

/** Words that say a limb HOLDS a position instead of travelling to one. */
const HOLD_VERBS = [
  "remain", "remains", "remaining", "stay", "stays", "staying", "hold",
  "holds", "holding", "keep", "keeps", "clasp", "clasped", "clasping",
  "rest", "rests", "resting", "press", "presses", "pressed", "furrow",
  "furrows", "together", "folded"
];

/** Pairs of pose states that describe two different arrangements. */
const POSE_CONFLICTS: Array<[string, string]> = [
  ["arms-at-sides", "hands-behind-back"],
  ["arms-at-sides", "arms-crossed"],
  ["arms-at-sides", "hands-forward"],
  ["arms-at-sides", "hands-at-side"],
  ["arms-crossed", "hands-forward"],
  ["arms-crossed", "hands-behind-back"],
  ["hands-at-side", "hands-behind-back"],
  ["hands-at-side", "hands-forward"],
  ["chin-up", "chin-down"],
  ["eyes-open", "eyes-closed"],
  ["seated", "standing-still"]
];

/**
 * Time of day. These are the families that must MATCH between a shot and
 * its first frame, and that must not contradict each other inside a page.
 */
const TIME_FAMILIES: Array<{ id: string; words: string[] }> = [
  { id: "early", words: ["dawn", "sunrise", "pre-dawn", "first light", "morning"] },
  { id: "day", words: ["midday", "noon", "daylight", "afternoon"] },
  { id: "dusk", words: ["dusk", "sunset", "twilight", "evening"] },
  { id: "night", words: ["night", "midnight", "moonlight", "after dark"] }
];

/**
 * Light quality. These may differ in wording but must not contradict, and a
 * first frame has to carry the same one as its clip.
 */
const LIGHT_FAMILIES: Array<{ id: string; words: string[] }> = [
  { id: "cloud", words: ["overcast", "cloudy", "cloud cover", "clouds"] },
  { id: "grey", words: ["grey", "gray"] },
  { id: "warm", words: ["golden", "amber", "warm"] },
  { id: "low", words: ["dim", "faint", "low light"] },
  { id: "pale", words: ["pale", "washed out"] },
  { id: "haze", words: ["mist", "fog", "haze"] },
  // "bright" is a light, not a time of day - a yellow headtie is not noon.
  { id: "bright", words: ["bright", "sunlit", "brilliant"] }
];

/** Times of day that cannot both describe the same moment. */
const TIME_CONFLICTS: Array<[string, string]> = [
  ["early", "night"],
  ["early", "dusk"],
  ["dusk", "day"],
  ["dusk", "night"],
  ["night", "day"]
];

/** Light qualities that cannot both describe the same moment. */
const LIGHT_CONFLICTS: Array<[string, string]> = [["cloud", "warm"]];

/**
 * Objects that must not vanish between the shot and its first frame. Only
 * things that are already in the scene - an object the shot says ENTERS the
 * frame is legitimately absent from the opening frame.
 */
const SCENE_OBJECTS: Array<{ re: RegExp; any: string[] }> = [
  { re: /\bdriftwood\b/i, any: ["driftwood"] },
  { re: /\bplastic bottle\b|\bbottle\b/i, any: ["bottle"] },
  { re: /\bplank\b/i, any: ["plank"] },
  { re: /\b(?:scrap|piece) of (?:fabric|cloth)\b|\bfabric\b|\bcloth\b/i, any: ["fabric", "cloth"] },
  { re: /\bplastic bag\b|\bbag\b/i, any: ["bag"] },
  { re: /\bfishing boats?\b|\bboats?\b/i, any: ["boat", "boats"] },
  { re: /\brail(?:ing)?\b/i, any: ["rail", "railing"] },
  { re: /\bseawall\b/i, any: ["seawall"] },
  { re: /\bjetty\b/i, any: ["jetty"] },
  { re: /\b(?:mooring(?:s)?|moored)\b/i, any: ["mooring", "moorings", "moored"] },
  { re: /\b(?:pier|dock|quay)\b/i, any: ["pier", "dock", "quay"] },
  { re: /\brope\b/i, any: ["rope"] },
  { re: /\bcrate\b/i, any: ["crate"] },
  { re: /\bcanopy\b|\bawning\b/i, any: ["canopy", "awning"] },
  { re: /\b(?:palm|palms)\b/i, any: ["palm", "palms"] },
  { re: /\bbuildings?\b/i, any: ["building", "buildings"] }
];

/**
 * Actions that the character is performing right now. A still prompt that
 * contains one of these is describing a moment mid-action, not the frozen
 * opening frame.
 */
const IN_PROGRESS_ACTIONS = [
  "walks", "walking", "lifts", "lifting", "lowers", "lowering", "raises",
  "raising", "swings", "swinging", "slides", "sliding", "shifts",
  "shifting", "turns", "turning", "reaches", "reaching", "steps",
  "stepping", "extends", "extending", "grips", "gripping", "releases",
  "releasing", "opens", "opening", "closes", "closing", "blinks",
  "blinking", "nods", "nodding", "leans", "leaning", "straightens",
  "straightening", "drops", "dropping", "points", "counts", "moves",
  "moving", "settles", "settling", "comes", "coming", "passes", "passing",
  "sways", "swaying", "gestures", "gesturing", "follows", "following",
  "runs", "running", "marches", "marching"
];

const TEXT_WORDS = ["letter", "lettering", "title", "caption", "subtitle", "logo", "watermark", "sign", "word", "text"];

/**
 * Words that LOOK like verbs in the narration but are not character actions.
 * Without this, "the water returned what the city gave it" would count
 * "returned" as an action and lock the character's habit out of a shot that
 * has no character in it at all.
 */
const STOP_HABIT_WORDS = new Set([
  "thing", "things", "something", "anything", "nothing", "everything",
  "water", "waters", "morning", "evening", "dawn", "dusk", "night",
  "boat", "boats", "city", "town", "shore", "street", "sky", "wind",
  "rains", "rain", "light", "lights", "shadow", "shadows", "reflection",
  "reflections", "boat", "wave", "waves", "sound", "sounds", "voice",
  "voices", "name", "names", "word", "words", "glass", "metal", "wood",
  "wooden", "palm", "palms", "train", "trains", "lagoon", "harbour",
  "harbor", "waterfront", "marina", "morning", "day", "days", "week",
  "weeks", "breeze", "wind", "cloth", "fabric", "bottle", "plank", "bag"
]);
const NEGATIVE_PHRASES = [
  "no text",
  "without text",
  "no letters",
  "no lettering",
  "no titles",
  "no title",
  "no logos",
  "no logo",
  "no captions",
  "no caption",
  "no words",
  "no subtitles",
  "no watermarks",
  "no signage",
  "without lettering",
  "without logos",
  "without captions"
];

/** Words that mean "a name appeared in the prompt". */
const NAME_STOPLIST = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "so", "as", "at", "by",
  "for", "from", "in", "into", "of", "on", "to", "with", "without", "over",
  "under", "up", "down", "out", "off", "she", "he", "they", "it", "his",
  "her", "their", "its", "one", "two", "three", "no", "not", "nothing",
  "exactly", "frame", "water", "sky", "light", "night", "morning", "sun",
  "moon", "city", "street", "room", "door", "window", "ground", "rain",
  "wind", "boat", "boats", "sea", "lake", "river", "shore", "wave", "waves"
]);

export interface ShotViolation {
  rule: string;
  detail: string;
}

/* --------------------------------------------------------------------- *
 * Rule helpers
 * --------------------------------------------------------------------- */

/** Split a prompt into sentences, keeping the punctuation. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The light families a prompt describes. */
function lightFamilies(text: string): Set<string> {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const family of LIGHT_FAMILIES) {
    if (family.words.some((w) => lower.includes(w))) found.add(family.id);
  }
  return found;
}

/** The times of day a prompt describes. */
function timeFamilies(text: string): Set<string> {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const family of TIME_FAMILIES) {
    if (family.words.some((w) => lower.includes(w))) found.add(family.id);
  }
  return found;
}

/**
 * The first contradictory pair between two sets of the same kind.
 */
function familyConflict(
  a: Set<string>,
  b: Set<string>,
  table: Array<[string, string]>
): string | null {
  for (const [x, y] of table) {
    if (a.has(x) && b.has(y)) return `${x} and ${y}`;
    if (a.has(y) && b.has(x)) return `${y} and ${x}`;
  }
  return null;
}

/**
 * Do two sets of families agree?
 *
 * They agree when they share at least one. A prompt that mentions BOTH
 * "dawn" and "night air" describes one moment, so it must not be held
 * against a prompt that mentions the same two.
 */
function familiesAgree(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

/**
 * Any word that says the light is there, however it is worded.
 *
 * The light families are a heuristic, so a first frame that says "soft pink
 * and orange light" has stated its light even though none of the family
 * words appear. Only a first frame that says nothing about the light at all
 * is a problem.
 */
const LIGHT_MENTIONS = [
  "light", "lit", "sun", "sunlight", "glow", "glows", "bright", "dark",
  "shadow", "shadows", "dawn", "morning", "dusk", "sunset", "night",
  "daylight", "golden", "amber", "pale", "grey", "gray", "overcast",
  "cloudy", "warm", "cool", "dim", "haze", "mist", "fog", "brightly"
];

/** Any word that says WHEN the moment is. */
const TIME_MENTIONS = [
  "dawn", "sunrise", "morning", "midday", "noon", "afternoon", "dusk",
  "sunset", "twilight", "evening", "night", "daylight", "sunlit", "day",
  "midnight", "daybreak"
];

/** The body positions a prompt describes. */
function poseStates(text: string): string[] {
  return POSE_STATES.filter((s) => s.re.test(text)).map((s) => s.id);
}

/** A light stem, so "walked" and "walks" compare equal. */
function stem(word: string): string {
  return word.replace(/(ing|ed|es|s)$/, "");
}

/** The first contradictory pair of body positions in a prompt. */
function poseConflict(text: string): string | null {
  const present = new Set(poseStates(text));
  for (const [a, b] of POSE_CONFLICTS) {
    if (present.has(a) && present.has(b)) return `${a} and ${b}`;
  }
  return null;
}

/** The positions a text asserts. Camera clauses are skipped - "the camera is at
 *  her side" is where the camera is, not where her hand is. */
function positionsIn(text: string): string[] {
  const found = new Set<string>();
  for (const clause of clauses(text)) {
    if (isCameraClause(clause)) continue;
    for (const id of POSITIONS.filter((p) => p.re.test(clause)).map((p) => p.id)) found.add(id);
  }
  return [...found];
}

/** Is this clause about the camera rather than about the body? */
function isCameraClause(clause: string): boolean {
  return /\b(camera|lens|viewpoint|point of view)\b/i.test(clause);
}

/** Split a prompt into clauses - the comma-separated pieces of a sentence. */
function clauses(text: string): string[] {
  return text
    .split(/[,;]|\.\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Does the text contain one of these words as a whole word? Hyphens do not
 *  count as word breaks, so "close-cropped" is not the verb "close". */
function hasWord(text: string, words: string[]): boolean {
  return words.some((w) => new RegExp(`(?<![\\w-])${w}(?![\\w-])`, "i").test(text));
}

/**
 * Where the body is AT THE START of a shot, and where the shot MOVES it to.
 *
 * A clause that says a limb travels ("her right hand comes forward from
 * behind her back") contributes the position it REACHES. The position it
 * starts from is named by the "from ..." phrase, which is cut out of the
 * clause first so the source is never mistaken for the destination. A clause
 * that only says a limb HOLDS a position contributes to the opening state
 * instead - that position is already true when the clip starts.
 */
function openingState(shotText: string): { start: string[]; reach: string[] } {
  const start = new Set<string>();
  const reach = new Set<string>();
  for (const clause of clauses(shotText)) {
    if (isCameraClause(clause)) continue;
    const moves = hasWord(clause, MOVE_VERBS);
    const holds = hasWord(clause, HOLD_VERBS);
    // Cut the "from ..." source phrase out of the clause before looking for
    // the position the movement reaches.
    let rest = clause;
    for (const source of SOURCE_PATTERNS) {
      const match = clause.match(source.re);
      if (!match) continue;
      start.add(source.id);
      rest = rest.replace(match[0], " ");
    }
    if (moves && !holds) {
      for (const id of positionsIn(rest)) reach.add(id);
    } else if (holds && !moves) {
      for (const id of positionsIn(rest)) start.add(id);
    }
  }
  return { start: [...start], reach: [...reach] };
}
/**
 * Does the prompt describe a character doing something RIGHT NOW? A first
 * frame is a photograph, so an action in progress means the still is not the
 * frozen opening frame of the clip.
 */
function hasActionInProgress(text: string): string | null {
  const lower = text.toLowerCase();
  for (const verb of IN_PROGRESS_ACTIONS) {
    // The verb must belong to a character: a pronoun subject, optionally with
    // a couple of words in between ("her right foot lifts", "her head turns").
    const re = new RegExp(`\\b(?:she|he|her|his|their|it)\\s+(?:\\w+\\s+){0,2}${verb}\\b`, "i");
    if (re.test(lower)) return verb;
  }
  return null;
}

/**
 * The objects a prompt puts in the scene, minus anything the prompt says
 * ENTERS the frame - an object that arrives later is correctly absent from
 * the opening frame.
 *
 * Each object is returned with the words that count as it, so "moored" and
 * "mooring" are the same object.
 */
function sceneObjects(text: string): string[][] {
  const entering = new Set<string>();
  for (const sentence of sentences(text)) {
    if (!/(enter|enters|entering|moves into|comes into|crosses into|flies into|steps into|walks into)/i.test(sentence)) {
      continue;
    }
    for (const obj of SCENE_OBJECTS) {
      if (obj.re.test(sentence)) entering.add(obj.any[0]!);
    }
  }
  const present: string[][] = [];
  for (const obj of SCENE_OBJECTS) {
    if (!obj.re.test(text)) continue;
    if (entering.has(obj.any[0]!)) continue;
    present.push(obj.any);
  }
  return present;
}

/**
 * Check a shot prompt against the rules the shot writer has to obey.
 *
 * This is a gate, not a suggestion. A prompt that fails is sent back to the
 * Brain once with the violations attached; if it still fails, a deterministic
 * prompt is built from the page instead, so a book never ends up with a
 * missing or broken shot.
 */
export function validateShotPrompt(
  prompt: string,
  ctx: {
    /** "shot" = the moving clip; "still" = its first frame. */
    kind?: "shot" | "still";
    /** Character look wording that must appear verbatim. */
    requiredLooks: string[];
    /** Role labels of the characters in frame. */
    charactersInFrame: string[];
    /** Proper names that must not appear in the prompt. */
    forbiddenNames: string[];
    /**
     * Phrases that must NOT appear. A STILL prompt must not carry the
     * character's movement wording - a photograph has no movement in it.
     */
    forbiddenPhrases?: string[];
    /**
     * The clip prompt this still belongs to. A still must describe the SAME
     * opening frame: same light, same objects already in the scene.
     */
    compareTo?: string;
    /**
     * The character bible's movement wording. When the narration describes a
     * specific action the habit must not be repeated verbatim.
     */
    habitMotion?: string | null;
    /** The narration words this shot covers. */
    narrationText?: string;
  }
): ShotViolation[] {
  const problems: ShotViolation[] = [];
  const kind = ctx.kind ?? "shot";
  const text = prompt.trim().replace(/\.\.+/g, ".");
  const lower = text.toLowerCase();

  // 1. The count. It has to be in the OPENING SENTENCE of the prompt: the
  // model has to decide how many people are in frame before it describes
  // anybody.
  const opening = (lower.split(/(?<=[.!?])\s+/)[0] ?? lower).slice(0, 120);
  const countMatch = opening.match(
    /exactly\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+([a-z\s]+?)\s+in\s+frame/
  );
  const noneMatch = /no\s+(people|persons?|animals?|creatures?)\b[^.]*in\s+frame/.test(opening);
  if (!countMatch && !noneMatch) {
    problems.push({
      rule: "count",
      detail: "the prompt must open with the exact number of people/animals in frame"
    });
  } else if (countMatch && ctx.charactersInFrame.length > 0) {
    const words: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10
    };
    const said = words[countMatch[1]!] ?? Number(countMatch[1]);
    const noun = countMatch[2]!.trim();
    // "Exactly one woman" means one CHARACTER. A phrase that names animals
    // as well ("two people and one dog") counts people + animals.
    const mentionsAnimal = /\b(dog|cat|bird|gull|goat|cow|horse|fish|animal|animals|dog|child|boy|girl)\b/.test(noun);
    const counted = said + (mentionsAnimal && /\band\b/.test(noun) ? 1 : 0);
    if (counted !== ctx.charactersInFrame.length) {
      problems.push({
        rule: "count-matches-cast",
        detail: `the prompt says ${counted} in frame but ${ctx.charactersInFrame.length} character(s) were listed`
      });
    }
  }

  // 2. Each character's look, verbatim.
  for (const look of ctx.requiredLooks) {
    const core = look.trim();
    if (!core) continue;
    if (!lower.includes(core.toLowerCase())) {
      problems.push({
        rule: "character-look",
        detail: `the prompt does not use the character's fixed look wording verbatim: "${core.slice(0, 80)}"`
      });
    }
  }

  // Rules 3 to 7 describe MOVEMENT, so they only apply to the moving clip.
  // A first frame is a photograph: it has no camera move, no body action, no
  // environment in motion, no effect and no frame entry. Judging a still by
  // the shot rules would flag every good photograph and push the writer down
  // the deterministic fallback path for no reason.
  if (kind === "shot") {
    // 3. The camera, stated.
    if (!CAMERA_WORDS.some((w) => lower.includes(w))) {
      problems.push({ rule: "camera", detail: "the prompt does not state the camera or its movement" });
    }

    // 4. Body mechanics, when somebody is in frame.
    if (ctx.charactersInFrame.length > 0) {
      const parts = BODY_PARTS.filter((w) => lower.includes(w)).length;
      const verbs = BODY_VERBS.filter((w) => new RegExp(`\\b${w}`, "i").test(text)).length;
      if (parts < 2 || verbs < 1) {
        problems.push({
          rule: "body-mechanics",
          detail: `the prompt must describe what the hands/arms/head/eyes/legs/torso do (found ${parts} body part(s), ${verbs} movement verb(s))`
        });
      }
    }

    // 5. The environment's own motion.
    const envHits = ENVIRONMENT_WORDS.filter((w) => lower.includes(w)).length;
    if (envHits < 2) {
      problems.push({
        rule: "environment-motion",
        detail: `the prompt must say what moves in the environment (found ${envHits} environment word(s))`
      });
    }

    // 6. No contradictory body positions. An arm cannot hang at the side
    // while the hands are clasped behind the back.
    const conflict = poseConflict(text);
    if (conflict) {
      problems.push({
        rule: "body-conflict",
        detail: `the body is described in two incompatible positions at once (${conflict})`
      });
    }

    // 7. Effects tied to a cause, sentence by sentence. An effect that
    // floats free of its cause inside one sentence is a floating effect.
    for (const sentence of sentences(text)) {
      const lowerSentence = sentence.toLowerCase();
      const hasEffect =
        EFFECT_WORDS.some((w) => lowerSentence.includes(w)) ||
        (lowerSentence.includes("light") &&
          LIGHT_EFFECT_VERBS.some((v) => lowerSentence.includes(v)));
      if (!hasEffect) continue;
      if (!CAUSE_WORDS.some((w) => lowerSentence.includes(w))) {
        problems.push({
          rule: "effect-cause",
          detail: `an effect is described with no cause in the same sentence: "${sentence.slice(0, 120)}"`
        });
      }
    }

    // 8. The bible's motion is a habit, not a lock. When the narration
    // describes an action the habit does not cover, repeating the habit
    // verbatim means the story action never happens.
    const habit = ctx.habitMotion?.trim();
    if (habit) {
      const narration = (ctx.narrationText ?? "").toLowerCase();
      const actionWords = Array.from(
        new Set(
          narration
            .split(/[^a-z]+/)
            .filter((w) => w.length > 3 && /ing$|ed$|s$/.test(w) && !STOP_HABIT_WORDS.has(w))
        )
      );
      // "walked" and "walks" are the same action, so the wording is stemmed
      // before it is compared.
      const habitStems = new Set(habit.toLowerCase().split(/[^a-z]+/).filter(Boolean).map(stem));
      const uncovered = actionWords.filter((w) => !habitStems.has(stem(w)));
      if (uncovered.length && text.toLowerCase().includes(habit.toLowerCase())) {
        problems.push({
          rule: "habit-lock",
          detail: `the narration describes an action the character habit does not cover (${uncovered.join(", ")}), so the habit must not be repeated verbatim`
        });
      }
    }

    // 9. What enters the frame.
    const saysNothingEnters = /nothing\s+(new\s+)?(enters|moves into|comes into)|no\s+(one|body|nothing)\s+enters/.test(lower);
    const saysSomethingEnters =
      /(enters|moves into|comes into|steps into|walks into|crosses into|flies into)[^.]{0,50}\b(frame|shot|foreground)\b/.test(lower);
    if (!saysNothingEnters && !saysSomethingEnters) {
      problems.push({
        rule: "frame-entry",
        detail: "the prompt must say what enters the frame (or that nothing does)"
      });
    }
  } else {
    // A STILL is the opening frame of the clip, so it must describe that
    // exact instant: the same light, the same objects already in the scene,
    // and no action in progress.
    const shotText = ctx.compareTo;

    if (shotText) {
      // The first frame must be the SAME moment: the same time of day, and
      // the same light. A dawn clip must not have a midnight still.
      const shotTime = timeFamilies(shotText);
      const stillTime = timeFamilies(text);
      if (!familiesAgree(shotTime, stillTime)) {
        const timeClash = familyConflict(shotTime, stillTime, TIME_CONFLICTS);
        if (timeClash) {
          problems.push({
            rule: "still-lighting",
            detail: `the still's time of day (${timeClash}) contradicts the shot's`
          });
        } else if (shotTime.size && stillTime.size) {
          problems.push({
            rule: "still-lighting",
            detail: `the still is at a different time of day (${[...stillTime].join(", ")}) than the shot (${[...shotTime].join(", ")})`
          });
        } else if (shotTime.size && !TIME_MENTIONS.some((w) => text.toLowerCase().includes(w))) {
          problems.push({
            rule: "still-lighting",
            detail: "the still does not state the time of day the shot uses"
          });
        }
      }

      const shotLight = lightFamilies(shotText);
      const stillLight = lightFamilies(text);
      if (!familiesAgree(shotLight, stillLight)) {
        const lightClash = familyConflict(shotLight, stillLight, LIGHT_CONFLICTS);
        if (lightClash) {
          problems.push({
            rule: "still-lighting",
            detail: `the still's light (${lightClash}) contradicts the shot's light`
          });
        } else if (shotLight.size && !LIGHT_MENTIONS.some((w) => text.toLowerCase().includes(w))) {
          problems.push({
            rule: "still-lighting",
            detail: "the still does not state the light the shot uses"
          });
        }
      }
    }

    const action = hasActionInProgress(text);
    if (action) {
      problems.push({
        rule: "still-freeze",
        detail: `the still describes an action in progress ("${action}"), but it must be the frozen opening frame`
      });
    }

    // The still has to show the pose the clip starts from. A still that
    // names no body part at all cannot be the opening frame of a shot that
    // is all about what the body does.
    if (shotText && ctx.charactersInFrame.length > 0) {
      const shotParts = BODY_PARTS.filter((w) => shotText.toLowerCase().includes(w)).length;
      const stillParts = BODY_PARTS.filter((w) => text.toLowerCase().includes(w)).length;
      if (shotParts >= 2 && stillParts === 0) {
        problems.push({
          rule: "still-pose",
          detail: "the still names no body part, so it cannot be the opening pose of this shot"
        });
      }
    }

    // The still has to show the body BEFORE the shot's first movement. If the
    // clip opens with "her right hand comes forward from behind her back", the
    // first frame is the one where her hand is STILL behind her back. A still
    // that already has the hand raised and pointing is a photograph of a later
    // instant, and the clip would open by snapping into the pose it is
    // already in.
    if (shotText && ctx.charactersInFrame.length > 0) {
      const { start, reach } = openingState(shotText);
      if (start.length && reach.length) {
        const stillPositions = positionsIn(text);
        const late = stillPositions.filter((id) => reach.includes(id) && !start.includes(id));
        if (late.length) {
          problems.push({
            rule: "still-start-state",
            detail:
              `the still shows ${late.map(positionLabel).join(" and ")}, which the shot only reaches later; ` +
              `the first frame has to show the position the clip starts from (${start.map(positionLabel).join(" and ")})`
          });
        } else if (!stillPositions.some((id) => start.includes(id))) {
          problems.push({
            rule: "still-start-state",
            detail: `the still does not show the position the clip starts from (${start.map(positionLabel).join(" and ")})`
          });
        }
      }
    }

    if (shotText) {
      const shotObjects = sceneObjects(shotText);
      const stillObjects = sceneObjects(text);
      const missing = shotObjects.filter(
        (forms) => !forms.some((form) => stillObjects.some((other) => other.includes(form)))
      );
      if (missing.length) {
        problems.push({
          rule: "still-objects",
          detail: `the still is missing objects the shot already has in frame: ${missing.map((f) => f[0]).join(", ")}`
        });
      }
    }
  }

  // 8. No text, letters, titles or logos.
  let scrubbed = lower;
  for (const phrase of NEGATIVE_PHRASES) scrubbed = scrubbed.split(phrase).join(" ");
  const foundText = TEXT_WORDS.filter((w) => new RegExp(`\\b${w}s?\\b`, "i").test(scrubbed));
  if (foundText.length) {
    problems.push({
      rule: "no-text",
      detail: `the prompt mentions ${foundText.join(", ")}`
    });
  }

  // 9. No character names.
  for (const name of ctx.forbiddenNames) {
    if (!name) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) {
      problems.push({ rule: "no-names", detail: `the prompt uses the name "${name}" - describe the character by look instead` });
    }
  }

  // 10. Phrases that must not be here (a still cannot describe movement).
  for (const phrase of ctx.forbiddenPhrases ?? []) {
    const needle = phrase.trim();
    if (!needle) continue;
    if (lower.includes(needle.toLowerCase())) {
      problems.push({
        rule: "forbidden-phrase",
        detail: `the prompt contains movement wording that does not belong in a still: "${needle.slice(0, 80)}"`
      });
    }
  }

  return problems;
}

/* --------------------------------------------------------------------- *
 * Narration span mapping
 * --------------------------------------------------------------------- */

/** Collapse whitespace so offsets can be compared reliably. */
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Map each beat onto a character range of the page text.
 *
 * The beats must tile the page exactly: shot 0 starts at 0, every shot
 * starts where the previous one ended, and the last shot ends at the end of
 * the page. That is what makes the shot sequence cover the narration with no
 * gap and no overlap.
 */
export function resolveNarrationSpans(
  pageText: string,
  beats: string[],
  totalMs: number
): Array<{ startMs: number; endMs: number; text: string }> {
  const flat = normalise(pageText);
  const flatLen = flat.length || 1;

  // Find each beat in order.
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const beat of beats) {
    const needle = normalise(beat);
    if (!needle) {
      ranges.push({ start: cursor, end: cursor });
      continue;
    }
    let at = flat.indexOf(needle, cursor);
    if (at === -1) at = flat.indexOf(needle);
    if (at === -1) {
      // The Brain paraphrased. Fall back to proportional placement so the
      // sequence still tiles the page.
      at = cursor;
    }
    const end = at + needle.length;
    ranges.push({ start: at, end });
    cursor = end;
  }

  // Force a perfect tiling.
  if (ranges.length) {
    ranges[0]!.start = 0;
    for (let i = 1; i < ranges.length; i++) {
      ranges[i]!.start = ranges[i - 1]!.end;
      ranges[i]!.end = Math.max(ranges[i]!.end, ranges[i]!.start);
    }
    const last = ranges[ranges.length - 1]!;
    last.end = Math.max(last.end, flatLen);
    if (last.start > last.end) last.start = last.end;
  }

  return ranges.map((r, i) => ({
    startMs: Math.round((r.start / flatLen) * totalMs),
    endMs: Math.round((r.end / flatLen) * totalMs),
    text: beats[i] ?? ""
  }));
}

/**
 * The narration length of a page, in milliseconds.
 *
 * The real audio is probed with ffprobe when the binary is available (it can
 * read a URL directly). If that fails, the length is estimated from the word
 * count, which is close enough to place the shots.
 */
export async function narrationDurationMs(
  text: string,
  audioUrl: string | null | undefined
): Promise<{ ms: number; source: "probe" | "estimate" }> {
  if (audioUrl) {
    const probed = await probeDurationMs(audioUrl);
    if (probed && probed > 200) return { ms: Math.round(probed), source: "probe" };
  }
  const words = normalise(text).split(" ").filter(Boolean).length;
  const ms = Math.round((words / FALLBACK_WORDS_PER_MINUTE) * 60_000);
  return { ms: Math.max(1000, ms), source: "estimate" };
}

/** Ask ffprobe how long a remote media file is. */
function probeDurationMs(url: string): Promise<number | null> {
  const bin = resolveFfprobe();
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const done = (v: number | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        bin,
        ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", url],
        { stdio: ["ignore", "pipe", "ignore"] }
      );
    } catch {
      done(null);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      done(null);
    }, 45_000);
    child.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      done(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const secs = Number(out.trim());
      done(Number.isFinite(secs) && secs > 0 ? secs * 1000 : null);
    });
  });
}

/* --------------------------------------------------------------------- *
 * Deterministic fallback
 * --------------------------------------------------------------------- */

/**
 * Build a compliant shot prompt without asking the Brain.
 *
 * Used when the Brain is unreachable or keeps failing validation. It is
 * deliberately plain, but it obeys every rule the validator checks, so a
 * page never ends up with a broken shot.
 */
export function buildFallbackShot(input: {
  narrationText: string;
  characters: { roleLabel: string; look: string; motion?: string | null }[];
  setting: string;
  camera: string;
}): { shotPrompt: string; stillPrompt: string } {
  const { narrationText, characters, setting, camera } = input;
  const count =
    characters.length === 0
      ? "No people or animals in frame."
      : `Exactly ${characters.length === 1 ? "one" : String(characters.length)} ${
          characters.length === 1 ? "person" : "people"
        } in frame.`;

  // The look sentence, without the movement sentence. The look is the same in
  // the clip and in the first frame; the movement is only in the clip.
  const lookOnly = characters
    .map((c) => c.look.trim().replace(/\s*\.\s*$/, "") + ".")
    .join(" ");

  // The look sentence plus the movement sentence.
  const cast = characters
    .map((c) => `${c.look.trim().replace(/\s*\.\s*$/, "")}. ${(c.motion ?? "Their posture stays level and unhurried.").trim()}`)
    .join(" ");

  const action = characters.length
    ? "Her head turns a few degrees toward the water and holds, her right hand comes off the rail and settles at her side, and her weight shifts from the back foot to the front foot before she stands still again."
    : "";

  const shotPrompt = [
    count,
    cast,
    action,
    "The water moves on its own: waves roll in low and break into foam at the edge, and the reflection on the surface breaks apart because the water is moving under it. The light on the surface slides because the sun has moved since the first frame.",
    `Camera: ${camera}. Locked-off static shot. The camera does not move.`,
    "Nothing enters the frame.",
    `Setting: ${setting}.`
  ]
    .filter(Boolean)
    .join(" ");

  // A photograph cannot move, so the still carries the look only - no
  // movement sentence, no camera, nothing entering.
  const stillPose = characters.length
    ? "The figure stands still with the arms at the sides, the hands relaxed, the head level and the eyes directed ahead."
    : "";
  const stillPrompt = [
    count,
    lookOnly,
    stillPose,
    `A single still instant at ${setting}. The light is low and the water is flat. Nothing in this frame moves.`
  ]
    .filter(Boolean)
    .join(" ");

  return { shotPrompt, stillPrompt };
}

/* --------------------------------------------------------------------- *
 * Brain calls
 * --------------------------------------------------------------------- */

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) candidates.push(fence[1]);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/**
 * Write (or reuse) the book's character bible.
 *
 * Reusing an existing bible is what keeps a re-run from changing the look of
 * a character halfway through a book.
 */
export async function writeCharacterBible(bookId: string): Promise<ShotCharacterDraft[]> {
  const existing = await prisma.shotCharacter.findMany({ where: { bookId }, orderBy: { order: "asc" } });
  if (existing.length) {
    return existing.map((c) => ({ roleLabel: c.roleLabel, look: c.look, motion: c.motion ?? undefined }));
  }

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: {
      title: true,
      synopsis: true,
      pages: { orderBy: { pageNum: "asc" }, select: { pageNum: true, textExcerpt: true } }
    }
  });
  if (!book) throw new Error(`book ${bookId} not found`);

  const brain = await prisma.bookBrain.findUnique({ where: { bookId }, select: { rawJson: true } });
  const brainCharacters = extractBrainCharacters(brain?.rawJson);

  const prompt = JSON.stringify({
    task: "Write the character bible for this book.",
    book: { title: book.title, synopsis: book.synopsis?.slice(0, 600) },
    pages: book.pages.map((p) => ({ page_num: p.pageNum, text: p.textExcerpt })),
    characters_from_the_brain: brainCharacters
  });

  const raw = await callAnthropic(prompt, CHARACTER_BIBLE_SYSTEM);
  const parsed = extractJson(raw);
  const list = Array.isArray(parsed?.["characters"]) ? (parsed!["characters"] as unknown[]) : [];
  const bible: ShotCharacterDraft[] = [];
  for (const item of list) {
    const c = item as Partial<ShotCharacterDraft>;
    if (!c?.roleLabel || !c?.look) continue;
    bible.push({ roleLabel: String(c.roleLabel), look: String(c.look), motion: c.motion ? String(c.motion) : undefined });
  }
  if (!bible.length) return [];
  await prisma.shotCharacter.createMany({
    data: bible.map((c, i) => ({
      bookId,
      order: i,
      roleLabel: c.roleLabel,
      look: c.look,
      motion: c.motion ?? null
    }))
  });
  return bible;
}

/** Pull the character list out of a stored Book Brain, if there is one. */
function extractBrainCharacters(rawJson: unknown): Array<{ name?: string; description?: string }> {
  if (!rawJson || typeof rawJson !== "object") return [];
  const chars = (rawJson as { characters?: unknown }).characters;
  if (!Array.isArray(chars)) return [];
  return chars
    .map((c) => c as { name?: string; description?: string })
    .filter((c) => c && (c.name || c.description));
}

/**
 * Ask the Brain for the beats of one page, then validate and repair them.
 */
/**
 * The shortest narration span a shot may cover.
 *
 * A clip is 6 seconds long but the player cuts it at the end of its span, so
 * a 1.5 second span would show a gesture that never finishes. Beats shorter
 * than this are merged until every shot has room to complete its action.
 *
 * 3.5s, not 4s: a 7.5 second page split in two gives 3.78s a shot, which is
 * "about four seconds" and still leaves the 6 second clip with headroom.
 */
export const MIN_SHOT_NARRATION_MS = 3500;

/**
 * How much narration a shot aims to cover.
 *
 * Four seconds is the sweet spot: long enough for a visible action to start
 * and finish, short enough that the 6 second clip is not mostly padding.
 */
export const TARGET_SHOT_NARRATION_MS = 4000;

/**
 * Split a page's sentences into exactly `wanted` beats, as evenly as the
 * text allows.
 *
 * This is the deterministic fallback when the Brain does not return the
 * number of beats that was asked for. A page that ends up with one long beat
 * would have a single 6 second clip covering eight seconds of narration, so
 * the count matters more than the exact wording of the seam.
 */
export function balanceBeats(sentences: string[], wanted: number): string[] {
  if (wanted <= 1) return [sentences.join(" ")].filter(Boolean);
  let pieces = sentences.map((s) => s.trim()).filter(Boolean);
  if (!pieces.length) return [];

  // Not enough sentences: split the longest one at a comma until there are.
  while (pieces.length < wanted) {
    let longest = 0;
    for (let i = 1; i < pieces.length; i++) {
      if (pieces[i]!.length > pieces[longest]!.length) longest = i;
    }
    const text = pieces[longest]!;
    const comma = text.lastIndexOf(", ");
    if (comma <= 0) break;
    pieces = [
      ...pieces.slice(0, longest),
      text.slice(0, comma + 1).trim(),
      text.slice(comma + 1).trim(),
      ...pieces.slice(longest + 1)
    ];
  }
  if (pieces.length < wanted) return pieces;

  // Distribute into `wanted` groups of roughly equal word count.
  const wordsOf = (s: string) => s.split(/\s+/).length;
  const per = Math.ceil(pieces.reduce((n, p) => n + wordsOf(p), 0) / wanted);
  let groups: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const piece of pieces) {
    const words = wordsOf(piece);
    if (current.length && count + words > per && groups.length < wanted - 1) {
      groups.push(current.join(" "));
      current = [];
      count = 0;
    }
    current.push(piece);
    count += words;
  }
  if (current.length) groups.push(current.join(" "));

  // Split the longest group until there are as many as were asked for.
  while (groups.length < wanted) {
    let longest = 0;
    for (let i = 1; i < groups.length; i++) {
      if (groups[i]!.length > groups[longest]!.length) longest = i;
    }
    const words = groups[longest]!.split(/\s+/);
    const half = Math.ceil(words.length / 2);
    groups = [
      ...groups.slice(0, longest),
      words.slice(0, half).join(" "),
      words.slice(half).join(" "),
      ...groups.slice(longest + 1)
    ];
  }
  return groups.slice(0, wanted);
}

/**
 * Split a page's text into `count` contiguous chunks of roughly equal
 * LENGTH, so every shot covers about the same number of seconds.
 *
 * The cut is made at a space or a comma as close to the target as possible,
 * so the narration never lands mid-word. The beats are still the page's own
 * words in the page's own order - only the seam moves.
 */
export function splitByLength(text: string, count: number): string[] {
  const body = text.trim();
  if (count <= 1 || !body) return [body];
  const target = body.length / count;
  const cuts: number[] = [];
  for (let i = 1; i < count; i++) {
    const want = Math.round(target * i);
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let j = want - 18; j <= want + 18; j++) {
      if (j <= 0 || j >= body.length) continue;
      const ch = body[j - 1] ?? "";
      const next = body[j] ?? "";
      const isSpace = ch === " ";
      const isPunctuation = ",.;:!?â€”-".includes(ch);
      const startsWord = next !== " " && next !== "";
      if (!isSpace && !isPunctuation) continue;
      // Prefer a space, then punctuation, and prefer the closer cut.
      const score = (isSpace ? 0 : 1) * 100 + Math.abs(j - want);
      if (score < bestDistance) {
        bestDistance = score;
        best = j;
      }
    }
    if (best === -1) best = Math.min(body.length, Math.max(1, want));
    cuts.push(best);
  }
  const chunks: string[] = [];
  let from = 0;
  for (const cut of [...new Set(cuts)].sort((a, b) => a - b)) {
    if (cut <= from) continue;
    chunks.push(body.slice(from, cut).trim());
    from = cut;
  }
  chunks.push(body.slice(from).trim());
  return chunks.filter(Boolean);
}

/**
 * Merge beats that are too short to carry a visible action.
 *
 * The shortest group is merged into its neighbour (preferring the one that
 * follows) until every group covers at least MIN_SHOT_NARRATION_MS.
 */
export function mergeShortSpans(pageText: string, beats: string[], durationMs: number): string[] {
  if (beats.length <= 1) return beats;
  let groups = beats.map((b) => [b]);
  let spans = resolveNarrationSpans(pageText, groups.map((g) => g.join(" ")), durationMs);

  const groupMs = (i: number): number => spans[i]!.endMs - spans[i]!.startMs;
  let guard = 0;
  while (groups.length > 1 && guard++ < 32) {
    const shortIndex = groups.findIndex((_, i) => groupMs(i) < MIN_SHOT_NARRATION_MS);
    if (shortIndex === -1) break;
    // Merge into the next group when there is one, otherwise into the
    // previous one. Merging forward keeps the first beat's opening intact.
    const into = shortIndex < groups.length - 1 ? shortIndex + 1 : shortIndex - 1;
    const lower = Math.min(shortIndex, into);
    const upper = Math.max(shortIndex, into);
    groups = [
      ...groups.slice(0, lower),
      [...groups[lower]!, ...groups[upper]!],
      ...groups.slice(upper + 1)
    ];
    spans = resolveNarrationSpans(pageText, groups.map((g) => g.join(" ")), durationMs);
  }
  return groups.map((g) => g.join(" "));
}

/** Ask the Brain for the beats of one page. */
async function requestBeats(userPrompt: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await callAnthropic(userPrompt, BEAT_SPLITTER_SYSTEM, 2000);
  } catch (err) {
    console.warn(`[shot-writer] beat call failed: ${(err as Error).message.slice(0, 160)}`);
    return [];
  }
  const parsed = extractJson(raw);
  const list = Array.isArray(parsed?.["beats"]) ? (parsed!["beats"] as unknown[]) : [];
  const beats = list.map((b) => (typeof b === "string" ? b : String((b as Record<string, unknown>)?.["text"] ?? ""))).filter(Boolean);
  if (!beats.length) {
    console.warn(`[shot-writer] no beats parsed (${raw.length} chars): ${raw.slice(0, 200).replace(/\s+/g, " ")}`);
  }
  return beats;
}

async function writePageShots(input: {
  pageNum: number;
  text: string;
  setting: string;
  camera: string;
  emotion: string;
  bible: ShotCharacterDraft[];
  forbiddenNames: string[];
  durationMs: number;
}): Promise<{ shots: ShotPlan[]; violations: ShotViolation[] }> {
  const { pageNum, text, setting, camera, emotion, bible, forbiddenNames, durationMs } = input;

  // PHASE 1 - the beats. The split happens before any prompt is written so
  // the writer knows how many seconds of narration each shot has to cover.
  //
  // The count is worked out here: about four seconds of narration a shot,
  // and never fewer shots than the 6 second clip needs to cover the whole
  // page (a shorter clip would leave the narration running over a frozen
  // frame).
  const wantedBeats = Math.max(
    1,
    Math.ceil(durationMs / (SHOT_CLIP_SECONDS * 1000)),
    Math.round(durationMs / TARGET_SHOT_NARRATION_MS)
  );
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const beatPrompt = JSON.stringify({
    task: `Split this page of narration into exactly ${wantedBeats} beat${wantedBeats === 1 ? "" : "s"}.`,
    page: { page_num: pageNum, text },
    guidance: {
      narration_seconds: Math.round(durationMs / 100) / 10,
      beats_required: wantedBeats,
      seconds_per_beat: Math.round((durationMs / wantedBeats) / 100) / 10,
      sentences: sentences,
      note:
        `Return exactly ${wantedBeats} beat${wantedBeats === 1 ? "" : "s"}, each covering about ` +
        `${Math.round((durationMs / wantedBeats) / 100) / 10} seconds of narration. ` +
        "Make the beats the same length as each other - if one sentence is too long to fit in one " +
        "beat, cut it at a comma; if it is too short, join it to the next one."
    }
  });
  let beats = await requestBeats(beatPrompt);
  if (beats.length !== wantedBeats) {
    // The model returned the wrong number of beats. Fall back to splitting on
    // the sentences and then re-balancing, which is deterministic and always
    // gives every shot room to finish its action.
    const returned = beats.length;
    const balanced = balanceBeats(sentences, wantedBeats);
    if (balanced.length === wantedBeats) {
      beats = balanced;
      console.warn(
        `[shot-writer] page ${pageNum}: the Brain returned ${returned} beat(s), expected ${wantedBeats}; used the sentence split instead`
      );
    }
  }
  if (!beats.length) beats = [text];

  // A beat that is too short cannot carry a visible action. Rather than
  // accept that, the page is re-cut into equal-length beats, so every shot
  // covers about the same number of seconds.
  {
    const spans = resolveNarrationSpans(text, beats, durationMs);
    const shortest = Math.min(...spans.map((s) => s.endMs - s.startMs));
    if (beats.length === wantedBeats && shortest < MIN_SHOT_NARRATION_MS) {
      const even = splitByLength(text, wantedBeats);
      if (even.length === wantedBeats) {
        console.warn(
          `[shot-writer] page ${pageNum}: a beat was only ${Math.round(shortest)}ms; re-cut the page into ${wantedBeats} equal beats`
        );
        beats = even;
      }
    }
  }

  // Last resort: merge anything still too short.
  beats = mergeShortSpans(text, beats, durationMs);

  const spans = resolveNarrationSpans(text, beats, durationMs);
  const visible = spans.map((s) => Math.round((s.endMs - s.startMs) / 100) / 10);

  // PHASE 2 - the shots.
  const userPrompt = JSON.stringify({
    task: "Write one shot per beat.",
    page: { page_num: pageNum, text },
    beats: beats.map((b, i) => ({
      beat_index: i,
      narration_text: b,
      visible_seconds: visible[i] ?? 0
    })),
    character_bible: bible.map((c) => ({ role_label: c.roleLabel, look: c.look, motion: c.motion ?? null })),
    guidance: {
      setting,
      camera_hint: camera,
      mood: emotion,
      pace_note:
        "visible_seconds is how long the shot is actually on screen. The whole visible action must finish inside it.",
      motion_note:
        "The bible's motion is the character's DEFAULT habit. When the narration describes a specific action, the action overrides the habit and the habit must not be repeated.",
      light_note: "Every shot on this page must share the same time of day and the same light."
    }
  });

  let drafts = await requestShots(userPrompt);
  let violations = validateDrafts(drafts, { bible, forbiddenNames });

  // Retries with the violations attached. Two attempts: the second one sees
  // the first rewrite, so the model can see what it changed and what is
  // still wrong.
  for (let attempt = 0; attempt < 2 && violations.length; attempt++) {
    const retryPrompt = JSON.stringify({
      task: "Rewrite these shots. The previous attempt broke these rules.",
      rules_broken: violations.map((v) => `${v.rule}: ${v.detail}`),
      previous_attempt: drafts.map((d) => ({
        narration_text: d.narrationText,
        characters_in_frame: d.charactersInFrame,
        shot_prompt: d.shotPrompt,
        still_prompt: d.stillPrompt
      })),
      page: { page_num: pageNum, text },
      beats: beats.map((b, i) => ({
        beat_index: i,
        narration_text: b,
        visible_seconds: visible[i] ?? 0
      })),
      character_bible: bible.map((c) => ({ role_label: c.roleLabel, look: c.look, motion: c.motion ?? null })),
      guidance: { setting, camera_hint: camera, mood: emotion },
      instruction:
        "Keep the beats, the characters in frame and the wording you already got right. " +
        "Fix ONLY the broken rules, in the shot_prompt AND in the still_prompt where they apply. " +
        "Open EVERY prompt - shot and still - with the count phrase, exactly as written: " +
        "'Exactly one woman in frame.' or 'No people or animals in frame.' Nothing may come before it. " +
        "In every sentence that describes light, shadow, a reflection, a ripple, mist or cloth, " +
        "say what CAUSES it, in that same sentence (because / as / from / off / under / with / after). " +
        "The still_prompt is the FIRST FRAME of that clip: the same pose, the same time of day, the same " +
        "light and the same objects as the shot's opening instant, but with no movement in it. " +
        "The still_prompt MUST name the pose - say where her arms, her hands, her head and her eyes are " +
        "at the opening instant, exactly as the shot starts. A still with no pose is not the opening frame. " +
        "The still_prompt shows the body BEFORE the shot's first movement: if the shot's first action " +
        "brings her right hand forward from behind her back, the still shows that hand STILL BEHIND " +
        "HER BACK - not already raised and pointing. " +
        "The shot_prompt needs every one of them."
    });
    const retry = await requestShots(retryPrompt);
    if (!retry.length) break;
    const retryViolations = validateDrafts(retry, { bible, forbiddenNames });
    if (retryViolations.length < violations.length) {
      drafts = retry;
      violations = retryViolations;
    } else if (attempt === 0) {
      // No improvement: try once more, showing the model its own rewrite.
      continue;
    } else {
      break;
    }
  }

  // Repair whatever is still broken with the deterministic builder.
  const plans: ShotPlan[] = [];
  for (let i = 0; i < beats.length; i++) {
    const span = spans[i]!;
    const draft = drafts[i];
    const inFrame = bible.filter((c) => (draft?.charactersInFrame ?? []).includes(c.roleLabel));
    const narrationText = span.text;
    const habitMotion = inFrame.length === 1 ? inFrame[0]!.motion ?? null : null;

    let shotPrompt = "";
    let stillPrompt = "";
    let draftProblems: ShotViolation[] = [];
    let stillProblems: ShotViolation[] = [];

    if (draft) {
      draftProblems = validateShotPrompt(draft.shotPrompt, {
        kind: "shot",
        requiredLooks: inFrame.map((c) => c.look),
        charactersInFrame: draft.charactersInFrame,
        forbiddenNames,
        habitMotion,
        narrationText
      });
      // A still has no movement in it, so the character's movement wording must
      // not leak into the first-frame prompt.
      stillProblems = validateShotPrompt(draft.stillPrompt, {
        kind: "still",
        requiredLooks: inFrame.map((c) => c.look),
        charactersInFrame: draft.charactersInFrame,
        forbiddenNames,
        forbiddenPhrases: inFrame.map((c) => c.motion).filter((m): m is string => Boolean(m)),
        compareTo: draft.shotPrompt,
        narrationText
      });
      shotPrompt = draft.shotPrompt.replace(/\.\.+/g, ".");
      stillPrompt = draft.stillPrompt.replace(/\.\.+/g, ".");
    }

    // Try to fix a prompt in place before giving up on it: a near-miss look
    // wording or a leaked movement sentence is a one-line fix, and the
    // Brain's prompt is worth far more than the deterministic one. A prompt
    // that is still broken after the repair is replaced outright.
    if (!draft) {
      shotPrompt = buildFallbackShot({ narrationText, characters: inFrame, setting, camera }).shotPrompt;
      stillPrompt = buildFallbackShot({ narrationText, characters: inFrame, setting, camera }).stillPrompt;
    } else {
      if (draftProblems.length) {
        const repaired = repairPrompt(draft.shotPrompt, draftProblems, inFrame.map((c) => c.look), [], camera);
        const stillBroken = repaired.text
          ? validateShotPrompt(repaired.text, {
              kind: "shot",
              requiredLooks: inFrame.map((c) => c.look),
              charactersInFrame: draft.charactersInFrame,
              forbiddenNames,
              habitMotion,
              narrationText
            })
          : [{ rule: "empty", detail: "nothing to repair" }];
        shotPrompt = stillBroken.length
          ? buildFallbackShot({ narrationText, characters: inFrame, setting, camera }).shotPrompt
          : repaired.text;
      }
      if (stillProblems.length) {
        const repaired = repairPrompt(
          draft.stillPrompt,
          stillProblems,
          inFrame.map((c) => c.look),
          inFrame.map((c) => c.motion).filter((m): m is string => Boolean(m))
        );
        const stillBroken = repaired.text
          ? validateShotPrompt(repaired.text, {
              kind: "still",
              requiredLooks: inFrame.map((c) => c.look),
              charactersInFrame: draft.charactersInFrame,
              forbiddenNames,
              forbiddenPhrases: inFrame.map((c) => c.motion).filter((m): m is string => Boolean(m)),
              compareTo: shotPrompt,
              narrationText
            })
          : [{ rule: "empty", detail: "nothing to repair" }];
        if (!stillBroken.length) {
          stillPrompt = repaired.text;
        } else {
          // The pose cannot be fixed mechanically - it has to be rewritten in
          // words, and the generic builder would throw the whole scene away.
          const startProblem = stillBroken.find((p) => p.rule === "still-start-state");
          const rewritten = startProblem
            ? await rewriteStill({
                shotPrompt,
                stillPrompt: repaired.text,
                violation: startProblem.detail,
                looks: inFrame.map((c) => c.look)
              })
            : null;
          if (rewritten) {
            const rechecked = validateShotPrompt(rewritten, {
              kind: "still",
              requiredLooks: inFrame.map((c) => c.look),
              charactersInFrame: draft.charactersInFrame,
              forbiddenNames,
              forbiddenPhrases: inFrame.map((c) => c.motion).filter((m): m is string => Boolean(m)),
              compareTo: shotPrompt,
              narrationText
            });
            console.warn(
              `[shot-writer] first-frame rewrite: ${rechecked.length ? rechecked.map((p) => p.rule).join(", ") : "clean"}`
            );
            stillPrompt = rechecked.some((p) => p.rule === "still-start-state")
              ? buildFallbackShot({ narrationText, characters: inFrame, setting, camera }).stillPrompt
              : rewritten;
          } else {
            console.warn("[shot-writer] first-frame rewrite returned nothing");
            stillPrompt = buildFallbackShot({ narrationText, characters: inFrame, setting, camera }).stillPrompt;
          }
        }
      }
    }
    // The still is the FIRST FRAME of this shot, so it must open with the
    // same count wording the clip uses.
    stillPrompt = alignCountPhrase(shotPrompt, stillPrompt);

    const spanMs = Math.max(0, span.endMs - span.startMs);
    plans.push({
      order: i,
      narrationText,
      narrationStartMs: span.startMs,
      narrationEndMs: span.endMs,
      shotPrompt,
      stillPrompt,
      charactersInFrame: (draft?.charactersInFrame ?? []).filter((r) => bible.some((c) => c.roleLabel === r)),
      durationSeconds: spanMs > MAX_SHOT_NARRATION_MS ? SHOT_CLIP_SECONDS_LONG : SHOT_CLIP_SECONDS
    });
  }

  return { shots: plans, violations };
}

/**
 * Rewrite ONE first-frame prompt.
 *
 * A still that shows a pose the clip only reaches later cannot be fixed
 * mechanically - the pose has to be rewritten in words. The page level retry
 * rewrites the WHOLE page, which can break something that was already right,
 * so this asks for the one prompt that is wrong and nothing else.
 */
async function rewriteStill(input: {
  shotPrompt: string;
  stillPrompt: string;
  violation: string;
  looks: string[];
}): Promise<string | null> {
  const userPrompt = JSON.stringify({
    task: "Rewrite this first-frame prompt so it shows the instant the clip OPENS on.",
    rules_broken: [input.violation],
    shot_prompt: input.shotPrompt,
    still_prompt: input.stillPrompt,
    character_looks: input.looks,
    instruction:
      "Keep the time of day, the light, the objects in their places, the camera angle and the " +
      "character's look word for word. Change ONLY the body pose: it must be the pose the clip " +
      "STARTS from, before its first movement, never a pose the clip reaches later. " +
      'Return ONE JSON object: {"still_prompt": "..."}. Nothing else.'
  });
  let raw: string;
  try {
    raw = await callAnthropic(userPrompt, STILL_REWRITER_SYSTEM, 2_000);
  } catch (err) {
    console.warn(`[shot-writer] first-frame rewrite failed: ${(err as Error).message.slice(0, 160)}`);
    return null;
  }
  const parsed = extractJson(raw);
  const still = firstString((parsed ?? {}) as Record<string, unknown>, [
    "still_prompt",
    "stillPrompt",
    "first_frame_prompt",
    "prompt"
  ]);
  return still && still.trim() ? still.trim() : null;
}

/** Ask the Brain for the shots of one page and normalise the shape. */
async function requestShots(userPrompt: string): Promise<ShotDraft[]> {
  let raw: string;
  try {
    // The shot prompts are long, so this call gets a bigger token budget than
    // the Book Brain's default.
    raw = await callAnthropic(userPrompt, SHOT_WRITER_SYSTEM, 16_000);
  } catch (err) {
    console.warn(`[shot-writer] Brain call failed: ${(err as Error).message.slice(0, 160)}`);
    return [];
  }
  const parsed = extractJson(raw);
  const list = Array.isArray(parsed?.["shots"]) ? (parsed!["shots"] as unknown[]) : [];
  if (!list.length) {
    // Log enough to diagnose a schema drift without dumping the whole answer.
    console.warn(
      `[shot-writer] no shots parsed (${raw.length} chars, top-level keys: ${parsed ? Object.keys(parsed).join(",") : "unparseable"}) ` +
        `head: ${raw.slice(0, 300).replace(/\s+/g, " ")}`
    );
    return [];
  }
  const drafts: ShotDraft[] = [];
  for (const item of list) {
    const s = item as Record<string, unknown>;
    const shotPrompt = firstString(s, ["shot_prompt", "shotPrompt", "prompt"]);
    const stillPrompt = firstString(s, ["still_prompt", "stillPrompt", "first_frame_prompt"]);
    if (!shotPrompt || !stillPrompt) continue;
    drafts.push({
      narrationText: firstString(s, ["narration_text", "narrationText", "beat_text", "text"]) ?? "",
      charactersInFrame: Array.isArray(s["characters_in_frame"])
        ? (s["characters_in_frame"] as unknown[]).map(String)
        : Array.isArray(s["charactersInFrame"])
          ? (s["charactersInFrame"] as unknown[]).map(String)
          : [],
      shotPrompt,
      stillPrompt
    });
  }
  if (!drafts.length) {
    console.warn(`[shot-writer] ${list.length} shot(s) returned but none had a usable prompt`);
  }
  return drafts;
}

/** The first of several possible keys that holds a non-empty string. */
function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Put the bible's look wording back into a prompt.
 *
 * The Brain usually copies the look verbatim, but sometimes it paraphrases
 * it ("a matching yellow wrapper" instead of "a matching wrapper"). That is
 * a one-word slip, not a broken prompt, so the sentence is swapped for the
 * exact wording instead of throwing the whole prompt away.
 */
export function repairLook(text: string, look: string): string | null {
  const exact = look.trim();
  if (!exact) return null;
  const anchor = exact.split(/\s+/).slice(0, 4).join(" ");
  const parts = text.match(/[^.!?]*[.!?]+|[^.!?]+$/g) ?? [];
  for (const part of parts) {
    if (!part.toLowerCase().includes(anchor.toLowerCase())) continue;
    const at = text.indexOf(part);
    if (at === -1) continue;
    // Keep whatever whitespace came before the sentence, or the two
    // sentences end up glued together.
    const lead = part.match(/^\s*/)?.[0] ?? "";
    return text.slice(0, at) + lead + exact + text.slice(at + part.length);
  }
  return null;
}

/**
 * Fix a prompt in place where it can be fixed.
 *
 * Two repairs are safe and mechanical: putting the bible's exact look
 * wording back, and taking the character's movement sentence out of a still
 * (a photograph cannot move). Anything else has to be rewritten, which is
 * the job of the retry or the deterministic builder.
 */
export function repairPrompt(
  prompt: string,
  problems: ShotViolation[],
  looks: string[],
  motions: string[],
  camera?: string
): { text: string } {
  let out = prompt;
  if (!out) return { text: "" };
  if (problems.some((p) => p.rule === "character-look")) {
    for (const look of looks) {
      if (out.toLowerCase().includes(look.trim().toLowerCase())) continue;
      const fixed = repairLook(out, look);
      if (fixed) out = fixed;
    }
  }
  if (problems.some((p) => p.rule === "forbidden-phrase") && motions.length) {
    out = stripPhrases(out, motions);
  }
  // A prompt that forgot to say what the camera does is still a good prompt:
  // the camera is appended rather than the whole thing thrown away.
  if (problems.some((p) => p.rule === "camera")) {
    const stated = CAMERA_WORDS.some((w) => out.toLowerCase().includes(w));
    if (!stated) {
      const sentence =
        camera && /track/i.test(camera)
          ? "Tracking shot following the action."
          : "Locked-off static shot. The camera does not move.";
      out = `${out} ${sentence}`;
    }
  }
  return { text: out.replace(/\.\.+/g, ".").replace(/\s{2,}/g, " ").trim() };
}

/** Remove phrases from a prompt, tidying the punctuation they leave behind. */
function stripPhrases(text: string, phrases: string[]): string {
  let out = text;
  for (const phrase of phrases) {
    const needle = phrase.trim();
    if (!needle) continue;
    out = out.replace(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
  }
  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\.\s*\./g, ".")
    .trim();
}

/** The count phrase a prompt opens with, if it has one. */
const COUNT_PHRASE =
  /^(Exactly\s+[^.]+?\.|No\s+(?:people|persons?|animals?|creatures?)\b[^.]*?in\s+frame\.)/i;

/**
 * Make the still open with the same count wording as the clip.
 *
 * The still is the FIRST FRAME of the clip, so "Exactly one woman in frame"
 * in the clip and "Exactly one person in frame" in the still would hand the
 * model two different casts for the same instant.
 */
function alignCountPhrase(shotPrompt: string, stillPrompt: string): string {
  const shotCount = shotPrompt.match(COUNT_PHRASE);
  const stillCount = stillPrompt.match(COUNT_PHRASE);
  if (!shotCount || !stillCount) return stillPrompt;
  return stillPrompt.replace(stillCount[0], shotCount[0]);
}

/** Validate every draft of a page; returns the combined violations. */
function validateDrafts(
  drafts: ShotDraft[],
  ctx: { bible: ShotCharacterDraft[]; forbiddenNames: string[] }
): ShotViolation[] {
  const problems: ShotViolation[] = [];
  if (!drafts.length) {
    problems.push({ rule: "shots", detail: "the Brain returned no shots for this page" });
    return problems;
  }
  for (const draft of drafts) {
    const inFrame = ctx.bible.filter((c) => draft.charactersInFrame.includes(c.roleLabel));
    const habitMotion = inFrame.length === 1 ? inFrame[0]!.motion ?? null : null;
    problems.push(
      ...validateShotPrompt(draft.shotPrompt, {
        kind: "shot",
        requiredLooks: inFrame.map((c) => c.look),
        charactersInFrame: draft.charactersInFrame,
        forbiddenNames: ctx.forbiddenNames,
        habitMotion,
        narrationText: draft.narrationText
      })
    );
    problems.push(
      ...validateShotPrompt(draft.stillPrompt, {
        kind: "still",
        requiredLooks: inFrame.map((c) => c.look),
        charactersInFrame: draft.charactersInFrame,
        forbiddenNames: ctx.forbiddenNames,
        forbiddenPhrases: inFrame.map((c) => c.motion).filter((m): m is string => Boolean(m)),
        compareTo: draft.shotPrompt,
        narrationText: draft.narrationText
      })
    );
  }

  // The light is continuous across a page: every shot is at the same time of
  // day unless the narration says otherwise.
  const times = drafts.map((d) => timeFamilies(d.shotPrompt));
  for (let i = 1; i < times.length; i++) {
    if (familiesAgree(times[0]!, times[i]!)) continue;
    const clash = familyConflict(times[0]!, times[i]!, TIME_CONFLICTS);
    problems.push({
      rule: "page-lighting",
      detail: clash
        ? `shot ${i} is at a different time of day from shot 0 (${clash})`
        : `shot ${i} is at a different time of day from shot 0`
    });
  }
  return problems;
}

/* --------------------------------------------------------------------- *
 * The step
 * --------------------------------------------------------------------- */

export interface WriteShotsResult {
  bookSlug: string;
  pages: Array<{
    pageNum: number;
    shots: number;
    narrationMs: number;
    violations: ShotViolation[];
  }>;
  characters: ShotCharacterDraft[];
  written: number;
}

/**
 * THE SHOT-WRITER STEP.
 *
 * Writes the shot plan for every page of a book: the character bible first
 * (so everybody looks the same in every shot), then one shot per narration
 * beat per page, each with its narration span, its own motion prompt and its
 * own first-frame prompt.
 *
 * It never calls the video API. The shots are PLANNED - the clips are
 * generated later, one shot at a time, by the pipeline.
 */
export async function writeShotsForBook(
  bookSlug: string,
  opts: { replace?: boolean; dryRun?: boolean } = {}
): Promise<WriteShotsResult> {
  const book = await prisma.book.findUnique({
    where: { slug: bookSlug },
    select: {
      id: true,
      slug: true,
      title: true,
      synopsis: true,
      pages: {
        orderBy: { pageNum: "asc" },
        select: {
          id: true,
          pageNum: true,
          chapter: true,
          textExcerpt: true,
          audioUrl: true,
          sceneType: true,
          emotionalRegister: true,
          cameraAngle: true
        }
      }
    }
  });
  if (!book) throw new Error(`book "${bookSlug}" not found`);

  const bible = await writeCharacterBible(book.id);

  // Proper names in the narration must never appear in a prompt.
  const forbiddenNames = collectProperNames(book.pages.map((p) => p.textExcerpt));

  const result: WriteShotsResult = {
    bookSlug: book.slug,
    pages: [],
    characters: bible,
    written: 0
  };

  for (const page of book.pages) {
    const { ms, source } = await narrationDurationMs(page.textExcerpt, page.audioUrl);
    const { shots, violations } = await writePageShots({
      pageNum: page.pageNum,
      text: page.textExcerpt,
      setting: page.sceneType ?? page.chapter ?? book.title,
      camera: page.cameraAngle ?? "Locked-off static shot",
      emotion: page.emotionalRegister ?? "calm",
      bible,
      forbiddenNames,
      durationMs: ms
    });

    result.pages.push({
      pageNum: page.pageNum,
      shots: shots.length,
      narrationMs: ms,
      violations
    });

    if (!shots.length) {
      console.warn(`[shot-writer] page ${page.pageNum}: no shots written (narration ${source})`);
      continue;
    }

    if (!opts.dryRun) {
      if (opts.replace !== false) {
        // Replace only the PLANNED shots; a shot that already has a rendered
        // clip is kept so a re-run cannot throw away paid-for video.
        await prisma.shot.deleteMany({ where: { pageId: page.id, status: "PLANNED" } });
      }
      await prisma.shot.createMany({
        data: shots.map((s) => ({
          pageId: page.id,
          order: s.order,
          narrationStartMs: s.narrationStartMs,
          narrationEndMs: s.narrationEndMs,
          narrationText: s.narrationText,
          shotPrompt: s.shotPrompt,
          stillPrompt: s.stillPrompt,
          charactersInFrame: s.charactersInFrame,
          durationSeconds: s.durationSeconds,
          status: "PLANNED" as const
        }))
      });
      result.written += shots.length;
    }
  }

  return result;
}

/**
 * Proper names in the narration, so they can be kept out of the prompts.
 *
 * A capitalised word that is not a sentence-starting common word is treated
 * as a name. The stop list keeps the obvious false positives out.
 */
export function collectProperNames(texts: string[]): string[] {
  const names = new Set<string>();
  const common = new Set([
    "The", "A", "An", "And", "But", "If", "Then", "So", "As", "At", "By",
    "For", "From", "In", "Into", "Of", "On", "To", "With", "Without", "Over",
    "Under", "Up", "Down", "Out", "Off", "She", "He", "They", "It", "His",
    "Her", "Their", "Its", "When", "While", "After", "Before", "During",
    "There", "Here", "Now", "No", "Not", "Nothing", "One", "Two", "Three",
    "Night", "Morning", "Evening", "Day", "Lagos", "City", "Water", "Light",
    "Street", "Room", "Door", "Window", "God", "Lord", "First", "Last",
    "Every", "Some", "Most", "Other", "Another", "Because", "Since", "Though",
    "Yet", "Only", "Even", "Still", "Never", "Always", "Often", "Rarely"
  ]);
  for (const text of texts) {
    for (const raw of text.split(/\b/)) {
      const word = raw.trim().replace(/[^A-Za-z'-]/g, "");
      if (word.length < 3) continue;
      if (!/^[A-Z][a-z]+$/.test(word)) continue;
      if (common.has(word)) continue;
      if (NAME_STOPLIST.has(word.toLowerCase())) continue;
      names.add(word);
    }
  }
  return [...names];
}
