import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { JSDOM, VirtualConsole } from "jsdom";
import { z } from "zod";
import { defineTool, fail, ok } from "@/lib/agents/core/types";
import { assertSafeUrl, UnsafeUrlError } from "./url-safety";

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 2 * 1024 * 1024;
// Sized up front so a single read can't flood the conversation; the agent
// keeps every result it has seen, so trimming later would cost cache hits.
const MAX_WORDS = 3000;
// Below this, Readability probably grabbed a cookie banner instead of the article.
const MIN_ARTICLE_WORDS = 50;

const BLOCKS = "h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, td, th, dd, dt, figcaption, div";
const CHROME = "script, style, noscript, template, svg, iframe, form, nav, header, footer, aside, button";

const inputSchema = z.object({
  url: z.string().trim().min(1, "URL is empty"),
});

export const webReadTool = defineTool({
  definition: {
    name: "read_webpage",
    description:
      "Read and extract the main content from a webpage URL. Returns the cleaned article text. Use this after web_search to read promising results in full.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL of the page to read",
        },
      },
      required: ["url"],
    },
  },
  inputSchema,
  async execute({ url }) {
    try {
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      const { response, finalUrl } = await fetchSafely(url, signal);

      if (!response.ok) {
        await response.body?.cancel();
        const hint = [401, 403, 429].includes(response.status)
          ? " The site may block automated readers; try another source."
          : "";
        return fail(`HTTP ${response.status} ${response.statusText} from ${finalUrl.href}.${hint}`.trim());
      }

      const contentType = response.headers.get("content-type") ?? "";
      const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);
      const isText = /text\/plain/i.test(contentType);
      if (!isHtml && !isText) {
        await response.body?.cancel();
        const kind = contentType.split(";")[0].trim() || "unknown";
        return fail(`Unsupported content type "${kind}": only HTML and plain-text pages can be read.`);
      }

      const body = decode(await readCapped(response), contentType);
      const page = isHtml ? extractHtml(body, finalUrl.href) : { title: null, text: cleanText(body), extraction: "plain" };
      if (!page.text) return fail("The page has no readable text (it may need JavaScript to render).");

      const { text, wordCount, truncated } = truncateWords(page.text, MAX_WORDS);
      return ok({
        url: finalUrl.href,
        title: page.title,
        content: text,
        word_count: wordCount,
        truncated,
        extraction: page.extraction,
      });
    } catch (error) {
      return fail(describeReadError(error));
    }
  },
});

// Follows redirects by hand so every hop passes the SSRF guard: otherwise a
// public URL could redirect to a private one.
async function fetchSafely(raw: string, signal: AbortSignal) {
  let url = await assertSafeUrl(raw);
  for (let redirects = 0; ; redirects++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; ResearchAgent/0.1)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "accept-language": "en;q=0.9,*;q=0.5",
      },
    });

    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return { response, finalUrl: url };
    }
    await response.body?.cancel();
    if (redirects >= MAX_REDIRECTS) throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`);
    url = await assertSafeUrl(new URL(location, url).href);
  }
}

class TooLargeError extends Error {}

async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_BYTES) {
    await response.body?.cancel();
    throw new TooLargeError();
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new TooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes); // unknown charset label
  }
}

/** Readability first; if it fails or finds too little, strip page chrome with Cheerio and take what's left. */
function extractHtml(html: string, url: string) {
  let title: string | null = null;
  try {
    // A silent VirtualConsole keeps jsdom's CSS parse noise out of the logs; scripts never run.
    const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
    try {
      title = dom.window.document.title.trim() || null;
      const article = new Readability(dom.window.document).parse();
      const text = article?.content ? blocksToText(article.content) : "";
      if (countWords(text) >= MIN_ARTICLE_WORDS) {
        return { title: article?.title?.trim() || title, text, extraction: "readability" };
      }
    } finally {
      dom.window.close();
    }
  } catch {
    // Malformed markup: fall through to the forgiving parser
  }

  const $ = cheerio.load(html);
  title ??= $("title").first().text().trim() || null;
  $(CHROME).remove();
  const root = ["article", "main", "[role=main]", "body"].map((sel) => $(sel).first()).find((el) => el.length);
  return { title, text: root ? blocksToText($.html(root)) : "", extraction: "fallback" };
}

/** One paragraph per leaf block, so the text keeps its structure instead of running together. */
function blocksToText(html: string): string {
  const $ = cheerio.load(html);
  $(CHROME).remove();
  const lines: string[] = [];
  $(BLOCKS).each((_, el) => {
    const $el = $(el);
    if ($el.find(BLOCKS).length > 0) return; // a container: its children are visited on their own
    if (el.tagName === "pre") {
      const code = $el.text().trim(); // code keeps its line breaks
      if (code) lines.push(code);
      return;
    }
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (!text) return;
    if (/^h[1-6]$/.test(el.tagName)) lines.push(`## ${text}`);
    else if (el.tagName === "li") lines.push(`- ${text}`);
    else lines.push(text);
  });
  return lines.length > 0 ? lines.join("\n\n") : cleanText($.root().text());
}

function cleanText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

function truncateWords(text: string, max: number) {
  const words = /\S+/g;
  let wordCount = 0;
  let cut = text.length;
  for (let m = words.exec(text); m; m = words.exec(text)) {
    if (++wordCount === max) cut = m.index + m[0].length;
  }
  const truncated = wordCount > max;
  return {
    text: truncated ? `${text.slice(0, cut)}\n\n[Truncated: showing ${max} of ${wordCount} words]` : text,
    wordCount,
    truncated,
  };
}

function describeReadError(error: unknown): string {
  if (error instanceof UnsafeUrlError) return `URL not allowed: ${error.message}`;
  if (error instanceof TooLargeError) return "Page is larger than 2 MB; not read. Try a more specific page.";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `Timed out after ${TIMEOUT_MS / 1000} seconds. The site may be slow; try another source.`;
  }
  // DNS failures (from the guard's lookup) and fetch's "fetch failed" both carry a code
  const code = (error as { code?: string; cause?: { code?: string } } | null)?.code ??
    (error as { cause?: { code?: string } } | null)?.cause?.code;
  if (code || (error instanceof TypeError && error.message === "fetch failed")) {
    return `Could not reach URL${code ? ` (${code})` : ""}.`;
  }
  return `Could not read the page: ${error instanceof Error ? error.message : String(error)}`;
}
