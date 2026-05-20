import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Article, AppState, NotebookNote } from './types';
import Navbar from './components/Navbar';
import Library from './components/Library';
import Reader from './components/Reader';
import IndexGraph from './components/IndexGraph';
import Spotlight from './components/Spotlight';
import Notebook from './components/Notebook';

const STORAGE_KEY = 'editorial-reader-v1';

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (!parsed.openArticleIds) parsed.openArticleIds = [];
      if (!parsed.notebookNotes) parsed.notebookNotes = [];
      if (parsed.selectedNotebookNoteId === undefined) parsed.selectedNotebookNoteId = null;
      return parsed;
    }
  } catch {}
  return { 
    articles: [], 
    currentView: 'library', 
    selectedArticleId: null, 
    openArticleIds: [],
    notebookNotes: [],
    selectedNotebookNoteId: null
  };
}

const pageVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

export default function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [spotlightOpen, setSpotlightOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  // ⌘K / Ctrl+K opens spotlight
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSpotlightOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const navigate = (view: AppState['currentView'], articleId?: string) => {
    setState((s) => {
      let nextOpen = s.openArticleIds;
      if (view === 'reader' && articleId && !s.openArticleIds.includes(articleId)) {
        nextOpen = [...s.openArticleIds, articleId];
      }
      return {
        ...s,
        currentView: view,
        selectedArticleId: articleId ?? s.selectedArticleId,
        openArticleIds: nextOpen,
      };
    });
  };

  const closeArticle = (id: string) => {
    setState((s) => {
      const nextOpen = s.openArticleIds.filter((x) => x !== id);
      if (s.selectedArticleId === id) {
        const fallbackId = nextOpen.length > 0 ? nextOpen[nextOpen.length - 1] : null;
        return {
          ...s,
          openArticleIds: nextOpen,
          selectedArticleId: fallbackId,
          currentView: fallbackId ? 'reader' : 'library',
        };
      }
      return { ...s, openArticleIds: nextOpen };
    });
  };

  const addArticle = (article: Article) => {
    setState((s) => ({ ...s, articles: [article, ...s.articles] }));
  };

  const updateArticle = (updated: Article) => {
    setState((s) => ({
      ...s,
      articles: s.articles.map((a) => (a.id === updated.id ? updated : a)),
    }));
  };

  const deleteArticle = (id: string) => {
    setState((s) => ({
      ...s,
      articles: s.articles.filter((a) => a.id !== id),
      currentView: 'library',
      selectedArticleId: null,
    }));
  };

  const handleSaveUrl = async (url: string) => {
    // Check if an article with the same URL is already present in state
    const existing = state.articles.find((a) => a.url === url);
    if (existing) {
      navigate('reader', existing.id);
      return;
    }

    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status} — failed to scrape`);
    }

    const newArticle = await res.json() as Article;

    setState((s) => {
      const exists = s.articles.some((a) => a.url === newArticle.url);
      const nextArticles = exists ? s.articles : [newArticle, ...s.articles];
      
      const targetArticle = s.articles.find((a) => a.url === newArticle.url) || newArticle;

      let nextOpen = s.openArticleIds;
      if (!s.openArticleIds.includes(targetArticle.id)) {
        nextOpen = [...s.openArticleIds, targetArticle.id];
      }

      return {
        ...s,
        articles: nextArticles,
        currentView: 'reader',
        selectedArticleId: targetArticle.id,
        openArticleIds: nextOpen,
      };
    });
  };

  const addNotebookNote = (title?: string, content?: string) => {
    setState((s) => {
      const newNote: NotebookNote = {
        id: crypto.randomUUID(),
        title: title || 'UNTITLED NOTE',
        content: content || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return {
        ...s,
        notebookNotes: [newNote, ...(s.notebookNotes || [])],
        selectedNotebookNoteId: newNote.id,
      };
    });
  };

  const updateNotebookNote = (updated: NotebookNote) => {
    setState((s) => ({
      ...s,
      notebookNotes: (s.notebookNotes || []).map((n) => (n.id === updated.id ? updated : n)),
    }));
  };

  const deleteNotebookNote = (id: string) => {
    setState((s) => {
      const nextNotes = (s.notebookNotes || []).filter((n) => n.id !== id);
      const nextSelected = s.selectedNotebookNoteId === id ? (nextNotes[0]?.id || null) : s.selectedNotebookNoteId;
      return {
        ...s,
        notebookNotes: nextNotes,
        selectedNotebookNoteId: nextSelected,
      };
    });
  };

  const handleSpotlightOpen = (id: string) => {
    navigate('reader', id);
  };

  const selectedArticle = state.articles.find((a) => a.id === state.selectedArticleId);

  return (
    <div className="app">
      <Navbar
        currentView={state.currentView}
        selectedArticleId={state.selectedArticleId}
        openArticles={state.openArticleIds.map(id => state.articles.find(a => a.id === id)).filter(Boolean) as Article[]}
        onNavigate={navigate}
        onCloseArticle={closeArticle}
        onOpenSpotlight={() => setSpotlightOpen(true)}
      />

      <Spotlight
        open={spotlightOpen}
        onClose={() => setSpotlightOpen(false)}
        onAdd={addArticle}
        onOpen={handleSpotlightOpen}
      />

      <div className="main-content">
        <AnimatePresence mode="wait">
          {state.currentView === 'library' && (
            <motion.div key="library" {...pageVariants} style={{ height: '100%', overflow: 'auto' }}>
              <Library
                articles={state.articles}
                onAdd={addArticle}
                onSelect={(id) => navigate('reader', id)}
                onDelete={deleteArticle}
              />
            </motion.div>
          )}

          {state.currentView === 'reader' && selectedArticle && (
            <motion.div key="reader" {...pageVariants} style={{ height: '100%' }}>
              <Reader
                article={selectedArticle}
                onUpdate={updateArticle}
                onBack={() => navigate('library')}
                onDelete={(id) => deleteArticle(id)}
                onSaveUrl={handleSaveUrl}
              />
            </motion.div>
          )}

          {state.currentView === 'graph' && (
            <motion.div key="graph" className="app-main" {...pageVariants} style={{ height: '100%' }}>
              <IndexGraph
                articles={state.articles}
                onSelect={(id) => navigate('reader', id)}
              />
            </motion.div>
          )}

          {state.currentView === 'notebook' && (
            <motion.div key="notebook" className="app-main" {...pageVariants} style={{ height: '100%' }}>
              <Notebook
                articles={state.articles}
                notes={state.notebookNotes || []}
                selectedNoteId={state.selectedNotebookNoteId || null}
                onSelectNote={(id) => setState((s) => ({ ...s, selectedNotebookNoteId: id }))}
                onAddNote={addNotebookNote}
                onUpdateNote={updateNotebookNote}
                onDeleteNote={deleteNotebookNote}
                onOpenArticle={(id) => navigate('reader', id)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

