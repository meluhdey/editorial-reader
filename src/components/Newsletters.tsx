import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft } from 'lucide-react';
import type { Newsletter } from '../types';
import { gradientFor } from '../lib/fallbackCovers';
import { readingMinutes, stripLeadingTitle } from '../lib/newsletters';

interface NewslettersProps {
  newsletters: Newsletter[];
  cloud: 'off' | 'loading' | 'ok' | 'missing-table' | 'error';
  onRefresh: () => void;
  onDelete: (id: string) => void;
}

const highlightColors = ['yellow', 'green', 'blue', 'purple', 'orange'];

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash);
}

/** Issue dates are calendar dates (Sydney); parse without a timezone shift. */
function issueDate(n: Newsletter): Date {
  const [y, m, d] = n.issueDate.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

const shortDate = (n: Newsletter) =>
  issueDate(n).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const longDate = (n: Newsletter) =>
  issueDate(n).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const sourceName = (url?: string) => {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

function Cover({ issue, className }: { issue: Newsletter; className: string }) {
  const fallback = gradientFor(issue.id);
  return (
    <img
      className={className}
      src={issue.coverUrl || fallback}
      alt=""
      loading="lazy"
      onError={(e) => {
        if (e.currentTarget.src !== new URL(fallback, location.href).href) e.currentTarget.src = fallback;
      }}
    />
  );
}

// ── Reading view ───────────────────────────────────────────────────────────

function NewsletterReader({ issue, onClose }: { issue: Newsletter; onClose: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [issue.id, onClose]);

  const source = sourceName(issue.coverSourceUrl);

  return (
    <motion.div
      className="nl-reader"
      ref={scrollRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="nl-reader-bar">
        <button className="nl-back" onClick={onClose}>
          <ArrowLeft size={14} /> NEWSLETTERS
        </button>
      </div>

      <figure className="nl-hero">
        <Cover issue={issue} className="nl-hero-img" />
        {source && (
          <figcaption className="nl-hero-caption">
            Cover:{' '}
            <a href={issue.coverSourceUrl} target="_blank" rel="noreferrer">
              {source}
            </a>
          </figcaption>
        )}
      </figure>

      <header className="nl-header">
        <span className="nl-kicker">
          Morning briefing · {longDate(issue)} · {readingMinutes(issue.wordCount)} min read
        </span>
        <h1 className="nl-title">{issue.headline || issue.title}</h1>
        {issue.summary && <p className="nl-dek">{issue.summary}</p>}
      </header>

      {/* Markdown only — no raw HTML from the routine is rendered. */}
      <article className="article-content nl-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          }}
        >
          {stripLeadingTitle(issue.content)}
        </ReactMarkdown>
      </article>

      <footer className="nl-footer">
        <button className="nl-back" onClick={onClose}>
          <ArrowLeft size={14} /> ALL ISSUES
        </button>
      </footer>
    </motion.div>
  );
}

// ── Issue grid ─────────────────────────────────────────────────────────────

export default function Newsletters({ newsletters, cloud, onRefresh, onDelete }: NewslettersProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = newsletters.find((n) => n.id === openId) ?? null;

  // Pick up a briefing that arrived while the app was open.
  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  if (open) {
    return (
      <AnimatePresence mode="wait">
        <NewsletterReader key={open.id} issue={open} onClose={() => setOpenId(null)} />
      </AnimatePresence>
    );
  }

  const emptyMessage =
    cloud === 'missing-table'
      ? 'Newsletter storage isn’t set up yet — run supabase/newsletters.sql in your Supabase SQL editor.'
      : cloud === 'off'
        ? 'Sign in to see your daily briefings.'
        : cloud === 'loading'
          ? 'Loading…'
          : cloud === 'error'
            ? 'Couldn’t reach the cloud. Try again shortly.'
            : 'No issues yet — your first briefing arrives at 7am.';

  return (
    <div className="lib">
      <div className="lib-header">
        <div className="lib-header-top">
          <h1 className="lib-title">Newsletter</h1>
          <span className="lib-count">
            {newsletters.length} issue{newsletters.length !== 1 ? 's' : ''} · daily at 7am
          </span>
        </div>
      </div>

      <div className="lib-grid">
        {newsletters.length === 0 && (
          <div className="lib-empty">
            <p>{emptyMessage}</p>
          </div>
        )}

        <AnimatePresence>
          {newsletters.map((n, i) => (
            <motion.div
              key={n.id}
              className="lib-card"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.04, duration: 0.3 } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              onClick={() => setOpenId(n.id)}
            >
              <div className={`lib-card-img-wrap hover-color-${highlightColors[hashId(n.id) % highlightColors.length]}`}>
                <Cover issue={n} className="lib-card-img" />
                <button
                  className="lib-card-delete"
                  title="Delete this issue"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(n.id);
                  }}
                >
                  ×
                </button>
              </div>

              <div className="lib-card-meta">
                <div className="lib-card-meta-top">
                  <span className="lib-card-date">{shortDate(n).toUpperCase()}</span>
                  <span className="lib-card-source">{readingMinutes(n.wordCount)} MIN READ</span>
                </div>
                <h2 className="lib-card-title">{n.headline || n.title}</h2>
                {n.summary && <p className="lib-card-author">{n.summary}</p>}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
