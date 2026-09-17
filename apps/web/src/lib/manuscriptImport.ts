/**
 * Read a manuscript file in the browser — nothing is uploaded, so large books
 * work on slow connections. Word (.docx) via mammoth, PDF via unpdf (pdf.js),
 * text as-is. Libraries load only when a file is imported.
 */
export class ImportError extends Error {}

type Progress = (message: string) => void;

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** PDF text arrives one visual line at a time; rejoin lines into paragraphs. */
export function joinPdfLines(lines: string[]): string {
  const out: string[] = [];
  let para = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (para) out.push(para);
      para = "";
      continue;
    }
    if (/^(chapter|part|book|prologue|epilogue|introduction|preface)\b/i.test(line) && line.length < 60) {
      if (para) out.push(para);
      out.push(line);
      para = "";
      continue;
    }
    if (!para) para = line;
    else if (para.endsWith("-") && /^[a-z]/.test(line)) para = para.slice(0, -1) + line;
    else para = `${para} ${line}`;
    if (/[.!?:"”’)]$/.test(line) && line.length < 60) {
      out.push(para);
      para = "";
    }
  }
  if (para) out.push(para);
  return out.join("\n\n");
}

const pause = () => new Promise((r) => setTimeout(r, 0));

async function readPdf(file: File, progress: Progress): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    if (i === 1 || i % 5 === 0 || i === pdf.numPages) progress(`Reading page ${i} of ${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let current = "";
    for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
      if (typeof item.str !== "string") continue;
      current += item.str;
      if (item.hasEOL) {
        lines.push(current);
        current = "";
      }
    }
    if (current) lines.push(current);
    pages.push(joinPdfLines(lines));
    if (i % 10 === 0) await pause(); // keep the page responsive on long books
  }
  const text = pages.filter(Boolean).join("\n\n");
  if (text.replace(/\s/g, "").length < 20) {
    throw new ImportError("No text found in this PDF — it may be scanned images. Please use a PDF with selectable text, or a Word file.");
  }
  return text;
}

async function readDocx(file: File): Promise<string> {
  const mod = (await import("mammoth")) as unknown as {
    default?: { extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> };
    extractRawText?(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
  };
  const mammoth = mod.extractRawText ? mod : mod.default!;
  const result = await mammoth.extractRawText!({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

export async function readManuscriptFile(file: File, progress: Progress = () => undefined): Promise<string> {
  const name = file.name.toLowerCase();
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const isPdf = String.fromCharCode(...head) === "%PDF-";
  const isZip = head[0] === 0x50 && head[1] === 0x4b;

  let text: string;
  if (name.endsWith(".pdf") || isPdf) {
    if (!isPdf) throw new ImportError("That file doesn't look like a PDF.");
    progress("Opening PDF…");
    text = await readPdf(file, progress);
  } else if (name.endsWith(".docx")) {
    if (!isZip) throw new ImportError("That file doesn't look like a Word (.docx) document.");
    progress("Reading Word document…");
    text = await readDocx(file);
  } else if (name.endsWith(".doc")) {
    throw new ImportError("Old Word (.doc) files aren't supported. In Word, choose File → Save As → .docx, then import that.");
  } else if (/\.(txt|md|markdown)$/.test(name)) {
    text = await file.text();
  } else {
    throw new ImportError("Please import a Word (.docx), PDF, or plain text (.txt / .md) file.");
  }
  text = normalise(text);
  if (!text) throw new ImportError("The file is empty.");
  if (text.length > 2_000_000) throw new ImportError("This manuscript is too long for one AnimBook (over 2 million characters).");
  return text;
}
