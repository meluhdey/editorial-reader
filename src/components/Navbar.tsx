import type { View, Article } from '../types';

interface NavbarProps {
  currentView: View;
  selectedArticleId: string | null;
  openArticles: Article[];
  onNavigate: (view: View, articleId?: string) => void;
  onCloseArticle: (id: string) => void;
  onOpenSpotlight: () => void;
}

export default function Navbar({ currentView, selectedArticleId, openArticles, onNavigate, onCloseArticle, onOpenSpotlight }: NavbarProps) {
  return (
    <nav className="navbar">
      <div className="navbar-logo-container">
        <span className="navbar-logo-text">MELODY'S LIBRARY</span>
      </div>

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
              onClick={(e) => { e.stopPropagation(); onCloseArticle(article.id); }}
            >
              ✕
            </button>
            <span className="navbar-tab-text">
              {article.title.length > 50 ? article.title.substring(0, 50).toUpperCase() + '...' : article.title.toUpperCase()}
            </span>
          </div>
        );
      })}

      {/* Spacer pushes add button to bottom */}
      <div style={{ flex: 1 }} />

      <button className="navbar-tab-vertical navbar-tab-add" onClick={onOpenSpotlight} title="Load article from URL (⌘K)">
        <span className="navbar-tab-text">+</span>
      </button>
    </nav>
  );
}
