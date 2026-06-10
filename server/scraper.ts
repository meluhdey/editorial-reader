import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

// ── Lazy PDF.js loader (serverless-safe) ─────────────────────────────────────
// pdfjs-dist v5 relies on process.getBuiltinModule(), which only exists in
// Node 22.3+/20.16+. On older lambda runtimes it's missing, so we polyfill it
// IMMEDIATELY before importing pdfjs. Loading lazily (a) guarantees the polyfill
// runs first regardless of bundler ordering, (b) keeps pdfjs out of the article-
// scrape code path entirely, and (c) keeps any load failure inside the caller's
// try/catch so it surfaces as a real 500 message instead of a hard crash.
type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const proc = process as unknown as { getBuiltinModule?: (n: string) => unknown };
      if (typeof proc.getBuiltinModule !== 'function') {
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        proc.getBuiltinModule = (name: string) => require(name);
      }

      // pdfjs uses bare `new DOMMatrix()` / `globalThis.DOMMatrix`. In Node it
      // normally pulls these from @napi-rs/canvas via its own internal require,
      // but esbuild bundling on Vercel breaks that dynamic require, leaving the
      // globals unset -> "DOMMatrix is not defined". So we import the canvas
      // backend ourselves and assign the globals before pdfjs initialises.
      const g = globalThis as unknown as Record<string, unknown>;
      if (typeof g.DOMMatrix !== 'function') {
        const canvas = await import('@napi-rs/canvas');
        if (canvas.DOMMatrix) g.DOMMatrix = canvas.DOMMatrix;
        if (canvas.Path2D) g.Path2D = canvas.Path2D;
        if (canvas.ImageData) g.ImageData = canvas.ImageData;
      }

      return import('pdfjs-dist/legacy/build/pdf.mjs');
    })();
  }
  return pdfjsPromise;
}

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  strongDelimiter: '**',
});

// Drop purely presentational / noisy elements before converting
td.remove([
  'script', 'style', 'noscript', 'iframe', 'button', 'input',
  'select', 'form', 'nav', 'header', 'footer',
]);

