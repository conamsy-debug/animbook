/**
 * Unit tests for the shot writer's rules.
 *
 * These are the gate that keeps the Brain's prompts honest: the count, the
 * consistent look, the body mechanics, the cause of every effect, the
 * camera, the frame entry, the light, and the first frame matching the
 * opening of its clip.
 *
 * Run with: `node --test apps/api/tests/shotWriter.test.mjs`
 */
import "./_guard.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { validateShotPrompt, mergeShortSpans, balanceBeats, splitByLength, repairLook, collectProperNames } =
  await import("../dist/services/shotWriter.js");

const LOOK =
  "A woman in her thirties with deep brown skin, close-cropped natural hair beneath a bright yellow cotton headtie, wearing a matching wrapper tied at her waist over a white sleeveless blouse.";
const MOTION =
  "She walks with measured steps and steady rhythm, hands clasped loosely behind her back, occasionally pausing to lean forward slightly as she peers at the water, then resuming her unhurried pace.";

function rulesOf(problems) {
  return problems.map((p) => p.rule);
}

/** A prompt that satisfies every rule, used as the base for the tests. */
const GOOD_SHOT = [
  "Exactly one woman in frame.",
  LOOK,
  "Her right hand comes forward from behind her back, her right index finger extends and points at the first boat, her eyes follow the point, then her hand lowers back to her side.",
  "The reflection breaks apart because the water is moving under it.",
  "Three wooden boats rock on their moorings as the swell passes beneath them.",
  "Slow pan left.",
  "Nothing else enters the frame."
].join(" ");

const GOOD_STILL = [
  "Exactly one woman in frame.",
  LOOK,
  "She stands on the concrete waterfront with her hands clasped behind her back, her head level, her eyes looking straight ahead.",
  "Three wooden fishing boats are moored in the water to her right under an overcast sky.",
  "The camera is at her side."
].join(" ");

/* --------------------------------------------------------------------- *
 * The count
 * --------------------------------------------------------------------- */

test("the count has to open the prompt", () => {
  const late = `Wide shot of a woman. ${GOOD_SHOT}`;
  const problems = validateShotPrompt(late, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: []
  });
  assert.ok(rulesOf(problems).includes("count"), "a prompt that does not open with the count is rejected");
});

test("the count has to agree with the cast", () => {
  const problems = validateShotPrompt(GOOD_SHOT.replace("Exactly one woman", "Exactly two women"), {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: []
  });
  assert.ok(rulesOf(problems).includes("count-matches-cast"));
});

/* --------------------------------------------------------------------- *
 * The look
 * --------------------------------------------------------------------- */

test("the character's look has to be used verbatim", () => {
  const problems = validateShotPrompt(GOOD_SHOT.replace("a matching wrapper", "a matching yellow wrapper"), {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: []
  });
  assert.ok(rulesOf(problems).includes("character-look"));
});

test("a near-miss look is repaired instead of thrown away", () => {
  const broken = "Exactly one woman in frame. A woman in her thirties with deep brown skin wearing a yellow headtie. The camera is locked off.";
  const fixed = repairLook(broken, LOOK);
  assert.ok(fixed, "the look sentence is found");
  assert.ok(fixed.includes(LOOK), "the exact wording is put back");
});

/* --------------------------------------------------------------------- *
 * Contradictory body positions
 * --------------------------------------------------------------------- */

test("arms at the sides and hands behind the back is a contradiction", () => {
  const contradictory = GOOD_SHOT.replace(
    "Her right hand comes forward from behind her back,",
    "Her arms hang at her sides with her hands clasped loosely behind her back, her right hand comes forward from behind her back,"
  );
  const problems = validateShotPrompt(contradictory, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: []
  });
  assert.ok(rulesOf(problems).includes("body-conflict"), "the contradiction is caught");
});

