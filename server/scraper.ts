import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  strongDelimiter: '**',
});

// Drop purely presentational / noisy elements before converting
td.remove([
  'script', 'style', 'noscript', 'iframe', 'button', 'input',
  'select', 'form', 'nav', 'header', 'footer', 'figure > figcaption:empty',
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

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': GOOGLEBOT_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — could not fetch ${url}`);
  return res.text();
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
  // Stage 1: Mozilla Readability (best quality)
  try {
    const dom = new JSDOM(html, { url: pageUrl });
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

// ── Public API ─────────────────────────────────────────────────────────────

export async function scrapeAndProcess(url: string) {
  const html = await fetchPage(url);

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
    headerImageUrl: headerImageUrl || buildFallbackSvg(),
    highlights: [],
    notes: '',
    savedAt: Date.now(),
  };
}