// Preserve img tags as raw HTML so width/height attributes survive
td.addRule('images', {
  filter: 'img',
  replacement: (_content, node) => {
    const el = node as Element;
    const src = el.getAttribute('src') ?? '';
    if (!src || src.startsWith('data:')) return '';
    const alt = (el.getAttribute('alt') ?? '').replace(/"/g, '&quot;');
    const width = el.getAttribute('width');
    const height = el.getAttribute('height');
    const w = width ? ` width="${width}"` : '';
    const h = height ? ` height="${height}"` : '';
    return `\n\n<img src="${src}" alt="${alt}"${w}${h} />\n\n`;
  },
});

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetchResource(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': CHROME_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — could not fetch ${url}`);
  return res;
}

// ── Meta extraction (cheerio, lightweight) ─────────────────────────────────

function extractMeta(html: string, pageUrl: string) {
  const $ = cheerio.load(html);

  let title = (
    $('meta[property="og:title"]').attr('content') ??
    $('meta[name="twitter:title"]').attr('content') ??
    $('h1').first().text() ??
    $('title').text()
  ).trim();

  let explicitAuthor = '';
  const byMatch = title.match(/^(.*?),\s+by\s+(.+)$/i);
  if (byMatch) {
    title = byMatch[1].trim();
    explicitAuthor = byMatch[2].trim();
  }

  // Extract author from JSON-LD (Schema.org Person/author field)
  let jsonLdAuthor = '';
  $('script[type="application/ld+json"]').each((_, el) => {
    if (jsonLdAuthor) return;
    try {
      const data = JSON.parse($(el).html() ?? '') as unknown;
      const findAuthor = (obj: unknown): string => {
        if (!obj || typeof obj !== 'object') return '';
        const r = obj as Record<string, unknown>;
        if (r.author) {
          const a = r.author;
          if (typeof a === 'string') return a;
          if (typeof a === 'object' && a !== null) {
            const ao = a as Record<string, unknown>;
            if (typeof ao.name === 'string') return ao.name;
          }
          if (Array.isArray(a)) {
            const names = (a as unknown[])
              .map((item) => {
                if (typeof item === 'string') return item;
                if (typeof item === 'object' && item !== null) {
                  const io = item as Record<string, unknown>;
                  return typeof io.name === 'string' ? io.name : '';
                }
                return '';
              })
              .filter(Boolean);
            if (names.length) return names.slice(0, 4).join(', ');
          }
        }
        for (const val of Object.values(r)) {
          const found = findAuthor(val);
          if (found) return found;
        }
        return '';
      };
      jsonLdAuthor = findAuthor(data);
    } catch {}
  });

  const authorNodes = $('[rel="author"]');
  const relAuthorText = authorNodes.length
    ? Array.from(new Set(authorNodes.map((_, el) => $(el).text().trim()).get())).filter(Boolean).slice(0, 4).join(', ')
    : null;

  // Broad byline selectors covering The Atlantic, NYT, and other major publishers
  const bylineSelectors = [
    '[data-testid*="byline"] [data-testid*="author"]',
    '[data-testid*="byline"] a',
    '[class*="Byline"] a',
    '[class*="ArticleByline"] a',
    '[class*="byline"] a',
    '[class*="author-name"]',
    '[class*="AuthorName"]',
    '.contributor a',
  ].join(', ');
  const domByline = (() => {
    const nodes = $(bylineSelectors);
    if (!nodes.length) return '';
    return Array.from(new Set(nodes.map((_, el) => $(el).text().trim()).get())).filter(Boolean).slice(0, 4).join(', ');
  })();

  const author = explicitAuthor || (
    jsonLdAuthor ||
    $('meta[name="sailthru.author"]').attr('content') ||
    $('meta[name="author"]').attr('content') ||
    $('meta[property="article:author"]').attr('content') ||
    relAuthorText ||
    domByline ||
    $('.author, .byline').first().text() ||
    ''
  ).trim();

  // Clean up title: remove trailing " | SiteName" or " - AuthorName"
  title = title.split(/\s*\|\s*/)[0].trim();
  
  const dashParts = title.split(/\s+[-—–]\s+/);
  if (dashParts.length > 1) {
    const lastPart = dashParts[dashParts.length - 1].trim();
    if (author && lastPart.toLowerCase().includes(author.toLowerCase())) {
      dashParts.pop();
      title = dashParts.join(' - ').trim();
    } else if (lastPart.split(' ').length <= 4) {
      dashParts.pop();
      title = dashParts.join(' - ').trim();
    }
  }

  // Header image: prefer OG/Twitter card, then first large in-page img
  const rawImg =
    $('meta[property="og:image"]').attr('content') ??
    $('meta[name="twitter:image"]').attr('content') ??
    $('meta[property="og:image:url"]').attr('content') ??
    '';

  let headerImageUrl = rawImg ? makeAbsolute(rawImg, pageUrl) : '';

  if (!headerImageUrl) {
    // Walk <img> tags and pick the first one that looks like a real photo
    $('img').each((_, el) => {
      if (headerImageUrl) return;
      const src = $(el).attr('src') ?? '';
      const w = parseInt($(el).attr('width') ?? '0', 10);
      const h = parseInt($(el).attr('height') ?? '0', 10);
      const skip = /logo|avatar|icon|sprite|pixel|tracking|blank/i.test(src);
      if (!skip && src && (w === 0 || w > 200) && (h === 0 || h > 100)) {
        headerImageUrl = makeAbsolute(src, pageUrl);
      }
    });
  }

  return { title, author, headerImageUrl };
}

function extractTags(html: string): string[] {
  const $ = cheerio.load(html);
  const tags: string[] = [];

  // JSON-LD: keywords + articleSection
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() ?? '') as unknown;
      const scan = (obj: unknown): void => {
        if (!obj || typeof obj !== 'object') return;
        const r = obj as Record<string, unknown>;
        if (typeof r.keywords === 'string')
          tags.push(...r.keywords.split(',').map((k) => k.trim().toLowerCase()));
        if (Array.isArray(r.keywords))
          tags.push(...(r.keywords as string[]).map((k) => String(k).trim().toLowerCase()));
        if (typeof r.articleSection === 'string')
          tags.push(r.articleSection.trim().toLowerCase());
        Object.values(r).forEach(scan);
      };
      scan(data);
    } catch {}
  });

  // <meta name="keywords"> and news_keywords
  for (const name of ['keywords', 'news_keywords']) {
    const content = $(`meta[name="${name}"]`).attr('content');
    if (content)
      tags.push(...content.split(/[,;]/).map((t) => t.trim().toLowerCase()));
  }

  // Open Graph article:tag + article:section
  $('meta[property="article:tag"]').each((_, el) => {
    const v = $(el).attr('content');
    if (v) tags.push(v.trim().toLowerCase());
  });
  const section = $('meta[property="article:section"]').attr('content');
  if (section) tags.push(section.trim().toLowerCase());

  // DOM-level tag/label links (many CMS use these)
  $('a[rel="tag"], .tags a, .article-tags a, .post-tags a, [class*="tag-list"] a').each((_, el) => {
    const t = $(el).text().trim().toLowerCase();
    if (t) tags.push(t);
  });

  return [...new Set(tags)]
    .filter((t) => t.length > 1 && t.length < 50)
    .slice(0, 8);
}

