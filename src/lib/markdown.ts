import TurndownService from 'turndown';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  bullet: '-'
});

// Preserve <u> tags exactly
turndownService.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`
});

// Preserve embedded insight cards exactly
turndownService.addRule('embeddedInsight', {
  filter: (node) => {
    return node.nodeName === 'DIV' && node.classList.contains('embedded-insight');
  },
  replacement: (_content, node) => {
    return '\n\n' + (node as any).outerHTML.trim() + '\n\n';
  }
});

export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return turndownService.turndown(html);
}

export function markdownToHtml(md: string): string {
  if (!md) return '';

  // Protect embedded insight cards from markdown replacement
  const htmlBlocks: string[] = [];
  let placeholderCounter = 0;

  const cleanedMd = md.replace(/<div class="embedded-insight[\s\S]*?<\/div>\s*(<p><br><\/p>)?/g, (match) => {
    htmlBlocks.push(match);
    return `<!--EMBEDDED_INSIGHT_PLACEHOLDER_${placeholderCounter++}-->`;
  });

  let html = cleanedMd;

  // Let's replace basic markdown inline tags:
  
  // Headers (h1, h2, h3)
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>');

  // Blockquotes
  html = html.replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>');

  // Unordered Lists
  html = html.replace(/^[-\*] (.*?)$/gm, '<li>$1</li>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');

  // Italics
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.*?)_/g, '<em>$1</em>');

  // Underline
  html = html.replace(/~~(.*?)~~/g, '<u>$1</u>');

  // Let's convert plain text paragraphs:
  const lines = html.split(/\n/);
  const processedLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) {
      return '<p><br></p>';
    }

    // Check if it's already a block tag
    if (/^<(h1|h2|h3|blockquote|li|div|p)/i.test(trimmed) || trimmed.startsWith('<!--EMBEDDED_INSIGHT_PLACEHOLDER_')) {
      return trimmed;
    }

    return `<p>${line}</p>`;
  });
  
  html = processedLines.join('\n');

  // Restore embedded insights
  html = html.replace(/<!--EMBEDDED_INSIGHT_PLACEHOLDER_(\d+)-->/g, (_match, index) => {
    return htmlBlocks[parseInt(index, 10)] || '';
  });

  return html;
}

// ---------------------------------------------------------------------------
// Notebook content storage
//
// The notebook editor is a contentEditable div, so it natively produces HTML.
// Historically that HTML was run through Turndown on save and through the
// regex-based markdownToHtml() above on load. Those two are not inverses, so
// every save/reload cycle degraded the note:
//
//   "2 * 3"        -> "2 \* 3"  -> "2 \\\* 3"      (backslashes double)
//   "a\n\nb"       -> extra <p><br></p> each cycle (blank lines double)
//   "file_name"    -> "file<em>name</em>"          (underscores become italics)
//   nested bullets -> literal "*   item" text      (indented list items lost)
//
// Notes are now stored as HTML, which round-trips through the editor exactly.
// Content written by the old pipeline is still markdown, so reads fall back to
// the legacy converter for anything lacking the format marker below.
// ---------------------------------------------------------------------------

/** Characters Turndown escapes with a backslash when producing markdown. */
const TURNDOWN_ESCAPED = /\\([\\`*_{}[\]()#+\-.!>~|])/g;

/**
 * Reverse Turndown's backslash escaping. Legacy notes were escaped once per
 * save, so the backslashes compounded; unescape repeatedly until stable to
 * clean up notes that went through several cycles.
 */
function unescapeMarkdown(md: string): string {
  let out = md;
  for (let i = 0; i < 10; i++) {
    const next = out.replace(TURNDOWN_ESCAPED, '$1');
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Marker written at the head of every note saved by the current editor.
 *
 * A tag-sniffing heuristic is not enough: a note that is one plain sentence
 * ("see file_name_here") contains no HTML, so it would be misread as legacy
 * markdown and mangled by the converter below. An explicit marker makes the
 * stored format unambiguous. It is an HTML comment, so it stays invisible if
 * a value ever reaches the DOM unprocessed.
 */
const HTML_FORMAT_MARKER = '<!--fmt:html-->';

/** Does this stored value come from the current (HTML) editor? */
export function isHtmlContent(content: string): boolean {
  return content.startsWith(HTML_FORMAT_MARKER);
}

/**
 * markdownToHtml emits bare <li> with no list wrapper, which renders without
 * bullets or indentation. Group runs of them into a <ul> so legacy notes come
 * back as real lists; the padding Turndown added after its bullet is trimmed.
 */
function wrapLooseListItems(html: string): string {
  const lines = html.split('\n');
  const out: string[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length) {
      out.push('<ul>' + run.join('') + '</ul>');
      run = [];
    }
  };

  for (const line of lines) {
    const item = line.match(/^<li>([\s\S]*)<\/li>$/i);
    if (item) run.push(`<li>${item[1].trim()}</li>`);
    else { flush(); out.push(line); }
  }
  flush();
  return out.join('\n');
}

/**
 * Convert a stored note into HTML for the contentEditable editor.
 * New notes are already HTML; legacy markdown notes go through the old
 * converter, with accumulated escape backslashes stripped first.
 */
export function contentToHtml(content: string): string {
  if (!content) return '';
  if (isHtmlContent(content)) return content.slice(HTML_FORMAT_MARKER.length);
  return wrapLooseListItems(markdownToHtml(unescapeMarkdown(content)));
}

/**
 * Convert editor HTML into the value persisted to `notebook_notes.content`.
 * Stored verbatim so the next load is byte-identical — this is what stops the
 * compounding corruption described above.
 */
export function htmlToStoredContent(html: string): string {
  if (!html) return '';
  // An empty contentEditable leaves a stray break behind; normalise it away so
  // "empty note" stays empty rather than growing a <br> on every save.
  const trimmed = html.trim();
  if (trimmed === '<br>' || trimmed === '<p><br></p>' || trimmed === '<div><br></div>') return '';
  return HTML_FORMAT_MARKER + trimmed;
}
