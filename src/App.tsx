import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Article, AppState } from './types';
import Navbar from './components/Navbar';
import Library from './components/Library';
import Reader from './components/Reader';
import IndexGraph from './components/IndexGraph';
import Spotlight from './components/Spotlight';

const STORAGE_KEY = 'editorial-reader-v1';

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (!parsed.openArticleIds) parsed.openArticleIds = [];
      return parsed;
    }
  } catch {}
  return { articles: [], currentView: 'library', selectedArticleId: null, openArticleIds: [] };
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
        </AnimatePresence>
      </div>
    </div>
  );
}
