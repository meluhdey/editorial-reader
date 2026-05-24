import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, Search, Plus, Filter, BookOpen, Copy, PlusCircle, LayoutGrid, FileText, ChevronLeft, ChevronRight, X, Bold, Italic, Underline } from 'lucide-react';
import type { Article, NotebookNote, Highlight } from '../types';
import TurndownService from 'turndown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

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
  replacement: (content, node) => {
    return '\n\n' + (node as any).outerHTML.trim() + '\n\n';
  }
});

function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return turndownService.turndown(html);
}

function markdownToHtml(md: string): string {
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
  html = html.replace(/<!--EMBEDDED_INSIGHT_PLACEHOLDER_(\d+)-->/g, (match, index) => {
    return htmlBlocks[parseInt(index, 10)] || '';
  });

  return html;
}

function stripMarkdownAndHtml(text: string): string {
  if (!text) return '';
  // 1. Strip HTML tags
  let clean = text.replace(/<[^>]*>/g, '');
  // 2. Strip bold and italics markdown tags
  clean = clean.replace(/\*\*|__|[\*_~]/g, '');
  // 3. Normalize spacing/newlines
  clean = clean.replace(/\s+/g, ' ');
  return clean.trim();
}

interface NotebookProps {
  articles: Article[];
  notes: NotebookNote[];
  selectedNoteId: string | null;
  onSelectNote: (id: string | null) => void;
  onAddNote: (title?: string, content?: string) => void;
  onUpdateNote: (note: NotebookNote) => void;
  onDeleteNote: (id: string) => void;
  onOpenArticle: (id: string) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).toUpperCase();
}

