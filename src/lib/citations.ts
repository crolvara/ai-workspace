/**
 * Groq browser_search citations → plain text + a "Sources:" list.
 *
 * With the built-in `browser_search` tool, gpt-oss cites inline as
 * `【6†L8-L10】` ("cursor 6, lines 8-10"). The cursor is the browser's INTERNAL
 * page-stack number and it does NOT map to anything in the stream: recorded
 * runs cite cursor 6 after only five executed tools (indices 0-4), and cursor
 * 8 in another run points at a `browser.find` that returned nothing. A guessed
 * mapping would attach claims to the wrong source, which is worse than none.
 *
 * So the markers are dropped, and the answer ends with the pages the model
 * actually opened (from `delta.executed_tools[].output`, whose first lines
 * carry `L1: URL: <url>`), minus the search engine's own results pages. The
 * chat UI renders plain text (whitespace-pre-wrap), hence no markdown.
 *
 * Markers arrive SPLIT across stream chunks (`【`, `†`, `】【` …), so the
 * rewriter buffers from `【` until the closing `】`. Everything here is pure —
 * no I/O — so it can be verified without the network.
 */

/** Cap so a runaway/unclosed `【` cannot swallow the rest of the answer. */
const MAX_MARKER_LENGTH = 64;

/** Results pages of the search tool itself — never a useful source. */
const SEARCH_PAGE_HOSTS = ["exa.ai"];

/** A long research loop can open dozens of pages; keep the list readable. */
const MAX_SOURCES = 8;

/** Body of a real citation marker: `6†L8-L10`, `6†L8`. */
const MARKER_BODY = /^\d+†L\d+(?:-L\d+)?$/;

export interface ExecutedToolDelta {
  index?: number;
  output?: string | null;
}

/** Real http(s) page URL that is not a search-results page, else null. */
function sourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.replace(/^www\./, "");
    const isSearch = SEARCH_PAGE_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`),
    );
    return isSearch ? null : url.toString();
  } catch {
    return null;
  }
}

/** Collect the URLs of pages the model opened, in first-seen order, deduped. */
export function recordToolPages(
  sources: string[],
  tools: ExecutedToolDelta[] | undefined,
): void {
  for (const tool of tools ?? []) {
    // Each tool arrives twice: first without output (started), then with it.
    if (typeof tool.output !== "string") continue;
    // Only a page load starts with the URL header; scrolls ("L8: …"), finds
    // and errors ("No pages to access!") carry no new page.
    const head = tool.output.split("\n", 3).find((l) => /^L\d+: URL: /.test(l));
    if (!head) continue;
    const url = sourceUrl(head.replace(/^L\d+: URL: /, "").trim());
    if (url && !sources.includes(url)) sources.push(url);
  }
}

/**
 * Streaming rewriter. Feed every content delta through `push`, then call
 * `finish` once — it flushes a dangling partial marker and returns the
 * "Sources:" block (just the leftover when no page was opened).
 */
export class CitationRewriter {
  private pending = "";

  constructor(private readonly sources: string[]) {}

  push(text: string): string {
    let out = "";
    let rest = this.pending + text;
    this.pending = "";

    while (rest.length > 0) {
      const open = rest.indexOf("【");
      if (open === -1) {
        out += rest;
        break;
      }
      out += rest.slice(0, open);
      const close = rest.indexOf("】", open);
      if (close === -1) {
        const tail = rest.slice(open);
        if (tail.length > MAX_MARKER_LENGTH) out += tail; // not a marker
        else this.pending = tail; // wait for the rest of the marker
        break;
      }
      const body = rest.slice(open + 1, close);
      // Drop citation markers; any other 【…】 is real text and stays.
      if (!MARKER_BODY.test(body)) out += rest.slice(open, close + 1);
      rest = rest.slice(close + 1);
    }
    return out;
  }

  finish(): string {
    const leftover = this.pending;
    this.pending = "";
    if (this.sources.length === 0) return leftover;
    const shown = this.sources.slice(0, MAX_SOURCES);
    const more = this.sources.length - shown.length;
    const list = shown.map((url) => `- ${url}`).join("\n");
    const tail = more > 0 ? `\n- …and ${more} more` : "";
    return `${leftover}\n\nSources:\n${list}${tail}`;
  }
}