test("a consistent pose is not a contradiction", () => {
  const problems = validateShotPrompt(GOOD_SHOT, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: []
  });
  assert.ok(!rulesOf(problems).includes("body-conflict"));
});

/* --------------------------------------------------------------------- *
 * Effects and their causes
 * --------------------------------------------------------------------- */

test("an effect with no cause in its sentence is rejected", () => {
  const floating = GOOD_SHOT.replace(
    "The reflection breaks apart because the water is moving under it.",
    "The reflection breaks apart. The light slides across the water."
  );
  const problems = validateShotPrompt(floating, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: []
  });
  assert.ok(rulesOf(problems).includes("effect-cause"));
});

test("an effect with a cause in its sentence is accepted", () => {
  const problems = validateShotPrompt(GOOD_SHOT, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: []
  });
  assert.ok(!rulesOf(problems).includes("effect-cause"));
});

/* --------------------------------------------------------------------- *
 * The camera and the frame
 * --------------------------------------------------------------------- */

test("a shot with no camera is rejected", () => {
  const problems = validateShotPrompt(GOOD_SHOT.replace("Slow pan left.", ""), {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: []
  });
  assert.ok(rulesOf(problems).includes("camera"));
});

test("a shot has to say what enters the frame", () => {
  const problems = validateShotPrompt(GOOD_SHOT.replace("Nothing else enters the frame.", ""), {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: []
  });
  assert.ok(rulesOf(problems).includes("frame-entry"));
});

/* --------------------------------------------------------------------- *
 * The habit is not a lock
 * --------------------------------------------------------------------- */

test("the bible's habit cannot be repeated when the story says otherwise", () => {
  const habitShot = `Exactly one woman in frame. ${LOOK} ${MOTION} Slow pan left. Nothing enters the frame.`;
  const problems = validateShotPrompt(habitShot, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    habitMotion: MOTION,
    narrationText: "counting fishing boats, finding six fewer than the week before."
  });
  assert.ok(rulesOf(problems).includes("habit-lock"), "the habit is refused when the narration describes another action");
});

test("the bible's habit is allowed when the narration describes that same action", () => {
  const habitShot = `Exactly one woman in frame. ${LOOK} ${MOTION} Slow pan left. Nothing enters the frame.`;
  const problems = validateShotPrompt(habitShot, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    habitMotion: MOTION,
    narrationText: "Adaeze walked along the Marina waterfront."
  });
  assert.ok(!rulesOf(problems).includes("habit-lock"));
});

/* --------------------------------------------------------------------- *
 * The first frame
 * --------------------------------------------------------------------- */

test("a still with a different time of day is rejected", () => {
  const nightStill = GOOD_STILL.replace("overcast sky", "a midnight sky with moonlight");
  const problems = validateShotPrompt(nightStill, {
    kind: "still",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    compareTo: GOOD_SHOT.replace("Slow pan left.", "Slow pan left under an overcast morning sky.")
  });
  assert.ok(rulesOf(problems).includes("still-lighting"));
});

test("a still with an action in progress is rejected", () => {
  const movingStill = GOOD_STILL.replace("her head level", "her head lifting as she turns toward the boats");
  const problems = validateShotPrompt(movingStill, {
    kind: "still",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    compareTo: GOOD_SHOT
  });
  assert.ok(rulesOf(problems).includes("still-freeze"));
});

test("a still that drops an object the shot has is rejected", () => {
  const lostBoats = GOOD_STILL.replace("Three wooden fishing boats are moored in the water to her right ", "");
  const problems = validateShotPrompt(lostBoats, {
    kind: "still",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    compareTo: GOOD_SHOT
  });
  assert.ok(rulesOf(problems).includes("still-objects"));
});

test("a still that keeps the movement wording out is accepted", () => {
  const problems = validateShotPrompt(GOOD_STILL, {
    kind: "still",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    forbiddenPhrases: [MOTION],
    compareTo: GOOD_SHOT.replace("Slow pan left.", "Slow pan left under an overcast sky.")
  });
  assert.deepEqual(problems, [], "a good first frame has no violations");
});