// ── Content extraction ─────────────────────────────────────────────────────

function extractContent(html: string, pageUrl: string): string {
  // Pre-clean raw HTML of scripts, styles, and stylesheets to prevent DOM layout/style pollution
  const $clean = cheerio.load(html);
  $clean('script, style, noscript, iframe, link[rel="stylesheet"]').remove();
  const cleanedHtml = $clean.html();

  // Stage 1: Mozilla Readability (best quality)
  try {
    const dom = new JSDOM(cleanedHtml, { url: pageUrl });
    const reader = new Readability(dom.window.document, {
      charThreshold: 100,
    });
    const parsed = reader.parse();
    if (parsed?.content && parsed.content.length > 300) {
      return htmlToMarkdown(parsed.content, pageUrl);
    }
  } catch {}

  // Stage 2: Heuristic cheerio fallback
  const $ = cheerio.load(html);
  $('nav, header, footer, aside, script, style, noscript, iframe').remove();
  $('[class*="ad-"],[id*="ad-"],[class*="advertisement"]').remove();
  $('[class*="paywall"],[class*="modal"],[class*="overlay"],[class*="subscribe"]').remove();
  $('[class*="sidebar"],[class*="related"],[class*="newsletter"],[class*="comment"]').remove();

  const selectors = [
    'article', 'main', '[role="main"]',
    '.RichTextComponentWrapper', '.article-body', '.article__body',
    '.story-body', '.post-content', '.entry-content', '.content-body',
    '#article-body', '.ArticleBody', '[data-testid="article-body"]',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 300)
      return htmlToMarkdown(el.html() ?? '', pageUrl);
  }

  // Last resort: div with most paragraph text
  let best: { el: ReturnType<typeof $>; len: number } = { el: $('body'), len: 0 };
  $('div, section').each((_, el) => {
    const len = $(el).find('p').text().trim().length;
    if (len > best.len) best = { el: $(el), len };
  });
  return htmlToMarkdown(best.el.html() ?? '', pageUrl);
}

function htmlToMarkdown(html: string, baseUrl: string): string {
  // Make image/link src absolute before conversion
  const $ = cheerio.load(html);
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    $(el).attr('src', makeAbsolute(src, baseUrl));
  });
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    $(el).attr('href', makeAbsolute(href, baseUrl));
  });

  return td.turndown($.html()).trim();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAbsolute(url: string, base: string): string {
  if (!url || url.startsWith('data:')) return url;
  try { return new URL(url, base).href; } catch { return url; }
}

