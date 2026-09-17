/**
 * Prompt hygiene shared by the Studio pipeline (the seed script has its own
 * copy). Everything sent to Runway should pass through safePrompt():
 *
 * - no mention of text/titles/logos/covers (Runway draws text, or refuses
 *   with INTERNAL.BAD_OUTPUT, even for "no text")
 * - no character names (well-known names trip text moderation)
 * - softer wording for things Runway's safety filter misreads
 */
export interface NamedCharacter {
  name: string;
  label?: string;
  description?: string;
}

export function scrubText(prompt: string): string {
  return prompt
    .replace(
      /\b(?:with\s+)?(?:no|without)\s+(?:any\s+)?(?:visible\s+)?(?:text|words?|writing|letters?|lettering|titles?|captions?|logos?|signs?|signage|watermarks?|typography)(?:\s*(?:,|or|and|\/)\s*(?:no\s+)?(?:visible\s+)?(?:text|words?|writing|letters?|lettering|titles?|captions?|logos?|signs?|signage|watermarks?|typography))*\b[.,;]?/gi,
      ""
    )
    .replace(/\b(?:book[- ]cover|cover artwork|cover art|poster)(?:[- ]style)?(?:\s+(?:illustration|artwork|art|image|painting))?\b/gi, "illustration")
    .replace(/\billustration(\s+illustration)+\b/gi, "illustration")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim();
}

export function labelFor(c: NamedCharacter): string {
  if (c.label?.trim()) return c.label.trim();
  const first = (c.description ?? "")
    .split(/[,.;]/)[0]
    .replace(/^\s*(?:a|an|the)\s+/i, "")
    .split(/\s+(?:with|who|wearing|in)\s+/i)[0]
    .trim();
  if (!first) return "the character";
  const words = first.split(/\s+/).slice(0, 6).join(" ");
  return `the ${words.charAt(0).toLowerCase()}${words.slice(1)}`;
}

const HONORIFIC = new Set(["the", "a", "an", "mr", "mrs", "ms", "miss", "dr", "old", "young", "little", "small", "first", "second", "third", "big"]);
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function stripNames(text: string, characters: NamedCharacter[]): string {
  if (!characters.length) return text;
  const names = characters
    .flatMap((c) => {
      const label = labelFor(c);
      const bare = c.name.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
      const inParens = [...c.name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim()).filter((t) => t.length >= 3);
      const tokens = bare.split(" ").map((t) => t.replace(/[^A-Za-z'-]/g, "")).filter(Boolean);
      const variants = new Set<string>([c.name, bare, ...inParens]);
      const firstReal = tokens.find((t) => !HONORIFIC.has(t.toLowerCase()));
      if (firstReal && firstReal.length >= 3) variants.add(firstReal);
      if (tokens.length > 1 && HONORIFIC.has(tokens[0].toLowerCase())) {
        variants.add(`${tokens[0]}. ${tokens.slice(1).join(" ")}`);
        const last = tokens[tokens.length - 1];
        if (last.length >= 3 && !HONORIFIC.has(last.toLowerCase())) variants.add(last);
      }
      for (const v of [...variants]) if (v.includes("-")) variants.add(v.replace(/-/g, ""));
      return [...variants].filter((v) => v.length >= 3).map((v) => ({ v, label }));
    })
    .sort((a, b) => b.v.length - a.v.length);
  let out = text;
  for (const { v, label } of names) {
    const re = new RegExp(`(^|[^@\\w])${escapeRe(v)}(?![\\w-])`, "g");
    out = out.replace(re, (_m, pre: string) => `${pre}${label}`);
  }
  return out.replace(/\b(the [^:.,]{3,60})[:,]\s+\1\b/gi, "$1");
}

export function soften(text: string): string {
  return text
    .replace(
      /\b(?:(small|little|tiny)\s+)?young\s+(?:fe)?male\s+(rabbit|bunny|hare|cat|kitten|dog|puppy|fox|cub|owl|bird|mouse|bear|lion|deer|fawn|animal)\b/gi,
      (_m, size: string | undefined, animal: string) => `${size ? `${size} ` : ""}young ${animal}`
    )
    .replace(/\b(?:fe)?male\s+(rabbit|bunny|hare|cat|kitten|dog|puppy|fox|cub|owl|bird|mouse|bear|lion|deer|fawn|animal)\b/gi, "$1")
    .replace(/\bwhite belly\b/gi, "white front")
    .replace(/\bbelly\b/gi, "front")
    .replace(/,?\s*gentle and safe,?\s*no peril\b/gi, "")
    .replace(/\s{2,}/g, " ");
}

export function safePrompt(text: string, characters: NamedCharacter[] = []): string {
  return soften(stripNames(scrubText(text), characters));
}

/** Studio visual styles → wording the image model follows. */
export const STUDIO_STYLES: Record<string, { label: string; prompt: string }> = {
  "desert-realism": { label: "Desert Realism", prompt: "sun-drenched realistic painting, warm ochre and gold palette, crisp light, wide open landscapes — a painting, not a photograph" },
  "painterly-mysticism": { label: "Painterly Mysticism", prompt: "painterly illustration with visible brushstrokes, soft glowing light, gentle mist, rich warm palette, dreamlike — a painting, not a photograph" },
  "graphic-novel": { label: "Graphic Novel", prompt: "bold graphic-novel illustration, strong ink outlines, flat vivid colour, dramatic shadows" },
  "anime-inspired": { label: "Anime-Inspired", prompt: "anime-inspired illustration, clean line art, expressive faces, soft cel shading, luminous skies" },
  watercolour: { label: "Watercolour", prompt: "soft watercolour illustration, loose washes, gentle paper texture, light airy palette" },
  "cinematic-dark": { label: "Cinematic Dark", prompt: "moody cinematic digital painting, deep shadows, low-key lighting, rich teal and amber tones" },
  "scientific-microscopy": { label: "Scientific Microscopy", prompt: "clean scientific illustration in the style of microscopy imagery, precise shapes, luminous colours on dark ground" },
  "sacred-realism": { label: "Sacred Realism", prompt: "reverent classical painting, soft golden light, dignified figures, rich muted palette" }
};

export function stylePrompt(styleId: string | null | undefined, fallback?: string | null): string {
  if (styleId && STUDIO_STYLES[styleId]) return STUDIO_STYLES[styleId].prompt;
  if (fallback && fallback.trim()) return fallback.trim();
  return STUDIO_STYLES["painterly-mysticism"].prompt;
}