test("a still that carries the movement wording is rejected", () => {
  const problems = validateShotPrompt(`${GOOD_STILL} ${MOTION}`, {
    kind: "still",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    forbiddenPhrases: [MOTION],
    compareTo: GOOD_SHOT
  });
  assert.ok(rulesOf(problems).includes("forbidden-phrase"));
});

/* --------------------------------------------------------------------- *
 * The first frame is the instant BEFORE the first movement
 * --------------------------------------------------------------------- */

const COUNTING_SHOT = [
  "Exactly one woman in frame.",
  LOOK,
  "Her right hand comes forward from behind her back, her right index finger extends and points at the first moored fishing boat, then moves to point at the second boat, her lips move silently as she counts, her left hand remains clasped behind her back, her legs carry her forward in measured steps along the waterfront.",
  "Gentle waves roll in and break against the seawall because the wind pushes them onshore.",
  "Three wooden fishing boats rock on their mooring lines as the waves pass beneath them.",
  "Slow tracking shot moving right alongside her walking.",
  "Nothing else enters the frame."
].join(" ");

test("a still that already shows the pose the clip reaches later is rejected", () => {
  const still = [
    "Exactly one woman in frame.",
    LOOK,
    "She stands on the waterfront, her right hand raised in front of her with index finger extended pointing at a fishing boat, her left hand clasped behind her back, her head turned slightly to the left.",
    "Three wooden fishing boats are moored along the waterfront under an overcast sky.",
    "Tracking angle from her left side."
  ].join(" ");
  const problems = validateShotPrompt(still, {
    kind: "still",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    compareTo: COUNTING_SHOT
  });
  assert.ok(
    rulesOf(problems).includes("still-start-state"),
    "the first frame has to show the hand BEHIND her back, not already pointing"
  );
});

test("a still that shows the pose the clip starts from is accepted", () => {
  const still = [
    "Exactly one woman in frame.",
    LOOK,
    "She stands on the waterfront, her right hand behind her back, her left hand clasped behind her back, her head turned slightly to the left.",
    "Three wooden fishing boats are moored along the waterfront under an overcast sky.",
    "Tracking angle from her left side."
  ].join(" ");
  const problems = validateShotPrompt(still, {
    kind: "still",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    compareTo: COUNTING_SHOT
  });
  assert.ok(!rulesOf(problems).includes("still-start-state"), "the opening pose is accepted");
});

test("a still that shows the pose the clip starts from is accepted when the clip moves on from it", () => {
  const shot = [
    "Exactly one woman in frame.",
    LOOK,
    "Her right hand lowers from pointing position back down to her side, her chin dips slightly downward from level, her eyes lower from the boats to the water's edge.",
    "Gentle waves roll in and break against the seawall because the wind pushes them onshore.",
    "Three wooden fishing boats rock on their mooring lines as the waves pass beneath them.",
    "Locked-off static shot.",
    "Nothing else enters the frame."
  ].join(" ");
  const still = [
    "Exactly one woman in frame.",
    LOOK,
    "She stands on the waterfront, her right hand raised with index finger pointing at distant boats, her left hand clasped behind her back, her chin level, her eyes focused on the moored fishing boats.",
    "Three wooden fishing boats are moored along the waterfront under an overcast sky.",
    "The camera is at her side."
  ].join(" ");
  const problems = validateShotPrompt(still, {
    kind: "still",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    compareTo: shot
  });
  assert.ok(!rulesOf(problems).includes("still-start-state"), "the opening pose is accepted");
});

/* --------------------------------------------------------------------- *
 * Shot chaining
 * --------------------------------------------------------------------- */

/** The shot before the continuation: she is walking with her hands behind
 *  her back when the clip ends, in the low afternoon sun. */
