/**
 * One-off diagnostic: which reference-image setups does Runway accept?
 *
 *   npx tsx apps/api/scripts/probe-runway-refs.ts [world:lagos-nights]
 *
 * Reads approved portraits from seed-clips-cast.json and tries the same
 * two-person scene in several shapes / reference counts, once each.
 * Runway refunds INTERNAL.BAD_OUTPUT failures; each success costs ~5–8
 * credits (max ~26 if everything succeeds). Successful images are stored
 * under probe/ in R2 so you can look at them.
 */
import "./slow-link-db.js";
import { readFileSync } from "node:fs";
import { generateStill, type ReferenceImage } from "../src/services/runway.js";
import { mirrorToR2 } from "../src/services/cloudflare.js";

interface CastMember { name: string; description: string; tag?: string; portraitUrl?: string; approved?: boolean }
const key = process.argv[2] ?? "world:lagos-nights";
const cast = JSON.parse(readFileSync("seed-clips-cast.json", "utf8"))[key] as { characters: CastMember[] } | undefined;
if (!cast) throw new Error(`No cast sheet for ${key} in seed-clips-cast.json`);
const people = cast.characters.filter((c) => c.approved && c.portraitUrl && c.tag).slice(0, 2);
if (people.length < 2) throw new Error("Need two approved portraits for this probe");
const [a, b] = people;
const ref = (c: CastMember): ReferenceImage => ({ uri: c.portraitUrl!, tag: c.tag! });
const style = "painterly illustration with visible brushstrokes, soft glowing light, gentle mist, rich warm palette, dreamlike";

const two = `${style}. @${a.tag} and @${b.tag} stand side by side at the Lagos lagoon waterfront at dusk, fishing boats on the misty water behind them, both gazing toward the glowing horizon. Medium-wide shot, warm golden light.`;
const one = `${style}. @${a.tag} stands alone at the Lagos lagoon waterfront at dusk, fishing boats on the misty water behind her, gazing toward the glowing horizon. Medium-wide shot, warm golden light.`;
const twoPlain = `${style}. Two women stand side by side at the Lagos lagoon waterfront at dusk: ${a.description} ${b.description} Fishing boats on the misty water behind them. Medium-wide shot, warm golden light.`;

const cases: Array<{ id: string; ratio: string; prompt: string; refs: ReferenceImage[] }> = [
  { id: "A-wide-2refs", ratio: "1280:720", prompt: two, refs: [ref(a), ref(b)] },
  { id: "B-tall-1ref", ratio: "720:960", prompt: one, refs: [ref(a)] },
  { id: "C-tall-2refs-1080", ratio: "1080:1440", prompt: two, refs: [ref(a), ref(b)] },
  { id: "D-square-2refs", ratio: "720:720", prompt: two, refs: [ref(a), ref(b)] },
  { id: "E-tall-2refs-short-prompt", ratio: "720:960", prompt: two, refs: [ref(a), ref(b)] },
  { id: "F-tall-no-refs", ratio: "720:960", prompt: twoPlain, refs: [] }
];

const only = process.argv[3]?.split(",");
for (const c of cases) {
  if (only && !only.includes(c.id[0])) continue;
  const started = Date.now();
  try {
    const url = await generateStill(c.prompt, c.ratio, c.refs, { attempts: 1 });
    const stored = await mirrorToR2(url, `probe/${key.replace(/[^a-z0-9-]+/gi, "-")}/${c.id}-${Date.now().toString(36)}.png`, "image/png");
    console.log(`OK    ${c.id.padEnd(28)} ${Math.round((Date.now() - started) / 1000)}s  ${stored.url}`);
  } catch (err) {
    console.log(`FAIL  ${c.id.padEnd(28)} ${Math.round((Date.now() - started) / 1000)}s  ${(err as Error).message}`);
  }
}