function buildFallbackSvg(): string {
  const palette = ['#CC0000', '#1A1A1A', '#8B7355', '#C4B89A'];
  const shapes = Array.from({ length: 6 }, (_, i) => {
    const c = palette[i % palette.length];
    const x = (i * 137) % 760;
    const y = (i * 89) % 360;
    const w = 50 + (i * 67) % 120;
    const h = 40 + (i * 53) % 90;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}" opacity="${0.18 + (i % 3) * 0.09}" transform="rotate(${i * 12} ${x + w / 2} ${y + h / 2})"/>`;
  }).join('');
  const circles = [0, 1, 2].map((i) =>
    `<circle cx="${150 + i * 280}" cy="${120 + (i * 80) % 160}" r="${40 + i * 20}" fill="${palette[(i + 1) % 4]}" opacity="${0.12 + i * 0.06}"/>`,
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><rect width="800" height="400" fill="#F5F1E6"/>${shapes}${circles}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function extractAndCleanFootnotes(pagesRaw: string[]): { cleanedPages: string[]; pageFootnotes: string[][] } {
  const pageFootnotesList: string[][] = [];
  const cleanedPages: string[] = [];

  // Pre-pass: collect all pages' lines for processing
  const allPagesLines: string[][] = pagesRaw.map(p =>
    p.split(/\r?\n/).map(l => l.trim())
  );


  for (let pageIdx = 0; pageIdx < allPagesLines.length; pageIdx++) {
    const lines = allPagesLines[pageIdx];

    // Strip bare page-number lines first
    const stripped = lines.filter(line => {
      if (!line) return true;
      return !(
        /^\d+$/.test(line) ||
        /^[ivxldcmIVXLDCM]+$/.test(line) ||
        /^page\s+\d+/i.test(line) ||
        /^\d+\s+of\s+\d+/i.test(line) ||
        /^[-—–]\s*\d+\s*[-—–]$/.test(line) ||
        /^\[\s*\d+\s*\]$/.test(line) ||
        /^(page|pg|p|part|ch|chapter|sec|section)\.?\s*[-–—]?\s*\d+(\s*of\s*\d+)?$/i.test(line) ||
        /^\d+\s*[-–—]\s*\d+$/.test(line) ||
        /^[\(\[\{-—–\s\*✦~•]*\d+[\)\]\}-—–\s\*✦~•]*$/.test(line)
      );
    });

    const bodyLines: string[] = [];
    const pageFootnotes: string[] = [];
    let currentFootnote = '';
    let currentMarker = '';
    let insideFootnote = false;

    for (let i = 0; i < stripped.length; i++) {
      const line = stripped[i];

      // Empty line — end any open footnote
      if (!line) {
        if (insideFootnote && currentFootnote) {
          pageFootnotes.push(`[${currentMarker}] ${currentFootnote}`.trim());
          currentFootnote = '';
          currentMarker = '';
          insideFootnote = false;
        }
        bodyLines.push('');
        continue;
      }

      // Pattern A (classic): "1. Text…" or "1 Text…" or "† Text…" on one line
      const sameLine = line.match(/^(\d+|[*†‡§])\s*(?:[.\)\]])\s+(.+)$/) ||
                       line.match(/^(\d+|[*†‡§])\s+(.+)$/);

      // Pattern B (split): bare marker on its own line, e.g. just "1" or "†"
      // followed by text on the next non-empty line
      const bareMarker = line.match(/^(\d+|[*†‡§])$/);
      const nextNonEmpty = (): string => {
        for (let j = i + 1; j < stripped.length; j++) {
          if (stripped[j]) return stripped[j];
        }
        return '';
      };

      const isLikelySectionHeading = (l: string) =>
        l.length < 65 && !/[.\]\)]\s*$/.test(l) && /^[A-Z0-9]/.test(l);

      if (sameLine && !isLikelySectionHeading(line)) {
        const m = sameLine;
        // Commit previous footnote
        if (currentFootnote) {
          pageFootnotes.push(`[${currentMarker}] ${currentFootnote}`.trim());
        }
        currentMarker = m[1];
        currentFootnote = m[2];
        insideFootnote = true;

      } else if (bareMarker && nextNonEmpty() && !isLikelySectionHeading(nextNonEmpty())) {
        // Bare marker: commit any open footnote, start a new one from the NEXT line
        if (currentFootnote) {
          pageFootnotes.push(`[${currentMarker}] ${currentFootnote}`.trim());
        }
        currentMarker = bareMarker[1];
        currentFootnote = '';   // text will be added by the next iteration
        insideFootnote = true;

      } else if (insideFootnote) {
        const prevLine = i > 0 ? stripped[i - 1] : '';
        const endedSentence = prevLine ? /[.!?]['"]?\s*$/.test(prevLine) : false;
        const startsWithMetadata = /^(abstract|keywords|submitted|received|accepted|published|how to cite|copyright|©|doi|isbn|issn)\b/i.test(line);
        const startsWithSection = /^\d+\.\s+[A-Z]/.test(line);

        if (endedSentence && (startsWithMetadata || startsWithSection)) {
          if (currentFootnote) {
            pageFootnotes.push(`[${currentMarker}] ${currentFootnote}`.trim());
          }
          insideFootnote = false;
          currentFootnote = '';
          currentMarker = '';
          bodyLines.push(line);
        } else {
          // Accumulate footnote text (handles the split-line pattern: marker was bare, now we get text)
          if (currentFootnote) {
            currentFootnote += ' ' + line;
          } else {
            currentFootnote = line;
          }
        }
      } else {
        bodyLines.push(line);
      }
    }

    // Commit any trailing footnote
    if (currentFootnote) {
      pageFootnotes.push(`[${currentMarker}] ${currentFootnote}`.trim());
    }

    pageFootnotesList.push(pageFootnotes);
    cleanedPages.push(bodyLines.join('\n'));
  }

  return { cleanedPages, pageFootnotes: pageFootnotesList };
}