const PREVIOUS_SHOT = [
  "Exactly one woman in frame.",
  LOOK,
  "Her right hand comes forward from behind her back, her right index finger extends and points at a fishing boat moored near the quay, her left hand remains clasped behind her back.",
  "Gentle waves roll in and break against the concrete quay because the swell pushes them ashore.",
  "Three fishing boats rock slowly on their moorings as the waves lift and lower them.",
  "The low afternoon sun angling from the west casts long shadows across the waterfront.",
  "Tracking shot moving left alongside her as she walks.",
  "Nothing enters the frame."
].join(" ");

test("a continuation that opens in a different pose is rejected", () => {
  const continuation = [
    "Exactly one woman in frame.",
    LOOK,
    "Her right hand is raised in front of her with the index finger pointing at a boat, her left hand at her side.",
    "Gentle waves roll in and break against the concrete quay because the swell pushes them ashore.",
    "Three fishing boats rock slowly on their moorings as the waves lift and lower them.",
    "Slow pan right.",
    "Nothing enters the frame."
  ].join(" ");
  const problems = validateShotPrompt(continuation, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    continuesPrevious: true,
    previousShotPrompt: PREVIOUS_SHOT
  });
  assert.ok(rulesOf(problems).includes("continuation-start"), "a continuation that opens in the wrong pose is rejected");
});

test("a continuation that opens where the previous clip ends is accepted", () => {
  const continuation = [
    "Exactly one woman in frame.",
    LOOK,
    "She is still walking along the quay with both hands clasped behind her back, the yellow wrapper swinging against her shins.",
    "Gentle waves roll in and break against the concrete quay because the swell pushes them ashore.",
    "Three fishing boats rock slowly on their moorings as the waves lift and lower them.",
    "Slow pan right.",
    "Nothing enters the frame."
  ].join(" ");
  const problems = validateShotPrompt(continuation, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    continuesPrevious: true,
    previousShotPrompt: PREVIOUS_SHOT
  });
  assert.ok(!rulesOf(problems).includes("continuation-start"), "the pose the previous clip ends in is accepted");
});

test("a continuation cannot jump to another time of day", () => {
  const continuation = [
    "Exactly one woman in frame.",
    LOOK,
    "She is still walking along the quay with both hands clasped behind her back.",
    "Gentle waves roll in and break against the concrete quay because the swell pushes them ashore.",
    "Three fishing boats rock slowly on their moorings as the waves lift and lower them.",
    "Slow pan right.",
    "Nothing enters the frame."
  ].join(" ");
  const midnight = continuation.replace(
    "along the quay",
    "along the quay at midnight under moonlight"
  );
  const problems = validateShotPrompt(midnight, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    continuesPrevious: true,
    previousShotPrompt: PREVIOUS_SHOT
  });
  assert.ok(rulesOf(problems).includes("continuation-light"), "a continuation that changes the hour is rejected");
});

test("a new setup is not held to the previous shot's pose", () => {
  const newSetup = [
    "Exactly one woman in frame.",
    LOOK,
    "Her right hand is raised in front of her with the index finger pointing at a boat, her left hand at her side.",
    "Gentle waves roll in and break against the concrete quay because the swell pushes them ashore.",
    "Three fishing boats rock slowly on their moorings as the waves lift and lower them.",
    "Slow pan right.",
    "Nothing enters the frame."
  ].join(" ");
  const problems = validateShotPrompt(newSetup, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    continuesPrevious: false,
    previousShotPrompt: PREVIOUS_SHOT
  });
  assert.ok(!rulesOf(problems).includes("continuation-start"), "a new setup may open in any pose");
});

/* --------------------------------------------------------------------- *
 * A walking character is described from the legs up
 * --------------------------------------------------------------------- */

