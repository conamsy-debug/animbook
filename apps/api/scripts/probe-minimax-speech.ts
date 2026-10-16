/**
 * One-shot probe: synthesise a single short sentence with every MiniMax
 * narration voice that's wired into AnimBook's role mapping. Saves each clip
 * under narration/samples/minimax/<role>-<voiceId>.mp3 in R2 and prints a
 * role -> voiceId -> media URL report on stdout. No book pages are
 * narrated and no existing narration is regenerated.
 *
 * Run once via `railway run --service melodious-success npx tsx
 * apps/api/scripts/probe-minimax-speech.ts` (or locally with the right env).
 */
import { config } from "dotenv";
import { createHash } from "node:crypto";
import path from "node:path";
import { generateNarration as minimaxGenerateNarration } from "../src/services/minimax-speech.js";
import { narratorVoices as narratorVoicesList } from "../src/config/voices.js";
import { KIDS_VOICES } from "../src/services/kids.js";

config({ path: path.resolve(process.cwd(), "apps/api/.env.local") });

const SAMPLE_TEXT = "Every great story begins with a single page, waiting to be heard.";
const STORAGE_PREFIX = "narration/samples/minimax";

interface ProbeEntry {
  bucket: "curated" | "kids";
  role: string;
  voiceId: string;
}

const candidates: ProbeEntry[] = [];

for (const voice of narratorVoicesList()) {
  if (voice.minimaxVoiceId) {
    candidates.push({ bucket: "curated", role: voice.id, voiceId: voice.minimaxVoiceId });
  }
}
for (const character of KIDS_VOICES) {
  if (character.minimaxVoiceId) {
    candidates.push({ bucket: "kids", role: character.character, voiceId: character.minimaxVoiceId });
  }
}

console.log(`[probe] generating ${candidates.length} clips via MiniMax TTS (model ${process.env.MINIMAX_TTS_MODEL ?? "speech-2.8-hd"})`);
console.log(`[probe] storage prefix: ${STORAGE_PREFIX}/`);

const hash = createHash("sha1").update(SAMPLE_TEXT).digest("hex").slice(0, 12);

interface Report {
  bucket: ProbeEntry["bucket"];
  role: string;
  voiceId: string;
  audioUrl: string;
  characters: number;
  durationSeconds: number;
}

const report: Report[] = [];

for (const candidate of candidates) {
  const fileSafeRole = candidate.role.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const storageKey = `${STORAGE_PREFIX}/${fileSafeRole}-${candidate.voiceId}-${hash}.mp3`;
  try {
    const result = await minimaxGenerateNarration({
      text: SAMPLE_TEXT,
      voiceId: candidate.voiceId,
      storageKey,
      strict: true
    });
    if (!result.audioUrl) {
      console.warn(`[probe] FAIL ${candidate.bucket}/${candidate.role}: ${result.error}`);
      continue;
    }
    report.push({
      bucket: candidate.bucket,
      role: candidate.role,
      voiceId: candidate.voiceId,
      audioUrl: result.audioUrl,
      characters: result.characters,
      durationSeconds: result.durationSeconds
    });
    console.log(
      `[probe] OK   ${candidate.bucket}/${candidate.role.padEnd(18)} ${candidate.voiceId.padEnd(34)} ${result.durationSeconds}s ${result.audioUrl}`
    );
  } catch (err) {
    console.warn(`[probe] THROW ${candidate.bucket}/${candidate.role}: ${(err as Error).message}`);
  }
}

console.log("\n=== REPORT (role -> voice -> URL) ===");
for (const r of report) {
  console.log(`${r.bucket}\t${r.role}\t${r.voiceId}\t${r.characters} chars\t${r.durationSeconds}s\t${r.audioUrl}`);
}
console.log(`\nTotal: ${report.length}/${candidates.length} successful samples`);