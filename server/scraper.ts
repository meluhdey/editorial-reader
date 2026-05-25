import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { PDFParse } from 'pdf-parse';

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
      'User-Agent': GOOGLEBOT_UA,
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

function extractAndCleanFootnotes(pagesRaw: string[]): { cleanedPages: string[]; footnotes: string[] } {
  const globalFootnotes: string[] = [];
  const cleanedPages: string[] = [];

  for (let pageIdx = 0; pageIdx < pagesRaw.length; pageIdx++) {
    const pageText = pagesRaw[pageIdx];
    const lines = pageText.split(/\r?\n/).map(line => line.trim());
    
    // 1. First, strip page numbers from the page lines
    const nonPageNumLines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true;
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
      return !isPageNum;
    });

    const bodyLines: string[] = [];
    const pageFootnotes: string[] = [];
    let currentFootnote = '';
    let currentMarker = '';
    let insideFootnote = false;

    for (let i = 0; i < nonPageNumLines.length; i++) {
      const line = nonPageNumLines[i];
      if (!line) {
        if (insideFootnote) {
          insideFootnote = false;
          if (currentFootnote) {
            pageFootnotes.push(`[${currentMarker}] ${currentFootnote}`.trim());
            currentFootnote = '';
            currentMarker = '';
          }
        }
        bodyLines.push('');
        continue;
      }

      // Check if this line matches a footnote starter
      const match = line.match(/^(\d+|\*|†|‡|§)\s*(?:\.|\)|\])?\s+(.+)$/);
      const isLikelySectionHeading = line.length < 65 && !/[.\]\)]\s*$/.test(line);
      const isStarter = match && !isLikelySectionHeading;

      if (isStarter && match) {
        if (currentFootnote) {
          pageFootnotes.push(`[${currentMarker}] ${currentFootnote}`.trim());
        }
        currentMarker = match[1];
        currentFootnote = match[2];
        insideFootnote = true;
      } else {
        if (insideFootnote) {
          // Check if the previous line ended a sentence
          const previousLine = i > 0 ? nonPageNumLines[i - 1] : '';
          const endedSentence = previousLine ? /[.!?]['"]?\s*$/.test(previousLine) : false;

          // Check if this line starts with metadata or section headers, signaling end of footnote
          const startsWithMetadata = /^(abstract|keywords|submitted|received|accepted|published|how to cite|copyright|©|doi|isbn|issn)\b/i.test(line);
          const startsWithSectionHeader = /^\d+\.\s+[A-Z]/i.test(line);

          if (endedSentence && (startsWithMetadata || startsWithSectionHeader)) {
            insideFootnote = false;
            pageFootnotes.push(`[${currentMarker}] ${currentFootnote}`.trim());
            currentFootnote = '';
            currentMarker = '';
            bodyLines.push(line);
          } else {
            currentFootnote += ' ' + line;
          }
        } else {
          bodyLines.push(line);
        }
      }
    }

    if (currentFootnote) {
      pageFootnotes.push(`[${currentMarker}] ${currentFootnote}`.trim());
    }

    globalFootnotes.push(...pageFootnotes);
    cleanedPages.push(bodyLines.join('\n'));
  }

  return { cleanedPages, footnotes: globalFootnotes };
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

function cleanPDFText(text: string): string {
  if (!text) return '';

  const pagesRaw = text.split(/-- \d+ of \d+ --/);
  
  // 1. Remove repeated headers/footers using original page splits
  const withoutHeaders = cleanAndRemoveHeadersFooters(pagesRaw);
  
  // 2. Extract footnotes
  const { cleanedPages, footnotes } = extractAndCleanFootnotes(withoutHeaders);
  
  // Join the cleaned pages together for standard paragraph/line joining
  const cleanedPagesText = cleanedPages.join('\n\n');
  const lines = cleanedPagesText.split(/\r?\n/);
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

  for (const line of cleanedLines) {
    if (line === '') {
      if (currentParagraph) {
        processedText += currentParagraph + '\n\n';
        currentParagraph = '';
      }
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

  if (currentParagraph) {
    processedText += currentParagraph;
  }

  let finalContent = processedText.replace(/\n{3,}/g, '\n\n').trim();

  if (footnotes.length > 0) {
    const formattedFootnotes = footnotes
      .map(fn => fn.replace(/^\[(.+?)\]/, '**$1.**'))
      .join('\n\n');
    finalContent += '\n\n## Footnotes\n\n' + formattedFootnotes;
  }

  return finalContent;
}

// ── Public API ─────────────────────────────────────────────────────────────

const CLASSICAL_PAINTINGS = [
  'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/757px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Claude_Monet_-_Water_Lilies_-_Google_Art_Project.jpg/800px-Claude_Monet_-_Water_Lilies_-_Google_Art_Project.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/1665_Girl_with_a_Pearl_Earring.jpg/600px-1665_Girl_with_a_Pearl_Earring.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project.jpg/800px-Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg/600px-Mona_Lisa%2C_by_Leonardo_da_Vinci%2C_from_C2RMF_retouched.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Katsushika_Hokusai_-_The_Great_Wave_off_Kanagawa_-_Google_Art_Project.jpg/800px-Katsushika_Hokusai_-_The_Great_Wave_off_Kanagawa_-_Google_Art_Project.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/The_Kiss_-_Gustav_Klimt_-_Google_Art_Project.jpg/600px-The_Kiss_-_Gustav_Klimt_-_Google_Art_Project.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/A_Sunday_on_La_Grande_Jatte%2C_Georges_Seurat%2C_1884.jpg/800px-A_Sunday_on_La_Grande_Jatte%2C_Georges_Seurat%2C_1884.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg/600px-Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/The_Fighting_Temeraire%2C_JMW_Turner%2C_1839.jpg/800px-The_Fighting_Temeraire%2C_JMW_Turner%2C_1839.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/The_Night_Watch_-_Rembrandt_van_Rijn.jpg/800px-The_Night_Watch_-_Rembrandt_van_Rijn.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73.5_cm%2C_National_Gallery_of_Norway.jpg/600px-Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73.5_cm%2C_National_Gallery_of_Norway.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Las_Meninas_by_Diego_Vel%C3%A1zquez_-_retouched.jpg/800px-Las_Meninas_by_Diego_Vel%C3%A1zquez_-_retouched.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Claude_Monet%2C_Impression%2C_soleil_levant.jpg/800px-Claude_Monet%2C_Impression%2C_soleil_levant.jpg'
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
  const parser = new PDFParse({ data: buffer });
  const textResult = await parser.getText();
  const info = await parser.getInfo();
  await parser.destroy();

  const rawText = textResult.text;
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

  let title = info.info?.Title || '';
  if (!title || title.toLowerCase() === 'untitled' || title.toLowerCase() === 'introduction') {
    title = extracted.title || cleanTitle || 'Uploaded PDF';
  }
  const author = info.info?.Author || extracted.author || undefined;

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