function cleanAndRemoveHeadersFooters(pagesRaw: string[]): string[] {
  const pagesLines = pagesRaw.map(page => {
    return page.split(/\r?\n/).map(line => line.trim());
  });

  const headerCandidates = new Map<string, number>();
  const footerCandidates = new Map<string, number>();

  // Helper to normalize lines for frequency comparison (replaces all digit sequences with a placeholder)
  const normalizeForFreq = (line: string): string => {
    return line
      .toLowerCase()
      .replace(/\d+/g, '#')
      .replace(/\b[ivxldcm]+\b/g, '#')
      .replace(/\s+/g, ' ')
      .trim();
  };

  for (const lines of pagesLines) {
    const topLines = lines.filter(l => l.length > 0).slice(0, 3);
    for (const line of topLines) {
      if (line.length > 3) {
        const norm = normalizeForFreq(line);
        headerCandidates.set(norm, (headerCandidates.get(norm) || 0) + 1);
      }
    }

    const bottomLines = lines.filter(l => l.length > 0).slice(-3);
    for (const line of bottomLines) {
      if (line.length > 3) {
        const norm = normalizeForFreq(line);
        footerCandidates.set(norm, (footerCandidates.get(norm) || 0) + 1);
      }
    }
  }

  const repeatedHeaders = new Set<string>();
  const repeatedFooters = new Set<string>();

  headerCandidates.forEach((count, norm) => {
    if (count >= 2) repeatedHeaders.add(norm);
  });

  footerCandidates.forEach((count, norm) => {
    if (count >= 2) repeatedFooters.add(norm);
  });

  const cleanedPages: string[] = [];

  for (let pageIdx = 0; pageIdx < pagesLines.length; pageIdx++) {
    const lines = pagesLines[pageIdx];
    const pageCleaned: string[] = [];
    const topLines = lines.filter(l => l.length > 0).slice(0, 3);
    const bottomLines = lines.filter(l => l.length > 0).slice(-3);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        pageCleaned.push('');
        continue;
      }

      // Secondary check for page numbers (primary check is in extractAndCleanFootnotes)
      const isPageNum = 
        /^\d+$/.test(trimmed) || 
        /^[ivxldcmIVXLDCM]+$/.test(trimmed) ||
        /^page\s+\d+/i.test(trimmed) ||
        /^\d+\s+of\s+\d+/i.test(trimmed) ||
        /^[-—–]\s*\d+\s*[-—–]$/.test(trimmed) ||
        /^\[\s*\d+\s*\]$/.test(trimmed) ||
        /^(page|pg|p|part|ch|chapter|sec|section)\.?\s*[-–—]?\s*\d+(\s*of\s*\d+)?$/i.test(trimmed) ||
        /^\d+\s*[-–—]\s*\d+$/.test(trimmed) ||
        /^[\(\[\{-—–\s\*✦~•]*\d+[\)\]\}-—–\s\*✦~•]*$/.test(trimmed);

      if (isPageNum) {
        continue;
      }

      // Only strip repeated running headers/footers on pages after the first page (protects article title page metadata)
      if (pageIdx > 0) {
        const norm = normalizeForFreq(line);
        const isTopLine = topLines.includes(line);
        const isBottomLine = bottomLines.includes(line);

        if ((isTopLine && repeatedHeaders.has(norm)) || 
            (isBottomLine && repeatedFooters.has(norm))) {
          continue;
        }
      }

      pageCleaned.push(line);
    }
    cleanedPages.push(pageCleaned.join('\n'));
  }

  return cleanedPages;
}

