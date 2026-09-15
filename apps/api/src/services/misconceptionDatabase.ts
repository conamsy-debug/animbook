/**
 * Misconception Database.
 *
 * Maps scene/content keys to the 3 most common student misconceptions for that
 * concept. The checkpoint generator surfaces these as candidate distractors,
 * and the EDU teacher dashboard surfaces the misconception-target frequency
 * per chapter so teachers can plan targeted remediation.
 */

export interface Misconception {
  concept: string;
  description: string;
  remediation: string;
}

const MISCONCEPTIONS: Record<string, Misconception[]> = {
  mitosis: [
    {
      concept: "Cell division direction",
      description: "Students often think mitosis only produces identical daughters, ignoring ploidy in meiosis.",
      remediation: "Pair the mitosis AnimPage with a meiosis comparison page and a short answer that names the ploidy delta."
    },
    {
      concept: "Chromosome vs chromatid",
      description: "Students conflate chromosome and chromatid during anaphase.",
      remediation: "Highlight the centromere in the AnimPage and add a diagram-labelling checkpoint."
    },
    {
      concept: "Time spent in each phase",
      description: "Students assume interphase is short; it is actually the longest phase.",
      remediation: "Overlay a phase-duration bar chart in the AnimPage and ask students to rank them."
    }
  ],
  equation: [
    {
      concept: "Order of operations",
      description: "Students drop parentheses when distributing.",
      remediation: "Use a step-by-step proof AnimPage that highlights each operation in colour."
    },
    {
      concept: "Variable isolation",
      description: "Students divide instead of multiplying when the variable is in the denominator.",
      remediation: "Add a short-answer prompt asking students to narrate the isolation steps."
    },
    {
      concept: "Sign errors",
      description: "Students miss sign flips when crossing the equals sign.",
      remediation: "Embed a checkpoint with a wrong-answer option that demonstrates the sign error."
    }
  ],
  vocabulary: [
    {
      concept: "Denotation vs connotation",
      description: "Students pick the dictionary definition, missing the contextual nuance.",
      remediation: "Pair the term with two sentence contexts and ask which preserves the connotation."
    },
    {
      concept: "False cognates",
      description: "Students map surface forms onto known words.",
      remediation: "Use a translation AnimPage that calls out the false cognate directly."
    },
    {
      concept: "Register mismatch",
      description: "Students use formal terms in informal contexts.",
      remediation: "Present the same term across three registers and ask students to choose."
    }
  ],
  diagram: [
    {
      concept: "Cross-section orientation",
      description: "Students read 2D diagrams as 3D without considering the cut plane.",
      remediation: "Add a rotating 3D overlay and ask students to label the cut plane."
    },
    {
      concept: "Label placement",
      description: "Students place labels near arrows instead of the named structure.",
      remediation: "Use a diagram-labelling checkpoint with explicit hit boxes."
    },
    {
      concept: "Scale",
      description: "Students ignore the scale bar.",
      remediation: "Embed a scale reference object and ask for ratio estimates."
    }
  ],
  translate: [
    {
      concept: "Word-order drift",
      description: "Students map English word order onto the target language.",
      remediation: "Reveal the target sentence word-by-word in the AnimPage audio."
    },
    {
      concept: "False friends",
      description: "Students substitute words that look similar but mean something else.",
      remediation: "Highlight the false friend in the AnimPage and ask students to retype the correct word."
    },
    {
      concept: "Tonal drift",
      description: "Students ignore tone marks or diacritics.",
      remediation: "Render the target language text with high-contrast tones and play a slow narration."
    }
  ],
  narrative: [
    {
      concept: "Theme vs plot",
      description: "Students describe events instead of identifying the theme.",
      remediation: "Use a short-answer checkpoint asking the student to name the theme in one sentence."
    },
    {
      concept: "Cause vs effect",
      description: "Students confuse cause and effect in chronological summaries.",
      remediation: "Add a sequencing checkpoint that orders the cause-effect chain."
    },
    {
      concept: "Character motivation",
      description: "Students ascribe actions without referencing the character's stated goals.",
      remediation: "Surface character goals via the AnimPage narration and ask a multiple-choice question."
    }
  ]
};

export function buildMisconceptionTargets(sceneKey: string, _keyTerms: string[]): string[] {
  const list = MISCONCEPTIONS[sceneKey] ?? MISCONCEPTIONS.narrative!;
  return list.map((m) => m.concept);
}

export function getMisconceptions(sceneKey: string): Misconception[] {
  return MISCONCEPTIONS[sceneKey] ?? MISCONCEPTIONS.narrative!;
}

export const misconceptionKeys = Object.keys(MISCONCEPTIONS);