export default function Notebook({
  articles,
  notes,
  selectedNoteId,
  onSelectNote,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onOpenArticle
}: NotebookProps) {
  const [subTab, setSubTab] = useState<'notes' | 'curator'>('notes');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Curator Filters
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedArticleIdFilter, setSelectedArticleIdFilter] = useState<string | null>(null);
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);

  // Side Curator Drawer inside Writer
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);

  // Drafts for active note title/content
  const activeNote = useMemo(() => notes.find(n => n.id === selectedNoteId), [notes, selectedNoteId]);
  const [titleDraft, setTitleDraft] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editorMode, setEditorMode] = useState<'edit' | 'preview'>('edit');
  const editorRef = useRef<HTMLDivElement>(null);

  // Update drafts when active note changes or editor mode changes
  useEffect(() => {
    if (activeNote) {
      setTitleDraft(activeNote.title);
      setIsEditingTitle(false);
      // Sync editorRef innerHTML only if the note ID has changed or if it's a different note in DOM
      if (editorRef.current) {
        if (editorRef.current.getAttribute('data-note-id') !== activeNote.id) {
          editorRef.current.innerHTML = markdownToHtml(activeNote.content || '');
          editorRef.current.setAttribute('data-note-id', activeNote.id);
        }
      }
    } else {
      setTitleDraft('');
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
        editorRef.current.removeAttribute('data-note-id');
      }
    }
  }, [selectedNoteId, activeNote?.id, editorMode]);

  const handleEditableInput = () => {
    if (editorRef.current && activeNote) {
      const html = editorRef.current.innerHTML;
      const markdown = htmlToMarkdown(html);
      onUpdateNote({
        ...activeNote,
        content: markdown,
        updatedAt: Date.now()
      });
    }
  };

  const saveTitle = () => {
    const trimmed = titleDraft.trim();
    if (activeNote && trimmed && trimmed !== activeNote.title) {
      onUpdateNote({
        ...activeNote,
        title: trimmed,
        updatedAt: Date.now()
      });
    } else if (activeNote) {
      setTitleDraft(activeNote.title);
    }
    setIsEditingTitle(false);
  };

  const applyFormatting = (formatType: 'bold' | 'italic' | 'underline') => {
    setEditorMode('edit');
    setTimeout(() => {
      if (!editorRef.current || !activeNote) return;
      editorRef.current.focus();
      document.execCommand(formatType, false);
      handleEditableInput();
    }, 20);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    handleEditableInput();
  };

  // Extract all unique highlights and notes across all articles
  const allInsights = useMemo(() => {
    const list: {
      articleId: string;
      articleTitle: string;
      articleTags: string[];
      articleUrl: string;
      savedAt: number;
      type: 'highlight' | 'note';
      id: string;
      text: string;
      comment?: string;
      color?: string;
      createdAt: number;
    }[] = [];

    articles.forEach(article => {
      // Add article note if it exists
      if (article.notes && article.notes.trim()) {
        list.push({
          articleId: article.id,
          articleTitle: article.title,
          articleTags: article.tags,
          articleUrl: article.url,
          savedAt: article.savedAt,
          type: 'note',
          id: `${article.id}-note`,
          text: article.notes,
          createdAt: article.savedAt
        });
      }

      // Add highlights
      article.highlights.forEach(hl => {
        list.push({
          articleId: article.id,
          articleTitle: article.title,
          articleTags: article.tags,
          articleUrl: article.url,
          savedAt: article.savedAt,
          type: 'highlight',
          id: hl.id,
          text: hl.text,
          comment: hl.comment,
          color: hl.color,
          createdAt: hl.createdAt
        });
      });
    });

    // Sort newest first
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, [articles]);

  // Extract all tags and article titles for filters
  const allTags = useMemo(() => {
    const set = new Set<string>();
    articles.forEach(a => a.tags?.forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [articles]);

  const allArticlesWithInsights = useMemo(() => {
    const map = new Map<string, string>();
    allInsights.forEach(ins => map.set(ins.articleId, ins.articleTitle));
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [allInsights]);

  // Filtered freeform notes
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const query = searchQuery.toLowerCase();
    return notes.filter(n => 
      n.title.toLowerCase().includes(query) || 
      n.content.toLowerCase().includes(query)
    );
  }, [notes, searchQuery]);

  // Filtered insights
  const filteredInsights = useMemo(() => {
    return allInsights.filter(ins => {
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesText = ins.text.toLowerCase().includes(query);
        const matchesTitle = ins.articleTitle.toLowerCase().includes(query);
        const matchesComment = ins.comment?.toLowerCase().includes(query) || false;
        if (!matchesText && !matchesTitle && !matchesComment) return false;
      }

      // Tag filter
      if (selectedTag && !ins.articleTags.includes(selectedTag)) return false;

      // Color filter
      if (selectedColor) {
        if (selectedColor === 'note' && ins.type !== 'note') return false;
        if (selectedColor !== 'note' && (ins.type !== 'highlight' || ins.color !== selectedColor)) return false;
      }

      // Article filter
      if (selectedArticleIdFilter && ins.articleId !== selectedArticleIdFilter) return false;

      return true;
    });
  }, [allInsights, searchQuery, selectedTag, selectedColor, selectedArticleIdFilter]);

  // Clipboard copy helper
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Curation injection helper
  const insertHTMLAtCursor = (html: string) => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) {
      if (editorRef.current) {
        editorRef.current.innerHTML += html;
        handleEditableInput();
      }
      return;
    }
    const range = selection.getRangeAt(0);
    if (editorRef.current && editorRef.current.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      const el = document.createElement('div');
      el.innerHTML = html;
      const frag = document.createDocumentFragment();
      let node, lastNode;
      while ((node = el.firstChild)) {
        lastNode = frag.appendChild(node);
      }
      range.insertNode(frag);
      if (lastNode) {
        const newRange = document.createRange();
        newRange.setStartAfter(lastNode);
        newRange.setEndAfter(lastNode);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
      handleEditableInput();
    } else if (editorRef.current) {
      editorRef.current.innerHTML += html;
      handleEditableInput();
    }
  };

  const injectInsightIntoNote = (insight: typeof allInsights[number]) => {
    if (!activeNote) return;

    setEditorMode('edit');

    const dateFormatted = formatDate(insight.createdAt);
    let html = '';

    if (insight.type === 'highlight') {
      const tagsList = insight.articleTags.length > 0 
        ? `<span class="embedded-tags">${insight.articleTags.map(t => '#' + t.toUpperCase()).join(' ')}</span>`
        : '';
      
      html = `
        <div class="embedded-insight ${insight.color || 'bold'}" contenteditable="false">
          <div class="embedded-insight-quote">"${insight.text}"</div>
          ${insight.comment && insight.comment.trim() ? `
            <div class="embedded-insight-comment">
              <span class="comment-label">ANNOTATION:</span>
              <p class="comment-text">${insight.comment}</p>
            </div>
          ` : ''}
          <div class="embedded-insight-meta">
            <span class="source-label">Source:</span>
            <span class="source-title">${insight.articleTitle}</span>
            <span class="meta-divider">|</span>
            <span class="meta-date">${dateFormatted}</span>
            ${tagsList}
          </div>
        </div>
        <p><br></p>
      `;
    } else {
      html = `
        <div class="embedded-insight bold" contenteditable="false">
          <div class="embedded-insight-quote"><strong>Summary Note:</strong> ${insight.text}</div>
          <div class="embedded-insight-meta">
            <span class="source-label">Source:</span>
            <span class="source-title">${insight.articleTitle}</span>
            <span class="meta-divider">|</span>
            <span class="meta-date">${dateFormatted}</span>
          </div>
        </div>
        <p><br></p>
      `;
    }

    // We defer to allow switching to edit mode if needed
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.focus();
        insertHTMLAtCursor(html);
      }
    }, 50);
  };

  const clearAllFilters = () => {
    setSelectedTag(null);
    setSelectedColor(null);
    setSelectedArticleIdFilter(null);
    setSearchQuery('');
  };

  return (
    <div className="notebook-layout">
      {/* ── LEFT SIDEBAR ── */}
      <div className="notebook-sidebar">
        <div className="notebook-sidebar-header">
          <span className="notebook-sidebar-title">00. WORKSPACE</span>
          <div className="notebook-sidebar-tabs">
            <button 
              className={`notebook-sidebar-tab ${subTab === 'notes' ? 'active' : ''}`}
              onClick={() => { setSubTab('notes'); setSearchQuery(''); }}
            >
              FREEFORM
            </button>
            <button 
              className={`notebook-sidebar-tab ${subTab === 'curator' ? 'active' : ''}`}
              onClick={() => { setSubTab('curator'); setSearchQuery(''); }}
            >
              INSIGHTS ({allInsights.length})
            </button>
          </div>

          <div className="notebook-search-row">
            <div className="notebook-search-input-wrap">
              <Search className="notebook-search-icon" size={13} />
              <input
                className="notebook-search-input"
                placeholder={subTab === 'notes' ? 'Search notes…' : 'Search insights…'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="notebook-search-clear" onClick={() => setSearchQuery('')}>×</button>
              )}
            </div>
          </div>
        </div>

        <div className="notebook-sidebar-list">
          {subTab === 'notes' ? (
            <>
              {/* Note creator button */}
              <button 
                className="notebook-create-btn"
                onClick={() => onAddNote()}
              >
                <Plus size={14} style={{ marginRight: '6px' }} />
                CREATE NEW NOTE
              </button>

              <div className="notebook-notes-list">
                {filteredNotes.length === 0 ? (
                  <div className="notebook-list-empty">
                    {searchQuery ? 'NO NOTES MATCH QUERY' : 'NO FREEFORM NOTES SAVED'}
                  </div>
                ) : (
                  filteredNotes.map(note => {
                    const isActive = note.id === selectedNoteId;
                    const cleanPreview = stripMarkdownAndHtml(note.content);
                    const previewText = cleanPreview.slice(0, 80) + (cleanPreview.length > 80 ? '…' : '') || 'Empty note…';
                    return (
                      <div 
                        key={note.id}
                        className={`notebook-note-card ${isActive ? 'active' : ''}`}
                        onClick={() => onSelectNote(note.id)}
                      >
                        <h4 className="notebook-note-card-title">
                          {note.title.toUpperCase()}
                        </h4>
                        <p className="notebook-note-card-snippet">"{previewText}"</p>
                        <span className="notebook-note-card-date">{formatDate(note.updatedAt)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            /* Insights quick selector list */
            <div className="notebook-insights-summary-list">
              <div 
                className={`notebook-insight-summary-card ${!selectedArticleIdFilter && !selectedTag && !selectedColor ? 'active' : ''}`}
                onClick={clearAllFilters}
              >
                <LayoutGrid size={13} style={{ marginRight: '8px' }} />
                <span>ALL INSIGHTS ({allInsights.length})</span>
              </div>

              <div className="notebook-sidebar-group-title">ARTICLES</div>
              {allArticlesWithInsights.map(art => {
                const count = allInsights.filter(i => i.articleId === art.id).length;
                const isActive = selectedArticleIdFilter === art.id;
                return (
                  <div 
                    key={art.id}
                    className={`notebook-insight-summary-card ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedArticleIdFilter(isActive ? null : art.id);
                      onSelectNote(null); // Deselect freeform note to see curation panel
                    }}
                  >
                    <BookOpen size={12} style={{ marginRight: '8px', flexShrink: 0 }} />
                    <span className="truncate">{art.title.toUpperCase()}</span>
                    <span className="count-badge">{count}</span>
                  </div>
                );
              })}

              {allTags.length > 0 && (
                <>
                  <div className="notebook-sidebar-group-title">TOPICS</div>
                  {allTags.map(tag => {
                    const count = allInsights.filter(i => i.articleTags.includes(tag)).length;
                    const isActive = selectedTag === tag;
                    return (
                      <div 
                        key={tag}
                        className={`notebook-insight-summary-card ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedTag(isActive ? null : tag);
                          onSelectNote(null); // Deselect note
                        }}
                      >
                        <span style={{ marginRight: '8px', fontFamily: 'var(--mono)', fontSize: '10px' }}>#</span>
                        <span className="truncate">{tag.toUpperCase()}</span>
                        <span className="count-badge">{count}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT MAIN PANEL ── */}
      <div className="notebook-main">
        <AnimatePresence mode="wait">
          {activeNote ? (
            /* ========================================================================= */
            /* ✍️ ACTIVE NOTE WRITING ENVIRONMENT                                         */
            /* ========================================================================= */
            <motion.div 
              key={`writer-${activeNote.id}`}
              className="notebook-writer-workspace"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="notebook-writer-body">
                {/* Editor Top Bar */}
                <div className="notebook-writer-header">
                  <div className="notebook-writer-header-left">
                    <button className="notebook-back-btn" onClick={() => onSelectNote(null)}>
                      <ChevronLeft size={16} />
                      DASHBOARD
                    </button>
                    <span className="notebook-writer-date">
                      CREATED {formatDate(activeNote.createdAt)} | UPDATED {formatDate(activeNote.updatedAt)}
                    </span>
                  </div>

                  <div className="notebook-writer-actions">
                    <button 
                      className={`btn-curator-toggle ${isDrawerOpen ? 'active' : ''}`}
                      onClick={() => setIsDrawerOpen(prev => !prev)}
                      title="Toggle Curation Drawer"
                    >
                      {isDrawerOpen ? 'HIDE INSIGHTS ➔' : '✦ CURATION DRAWER'}
                    </button>
                    <button 
                      className="notebook-delete-btn"
                      onClick={() => {
                        if (confirm('Delete this note permanently?')) {
                          onDeleteNote(activeNote.id);
                        }
                      }}
                    >
                      <Trash2 size={13} style={{ marginRight: '4px' }} />
                      DELETE
                    </button>
                  </div>
                </div>

                {/* Main Text Area */}
                <div className="notebook-editor-container">
                  <h1 className="notebook-editor-title">
                    {isEditingTitle ? (
                      <input
                        className="notebook-editor-title-input"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setTitleDraft(activeNote.title); setIsEditingTitle(false); } }}
                        autoFocus
                      />
                    ) : (
                      <span 
                        className="notebook-editor-title-span"
                        onClick={() => setIsEditingTitle(true)}
                      >
                        {titleDraft || 'UNTITLED NOTE'}
                      </span>
                    )}
                  </h1>

                  {/* Formatting Toolbar */}
                  <div className="notebook-editor-toolbar">
                    <div className="toolbar-left">
                      <button className="toolbar-btn" onClick={() => applyFormatting('bold')} title="Bold (Cmd+B)">
                        <Bold size={14} />
                      </button>
                      <button className="toolbar-btn" onClick={() => applyFormatting('italic')} title="Italic (Cmd+I)">
                        <Italic size={14} />
                      </button>
                      <button className="toolbar-btn" onClick={() => applyFormatting('underline')} title="Underline (Cmd+U)">
                        <Underline size={14} />
                      </button>
                    </div>
                    <div className="toolbar-right">
                      <button 
                        className={`toolbar-mode-btn ${editorMode === 'edit' ? 'active' : ''}`}
                        onClick={() => setEditorMode('edit')}
                      >
                        EDIT
                      </button>
                      <button 
                        className={`toolbar-mode-btn ${editorMode === 'preview' ? 'active' : ''}`}
                        onClick={() => setEditorMode('preview')}
                      >
                        PREVIEW
                      </button>
                    </div>
                  </div>

                  {editorMode === 'edit' ? (
                    <div
                      ref={editorRef}
                      contentEditable={true}
                      className="notebook-editor-editable"
                      placeholder="Weave your thoughts and insights here. Bold, italics, and underline supported..."
                      onInput={handleEditableInput}
                      onPaste={handlePaste}
                      suppressContentEditableWarning
                    />
                  ) : (
                    <div className="notebook-editor-editable preview-mode">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                        {activeNote.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>

              {/* 📖 Curator Drawer Inside Note Writer */}
              {isDrawerOpen && (
                <div className="notebook-curator-drawer">
                  <div className="drawer-header">
                    <span className="drawer-title">✦ INSIGHTS DOCK</span>
                    <button className="drawer-close" onClick={() => setIsDrawerOpen(false)}>
                      <X size={14} />
                    </button>
                  </div>

                  <div className="drawer-filters">
                    <input
                      className="drawer-search"
                      placeholder="Filter quotes…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button className="drawer-search-clear" onClick={() => setSearchQuery('')}>×</button>
                    )}
                  </div>

                  <div className="drawer-insights-list">
                    {filteredInsights.length === 0 ? (
                      <div className="drawer-empty-state">
                        NO ANNOTATIONS MATCH QUERY
                      </div>
                    ) : (
                      filteredInsights.map(ins => (
                        <div key={ins.id} className="drawer-insight-card">
                          <div className={`drawer-insight-bar ${ins.color || 'bold'}`} />
                          
                          <div className="drawer-insight-body">
                            <p className="drawer-insight-quote">"{ins.text}"</p>
                            {ins.comment && (
                              <p className="drawer-insight-comment">
                                <em>Annotation:</em> {ins.comment}
                              </p>
                            )}
                            <div className="drawer-insight-meta">
                              <span className="truncate">{ins.articleTitle.toUpperCase()}</span>
                            </div>
                          </div>

                          <div className="drawer-insight-actions">
                            <button 
                              className="drawer-inject-btn"
                              onClick={() => injectInsightIntoNote(ins)}
                              title="Embed into note as blockquote"
                            >
                              ✦ EMBED
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            /* ========================================================================= */
            /* 📊 CURATION & KNOWLEDGE DASHBOARD                                         */
            /* ========================================================================= */
            <motion.div 
              key="dashboard"
              className="notebook-dashboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Dashboard Header */}
              <div className="notebook-dashboard-header">
                <div className="notebook-dashboard-title-wrap">
                  <h1 className="notebook-dashboard-title">Insights Curator</h1>
                </div>

                <div className="notebook-dashboard-actions">
                  <button 
                    className="notebook-dashboard-create-btn"
                    onClick={() => onAddNote()}
                  >
                    <Plus size={14} style={{ marginRight: '6px' }} />
                    NEW NOTE
                  </button>
                  <button 
                    className={`notebook-filter-toggle-btn ${showFiltersPanel ? 'active' : ''}`}
                    onClick={() => setShowFiltersPanel(p => !p)}
                  >
                    <Filter size={13} style={{ marginRight: '6px' }} />
                    FILTERS {showFiltersPanel ? '▴' : '▾'}
                  </button>
                </div>
              </div>

              {/* Filters Drawer */}
              <AnimatePresence>
                {showFiltersPanel && (
                  <motion.div 
                    className="notebook-dashboard-filters"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="filter-row">
                      <span className="filter-label">Article Source:</span>
                      <div className="filter-pills">
                        <button 
                          className={`filter-pill ${!selectedArticleIdFilter ? 'active' : ''}`}
                          onClick={() => setSelectedArticleIdFilter(null)}
                        >
                          ALL
                        </button>
                        {allArticlesWithInsights.map(art => (
                          <button
                            key={art.id}
                            className={`filter-pill ${selectedArticleIdFilter === art.id ? 'active' : ''}`}
                            onClick={() => setSelectedArticleIdFilter(art.id)}
                          >
                            {art.title.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="filter-row">
                      <span className="filter-label">Topic Theme:</span>
                      <div className="filter-pills">
                        <button 
                          className={`filter-pill ${!selectedTag ? 'active' : ''}`}
                          onClick={() => setSelectedTag(null)}
                        >
                          ALL
                        </button>
                        {allTags.map(tag => (
                          <button
                            key={tag}
                            className={`filter-pill ${selectedTag === tag ? 'active' : ''}`}
                            onClick={() => setSelectedTag(tag)}
                          >
                            #{tag.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="filter-row">
                      <span className="filter-label">Insight Type:</span>
                      <div className="filter-pills">
                        <button 
                          className={`filter-pill ${!selectedColor ? 'active' : ''}`}
                          onClick={() => setSelectedColor(null)}
                        >
                          ALL
                        </button>
                        <button 
                          className={`filter-pill ${selectedColor === 'note' ? 'active' : ''}`}
                          onClick={() => setSelectedColor('note')}
                        >
                          ARTICLE NOTES
                        </button>
                        <button 
                          className={`filter-pill ${selectedColor === 'yellow' ? 'active' : ''}`}
                          onClick={() => setSelectedColor('yellow')}
                        >
                          YELLOW HIGHLIGHTS
                        </button>
                        <button 
                          className={`filter-pill ${selectedColor === 'blue' ? 'active' : ''}`}
                          onClick={() => setSelectedColor('blue')}
                        >
                          BLUE HIGHLIGHTS
                        </button>
                        <button 
                          className={`filter-pill ${selectedColor === 'green' ? 'active' : ''}`}
                          onClick={() => setSelectedColor('green')}
                        >
                          GREEN HIGHLIGHTS
                        </button>
                        <button 
                          className={`filter-pill ${selectedColor === 'purple' ? 'active' : ''}`}
                          onClick={() => setSelectedColor('purple')}
                        >
                          PURPLE HIGHLIGHTS
                        </button>
                        <button 
                          className={`filter-pill ${selectedColor === 'orange' ? 'active' : ''}`}
                          onClick={() => setSelectedColor('orange')}
                        >
                          ORANGE HIGHLIGHTS
                        </button>
                      </div>
                    </div>

                    {(selectedArticleIdFilter || selectedTag || selectedColor || searchQuery) && (
                      <div className="filter-row" style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', marginTop: '6px' }}>
                        <button className="clear-all-filters-btn" onClick={clearAllFilters}>
                          RESET ALL FILTERS
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Insights Grid Dashboard */}
              <div className="notebook-dashboard-grid">
                {filteredInsights.length === 0 ? (
                  <div className="notebook-dashboard-empty">
                    <FileText size={20} style={{ color: 'var(--border)', marginBottom: '12px' }} />
                    <h3>NO OBSERVATIONS FOUND</h3>
                    <p>Highlight text in articles or write notes to build your knowledge stream.</p>
                  </div>
                ) : (
                  filteredInsights.map((ins, i) => (
                    <motion.div 
                      key={ins.id}
                      className="insight-curation-card"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.02, 0.3) } }}
                    >
                      <div className={`insight-card-bar ${ins.color || 'bold'}`} />
                      
                      <div className="insight-card-header">
                        <span className="insight-card-type">
                          {ins.type === 'note' ? 'ARTICLE SUMMARY NOTE' : `${ins.color?.toUpperCase()} HIGHLIGHT Selection`}
                        </span>
                        <span className="insight-card-date">{formatDate(ins.createdAt)}</span>
                      </div>

                      <div className="insight-card-body">
                        <p className="insight-card-text">
                          {ins.type === 'note' ? ins.text : `"${ins.text}"`}
                        </p>
                        {ins.comment && (
                          <div className="insight-card-annotation">
                            <span className="annotation-label">YOUR REFLECTION:</span>
                            <p className="annotation-text">{ins.comment}</p>
                          </div>
                        )}
                      </div>

                      <div className="insight-card-footer">
                        <div className="insight-card-source-info" onClick={() => onOpenArticle(ins.articleId)}>
                          <span className="source-label">Source:</span>
                          <span className="source-title truncate">{ins.articleTitle}</span>
                        </div>

                        <div className="insight-card-actions">
                          <button 
                            className="insight-action-btn"
                            onClick={() => {
                              copyToClipboard(ins.text);
                              alert('Copied insight to clipboard!');
                            }}
                            title="Copy to Clipboard"
                          >
                            <Copy size={12} />
                          </button>
                          
                          {notes.length > 0 && (
                            <button 
                              className="insight-action-btn append-btn"
                              onClick={() => {
                                // Default append to the first note (newest note)
                                const activeTarget = notes[0];
                                onSelectNote(activeTarget.id);
                                setTimeout(() => {
                                  injectInsightIntoNote(ins);
                                }, 300);
                              }}
                              title={`Append to note: "${notes[0].title.toUpperCase()}"`}
                            >
                              <PlusCircle size={12} style={{ marginRight: '4px' }} />
                              APPEND
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