function formatSuperscriptSubscript(text: string, fnKeys: string[] = []): string {
  if (!text) return text;

  // 1. Convert Unicode superscripts and subscripts to HTML tags
  const superMap: Record<string, string> = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')', 'ⁿ': 'n', 'ⁱ': 'i', 'ᵃ': 'a', 'ᵇ': 'b', 'ᶜ': 'c',
    'ᵈ': 'd', 'ᵉ': 'e', 'ᶠ': 'f', 'ᵍ': 'g', 'ʰ': 'h', 'ʲ': 'j', 'ᵏ': 'k', 'ˡ': 'l', 'ᵐ': 'm', 'ᵒ': 'o',
    'ᵖ': 'p', 'ʳ': 'r', 'ˢ': 's', 'ᵗ': 't', 'ᵘ': 'u', 'ᵛ': 'v', 'ʷ': 'w', 'ˣ': 'x', 'ʸ': 'y', 'ᶻ': 'z'
  };

  const subMap: Record<string, string> = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')', 'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h',
    'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't'
  };

  const superRegex = new RegExp(`([${Object.keys(superMap).join('')}]+)`, 'g');
  const subRegex = new RegExp(`([${Object.keys(subMap).join('')}]+)`, 'g');

  let processed = text.replace(superRegex, (match) => {
    const converted = match.split('').map(char => superMap[char] || char).join('');
    return `<sup>${converted}</sup>`;
  });

  processed = processed.replace(subRegex, (match) => {
    const converted = match.split('').map(char => subMap[char] || char).join('');
    return `<sub>${converted}</sub>`;
  });

  // 2. Identify word-attached footnote citation numbers: e.g. "subjectivity2" -> "subjectivity<sup>2</sup>"
  processed = processed.replace(/\b([a-zA-Z]{2,})(\d+)\b/g, '$1<sup>$2</sup>');

  // 3. Identify punctuation-attached footnote citation numbers: e.g. "well.1" -> "well.<sup>1</sup>", "2024).2" -> "2024).<sup>2</sup>"
  // Using lookbehind so it doesn't match standard decimal points like "3.14" or "0.05"
  processed = processed.replace(/(?<!\d)([.,;:!?'"\]\)]+)(\d+)\b/g, '$1<sup>$2</sup>');

  // 4. Convert isolated footnote symbols (like †, ‡, §) attached to words or sentences to superscript
  processed = processed.replace(/(\w+)\s*(†|‡|§)/g, '$1<sup>$2</sup>');

  // 5. Render typical subscript notation in chemical formulas (like H2O, CO2)
  processed = processed.replace(/\b([A-Z][a-z]?)(\d+)([A-Z][a-z]?)\b/g, '$1<sub>$2</sub>$3');
  processed = processed.replace(/\b([A-Z][a-z]?O?)(\d+)\b/g, '$1<sub>$2</sub>');

  // 6. Dynamic Footnote Citation Replacements matching active footnote keys for the page
  // e.g. "denial 13" -> "denial<sup>13</sup>", "failing [13]" -> "failing<sup>13</sup>"
  for (const key of fnKeys) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Pattern A: Word/Punctuation + Space(s) + key
    // We ignore if the preceding word is a citation exclusion word (like "page", "chapter", "volume", "figure", "table")
    const regexSpace = new RegExp(`(\\b\\w+[.,;:!?'"\\]\\)]*)\\s+(${escapedKey})\\b`, 'gi');
    processed = processed.replace(regexSpace, (match, p1, p2) => {
      const wordOnly = p1.replace(/[.,;:!?'"\]\)]/g, '').toLowerCase();
      const excludeWords = ['page', 'pg', 'chapter', 'ch', 'section', 'sec', 'volume', 'vol', 'figure', 'fig', 'table', 'tbl', 'version', 'v', 'level', 'step', 'class', 'grade', 'group'];
      if (excludeWords.includes(wordOnly)) {
        return match; // Return unchanged (e.g. "page 13")
      }
      return `${p1}<sup>${p2}</sup>`;
    });

    // Pattern B: Word/Punctuation + Optional Space(s) + [key] or (key)
    // e.g. "denial [13]" -> "denial<sup>13</sup>" or "denial[13]" -> "denial<sup>13</sup>"
    const regexBracket = new RegExp(`(\\b\\w+[.,;:!?'"\\]\\)]*)\\s*\\[(${escapedKey})\\]`, 'g');
    processed = processed.replace(regexBracket, '$1<sup>$2</sup>');
    
    const regexParen = new RegExp(`(\\b\\w+[.,;:!?'"\\]\\)]*)\\s*\\((${escapedKey})\\)`, 'g');
    processed = processed.replace(regexParen, '$1<sup>$2</sup>');
  }

  return processed;
}

function cleanPDFText(text: string): string {
  if (!text) return '';

  const pagesRaw = text.split(/-- \d+ of \d+ --/);
  
  // 1. Remove repeated headers/footers using original page splits
  const withoutHeaders = cleanAndRemoveHeadersFooters(pagesRaw);
  
  // 2. Extract footnotes
  const { cleanedPages, pageFootnotes } = extractAndCleanFootnotes(withoutHeaders);
  
  // 3. Process each page individually to preserve page boundaries
  const processedPages = cleanedPages.map((pageText, idx) => {
    // Extract page-specific active footnote keys (e.g., ["13", "14"])
    const fns = pageFootnotes[idx] || [];
    const fnKeys = fns.map(fn => {
      const m = fn.match(/^\[(.+?)\]/);
      return m ? m[1] : null;
    }).filter(Boolean) as string[];

    const lines = pageText.split(/\r?\n/);
    const cleanedLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        cleanedLines.push('');
        continue;
      }
      const normalized = line.replace(/\s+/g, ' ');
      cleanedLines.push(normalized);
    }

    let processedText = '';
    let currentParagraph = '';

    const commitParagraph = () => {
      if (!currentParagraph) return;
      
      const formatted = formatSuperscriptSubscript(currentParagraph, fnKeys);
      
      // Abstract detection: if a paragraph starts with Abstract or Summary, wrap in class styling block
      if (/^\s*(?:abstract|summary)\b[—:\-\.\s]/i.test(formatted)) {
        processedText += `<div class="pdf-abstract">\n\n${formatted}\n\n</div>\n\n`;
      } else {
        processedText += formatted + '\n\n';
      }
      currentParagraph = '';
    };

    for (const line of cleanedLines) {
      if (line === '') {
        commitParagraph();
      } else {
        // Force heading lines and metadata lines to be separate paragraphs
        const isHeading = /^\d+(\.\d+)*\.?\s+[A-Z]/.test(line);
        const isMetadata = /^(keywords|how to cite|copyright|©)/i.test(line);
        
        if (isHeading || isMetadata) {
          commitParagraph();
          currentParagraph = line;
          commitParagraph();
        } else {
          if (currentParagraph) {
            if (currentParagraph.endsWith('-')) {
              currentParagraph = currentParagraph.slice(0, -1) + line;
            } else {
              currentParagraph += ' ' + line;
            }
          } else {
            currentParagraph = line;
          }
        }
      }
    }

    commitParagraph();

    let pageBody = processedText.replace(/\n{3,}/g, '\n\n').trim();

    // Append this specific page's footnotes, if present
    const fnsList = pageFootnotes[idx];
    if (fnsList && fnsList.length > 0) {
      const formattedFns = fnsList
        .map(fn => formatSuperscriptSubscript(fn.replace(/^\[(.+?)\]/, '**$1.**'), fnKeys))
        .join('\n\n');
      pageBody += '\n\n<!-- FOOTNOTES -->\n\n' + formattedFns;
    }

    return pageBody;
  }).filter(Boolean);

  return processedPages.join('\n\n---\n\n');
}

// ── Public API ─────────────────────────────────────────────────────────────

const CLASSICAL_PAINTINGS = [
  'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1578301978018-3005759f48f7?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1576016770956-debb63d900ee?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1580136579312-94651dfd596d?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1605721911519-3dfeb3be25e7?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1584727638096-042c45049edd?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1579783928621-7a13d66a62d1?q=80&w=800&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1580136608260-4eb11f4b24fe?q=80&w=800&auto=format&fit=crop'
];

function getRandomClassicalPainting(): string {
  const idx = Math.floor(Math.random() * CLASSICAL_PAINTINGS.length);
  return CLASSICAL_PAINTINGS[idx];
}

function extractTitleAndAuthorFromFirstPage(rawText: string, filename: string): { title?: string; author?: string } {
  // Clean filename for matching
  const cleanedFileTitle = filename
    .replace(/\.pdf$/i, '')
    .replace(/_sup_[^_]+__sup_/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const pagesRaw = rawText.split(/-- \d+ of \d+ --/);
  const firstPage = pagesRaw[0] || '';
  const lines = firstPage.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let title: string | undefined = undefined;
  let author: string | undefined = undefined;

  // 1. Try to find a line in the first page that matches the cleaned filename title (case-insensitive, ignoring symbols)
  const normFileTitle = cleanedFileTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const normLine = lines[i].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normLine && normFileTitle.includes(normLine) && normLine.length > 10) {
      // Found the title line!
      title = lines[i].replace(/[†*‡§]+$/, '').trim(); // Remove footnote markers
      
      // Look for the author in the next 1-2 lines
      for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
        const line = lines[j];
        if (isLikelyAuthor(line)) {
          author = line.replace(/^[†*‡§\s]+/, '').trim();
          break;
        }
      }
      break;
    }
  }

  // Helper to validate likely author names
  function isLikelyAuthor(line: string): boolean {
    const clean = line.replace(/^[†*‡§\s]+/, '').trim();
    if (!clean) return false;
    const words = clean.split(/\s+/);
    if (words.length < 2 || words.length > 5) return false;
    
    const isCapitalized = words.every((w, idx) => {
      if (idx > 0 && ['and', 'de', 'van', 'der', 'von', '&'].includes(w.toLowerCase())) return true;
      return /^[A-Z]/.test(w) || (w.includes('.') && /^[A-Z]\./i.test(w));
    });
    if (!isCapitalized) return false;

    if (/@/.test(clean)) return false;
    if (/university|department|school|college|institute|association|society|journal|philosophy|haifa|controversial|ideas/i.test(clean)) return false;
    return true;
  }

  // 2. If title wasn't found by filename matching, try finding the first substantial non-metadata line
  if (!title) {
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      const line = lines[i];
      // Skip category/journal/metadata lines
      if (line.length > 10 && 
          !/^(article|journal|volume|issue|http|doi|page|submitted|accepted|published|abstract|keywords)/i.test(line) &&
          !/controversial\s+ideas/i.test(line)) {
        title = line.replace(/[†*‡§]+$/, '').trim();
        
        // Try to get author in next 1-2 lines
        for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
          if (isLikelyAuthor(lines[j])) {
            author = lines[j].replace(/^[†*‡§\s]+/, '').trim();
            break;
          }
        }
        break;
      }
    }
  }

  return { title, author };
}

