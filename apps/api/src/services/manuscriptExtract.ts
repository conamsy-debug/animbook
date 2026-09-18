/**
 * Turn an uploaded manuscript file into plain text with paragraphs separated
 * by blank lines (what the Studio page splitter expects).
 *
 * Supported: .txt / .md (as-is), .docx (mammoth), .pdf (unpdf).
 */
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export class ExtractError extends Error {}

const MAX_CHARS = 2_000_000;

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Heuristics for a "garbage" token — typically a fragment of misaligned PDF
 * columns or a misread heading. Real English words almost never trigger
 * more than one of these flags; OCR column-mixing triggers several at once.
 *
 * Why this matters: the upstream prompt text is what we feed Runway. A
 * heading like "Organ-Specific Nutrition" that gets misread as
 *   "Organ-Speci cNutorioi,nFNsaPoingNlr,o,c,dPFNanhNoMeNbeoaw,..."
 * trips Runway's text-pre-processing safety classifier and the page gets
 * marked FLAGGED. Stripping these runs before splitting pages means the
 * animation prompt stays clean and the reader sees the actual sentence.
 */
/**
 * Heuristics for a "garbage" token — typically a fragment of misaligned PDF
 * columns or a misread heading. Real English words almost never trigger
 * more than one of these flags; OCR column-mixing triggers several at once.
 *
 * Why this matters: the upstream prompt text is what we feed Runway. A
 * heading like "Organ-Specific Nutrition" that gets misread as
 *   "Organ-Speci cNutorioi,nFNsaPoingNlr,o,c,dPFNanhNoMeNbeoaw,..."
 * trips Runway's text-pre-processing safety classifier and the page gets
 * marked FLAGGED. Stripping these runs before splitting pages means the
 * animation prompt stays clean and the reader sees the actual sentence.
 *
 * Exported for unit tests; production code reaches it via cleanOcrGarbage().
 */
export function looksLikeOcrGarbage(token: string): boolean {
  // Real words have at most one contiguous uppercase run at the start
  // (NASA, iPhone, mTOR). OCR column-mixing produces several: dPFN..., mTOrX...
  const upperRuns = token.match(/[A-Z]+/g);
  if (upperRuns && upperRuns.length >= 3) return true;

  // Lowercase-then-uppercase pattern repeated inside one token, e.g.
  // "dPFNanhNoMeNbeoaw" — multiple `[a-z][A-Z]` transitions.
  const ltuc = token.match(/[a-z][A-Z]/g);
  if (ltuc && ltuc.length >= 2) return true;

  // Punctuation (! @ # etc) embedded inside a word — never natural English.
  if (/[A-Za-z][!@#$%^&*+=][A-Za-z]/.test(token)) return true;

  // A run of single letters separated by commas (or similar): "a, b, c, ..."
  // alone in a token means the splitter ate a table of contents.
  if (/^([A-Za-z][,.]){3,}[A-Za-z]$/.test(token)) return true;

  return false;
}

/**
 * Strip contiguous runs of OCR-garbage tokens (3+ in a row) and tidy the
 * surrounding whitespace. Legitimate mixed-case words (mTOR, iPhone,
 * PhD, NASA) are preserved because their uppercase-run count is 1.
 */
/**
 * Strip contiguous runs of OCR-garbage tokens (3+ in a row) and tidy the
 * surrounding whitespace. Legitimate mixed-case words (mTOR, iPhone,
 * PhD, NASA) are preserved because their uppercase-run count is 1.
 *
 * Exported for unit tests.
 */
export function cleanOcrGarbage(text: string): string {
  const lines = text.split("\n");
  const cleaned: string[] = [];
  for (const line of lines) {
    const tokens = line.split(/(\s+)/); // keep whitespace
    const out: string[] = [];
    let garbageRun = 0;
    for (const tok of tokens) {
      if (/^\s+$/.test(tok)) {
        if (garbageRun === 0) out.push(tok);
        continue;
      }
      if (looksLikeOcrGarbage(tok)) {
        garbageRun += 1;
        continue;
      }
      // Real token — flush any garbage run we accumulated, then keep it.
      if (garbageRun >= 3) out.push(" ");
      else if (garbageRun > 0) out.push("… ");
      garbageRun = 0;
      out.push(tok);
    }
    // Trailing garbage run at end of line: drop silently.
    cleaned.push(out.join("").replace(/[ \t\u00a0]{2,}/g, " ").trim());
  }
  return cleaned.filter((l) => l.length > 0).join("\n");
}

/** PDF text arrives one visual line at a time; rejoin lines into paragraphs. */
function joinPdfLines(page: string): string {
  const lines = page.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (para) out.push(para);
      para = "";
      continue;
    }
    // Chapter / part headings stay on their own line.
    if (/^(chapter|part|book|prologue|epilogue|introduction|preface)\b/i.test(line) && line.length < 60) {
      if (para) out.push(para);
      out.push(line);
      para = "";
      continue;
    }
    if (!para) {
      para = line;
    } else if (para.endsWith("-") && /^[a-z]/.test(line)) {
      para = para.slice(0, -1) + line; // hyphenated line break
    } else {
      para = `${para} ${line}`;
    }
    // A short line ending a sentence usually closes a paragraph.
    if (/[.!?:"”’)]$/.test(line) && line.length < 60) {
      out.push(para);
      para = "";
    }
  }
  if (para) out.push(para);
  return out.join("\n\n");
}

export async function extractManuscript(filename: string, data: Buffer): Promise<{ text: string; kind: string }> {
  const name = filename.toLowerCase();
  const isZip = data.length > 4 && data[0] === 0x50 && data[1] === 0x4b;
  const isPdf = data.length > 4 && data.subarray(0, 5).toString("latin1") === "%PDF-";

  let text: string;
  let kind: string;
  if (name.endsWith(".pdf") || isPdf) {
    if (!isPdf) throw new ExtractError("That file doesn't look like a PDF.");
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text: pages } = await extractText(pdf, { mergePages: false });
    text = (pages as string[]).map(joinPdfLines).filter(Boolean).join("\n\n");
    kind = "pdf";
    if (text.trim().length < 20) {
      throw new ExtractError("No text found in this PDF — it may be scanned images. Please upload a PDF with selectable text, or a Word file.");
    }
  } else if (name.endsWith(".docx") || (isZip && !name.endsWith(".zip"))) {
    if (!isZip) throw new ExtractError("That file doesn't look like a Word (.docx) document.");
    const result = await mammoth.extractRawText({ buffer: data });
    text = result.value;
    kind = "docx";
  } else if (name.endsWith(".doc")) {
    throw new ExtractError("Old Word (.doc) files aren't supported. In Word, choose File → Save As → .docx, then upload that.");
  } else if (/\.(txt|md|markdown)$/.test(name) || !name.includes(".")) {
    text = data.toString("utf8");
    kind = "text";
  } else {
    throw new ExtractError("Please upload a Word (.docx), PDF, or plain text (.txt / .md) file.");
  }

  text = normalise(text);
  // Strip OCR-garbage runs from PDF-extracted text — column-mixing produces
  // token-soup that Runway's text pre-processor rejects (the page ends up
  // FLAGGED). See cleanOcrGarbage for the detection rules.
  if (kind === "pdf") text = cleanOcrGarbage(text);
  if (!text) throw new ExtractError("The file is empty.");
  if (text.length > MAX_CHARS) throw new ExtractError("This manuscript is too long for one AnimBook (over 2 million characters).");
  return { text, kind };
}
