import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Article } from '../types';

interface LibraryProps {
  articles: Article[];
  onAdd: (article: Article) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).toUpperCase();
}

function extractSource(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Strip TLD and capitalise
    return hostname.split('.')[0];
  } catch {
    return '';
  }
}

type SortOrder = 'newest' | 'oldest';

const highlightColors = ['yellow', 'green', 'blue', 'purple', 'orange'];

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

function getCardImageUrl(article: Article): string {
  const url = article.headerImageUrl;
  if (!url || url.includes('upload.wikimedia.org')) {
    const idx = hashId(article.id) % fallbackPaintings.length;
    return fallbackPaintings[idx];
  }
  return url;
}

export default function Library({ articles, onSelect, onDelete }: LibraryProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  // Collect all unique tags and sources
  const allTags = useMemo(() => {
    const set = new Set<string>();
    articles.forEach((a) => a.tags?.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [articles]);

  const allSources = useMemo(() => {
    const set = new Set<string>();
    articles.forEach((a) => {
      const src = extractSource(a.url);
      if (src) set.add(src);
    });
    return Array.from(set).sort();
  }, [articles]);

  const filtered = useMemo(() => {
    let result = [...articles];
    if (activeTag) result = result.filter((a) => a.tags?.includes(activeTag));
    if (activeSource) result = result.filter((a) => extractSource(a.url) === activeSource);
    result.sort((a, b) =>
      sortOrder === 'newest' ? b.savedAt - a.savedAt : a.savedAt - b.savedAt
    );
    return result;
  }, [articles, activeTag, activeSource, sortOrder]);

  const hasActiveFilter = activeTag || activeSource || sortOrder !== 'newest';

  const clearAll = () => {
    setActiveTag(null);
    setActiveSource(null);
    setSortOrder('newest');
  };

  return (
    <div className="lib">
      {/* Header */}
      <div className="lib-header">
        <div className="lib-header-top">
          <h1 className="lib-title">Library</h1>
          <span className="lib-count">{filtered.length} article{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="lib-filter-bar">
          <button
            className={`lib-filter-toggle ${filterOpen ? 'lib-filter-toggle--open' : ''}`}
            onClick={() => setFilterOpen((v) => !v)}
          >
            FILTER {filterOpen ? '▴' : '▾'}
          </button>

          {hasActiveFilter && (
            <button className="lib-filter-clear" onClick={clearAll}>
              CLEAR ALL
            </button>
          )}
        </div>

        <AnimatePresence>
          {filterOpen && (
            <motion.div
              className="lib-filter-panel"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Sort by date */}
              <div className="lib-filter-group">
                <span className="lib-filter-label">Date added</span>
                <div className="lib-filter-pills">
                  {(['newest', 'oldest'] as SortOrder[]).map((order) => (
                    <button
                      key={order}
                      className={`lib-tag-pill ${sortOrder === order ? 'lib-tag-pill--active' : ''}`}
                      onClick={() => setSortOrder(order)}
                    >
                      {order === 'newest' ? 'NEWEST FIRST' : 'OLDEST FIRST'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filter by source */}
              {allSources.length > 0 && (
                <div className="lib-filter-group">
                  <span className="lib-filter-label">Source</span>
                  <div className="lib-filter-pills">
                    {allSources.map((src) => (
                      <button
                        key={src}
                        className={`lib-tag-pill ${activeSource === src ? 'lib-tag-pill--active' : ''}`}
                        onClick={() => setActiveSource(activeSource === src ? null : src)}
                      >
                        {src.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Filter by tag */}
              {allTags.length > 0 && (
                <div className="lib-filter-group">
                  <span className="lib-filter-label">Tags</span>
                  <div className="lib-filter-pills">
                    {allTags.map((tag) => (
                      <button
                        key={tag}
                        className={`lib-tag-pill ${activeTag === tag ? 'lib-tag-pill--active' : ''}`}
                        onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                      >
                        {tag.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Grid */}
      <div className="lib-grid">
        <AnimatePresence>
          {filtered.length === 0 && (
            <motion.div
              className="lib-empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <p>No articles match the current filters.</p>
            </motion.div>
          )}

          {filtered.map((article, i) => (
            <motion.div
              key={article.id}
              className="lib-card"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04, duration: 0.3 } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              onClick={() => onSelect(article.id)}
            >
              {/* Image area */}
              <div className={`lib-card-img-wrap hover-color-${highlightColors[hashId(article.id) % highlightColors.length]}`}>
                <img
                  className="lib-card-img"
                  src={getCardImageUrl(article)}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    const target = e.currentTarget;
                    const fallback = fallbackPaintings[hashId(article.id) % fallbackPaintings.length];
                    if (target.src !== fallback) {
                      target.src = fallback;
                    }
                  }}
                />

                {/* Tag pills overlaid on image */}
                {article.tags && article.tags.length > 0 && (
                  <div className="lib-card-tags">
                    {article.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="lib-card-tag">
                        {tag.toUpperCase()}
                      </span>
                    ))}
                  </div>
                )}

                {/* Delete on hover */}
                <button
                  className="lib-card-delete"
                  onClick={(e) => { e.stopPropagation(); onDelete(article.id); }}
                >
                  ×
                </button>
              </div>

              {/* Meta below image */}
              <div className="lib-card-meta">
                <div className="lib-card-meta-top">
                  <span className="lib-card-date">{formatDate(article.savedAt)}</span>
                  {article.url && (
                    <span className="lib-card-source">{extractSource(article.url).toUpperCase()}</span>
                  )}
                </div>
                <h2 className="lib-card-title">{article.title}</h2>
                {article.author && (
                  <p className="lib-card-author">{article.author}</p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
