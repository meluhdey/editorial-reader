import type { View, Article } from '../types';
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
  let logoText = "GUEST'S FOOTNOTES";
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
    logoText = "GUEST'S FOOTNOTES";
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
      </button>

      <button
        className={`navbar-tab-vertical ${currentView === 'graph' ? 'active' : ''}`}
        onClick={() => onNavigate('graph')}
      >
        <span className="navbar-tab-text">INDEX</span>
      </button>

      <button
        className={`navbar-tab-vertical ${currentView === 'library' ? 'active' : ''}`}
        onClick={() => onNavigate('library')}
      >
        <span className="navbar-tab-text">LIBRARY</span>
      </button>

      <button
        className={`navbar-tab-vertical ${currentView === 'notebook' ? 'active' : ''}`}
        onClick={() => onNavigate('notebook')}
      >
        <span className="navbar-tab-text">NOTEBOOK</span>
      </button>

      {openArticles.map((article) => {
        const isActive = currentView === 'reader' && selectedArticleId === article.id;
        return (
          <div
            key={article.id}
            className={`navbar-tab-vertical ${isActive ? 'active' : ''}`}
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
        onClick={onOpenSpotlight}
        title="Load article from URL (⌘K)"
      >
        <span className="navbar-tab-text">+</span>
      </button>
    </nav>
  );
}