export async function processPDFBuffer(buffer: Buffer | ArrayBuffer, filename: string, sourceUrl?: string) {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdfDocument = await loadingTask.promise;
  const metadata = await pdfDocument.getMetadata().catch(() => null);

  let rawText = '';
  for (let i = 1; i <= pdfDocument.numPages; i++) {
    const page = await pdfDocument.getPage(i);
    const textContent = await page.getTextContent();
    
    // Group items by y-coordinate (with a threshold of 2.0 units) to reconstruct lines and preserve layout/breaks
    const linesMap: { y: number; items: any[] }[] = [];
    for (const item of textContent.items as any[]) {
      const text = item.str;
      if (text === undefined) continue;
      
      const x = item.transform[4];
      const y = item.transform[5];
      
      let foundLine = linesMap.find(line => Math.abs(line.y - y) < 2.0);
      if (!foundLine) {
        foundLine = { y, items: [] };
        linesMap.push(foundLine);
      }
      foundLine.items.push({ text, x });
    }

    // Sort lines by y coordinate descending (top-to-bottom)
    linesMap.sort((a, b) => b.y - a.y);

    // Sort items left-to-right on each line and join them
    const pageLines = linesMap.map(line => {
      line.items.sort((a, b) => a.x - b.x);
      return line.items.map(item => item.text).join('').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);

    const pageText = pageLines.join('\n');
    rawText += pageText + `\n-- ${i} of ${pdfDocument.numPages} --\n`;
  }

  if (!rawText || rawText.trim().length < 5) {
    throw new Error('This PDF appears to be empty or contain non-extractable text.');
  }

  const content = cleanPDFText(rawText);

  const cleanTitle = filename
    .replace(/\.pdf$/i, '')
    .replace(/_sup_[^_]+__sup_/gi, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  // Try extracting title and author from the first page text
  const extracted = extractTitleAndAuthorFromFirstPage(rawText, filename);

  const infoObj = metadata?.info as any;
  let title = infoObj?.Title || '';
  if (!title || title.toLowerCase() === 'untitled' || title.toLowerCase() === 'introduction') {
    title = extracted.title || cleanTitle || 'Uploaded PDF';
  }
  const author = infoObj?.Author || extracted.author || undefined;

  return {
    id: crypto.randomUUID(),
    title: title || 'Untitled PDF',
    author: author || undefined,
    content,
    url: sourceUrl || `local-upload://${filename}`,
    tags: ['pdf', 'uploaded'],
    headerImageUrl: getRandomClassicalPainting(),
    highlights: [],
    notes: '',
    savedAt: Date.now(),
  };
}

export async function scrapeAndProcess(url: string) {
  const res = await fetchResource(url);
  const contentType = res.headers.get('content-type') || '';
  const cleanUrl = url.toLowerCase().split('?')[0].split('#')[0];
  const isPdf = contentType.includes('application/pdf') || cleanUrl.endsWith('.pdf');

  if (isPdf) {
    const arrayBuffer = await res.arrayBuffer();
    const filename = url.split('/').pop() || 'scraped.pdf';
    return processPDFBuffer(arrayBuffer, filename, url);
  }

  const html = await res.text();

  const [{ title, author, headerImageUrl }, tags, content] = await Promise.all([
    Promise.resolve(extractMeta(html, url)),
    Promise.resolve(extractTags(html)),
    Promise.resolve(extractContent(html, url)),
  ]);

  if (!content || content.length < 50)
    throw new Error('Could not extract readable content from this page.');

  return {
    id: crypto.randomUUID(),
    title: title || 'Untitled Article',
    author: author || undefined,
    content,
    url,
    tags,
    headerImageUrl: headerImageUrl || getRandomClassicalPainting(),
    highlights: [],
    notes: '',
    savedAt: Date.now(),
  };
}
