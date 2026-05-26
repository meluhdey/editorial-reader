import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Article, AppState, NotebookNote } from './types';
import Navbar from './components/Navbar';
import Library from './components/Library';
import Reader from './components/Reader';
import IndexGraph from './components/IndexGraph';
import Spotlight from './components/Spotlight';
import Notebook from './components/Notebook';
import AccountDrawer from './components/AccountDrawer';
import Auth from './components/Auth';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { Cloud, Loader2 } from 'lucide-react';

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

function getLocalGuestData(): { articles: Article[]; notes: NotebookNote[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      return {
        articles: parsed.articles || [],
        notes: parsed.notebookNotes || []
      };
    }
  } catch {}
  return { articles: [], notes: [] };
}

const pageVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

export default function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  // Authentication states
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [localGuestBypassed, setLocalGuestBypassed] = useState(false);
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [guestDataToImport, setGuestDataToImport] = useState<{ articles: Article[]; notes: NotebookNote[] } | null>(null);
  const [importing, setImporting] = useState(false);

  // Initialize Supabase Auth Session
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const activeUser = session?.user ?? null;
      setUser(activeUser);
      if (activeUser) {
        fetchCloudData(activeUser);
      }
    });

    // Listen to changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const activeUser = session?.user ?? null;
      setUser(activeUser);
      if (activeUser) {
        fetchCloudData(activeUser);
      } else {
        // Logged out: reset back to local storage guest state
        setState(loadState());
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch all notes and articles from Supabase when logged in
  const fetchCloudData = async (activeUser: SupabaseUser) => {
    setLoadingCloud(true);
    try {
      const [articlesRes, notesRes] = await Promise.all([
        supabase.from('articles').select('*').order('saved_at', { ascending: false }),
        supabase.from('notebook_notes').select('*').order('created_at', { ascending: false })
      ]);

      if (articlesRes.error) throw articlesRes.error;
      if (notesRes.error) throw notesRes.error;

      const loadedArticles = (articlesRes.data || []).map((row) => ({
        id: row.id,
        title: row.title,
        author: row.author || undefined,
        content: row.content,
        url: row.url,
        tags: Array.isArray(row.tags) ? row.tags : JSON.parse(row.tags || '[]'),
        headerImageUrl: row.header_image_url || '',
        highlights: Array.isArray(row.highlights) ? row.highlights : JSON.parse(row.highlights || '[]'),
        notes: row.notes || '',
        savedAt: Number(row.saved_at)
      })) as Article[];

      const loadedNotes = (notesRes.data || []).map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at)
      })) as NotebookNote[];

      setState((s) => ({
        ...s,
        articles: loadedArticles,
        notebookNotes: loadedNotes
      }));

      // Check if there is guest storage data to import
      const guestData = getLocalGuestData();
      if (guestData.articles.length > 0 || guestData.notes.length > 0) {
        setGuestDataToImport(guestData);
      }
    } catch (err) {
      console.error('[Supabase Fetch Error]', err);
    } finally {
      setLoadingCloud(false);
    }
  };

  // Perform Local Storage data migration to the Cloud
  const handleImportGuestData = async () => {
    if (!user || !guestDataToImport) return;
    setImporting(true);

    try {
      const { articles, notes } = guestDataToImport;

      // Import Guest Articles
      if (articles.length > 0) {
        const rows = articles.map((a) => ({
          id: a.id,
          user_id: user.id,
          title: a.title,
          author: a.author || null,
          content: a.content,
          url: a.url,
          tags: a.tags,
          header_image_url: a.headerImageUrl || null,
          highlights: a.highlights,
          notes: a.notes || '',
          saved_at: a.savedAt
        }));

        const { error } = await supabase.from('articles').upsert(rows);
        if (error) throw error;
      }

      // Import Guest Notebook Notes
      if (notes.length > 0) {
        const rows = notes.map((n) => ({
          id: n.id,
          user_id: user.id,
          title: n.title,
          content: n.content,
          created_at: n.createdAt,
          updated_at: n.updatedAt
        }));

        const { error } = await supabase.from('notebook_notes').upsert(rows);
        if (error) throw error;
      }

      // Clean local storage so they are not prompted again
      localStorage.removeItem(STORAGE_KEY);
      setGuestDataToImport(null);

      // Refresh cloud lists
      await fetchCloudData(user);
    } catch (err) {
      console.error('[Import Error]', err);
    } finally {
      setImporting(false);
    }
  };

  // Save guest state to LocalStorage only if running in Guest Mode (user === null)
  useEffect(() => {
    if (!user) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {}
    }
  }, [state, user]);

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

  const addArticle = async (article: Article) => {
    setState((s) => ({ ...s, articles: [article, ...s.articles] }));

    if (user && isSupabaseConfigured()) {
      try {
        await supabase.from('articles').insert({
          id: article.id,
          title: article.title,
          author: article.author || null,
          content: article.content,
          url: article.url,
          tags: article.tags,
          header_image_url: article.headerImageUrl || null,
          highlights: article.highlights,
          notes: article.notes,
          saved_at: article.savedAt
        });
      } catch (err) {
        console.error(err);
      }
    }
  };

  const updateArticle = async (updated: Article) => {
    setState((s) => ({
      ...s,
      articles: s.articles.map((a) => (a.id === updated.id ? updated : a)),
    }));

    if (user && isSupabaseConfigured()) {
      try {
        await supabase.from('articles').update({
          title: updated.title,
          author: updated.author || null,
          content: updated.content,
          url: updated.url,
          tags: updated.tags,
          header_image_url: updated.headerImageUrl || null,
          highlights: updated.highlights,
          notes: updated.notes,
          saved_at: updated.savedAt
        }).eq('id', updated.id);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const deleteArticle = async (id: string) => {
    setState((s) => ({
      ...s,
      articles: s.articles.filter((a) => a.id !== id),
      currentView: 'library',
      selectedArticleId: null,
    }));

    if (user && isSupabaseConfigured()) {
      try {
        await supabase.from('articles').delete().eq('id', id);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleSaveUrl = async (url: string) => {
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

    if (user && isSupabaseConfigured()) {
      try {
        await supabase.from('articles').insert({
          id: newArticle.id,
          title: newArticle.title,
          author: newArticle.author || null,
          content: newArticle.content,
          url: newArticle.url,
          tags: newArticle.tags,
          header_image_url: newArticle.headerImageUrl || null,
          highlights: newArticle.highlights,
          notes: newArticle.notes,
          saved_at: newArticle.savedAt
        });
      } catch (err) {
        console.error(err);
      }
    }
  };

  const addNotebookNote = async (title?: string, content?: string) => {
    const newNote: NotebookNote = {
      id: crypto.randomUUID(),
      title: title || 'Untitled note',
      content: content || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setState((s) => ({
      ...s,
      notebookNotes: [newNote, ...(s.notebookNotes || [])],
      selectedNotebookNoteId: newNote.id,
    }));

    if (user && isSupabaseConfigured()) {
      try {
        await supabase.from('notebook_notes').insert({
          id: newNote.id,
          title: newNote.title,
          content: newNote.content,
          created_at: newNote.createdAt,
          updated_at: newNote.updatedAt
        });
      } catch (err) {
        console.error(err);
      }
    }
  };

  const updateNotebookNote = async (updated: NotebookNote) => {
    setState((s) => ({
      ...s,
      notebookNotes: (s.notebookNotes || []).map((n) => (n.id === updated.id ? updated : n)),
    }));

    if (user && isSupabaseConfigured()) {
      try {
        await supabase.from('notebook_notes').update({
          title: updated.title,
          content: updated.content,
          updated_at: updated.updatedAt
        }).eq('id', updated.id);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const deleteNotebookNote = async (id: string) => {
    setState((s) => {
      const nextNotes = (s.notebookNotes || []).filter((n) => n.id !== id);
      const nextSelected = s.selectedNotebookNoteId === id ? (nextNotes[0]?.id || null) : s.selectedNotebookNoteId;
      return {
        ...s,
        notebookNotes: nextNotes,
        selectedNotebookNoteId: nextSelected,
      };
    });

    if (user && isSupabaseConfigured()) {
      try {
        await supabase.from('notebook_notes').delete().eq('id', id);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleLogout = async () => {
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setLocalGuestBypassed(false);
    setAccountOpen(false);
  };

  const handleSpotlightOpen = (id: string) => {
    navigate('reader', id);
  };

  const selectedArticle = state.articles.find((a) => a.id === state.selectedArticleId);

  if (!user && !localGuestBypassed) {
    return (
      <div className="auth-gate-wrapper">
        <Auth
          onSuccess={() => {}}
          onGuestBypass={!isSupabaseConfigured() ? () => setLocalGuestBypassed(true) : undefined}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <Navbar
        currentView={state.currentView}
        selectedArticleId={state.selectedArticleId}
        openArticles={state.openArticleIds.map(id => state.articles.find(a => a.id === id)).filter(Boolean) as Article[]}
        onNavigate={navigate}
        onCloseArticle={closeArticle}
        onOpenSpotlight={() => setSpotlightOpen(true)}
        user={user}
        onOpenAccount={() => setAccountOpen(true)}
      />

      <Spotlight
        open={spotlightOpen}
        onClose={() => setSpotlightOpen(false)}
        onAdd={addArticle}
        onOpen={handleSpotlightOpen}
      />

      {/* Account Drawer Panel */}
      <AnimatePresence>
        {accountOpen && (
          <AccountDrawer
            isOpen={accountOpen}
            onClose={() => setAccountOpen(false)}
            user={user}
            onLogout={handleLogout}
            onLoginSuccess={() => {
              // Successfully authenticated, session listener handles fetch
              setAccountOpen(false);
            }}
            articleCount={state.articles.length}
            noteCount={state.notebookNotes?.length || 0}
          />
        )}
      </AnimatePresence>

      {/* Guest Data Import Prompter */}
      {guestDataToImport && user && (
        <div className="modal-backdrop">
          <div className="guest-import-modal">
            <Cloud size={36} className="modal-cloud-icon" />
            <h2>SYNC GUEST LIBRARY</h2>
            <p>
              We detected <strong>{guestDataToImport.articles.length} articles</strong> and{' '}
              <strong>{guestDataToImport.notes.length} notebook notes</strong> saved locally on this browser.
              Would you like to import them to your secure cloud account?
            </p>
            <div className="modal-actions">
              <button className="drawer-primary-btn" onClick={handleImportGuestData} disabled={importing}>
                {importing ? 'SYNCING LIBRARY...' : 'YES, SYNC TO CLOUD'}
              </button>
              <button 
                className="drawer-secondary-btn" 
                onClick={() => {
                  // Ignore and clear
                  localStorage.removeItem(STORAGE_KEY);
                  setGuestDataToImport(null);
                }} 
                disabled={importing}
              >
                DISCARD LOCAL GUEST DATA
              </button>
            </div>
          </div>
        </div>
      )}

      {loadingCloud && (
        <div className="cloud-loading-indicator" title="Synchronizing with Cloud Database...">
          <Loader2 className="animate-spin" size={12} />
          <span>SYNCING CLOUD...</span>
        </div>
      )}

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
