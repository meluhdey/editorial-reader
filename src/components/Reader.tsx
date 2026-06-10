import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { ArrowLeft, ExternalLink, Trash2, X, BookmarkPlus, Loader2, Bold, Italic, Underline } from 'lucide-react';
import type { Article, Highlight } from '../types';
import { htmlToMarkdown, markdownToHtml } from '../lib/markdown';

const fallbackPaintings = [
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

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function getReaderImageUrl(article: Article): string {
  const url = article.headerImageUrl;
  if (!url || url.includes('upload.wikimedia.org')) {
    const idx = hashId(article.id) % fallbackPaintings.length;
    return fallbackPaintings[idx];
  }
  return url;
}

function cleanContentImages(content: string, headerUrl: string | undefined): string {
  if (!headerUrl) return content;
  
  const getCleanUrl = (url: string) => {
    try {
      const u = new URL(url);
      return (u.hostname + u.pathname).replace(/\/$/, '');
    } catch {
      return url.replace(/^(https?:)?\/\//i, '').replace(/\/$/, '');
    }
  };

  const getFilename = (url: string) => {
    try {
      const path = url.split('?')[0];
      const parts = path.split('/');
      return parts[parts.length - 1] || '';
    } catch {
      return '';
    }
  };

  const cleanHeader = getCleanUrl(headerUrl);
  const headerFilename = getFilename(headerUrl);

  const mdImageRegex = /!\[.*?\]\((.*?)\)/g;
  const htmlImageRegex = /<img\s+[^>]*?src=["'](.*?)["'][^>]*?>/gi;

  const mdImages = [...content.matchAll(mdImageRegex)].map(m => ({ raw: m[0], url: m[1] }));
  const htmlImages = [...content.matchAll(htmlImageRegex)].map(m => ({ raw: m[0], url: m[1] }));
  const allImages = [...mdImages, ...htmlImages];

  if (allImages.length === 0) return content;

  // RULE A: If there is exactly one image inside the body content, and we have a banner,
  // we omit it from the body of text because it is already used in the banner cover!
  if (allImages.length === 1) {
    return content.replace(allImages[0].raw, '');
  }

  // RULE B: If there are multiple images, we strip any image that duplicates the banner
  // either by direct URL match OR by filename match.
  let nextContent = content;
  for (const img of allImages) {
    const cleanImgUrl = getCleanUrl(img.url);
    const imgFilename = getFilename(img.url);
    
    const isDirectMatch = cleanImgUrl === cleanHeader;
    const isFilenameMatch = headerFilename && imgFilename && imgFilename === headerFilename;

    if (isDirectMatch || isFilenameMatch) {
      nextContent = nextContent.replace(img.raw, '');
    }
  }

  return nextContent;
}

interface ReaderProps {
  article: Article;
  onUpdate: (article: Article) => void;
  onBack: () => void;
  onDelete: (id: string) => void;
  onSaveUrl?: (url: string) => Promise<void>;
}

interface Popup {
  x: number;
  y: number;
  text: string;
}

const entitiesMap: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&#x27;': "'",
  '&#8217;': "'",
  '&#x2019;': "'",
  '&rsquo;': "'",
  '&lsquo;': "'",
  '&rdquo;': '"',
  '&ldquo;': '"',
  '&nbsp;': ' ',
};

function decodeNumericEntity(entity: string): string | null {
  try {
    if (entity.startsWith('&#x') || entity.startsWith('&#X')) {
      const hex = entity.slice(3, -1);
      return String.fromCharCode(parseInt(hex, 16));
    } else if (entity.startsWith('&#')) {
      const dec = entity.slice(2, -1);
      return String.fromCharCode(parseInt(dec, 10));
    }
  } catch {}
  return null;
}

// Find the ')' that closes a markdown link destination beginning at the '(' (openIdx).
// Honors backslash escapes (e.g. \( \) in Wikipedia URLs) and balanced parens, so URLs
// containing apostrophes, quotes, or parenthesised disambiguators don't terminate early.
// A naive "first ')'" scan leaks the URL/title into the clean text and breaks the index
// map, which silently drops highlights that span links — worst in long, link-heavy articles.
function findLinkClose(md: string, openIdx: number): number {
  let k = openIdx + 1;
  let depth = 1;
  const len = md.length;
  while (k < len) {
    const c = md[k];
    if (c === '\\') { k += 2; continue; }          // escaped char
    if (c === '(') { depth++; k++; continue; }
    if (c === ')') { depth--; if (depth === 0) return k; k++; continue; }
    if (c === '\n') { return -1; }                 // links never span lines
    k++;
  }
  return -1;
}

function buildCleanTextAndMap(markdown: string) {
  let cleanText = '';
  const map: number[] = []; // cleanIndex -> rawIndex
  const skippedRanges: { start: number; end: number }[] = [];

  let i = 0;
  const len = markdown.length;

  // CommonMark backslash-escapable ASCII punctuation. Turndown emits these (e.g. \[ \]
  // \* \. \( \) ) when scraping prose, but they render WITHOUT the backslash — so the
  // user's on-screen selection never contains it. We must strip the backslash here too,
  // otherwise highlights spanning escaped punctuation (e.g. "[. . .]") never match.
  const ESCAPABLE = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

  while (i < len) {
    // 0. Backslash escapes: \X renders as literal X. Emit X (mapped to the backslash's
    //    raw position so the two-char \X stays atomic and renders correctly when wrapped).
    if (markdown[i] === '\\' && i + 1 < len && ESCAPABLE.includes(markdown[i + 1])) {
      map.push(i);
      cleanText += markdown[i + 1];
      i += 2;
      continue;
    }

    // 1. Skip HTML tags: <...tag...>
    if (markdown[i] === '<') {
      let closeTag = -1;
      for (let j = i + 1; j < len; j++) {
        if (markdown[j] === '>') {
          closeTag = j;
          break;
        }
      }
      if (closeTag !== -1) {
        skippedRanges.push({ start: i, end: closeTag + 1 });
        i = closeTag + 1;
        continue;
      }
    }

    // 2. Skip bold/italic/strikethrough syntax
    // ** or __ (bold)
    if ((markdown[i] === '*' && markdown[i + 1] === '*') || (markdown[i] === '_' && markdown[i + 1] === '_')) {
      skippedRanges.push({ start: i, end: i + 2 });
      i += 2;
      continue;
    }
    // ~~ (strikethrough)
    if (markdown[i] === '~' && markdown[i + 1] === '~') {
      skippedRanges.push({ start: i, end: i + 2 });
      i += 2;
      continue;
    }
    // * or _ (italic)
    if (markdown[i] === '*' || markdown[i] === '_') {
      skippedRanges.push({ start: i, end: i + 1 });
      i += 1;
      continue;
    }
    // ` (inline code)
    if (markdown[i] === '`') {
      skippedRanges.push({ start: i, end: i + 1 });
      i += 1;
      continue;
    }

    // 3. Links: [text](url)
    if (markdown[i] === '[') {
      let closeBracket = -1;
      let depth = 1;
      for (let j = i + 1; j < len; j++) {
        if (markdown[j] === '[') depth++;
        if (markdown[j] === ']') {
          depth--;
          if (depth === 0) {
            closeBracket = j;
            break;
          }
        }
      }
      if (closeBracket !== -1 && markdown[closeBracket + 1] === '(') {
        const closeParen = findLinkClose(markdown, closeBracket + 1);
        if (closeParen !== -1) {
          skippedRanges.push({ start: i, end: i + 1 }); // skipped [
          i += 1;
          continue;
        }
      }
    }

    if (markdown[i] === ']' && markdown[i + 1] === '(') {
      const closeParen = findLinkClose(markdown, i + 1);
      if (closeParen !== -1) {
        skippedRanges.push({ start: i, end: closeParen + 1 }); // skipped ](url)
        i = closeParen + 1;
        continue;
      }
    }

    // 4. Decode HTML Entities so selection matches exactly
    if (markdown[i] === '&') {
      let closeSemicolon = -1;
      for (let j = i + 1; j < Math.min(len, i + 12); j++) {
        if (markdown[j] === ';') {
          closeSemicolon = j;
          break;
        }
      }
      if (closeSemicolon !== -1) {
        const entity = markdown.slice(i, closeSemicolon + 1);
        let decoded = entitiesMap[entity.toLowerCase()] || entitiesMap[entity] || null;
        if (decoded === null && (entity.startsWith('&#') || entity.startsWith('&#x') || entity.startsWith('&#X'))) {
          decoded = decodeNumericEntity(entity);
        }
        if (decoded !== null) {
          map.push(i);
          cleanText += decoded;
          i = closeSemicolon + 1;
          continue;
        }
      }
    }

    map.push(i);
    cleanText += markdown[i];
    i++;
  }

  map.push(len);
  return { cleanText, map, skippedRanges };
}

function applyHighlights(markdown: string, highlights: Highlight[]): string {
  if (highlights.length === 0) return markdown;

  // 1. Build clean text, map, and skipped ranges
  const { cleanText, map, skippedRanges } = buildCleanTextAndMap(markdown);
  
  interface MatchRange {
    start: number;
    end: number;
    color: string;
    id: string;
  }
  
  const matches: MatchRange[] = [];

  // Group highlights by unique lowercase text + color to prevent duplicate RegExp scanning
  const uniqueHighlights = Array.from(
    new Map(
      highlights.map((h) => [`${h.text.trim().toLowerCase()}-${h.color}`, h])
    ).values()
  );
  
  // 2. Find matches on clean text
  for (const h of uniqueHighlights) {
    try {
      // Escape special characters for RegExp
      const escaped = h.text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Normalize spaces to support any whitespace
      let flexPattern = escaped.replace(/\s+/g, '\\s+');
      // Support matching both typographic and straight single/double quotes/apostrophes
      flexPattern = flexPattern
        .replace(/['’\u2018\u2019]/g, "['’\u2018\u2019]")
        .replace(/["”\u201C\u201D]/g, '["”\u201C\u201D]')
        .replace(/[-—–]/g, '[-—–]');
      
      // A. Try scanning with word boundaries first (highly performant and prevents substring false-positives)
      let matchFound = false;
      const startWordBound = /^\w/.test(h.text.trim()) ? '\\b' : '';
      const endWordBound = /\w$/.test(h.text.trim()) ? '\\b' : '';
      const pattern = `${startWordBound}${flexPattern}${endWordBound}`;
      let regex = new RegExp(pattern, 'gi');
      
      let match;
      while ((match = regex.exec(cleanText)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        matchFound = true;
        const cleanStart = match.index;
        const cleanEnd = match.index + match[0].length;
        
        // Translate clean indices to raw indices using the map
        const rawStart = map[cleanStart];
        const rawEnd = map[cleanEnd];

        matches.push({
          start: rawStart,
          end: rawEnd,
          color: h.color,
          id: h.id,
        });
      }

      // B. Self-Healing Fallback: If no match was found (e.g., due to custom punctuation, markdown blocks,
      // or hidden Unicode characters breaking \b boundaries), retry searching for the exact text without \b
      if (!matchFound) {
        regex = new RegExp(flexPattern, 'gi');
        while ((match = regex.exec(cleanText)) !== null) {
          if (match[0].length === 0) {
            regex.lastIndex++;
            continue;
          }
          const cleanStart = match.index;
          const cleanEnd = match.index + match[0].length;
          
          const rawStart = map[cleanStart];
          const rawEnd = map[cleanEnd];

          matches.push({
            start: rawStart,
            end: rawEnd,
            color: h.color,
            id: h.id,
          });
        }
      }
    } catch (e) {
      console.error('[highlight regex error]', e);
    }
  }

  // De-duplicate matches by start, end, and color to prevent overlapping DOM splits
  const uniqueMatchesMap = new Map<string, MatchRange>();
  for (const m of matches) {
    const key = `${m.start}-${m.end}-${m.color}`;
    uniqueMatchesMap.set(key, m);
  }
  const uniqueMatches = Array.from(uniqueMatchesMap.values());

  if (uniqueMatches.length === 0) return markdown;

  // 3. Collect all boundary offsets
  const boundariesSet = new Set<number>([0, markdown.length]);
  for (const m of uniqueMatches) {
    boundariesSet.add(m.start);
    boundariesSet.add(m.end);
  }
  for (const r of skippedRanges) {
    boundariesSet.add(r.start);
    boundariesSet.add(r.end);
  }
  const boundaries = Array.from(boundariesSet).sort((a, b) => a - b);

  // 4. Rebuild the document segment by segment
  let result = '';
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const segmentText = markdown.slice(start, end);
    if (!segmentText) continue;

    // Check if this segment is inside a skipped range
    const isSkipped = skippedRanges.some(r => r.start <= start && r.end >= end);

    if (!isSkipped) {
      // Find all matches covering this segment
      const covering = uniqueMatches.filter(m => m.start <= start && m.end >= end);
      
      if (covering.length > 0) {
        // Collect unique colors/styles
        const colors = Array.from(new Set(covering.map(m => m.color)));
        const ids = covering.map(m => m.id).join(',');
        const classes = colors.map(c => `hl-${c}`).join(' ');
        
        result += `<mark class="${classes}" data-hid="${ids}">${segmentText}</mark>`;
        continue;
      }
    }

    result += segmentText;
  }

  return result;
}


function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function hostname(url: string): string {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
}

const FONT_SIZES = [14, 16, 18, 20, 22, 24];
const DEFAULT_FONT_IDX = 2; // 18px

export default function Reader({ article, onUpdate, onBack, onDelete, onSaveUrl }: ReaderProps) {
  const [popup, setPopup] = useState<Popup | null>(null);
  const [showColors, setShowColors] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [fontIdx, setFontIdx] = useState(DEFAULT_FONT_IDX);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingAuthor, setEditingAuthor] = useState(false);
  const [titleDraft, setTitleDraft] = useState(article.title);
  const [authorDraft, setAuthorDraft] = useState(article.author ?? '');
  const [activeIframeUrl, setActiveIframeUrl] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [pdfColumns, setPdfColumns] = useState<'1' | '2' | 'original'>('1');

  const pdfUrl = useMemo(() => {
    if (!article.url) return '';
    let filename = '';
    if (article.url.startsWith('local-upload://')) {
      filename = article.url.replace('local-upload://', '');
    } else if (article.url.includes('/api/uploads/')) {
      filename = article.url.split('/api/uploads/')[1];
    } else {
      return article.url;
    }

    // Fully decode filename to plain text
    let decoded = filename;
    try {
      while (decoded !== decodeURIComponent(decoded)) {
        decoded = decodeURIComponent(decoded);
      }
    } catch {
      decoded = filename;
    }

    return `/api/uploads/${encodeURIComponent(decoded)}`;
  }, [article.url]);

  const isPdfArticle = article.tags.includes('pdf');

  // Refs for tracking scroll containers
  const normalContainerRef = useRef<HTMLDivElement | null>(null);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);

  // Save scroll position to localStorage
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    localStorage.setItem(`scroll-pos-${article.id}`, String(target.scrollTop));
  }, [article.id]);

  // Restore scroll position when article.id or layout mode changes
  useEffect(() => {
    const container = isPdfArticle ? pdfContainerRef.current : normalContainerRef.current;
    if (!container) return;

    const saved = localStorage.getItem(`scroll-pos-${article.id}`);
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed)) {
        container.scrollTop = parsed;
        const timer1 = setTimeout(() => {
          container.scrollTop = parsed;
        }, 50);
        const timer2 = setTimeout(() => {
          container.scrollTop = parsed;
        }, 150);
        const timer3 = setTimeout(() => {
          container.scrollTop = parsed;
        }, 300);
        return () => {
          clearTimeout(timer1);
          clearTimeout(timer2);
          clearTimeout(timer3);
        };
      }
    } else {
      container.scrollTop = 0;
    }
  }, [article.id, isPdfArticle, pdfColumns]);

  const pdfPages = useMemo(() => {
    if (!isPdfArticle) return [];
    // Split by horizontal rules "---" surrounded by empty lines
    return article.content.split(/\n\s*---\s*\n/);
  }, [article.content, isPdfArticle]);

  useEffect(() => {
    setIsSaving(false);
    setSaveError(null);
  }, [activeIframeUrl]);

  const handleSaveToLibrary = async () => {
    if (!activeIframeUrl || !onSaveUrl) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSaveUrl(activeIframeUrl);
    } catch (err) {
      console.error('Failed to save to library:', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
      setIsSaving(false);
    }
  };

  const saveTitle = () => {
    const t = titleDraft.trim();
    if (t && t !== article.title) onUpdate({ ...article, title: t });
    else setTitleDraft(article.title);
    setEditingTitle(false);
  };

  const saveAuthor = () => {
    const a = authorDraft.trim();
    if (a !== (article.author ?? '')) onUpdate({ ...article, author: a || undefined });
    setEditingAuthor(false);
  };

  /* ── Sidebar Notes Editor ── */
  const notesEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (notesEditorRef.current) {
      if (notesEditorRef.current.getAttribute('data-article-id') !== article.id) {
        notesEditorRef.current.innerHTML = markdownToHtml(article.notes || '');
        notesEditorRef.current.setAttribute('data-article-id', article.id);
      }
    }
  }, [article.id]);

  const handleNotesInput = () => {
    if (notesEditorRef.current) {
      const html = notesEditorRef.current.innerHTML;
      const markdown = htmlToMarkdown(html);
      onUpdate({
        ...article,
        notes: markdown
      });
    }
  };

  const applyFormatting = (formatType: 'bold' | 'italic' | 'underline') => {
    if (!notesEditorRef.current) return;
    notesEditorRef.current.focus();
    document.execCommand(formatType, false);
    handleNotesInput();
  };

  const handleNotesPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    handleNotesInput();
  };

  const handleNotesKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ') {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const node = range.startContainer;
      const textContent = node.textContent || '';
      const offset = range.startOffset;

      if (offset === 1 && (textContent.trim() === '-' || textContent.trim() === '*')) {
        e.preventDefault();
        document.execCommand('delete', false);
        document.execCommand('insertUnorderedList', false);
        handleNotesInput();
      }
    }
  };

  /* ── Tag management ── */
  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t || t === 'pdf' || article.tags.includes(t)) { setTagInput(''); return; }
    onUpdate({ ...article, tags: [...article.tags, t] });
    setTagInput('');
  };
  const removeTag = (tag: string) => {
    if (tag === 'pdf') return;
    onUpdate({ ...article, tags: article.tags.filter((t) => t !== tag) });
  };

  /* ── Highlight selection ── */
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 3) { setPopup(null); return; }
    
    // Check if selection spans across line/paragraph breaks to prevent DOM and HTML malformation
    if (text.includes('\n') || text.includes('\r')) {
      setPopup(null);
      return;
    }

    const range = sel!.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setPopup({ x: rect.left + rect.width / 2, y: rect.top + window.scrollY, text });
    setShowColors(false);
  }, []);

  const saveHighlight = (color: string) => {
    if (!popup) return;
    const cleanText = popup.text.trim();

    const isColorStyle = ['green', 'blue', 'purple', 'orange', 'yellow'].includes(color);

    if (isColorStyle) {
      // Look for an existing highlight color on the exact same text (case-insensitive)
      const existingColor = article.highlights.find(
        h => h.text.trim().toLowerCase() === cleanText.toLowerCase() && ['green', 'blue', 'purple', 'orange', 'yellow'].includes(h.color)
      );

      if (existingColor) {
        if (existingColor.color === color) {
          // Toggle off (remove) the highlight if the same color is clicked again
          const updated = article.highlights.filter(h => h.id !== existingColor.id);
          onUpdate({ ...article, highlights: updated });
        } else {
          // Switch to the new color
          const updated = article.highlights.map(h =>
            h.id === existingColor.id ? { ...h, color } : h
          );
          onUpdate({ ...article, highlights: updated });
        }
      } else {
        // Create new color highlight
        const highlight: Highlight = {
          id: crypto.randomUUID(),
          text: cleanText,
          color,
          createdAt: Date.now(),
        };
        onUpdate({ ...article, highlights: [...article.highlights, highlight] });
      }
    } else {
      // Bold or Underline styles (case-insensitive)
      const existingStyle = article.highlights.find(
        h => h.text.trim().toLowerCase() === cleanText.toLowerCase() && h.color === color
      );

      if (existingStyle) {
        // Toggle off (remove) the style
        const updated = article.highlights.filter(h => h.id !== existingStyle.id);
        onUpdate({ ...article, highlights: updated });
      } else {
        // Create new style highlight
        const highlight: Highlight = {
          id: crypto.randomUUID(),
          text: cleanText,
          color,
          createdAt: Date.now(),
        };
        onUpdate({ ...article, highlights: [...article.highlights, highlight] });
      }
    }

    setPopup(null);
    window.getSelection()?.removeAllRanges();
  };

  const deleteHighlight = (id: string) =>
    onUpdate({ ...article, highlights: article.highlights.filter((h) => h.id !== id) });

  const handleContentClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a');
    if (link) {
      const href = link.getAttribute('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        e.preventDefault();
        e.stopPropagation();
        setActiveIframeUrl(href);
        return;
      }
    }
    if (target.tagName !== 'MARK' && !window.getSelection()?.toString()) setPopup(null);
  };

  const cleanBodyContent = useMemo(() => {
    return cleanContentImages(article.content, article.headerImageUrl);
  }, [article.content, article.headerImageUrl]);

  const processedContent = applyHighlights(cleanBodyContent, article.highlights);

  return (
    <div 
      className={`reader ${activeIframeUrl ? 'reader--split' : ''}`}
      style={{ gridTemplateColumns: activeIframeUrl ? '1fr auto 380px' : '1fr 380px' }}
    >

      {/* ── LEFT: article ── */}
      <div 
        ref={isPdfArticle ? undefined : normalContainerRef}
        className="reader-left" 
        onScroll={isPdfArticle ? undefined : handleScroll}
        style={{ 
          display: isPdfArticle ? 'flex' : undefined,
          flexDirection: isPdfArticle ? 'column' : undefined
        }}
      >
        {isPdfArticle && (
          <div className="pdf-reader-toolbar">
            <div className="pdf-column-switch-container">
              <span className="pdf-column-switch-label">LAYOUT MODES</span>
              <div className="pdf-column-switch switch-three">
                <div className={`pdf-column-switch-slider ${
                  pdfColumns === '1' ? 'position-1' : pdfColumns === '2' ? 'position-2' : 'position-3'
                }`} />
                <span 
                  className={`pdf-column-switch-option ${pdfColumns === '1' ? 'active' : ''}`}
                  onClick={() => setPdfColumns('1')}
                >
                  1 COLUMN
                </span>
                <span 
                  className={`pdf-column-switch-option ${pdfColumns === '2' ? 'active' : ''}`}
                  onClick={() => setPdfColumns('2')}
                >
                  2 COLUMNS
                </span>
                <span 
                  className={`pdf-column-switch-option ${pdfColumns === 'original' ? 'active' : ''}`}
                  onClick={() => setPdfColumns('original')}
                >
                  ORIGINAL PDF
                </span>
              </div>
            </div>
          </div>
        )}

        {isPdfArticle ? (
          pdfColumns === 'original' ? (
            <div className="reader-pdf-iframe-container">
              <iframe
                src={pdfUrl}
                title={article.title}
                className="reader-pdf-iframe"
              />
            </div>
          ) : (
            <div 
              ref={pdfContainerRef}
              className="pdf-viewer-workspace" 
              onScroll={handleScroll}
              onMouseUp={handleMouseUp} 
              onClick={handleContentClick}
            >
              {pdfPages.map((pageText, idx) => {
                const parts = pageText.split('<!-- FOOTNOTES -->');
                const bodyText = parts[0];
                const footnoteText = parts[1];

                return (
                  <div key={idx} className={`pdf-page-sim-sheet ${pdfColumns === '2' ? 'pdf-page--two-columns' : ''}`}>
                  <div className="pdf-page-header">
                    <span>{article.title}</span>
                    <span className="pdf-page-num">PAGE {idx + 1} OF {pdfPages.length}</span>
                  </div>

                  {idx === 0 && (
                    <div className="pdf-page-title-block">
                      <h1 className="pdf-page-main-title">
                        {editingTitle ? (
                          <input
                            className="reader-article-title-input"
                            value={titleDraft}
                            autoFocus
                            onChange={(e) => setTitleDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setTitleDraft(article.title); setEditingTitle(false); } }}
                            onBlur={saveTitle}
                          />
                        ) : (
                          <span className="reader-editable" onClick={() => { setTitleDraft(article.title); setEditingTitle(true); }}>
                            {article.title}
                          </span>
                        )}
                      </h1>
                      <div className="pdf-page-main-author">
                        {editingAuthor ? (
                          <input
                            className="reader-article-author-input"
                            value={authorDraft}
                            autoFocus
                            placeholder="Add author…"
                            onChange={(e) => setAuthorDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveAuthor(); if (e.key === 'Escape') { setAuthorDraft(article.author ?? ''); setEditingAuthor(false); } }}
                            onBlur={saveAuthor}
                          />
                        ) : (
                          <span className="reader-editable" onClick={() => { setAuthorDraft(article.author ?? ''); setEditingAuthor(true); }}>
                            {article.author || <span className="reader-editable-placeholder">Add author…</span>}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div 
                    className="article-content"
                    style={{ fontSize: FONT_SIZES[fontIdx], margin: 0, padding: 0 }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                      {applyHighlights(bodyText, article.highlights)}
                    </ReactMarkdown>
                  </div>

                  {footnoteText && (
                    <div className="pdf-page-footnotes">
                      <div className="pdf-page-footnotes-line" />
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                        {applyHighlights(footnoteText.trim(), article.highlights)}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )
        ) : (
          <>
            <img
              className="reader-article-img"
              src={getReaderImageUrl(article)}
              alt=""
              onError={(e) => {
                const target = e.currentTarget;
                const fallback = fallbackPaintings[hashId(article.id) % fallbackPaintings.length];
                if (target.src !== fallback) {
                  target.src = fallback;
                }
              }}
            />

            <div className="reader-article-header">
              <h1 className="reader-article-title">
                {editingTitle ? (
                  <input
                    className="reader-article-title-input"
                    value={titleDraft}
                    autoFocus
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setTitleDraft(article.title); setEditingTitle(false); } }}
                    onBlur={saveTitle}
                  />
                ) : (
                  <span className="reader-editable" onClick={() => { setTitleDraft(article.title); setEditingTitle(true); }}>
                    {article.title}
                  </span>
                )}
              </h1>
              <div className="reader-article-author">
                {editingAuthor ? (
                  <input
                    className="reader-article-author-input"
                    value={authorDraft}
                    autoFocus
                    placeholder="Add author…"
                    onChange={(e) => setAuthorDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveAuthor(); if (e.key === 'Escape') { setAuthorDraft(article.author ?? ''); setEditingAuthor(false); } }}
                    onBlur={saveAuthor}
                  />
                ) : (
                  <span className="reader-editable" onClick={() => { setAuthorDraft(article.author ?? ''); setEditingAuthor(true); }}>
                    {article.author || <span className="reader-editable-placeholder">Add author…</span>}
                  </span>
                )}
              </div>

              <div className="reader-article-meta">
                <span>{formatDate(article.savedAt)}</span>
                <span>—</span>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="source-link"
                >
                  {hostname(article.url)}
                  <ExternalLink size={9} strokeWidth={1.5} />
                </a>
              </div>

              {article.tags.filter(t => t !== 'pdf').length > 0 && (
                <div className="reader-tags-inline">
                  {article.tags.filter(t => t !== 'pdf').join(' / ')}
                </div>
              )}
            </div>

            <div
              className="article-content"
              style={{ fontSize: FONT_SIZES[fontIdx] }}
              onMouseUp={handleMouseUp}
              onClick={handleContentClick}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {processedContent}
              </ReactMarkdown>
            </div>
          </>
        )}
      </div>

        {/* ── MIDDLE: split screen iframe ── */}
        <AnimatePresence>
          {activeIframeUrl && (
            <motion.div 
              className="reader-iframe-pane"
              initial={{ width: 0 }}
              animate={{ width: 'min(650px, 45vw)' }}
              exit={{ width: 0 }}
              transition={{ type: 'spring', damping: 26, stiffness: 210 }}
            >
              <div className="iframe-header">
                <span className="iframe-domain">{hostname(activeIframeUrl)}</span>
                <div className="iframe-header-actions">
                  {onSaveUrl && (
                    <button
                      className={`iframe-save-btn ${isSaving ? 'saving' : ''} ${saveError ? 'error' : ''}`}
                      onClick={handleSaveToLibrary}
                      disabled={isSaving}
                      title={saveError || 'Save this page as an article to your library'}
                    >
                      {isSaving ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          <span>SAVING...</span>
                        </>
                      ) : saveError ? (
                        <span>ERROR</span>
                      ) : (
                        <>
                          <BookmarkPlus size={12} strokeWidth={1.5} />
                          <span>SAVE +</span>
                        </>
                      )}
                    </button>
                  )}
                  <a 
                    href={activeIframeUrl} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="iframe-external-link"
                    title="Open in new tab"
                  >
                    <ExternalLink size={13} strokeWidth={1.5} />
                  </a>
                  <button 
                    className="iframe-close-btn" 
                    onClick={() => setActiveIframeUrl(null)}
                    title="Close split screen"
                  >
                    <X size={15} strokeWidth={1.5} />
                  </button>
                </div>
              </div>
              <iframe 
                src={`/api/proxy?url=${encodeURIComponent(activeIframeUrl)}`} 
                title="Split View"
                className="split-iframe"
                sandbox="allow-same-origin allow-forms"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── RIGHT: notes & tools ── */}
        <div className="reader-right">

          {/* Font size */}
          <div className="sidebar-section sidebar-section--font">
            <span className="sidebar-label">TEXT SIZE</span>
            <div className="font-size-controls">
              <button
                className="font-size-btn"
                onClick={() => setFontIdx((i) => Math.max(0, i - 1))}
                disabled={fontIdx === 0}
              >A−</button>
              <span className="font-size-value">{FONT_SIZES[fontIdx]}px</span>
              <button
                className="font-size-btn"
                onClick={() => setFontIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}
                disabled={fontIdx === FONT_SIZES.length - 1}
              >A+</button>
            </div>
          </div>

          {/* Topics */}
          <div className="sidebar-section">
            <span className="sidebar-label">TOPICS AND THEMES</span>
            <div className="tag-chip-list">
              <AnimatePresence>
                {article.tags.filter(t => t !== 'pdf').map((tag) => (
                  <motion.span 
                    key={tag} 
                    className="tag-chip"
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.2 }}
                  >
                    {tag}
                    <button className="tag-chip-remove" onClick={() => removeTag(tag)}>×</button>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
            <div className="tag-input-row">
              <input
                className="tag-input"
                placeholder="ADD NEW THEME"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              />
              <button className="btn btn-ghost tag-add-btn" onClick={addTag}>SAVE +</button>
            </div>
          </div>

          {/* Notes */}
          <div className="sidebar-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span className="sidebar-label" style={{ marginBottom: 0 }}>NOTES</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button 
                  className="toolbar-btn" 
                  onClick={() => applyFormatting('bold')} 
                  title="Bold (Cmd+B)"
                  style={{ padding: '2px 6px', border: '1px solid var(--border)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--muted)' }}
                >
                  <Bold size={11} />
                </button>
                <button 
                  className="toolbar-btn" 
                  onClick={() => applyFormatting('italic')} 
                  title="Italic (Cmd+I)"
                  style={{ padding: '2px 6px', border: '1px solid var(--border)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--muted)' }}
                >
                  <Italic size={11} />
                </button>
                <button 
                  className="toolbar-btn" 
                  onClick={() => applyFormatting('underline')} 
                  title="Underline (Cmd+U)"
                  style={{ padding: '2px 6px', border: '1px solid var(--border)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--muted)' }}
                >
                  <Underline size={11} />
                </button>
              </div>
            </div>
            <div
              ref={notesEditorRef}
              contentEditable={true}
              className="notes-textarea"
              style={{ 
                flex: 1, 
                minHeight: '120px', 
                overflowY: 'auto', 
                outline: 'none', 
                border: '1px solid var(--border)', 
                padding: '10px 12px',
                background: 'var(--surface)',
                fontFamily: 'var(--sans)',
                fontSize: '15px',
                lineHeight: '1.6',
                color: 'var(--ink)'
              }}
              placeholder="Your notes on this article…"
              onInput={handleNotesInput}
              onPaste={handleNotesPaste}
              onKeyDown={handleNotesKeyDown}
              suppressContentEditableWarning
            />
          </div>

          {/* Highlights */}
          <div className="sidebar-section" style={{ display: 'flex', flexDirection: 'column', height: '320px', minHeight: 0 }}>
            <div style={{ marginBottom: '12px' }}>
              <span className="sidebar-label" style={{ marginBottom: 0 }}>
                HIGHLIGHTS
                {article.highlights.length > 0 && ` (${article.highlights.length})`}
              </span>
            </div>

            {article.highlights.length === 0 ? (
              <p className="hl-empty-note">
                Select any text in the article to save a highlight.
              </p>
            ) : (
              <div className="hl-list" style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'thin' }}>
                <AnimatePresence>
                  {article.highlights.map((h) => (
                    <motion.div 
                      key={h.id} 
                      className="hl-item"
                      layout
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className={`hl-item-bar ${h.color}`} />
                      <p className="hl-item-text">"{h.text}"</p>
                      {h.comment && <p className="hl-item-comment">{h.comment}</p>}
                      <button className="hl-item-delete" onClick={() => deleteHighlight(h.id)}>
                        Remove
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

        </div>

      {/* ── Highlight popup ── */}
      {popup && (
        <div
          className="text-menu-popup"
          style={{ left: popup.x, top: popup.y - 48 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div 
            className="text-menu-item highlight"
            onMouseEnter={() => setShowColors(true)}
            onMouseLeave={() => setShowColors(false)}
            onMouseUp={(e) => { e.stopPropagation(); saveHighlight('green'); }}
          >
            <AnimatePresence>
              {showColors && (
                <motion.div 
                  className="color-submenu"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="color-circle yellow" onMouseUp={(e) => { e.stopPropagation(); saveHighlight('yellow'); }} />
                  <div className="color-circle blue" onMouseUp={(e) => { e.stopPropagation(); saveHighlight('blue'); }} />
                  <div className="color-circle green" onMouseUp={(e) => { e.stopPropagation(); saveHighlight('green'); }} />
                  <div className="color-circle purple" onMouseUp={(e) => { e.stopPropagation(); saveHighlight('purple'); }} />
                  <div className="color-circle orange" onMouseUp={(e) => { e.stopPropagation(); saveHighlight('orange'); }} />
                </motion.div>
              )}
            </AnimatePresence>
            <span className="hover-text">HIGHLIGHT</span>
          </div>
          <div className="text-menu-item bold" onMouseUp={(e) => { e.stopPropagation(); saveHighlight('bold'); }}>
            <span className="hover-text">BOLD</span>
          </div>
          <div className="text-menu-item underline" onMouseUp={(e) => { e.stopPropagation(); saveHighlight('underline'); }}>
            <span className="hover-text">UNDERLINE</span>
          </div>
        </div>
      )}
    </div>
  );
}
