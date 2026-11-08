import type { ReportSection } from "@/types/research";

// Markdown helpers shared by the writer (which stores the parsed structure) and the
// report page (which builds its table of contents from a draft as it streams in).
// Client-safe: no server imports.

/** "**Bold** [link](https://x)" → "Bold link" */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links and images keep their text
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text: string): string {
  const slug = plainText(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // drop accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/**
 * Heading ids, deduplicated the way GitHub does it (intro, intro-1, …). The parser
 * below and the renderer each make one and feed it the same headings in the same
 * order, so table-of-contents links match the rendered headings.
 */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = `report-${slugify(text)}`; // prefixed, so ids can't clash with the rest of the page
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

interface Heading {
  level: number;
  text: string;
  line: number;
}

/** ATX headings ("## Title") in order, skipping fenced code blocks. */
function headings(markdown: string): Heading[] {
  const result: Heading[] = [];
  let fence: string | null = null;
  markdown.split("\n").forEach((line, i) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const m = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) result.push({ level: m[1].length, text: m[2], line: i });
  });
  return result;
}

/** The table of contents: "##" and "###" headings. */
export function parseReportSections(markdown: string): ReportSection[] {
  const slug = createSlugger();
  return headings(markdown)
    .filter((h) => h.level === 2 || h.level === 3)
    .map((h) => ({ id: slug(h.text), title: plainText(h.text), level: h.level as 2 | 3 }));
}

/** The "# Title" line, or a fallback. */
export function extractTitle(markdown: string): string {
  const h1 = headings(markdown).find((h) => h.level === 1);
  return h1 ? plainText(h1.text) : "Research report";
}

/** The executive summary's text; failing that, the first paragraph. */
export function extractSummary(markdown: string): string {
  const lines = markdown.split("\n");
  const all = headings(markdown);
  const i = all.findIndex((h) => /summary/i.test(h.text));
  if (i >= 0) {
    const next = all.slice(i + 1).find((h) => h.level <= all[i].level);
    const body = lines.slice(all[i].line + 1, next?.line ?? lines.length).join("\n").trim();
    if (body) return body;
  }
  const firstParagraph = markdown
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#"));
  return firstParagraph ?? "";
}

export function countWords(markdown: string): number {
  return plainText(markdown).split(/\s+/).filter(Boolean).length;
}
