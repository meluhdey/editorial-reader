import type { View, Article } from '../types';
import { Network, Library as LibraryIcon, NotebookPen, BookMarked, Newspaper, Plus, CircleUser } from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';

interface NavbarProps {
  currentView: View;
  selectedArticleId: string | null;
  openArticles: Article[];
  onNavigate: (view: View, articleId?: string) => void;
  onCloseArticle: (id: string) => void;
  onOpenSpotlight: () => void;
  user: SupabaseUser | null;
  onOpenAccount: () => void;
}

export default function Navbar({
  currentView,
  selectedArticleId,
  openArticles,
  onNavigate,
  onCloseArticle,
  onOpenSpotlight,
  user,
  onOpenAccount,
}: NavbarProps) {
  let logoText = "MELODY'S FOOTNOTES";
  if (user) {
    const firstName = user.user_metadata?.first_name;
    if (firstName) {
      logoText = `${firstName.trim().toUpperCase()}'S FOOTNOTES`;
    } else if (user.email) {
      const emailPrefix = user.email.split('@')[0].toUpperCase();
      logoText = `${emailPrefix.substring(0, 12)}'S FOOTNOTES`;
    } else {
      logoText = "YOUR FOOTNOTES";
    }
  } else {
    logoText = "MELODY'S FOOTNOTES";
  }

  return (
    <nav className="navbar">
      <button
        className="navbar-logo-container"
        onClick={onOpenAccount}
        title="Account Profile"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        <span className="navbar-logo-text">{logoText}</span>
        <span className="navbar-mobile-item" aria-hidden="true">
          <CircleUser size={19} strokeWidth={1.5} />
          <span>Account</span>
        </span>
      </button>

      <button
        className={`navbar-tab-vertical navbar-main-tab ${currentView === 'graph' ? 'active' : ''}`}
        aria-label="Index"
        onClick={() => onNavigate('graph')}
      >
        <span className="navbar-tab-text">INDEX</span>
        <span className="navbar-mobile-item" aria-hidden="true">
          <Network size={19} strokeWidth={1.5} />
          <span>Index</span>
        </span>
      </button>

      <button
        className={`navbar-tab-vertical navbar-main-tab ${currentView === 'library' ? 'active' : ''}`}
        aria-label="Library"
        onClick={() => onNavigate('library')}
      >
        <span className="navbar-tab-text">LIBRARY</span>
        <span className="navbar-mobile-item" aria-hidden="true">
          <LibraryIcon size={19} strokeWidth={1.5} />
          <span>Library</span>
        </span>
      </button>

      <button
        className={`navbar-tab-vertical navbar-main-tab ${currentView === 'notebook' ? 'active' : ''}`}
        aria-label="Notebook"
        onClick={() => onNavigate('notebook')}
      >
        <span className="navbar-tab-text">NOTEBOOK</span>
        <span className="navbar-mobile-item" aria-hidden="true">
          <NotebookPen size={19} strokeWidth={1.5} />
          <span>Notes</span>
        </span>
      </button>

      <button
        className={`navbar-tab-vertical navbar-main-tab ${currentView === 'books' ? 'active' : ''}`}
        aria-label="Books"
        onClick={() => onNavigate('books')}
      >
        <span className="navbar-tab-text">BOOKS</span>
        <span className="navbar-mobile-item" aria-hidden="true">
          <BookMarked size={19} strokeWidth={1.5} />
          <span>Books</span>
        </span>
      </button>

      <button
        className={`navbar-tab-vertical navbar-main-tab ${currentView === 'newsletters' ? 'active' : ''}`}
        aria-label="Newsletter"
        onClick={() => onNavigate('newsletters')}
      >
        <span className="navbar-tab-text">NEWSLETTER</span>
        <span className="navbar-mobile-item" aria-hidden="true">
          <Newspaper size={19} strokeWidth={1.5} />
          <span>News</span>
        </span>
      </button>

      {openArticles.map((article) => {
        const isActive = currentView === 'reader' && selectedArticleId === article.id;
        return (
          <div
            key={article.id}
            className={`navbar-tab-vertical navbar-article-tab ${isActive ? 'active' : ''}`}
            onClick={() => onNavigate('reader', article.id)}
          >
            <button
              className="navbar-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseArticle(article.id);
              }}
            >
              ✕
            </button>
            <span className="navbar-tab-text">
              {article.title.length > 50
                ? article.title.substring(0, 50).toUpperCase() + '...'
                : article.title.toUpperCase()}
            </span>
          </div>
        );
      })}

      {/* Spacer pushes add button to bottom */}
      <div style={{ flex: 1 }} />

      <button
        className="navbar-tab-vertical navbar-tab-add"
        aria-label="Add article"
        onClick={onOpenSpotlight}
        title="Load article from URL (⌘K)"
      >
        <span className="navbar-tab-text">+</span>
        <span className="navbar-mobile-item" aria-hidden="true">
          <Plus size={19} strokeWidth={1.5} />
          <span>Add</span>
        </span>
      </button>
    </nav>
  );
}

