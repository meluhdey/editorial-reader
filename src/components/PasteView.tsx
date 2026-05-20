import { useState } from 'react';
import type { Article } from '../types';

interface PasteViewProps {
  onAdd: (article: Article) => void;
  onNavigate: (view: 'reader', id: string) => void;
}

function guessTitle(text: string): string {
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? 'Untitled';
  return firstLine.trim().slice(0, 120);
}

export default function PasteView({ onAdd, onNavigate }: PasteViewProps) {
  const [raw, setRaw] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!raw.trim()) return;
    const resolvedTitle = title.trim() || guessTitle(raw);
    const article: Article = {
      id: crypto.randomUUID(),
      title: resolvedTitle,
      author: author.trim() || undefined,
      content: raw.trim(),
      url: '',
      tags: [],
      headerImageUrl: '',
      highlights: [],
      notes: '',
      savedAt: Date.now(),
    };
    onAdd(article);
    setSubmitted(true);
    setTimeout(() => {
      onNavigate('reader', article.id);
    }, 600);
  };

  return (
    <div className="paste-view">
      <div className="paste-header">
        <h1 className="paste-title">PASTE ARTICLE</h1>
        <p className="paste-subtitle">Paste any article text below to add it to your library.</p>
      </div>

      <div className="paste-form">
        <div className="paste-meta-row">
          <div className="paste-field">
            <label className="paste-label">TITLE</label>
            <input
              className="paste-input"
              type="text"
              placeholder="Leave blank to auto-detect"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="paste-field">
            <label className="paste-label">AUTHOR</label>
            <input
              className="paste-input"
              type="text"
              placeholder="Optional"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
        </div>

        <div className="paste-field paste-field--full">
          <label className="paste-label">ARTICLE TEXT</label>
          <textarea
            className="paste-textarea"
            placeholder="Paste the full article text here…"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </div>

        <div className="paste-actions">
          <span className="paste-char-count">{raw.length.toLocaleString()} characters</span>
          <button
            className={`paste-submit ${submitted ? 'paste-submit--done' : ''}`}
            onClick={handleSubmit}
            disabled={!raw.trim() || submitted}
          >
            {submitted ? 'OPENING…' : 'ADD TO LIBRARY'}
          </button>
        </div>
      </div>
    </div>
  );
}