test("a shot whose camera follows a walking character has to describe the legs", () => {
  const shot = [
    "Exactly one woman in frame.",
    LOOK,
    "Her right hand comes forward from behind her back and points at a fishing boat, her head turns to follow the line of boats.",
    "Gentle waves roll in and break against the concrete quay because the swell pushes them ashore.",
    "Three fishing boats rock slowly on their moorings as the waves lift and lower them.",
    "Tracking shot moving left alongside her as she walks.",
    "Nothing enters the frame."
  ].join(" ");
  const problems = validateShotPrompt(shot, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    narrationText: "Adaeze walked along the Marina waterfront, counting"
  });
  assert.ok(rulesOf(problems).includes("walking-legs"), "a tracking shot without leg mechanics is rejected");
});

test("the narration saying the character walks also demands the leg mechanics", () => {
  const shot = [
    "Exactly one woman in frame.",
    LOOK,
    "Her right hand comes forward from behind her back and points at a fishing boat.",
    "Gentle waves roll in and break against the concrete quay because the swell pushes them ashore.",
    "Three fishing boats rock slowly on their moorings as the waves lift and lower them.",
    "Locked-off static shot.",
    "Nothing enters the frame."
  ].join(" ");
  const problems = validateShotPrompt(shot, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    narrationText: "Adaeze walked along the Marina waterfront, counting"
  });
  assert.ok(rulesOf(problems).includes("walking-legs"), "walking in the narration is enough to demand the leg mechanics");
});

test("a walking character described from the legs up is accepted", () => {
  const shot = [
    "Exactly one woman in frame.",
    LOOK,
    "She walks along the quay: her left foot plants flat on the concrete, her right knee swings forward and the foot plants a stride behind it, her hips counter-rotate with each step, her right hand comes forward from behind her back and points at a fishing boat.",
    "Gentle waves roll in and break against the concrete quay because the swell pushes them ashore.",
    "Three fishing boats rock slowly on their moorings as the waves lift and lower them.",
    "Tracking shot moving left alongside her as she walks.",
    "Nothing enters the frame."
  ].join(" ");
  const problems = validateShotPrompt(shot, {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: [],
    narrationText: "Adaeze walked along the Marina waterfront, counting"
  });
  assert.ok(!rulesOf(problems).includes("walking-legs"), "leg mechanics are accepted");
});

/* --------------------------------------------------------------------- *
 * Names never appear in a prompt
 * --------------------------------------------------------------------- */
test("a character name is never allowed in a prompt", () => {
  const names = collectProperNames(["Adaeze walked along the Marina waterfront."]);
  assert.ok(names.includes("Adaeze"));
  const problems = validateShotPrompt(GOOD_SHOT.replace("Exactly one woman in frame.", "Exactly one woman in frame. Adaeze stands here."), {
    kind: "shot",
    requiredLooks: [LOOK],
    charactersInFrame: ["the woman"],
    forbiddenNames: names
  });
  assert.ok(rulesOf(problems).includes("no-names"));
});

/* --------------------------------------------------------------------- *
 * The beats
 * --------------------------------------------------------------------- */

test("short beats are merged so every shot can carry an action", () => {
  const text = "One two three four five. Six seven eight nine ten. Eleven twelve thirteen fourteen fifteen.";
  const merged = mergeShortSpans(text, ["One two three four five.", "Six seven eight nine ten.", "Eleven twelve thirteen fourteen fifteen."], 12000);
  assert.ok(merged.length < 3, "the short beats are merged");
});

test("beats are balanced into the number of shots asked for", () => {
  const sentences = ["One two three.", "Four five six seven eight.", "Nine ten."];
  const balanced = balanceBeats(sentences, 2);
  assert.equal(balanced.length, 2);
});

test("a page is cut into equal beats that never break a word", () => {
  const text = "By morning the lagoon had forgotten the train. The water returned what the city gave it and asked for nothing back.";
  const chunks = splitByLength(text, 2);
  assert.equal(chunks.length, 2);
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), text.replace(/\s+/g, " "), "the words are all still there, in order");
  for (const chunk of chunks) assert.ok(chunk.trim().length > 0);
});
