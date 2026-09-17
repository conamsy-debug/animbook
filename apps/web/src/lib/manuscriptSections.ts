/**
 * Split a parsed manuscript into sections so the author can leave out the
 * parts that shouldn't be animated: copyright pages, the table of contents,
 * the index, and so on.
 */
export type SectionKind = "body" | "legal" | "contents" | "index" | "back";

export interface ParsedPage {
  pageNum: number;
  chapter: string | null;
  text: string;
}

export interface Section {
  kind: SectionKind;
  label: string;
  from: number;
  to: number;
  pages: number[];
  sample: string;
  skipByDefault: boolean;
}

const LABEL: Record<SectionKind, string> = {
  body: "The book",
  legal: "Copyright & notices",
  contents: "Table of contents",
  index: "Index",
  back: "About the author & acknowledgements"
};

const digitRatio = (t: string) => (t.match(/\d/g)?.length ?? 0) / Math.max(1, t.length);

function classify(page: ParsedPage, position: number): SectionKind {
  const text = page.text;
  const lower = text.toLowerCase();
  if (/all rights reserved|no part of this (book|publication)|isbn|copyright ©|©\s*\d{4}|trademarks|disclaimer|this book is a work of/.test(lower)) {
    return "legal";
  }
  // Near the end, a page dense with numbers is the index, not the contents.
  if (position > 0.85 && digitRatio(text) > 0.03) return "index";
  if (/^\s*(table of )?contents\b/i.test(text) || (digitRatio(text) > 0.03 && /\b(ch(apter)?\.?\s*\d+|part\s+[ivx\d])/i.test(text) && text.split("\n").length > 3)) {
    return "contents";
  }
  if (/about the author|acknowledg(e)?ments|also by the author|bibliograph|references\b|further reading/i.test(lower)) return "back";
  return "body";
}

export function detectSections(pages: ParsedPage[]): Section[] {
  const sections: Section[] = [];
  pages.forEach((page, i) => {
    const kind = classify(page, i / Math.max(1, pages.length - 1));
    const last = sections[sections.length - 1];
    if (last && last.kind === kind) {
      last.to = page.pageNum;
      last.pages.push(page.pageNum);
    } else {
      sections.push({
        kind,
        label: LABEL[kind],
        from: page.pageNum,
        to: page.pageNum,
        pages: [page.pageNum],
        sample: page.text.slice(0, 120),
        skipByDefault: kind !== "body"
      });
    }
  });
  // Tiny body gaps inside front matter are front matter too.
  return sections.filter((s) => !(s.kind === "body" && s.pages.length <= 1 && sections.length > 3 && s.from < (pages.length ?? 0) * 0.05));
}

/** Split text into pages of roughly `targetLength` characters. */
export function parseManuscript(raw: string, targetLength = 1200): ParsedPage[] {
  if (!raw.trim()) return [];
  const paragraphs = raw.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const pages: ParsedPage[] = [];
  let buffer: string[] = [];
  let chapter: string | null = null;
  let pageNum = 1;
  const flush = () => {
    if (buffer.length === 0) return;
    pages.push({ pageNum: pageNum++, chapter, text: buffer.join("\n\n") });
    buffer = [];
  };
  for (const para of paragraphs) {
    const chapterMatch = para.match(/^(chapter|part|book)\s+([\w\-:.]+)/i);
    if (chapterMatch && para.length < 80) {
      flush();
      chapter = para.trim();
      continue;
    }
    buffer.push(para);
    if (buffer.join(" ").length >= targetLength) flush();
  }
  flush();
  return pages;
}
