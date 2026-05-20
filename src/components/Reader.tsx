import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { ArrowLeft, ExternalLink, Trash2, X, BookmarkPlus, Loader2 } from 'lucide-react';
import type { Article, Highlight } from '../types';

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

function applyHighlights(markdown: string, highlights: Highlight[]): string {
  let result = markdown;
  const sorted = [...highlights].sort((a, b) => b.text.length - a.text.length);
  for (const h of sorted) {
    try {
      const escaped = h.text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Relax whitespace matching so any whitespace sequence in selection matches any whitespace in markdown (e.g. non-breaking spaces)
      const flexWhitespace = escaped.replace(/\s+/g, '\\s+');
      // Bypasses matching target text inside HTML tags by matching HTML tags first
      const tagOrTextRegex = new RegExp(`(<[^>]+>)|${flexWhitespace}`, 'gi');
      result = result.replace(tagOrTextRegex, (match, tag) => {
        if (tag) return match; // Keep tags intact
        return `<mark class="hl-${h.color}" data-hid="${h.id}">${match}</mark>`;
      });
    } catch (e) {
      console.error(e);
    }
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

  /* ── Tag management ── */
  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t || article.tags.includes(t)) { setTagInput(''); return; }
    onUpdate({ ...article, tags: [...article.tags, t] });
    setTagInput('');
  };
  const removeTag = (tag: string) =>
    onUpdate({ ...article, tags: article.tags.filter((t) => t !== tag) });

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

    // Prevent duplicate highlights of the exact same text.
    // If it already exists, update its color or do nothing.
    const exists = article.highlights.find(h => h.text.trim() === cleanText);
    if (exists) {
      if (exists.color === color) {
        setPopup(null);
        window.getSelection()?.removeAllRanges();
        return;
      }
      const updated = article.highlights.map(h =>
        h.id === exists.id ? { ...h, color } : h
      );
      onUpdate({ ...article, highlights: updated });
    } else {
      const highlight: Highlight = {
        id: crypto.randomUUID(),
        text: cleanText,
        color,
        createdAt: Date.now(),
      };
      onUpdate({ ...article, highlights: [...article.highlights, highlight] });
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

  const processedContent = applyHighlights(article.content, article.highlights);

  return (
    <div 
      className={`reader ${activeIframeUrl ? 'reader--split' : ''}`}
      style={{ gridTemplateColumns: activeIframeUrl ? '1fr auto 380px' : '1fr 380px' }}
    >

      {/* ── LEFT: article ── */}
      <div className="reader-left">
        {article.headerImageUrl ? (
          <img className="reader-article-img" src={article.headerImageUrl} alt="" />
        ) : (
          <div className="reader-article-img" />
        )}

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

            {article.tags.length > 0 && (
              <div className="reader-tags-inline">
                {article.tags.join(' / ')}
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
            <span className="sidebar-label">00. TEXT SIZE</span>
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
            <span className="sidebar-label">01. TOPICS AND THEMES</span>
            <div className="tag-chip-list">
              <AnimatePresence>
                {article.tags.map((tag) => (
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
          <div className="sidebar-section">
            <div style={{ marginBottom: '12px' }}>
              <span className="sidebar-label" style={{ marginBottom: 0 }}>02. NOTES</span>
            </div>
            <textarea
              className="notes-textarea"
              placeholder="Your notes on this article…"
              value={article.notes}
              onChange={(e) => onUpdate({ ...article, notes: e.target.value })}
            />
          </div>

          {/* Highlights */}
          <div className="sidebar-section" style={{ flex: 1 }}>
            <div style={{ marginBottom: '12px' }}>
              <span className="sidebar-label" style={{ marginBottom: 0 }}>
                03. HIGHLIGHTS
                {article.highlights.length > 0 && ` (${article.highlights.length})`}
              </span>
            </div>

            {article.highlights.length === 0 ? (
              <p className="hl-empty-note">
                Select any text in the article to save a highlight.
              </p>
            ) : (
              <div className="hl-list">
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
