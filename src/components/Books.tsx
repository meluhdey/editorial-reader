import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, ExternalLink, Plus } from 'lucide-react';
import type { Book, BookStatus } from '../types';
import { gradientFor } from '../lib/fallbackCovers';
import { searchBooks, olCoverByIsbn, todayISO, type BookCandidate } from '../lib/books';

interface BooksProps {
  books: Book[];
  cloud: 'off' | 'loading' | 'ok' | 'missing-table' | 'error';
  onAdd: (book: Book) => void;
  onUpdate: (book: Book) => void;
  onDelete: (id: string) => void;
}

const STATUSES: { id: BookStatus; label: string }[] = [
  { id: 'reading', label: 'Reading' },
  { id: 'want', label: 'Want to read' },
  { id: 'read', label: 'Read' },
  { id: 'abandoned', label: 'Abandoned' },
];
const statusLabel = (s: BookStatus) => STATUSES.find((x) => x.id === s)?.label ?? s;

type SortKey = 'added-desc' | 'added-asc' | 'finished-desc' | 'rating' | 'title' | 'author';
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'added-desc', label: 'Recently added' },
  { id: 'added-asc', label: 'Oldest added' },
  { id: 'finished-desc', label: 'Recently finished' },
  { id: 'rating', label: 'Highest rated' },
  { id: 'title', label: 'Title A–Z' },
  { id: 'author', label: 'Author A–Z' },
];
const SORT_STORAGE_KEY = 'footnotes-books-sort';

function loadSort(): SortKey {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    if (saved && SORTS.some((s) => s.id === saved)) return saved as SortKey;
  } catch {}
  return 'added-desc';
}

// ── Stars ──────────────────────────────────────────────────────────────────

const STAR_PATH =
  'M12 2.6l2.83 5.73 6.32.92-4.57 4.46 1.08 6.3L12 17.03l-5.66 2.98 1.08-6.3L2.85 9.25l6.32-.92L12 2.6z';

function StarRating({
  value,
  onChange,
  size = 16,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, '');
  const shown = hover ?? value;
  const interactive = !!onChange;

  const valueAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const raw = ((e.clientX - r.left) / r.width) * 5;
    return Math.min(5, Math.max(0.5, Math.ceil(raw * 2) / 2));
  };

  return (
    <div
      className={`stars ${interactive ? 'stars--interactive' : ''}`}
      role={interactive ? 'slider' : 'img'}
      aria-label={value ? `${value} out of 5 stars` : 'Not rated'}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? 5 : undefined}
      aria-valuenow={interactive ? value : undefined}
      tabIndex={interactive ? 0 : undefined}
      onMouseMove={interactive ? (e) => setHover(valueAt(e)) : undefined}
      onMouseLeave={interactive ? () => setHover(null) : undefined}
      onClick={
        interactive
          ? (e) => {
              const v = valueAt(e);
              onChange!(v === value ? 0 : v); // clicking the current rating clears it
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange!(Math.min(5, value + 0.5));
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange!(Math.max(0, value - 0.5));
              else if (e.key === '0' || e.key === 'Backspace') onChange!(0);
              else return;
              e.preventDefault();
            }
          : undefined
      }
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, shown - i)); // 0, 0.5 or 1
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <clipPath id={`${uid}-${i}`}>
                <rect x="0" y="0" width={24 * fill} height="24" />
              </clipPath>
            </defs>
            <path d={STAR_PATH} className="stars-empty" />
            <path d={STAR_PATH} className="stars-full" clipPath={`url(#${uid}-${i})`} />
          </svg>
        );
      })}
    </div>
  );
}

// ── Cover ──────────────────────────────────────────────────────────────────

function BookCover({ book, className = '' }: { book: Pick<Book, 'id' | 'title' | 'author' | 'coverUrl'>; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [book.coverUrl]);

  if (book.coverUrl && !failed) {
    return (
      <img
        className={`book-cover ${className}`}
        src={book.coverUrl}
        alt={`Cover of ${book.title}`}
        loading="lazy"
        onError={() => setFailed(true)}
        // Open Library serves a 1×1 placeholder for some missing covers.
        onLoad={(e) => e.currentTarget.naturalWidth < 10 && setFailed(true)}
      />
    );
  }
  // No usable cover: a generated jacket with the title set on it.
  return (
    <div className={`book-cover book-cover--generated ${className}`} style={{ backgroundImage: `url("${gradientFor(book.id)}")` }}>
      <span className="book-cover-title">{book.title}</span>
      {book.author && <span className="book-cover-author">{book.author}</span>}
    </div>
  );
}

// ── Tile colour ────────────────────────────────────────────────────────────
//
// Each tile is filled with one solid colour: the cover's average colour,
// softened toward the page background so covers and text stay legible.
// Open Library covers are CORS-open, so they can be read from a canvas; when a
// cover can't be read (e.g. some Google thumbnails) the tile stays neutral.

const PAGE_BG = [244, 243, 237]; // --bg #F4F3ED
const TINT_STRENGTH = 0.55;      // 0 = page background, 1 = raw average colour
const tintCache = new Map<string, string | null>();

function sampleTint(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 16;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx || img.naturalWidth < 10) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const d = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue;
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
        if (!n) return resolve(null);
        const mix = (c: number, k: number) => Math.round(PAGE_BG[k] + (c / n - PAGE_BG[k]) * TINT_STRENGTH);
        resolve(`rgb(${mix(r, 0)}, ${mix(g, 1)}, ${mix(b, 2)})`);
      } catch {
        resolve(null); // canvas tainted — no CORS on this image
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function useCoverTint(src: string): string | null {
  const [tint, setTint] = useState<string | null>(() => tintCache.get(src) ?? null);
  useEffect(() => {
    if (!src) return setTint(null);
    if (tintCache.has(src)) return setTint(tintCache.get(src)!);
    let alive = true;
    sampleTint(src).then((t) => {
      tintCache.set(src, t);
      if (alive) setTint(t);
    });
    return () => {
      alive = false;
    };
  }, [src]);
  return tint;
}

function TileStage({ book }: { book: Book }) {
  const tint = useCoverTint(book.coverUrl || gradientFor(book.id));
  return (
    <div className="book-card-stage" style={tint ? { backgroundColor: tint } : undefined}>
      <BookCover book={book} />
    </div>
  );
}

// ── Add-book search ────────────────────────────────────────────────────────

function AddBookModal({
  open,
  books,
  onClose,
  onAdd,
}: {
  open: boolean;
  books: Book[];
  onClose: () => void;
  onAdd: (b: Book) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [addAs, setAddAs] = useState<BookStatus>('read');
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState({ title: '', author: '', isbn: '', year: '' });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setError('');
    setManual(false);
    setForm({ title: '', author: '', isbn: '', year: '' });
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (!open || manual || q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    const t = setTimeout(() => {
      searchBooks(q, ctrl.signal)
        .then((r) => {
          setResults(r);
          if (!r.length) setError('No matches — try the author’s name too, or add it manually.');
        })
        .catch((err) => {
          if (!ctrl.signal.aborted) setError(`Search failed: ${err instanceof Error ? err.message : err}`);
        })
        .finally(() => !ctrl.signal.aborted && setLoading(false));
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, open, manual]);

  const make = (c: Omit<BookCandidate, 'thumbUrl' | 'source'>): Book => {
    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      title: c.title,
      author: c.author,
      year: c.year,
      isbn: c.isbn,
      pages: c.pages,
      coverUrl: c.coverUrl,
      sourceKey: c.sourceKey,
      status: addAs,
      rating: 0,
      review: '',
      tags: [],
      startedOn: addAs === 'reading' ? todayISO() : undefined,
      finishedOn: addAs === 'read' ? todayISO() : undefined,
      addedAt: now,
      updatedAt: now,
    };
  };

  const shelved = (c: BookCandidate) =>
    books.some((b) => (c.sourceKey && b.sourceKey === c.sourceKey) || (b.title === c.title && b.author === c.author));

  const submitManual = () => {
    if (!form.title.trim()) return;
    const isbn = form.isbn.replace(/[^0-9Xx]/g, '');
    onAdd(
      make({
        title: form.title.trim(),
        author: form.author.trim(),
        isbn: isbn || undefined,
        year: Number(form.year) || undefined,
        coverUrl: isbn ? olCoverByIsbn(isbn) : '',
      }),
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="spotlight-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <div className="spotlight-positioner books-modal-positioner">
            <motion.div
              className="spotlight-panel books-modal"
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onKeyDown={(e) => e.key === 'Escape' && onClose()}
            >
              {!manual ? (
                <div className="spotlight-input-row books-modal-search">
                  <Search size={16} className="books-modal-icon" />
                  <input
                    ref={inputRef}
                    className="spotlight-input"
                    placeholder="Search by title, author or ISBN…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {loading && <span className="spotlight-spinner" />}
                </div>
              ) : (
                <div className="books-modal-heading">Add a book manually</div>
              )}

              <div className="books-modal-addas">
                <span>Add as</span>
                {STATUSES.filter((s) => s.id !== 'abandoned').map((s) => (
                  <button
                    key={s.id}
                    className={`lib-tag-pill ${addAs === s.id ? 'lib-tag-pill--active' : ''}`}
                    onClick={() => setAddAs(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {!manual ? (
                <>
                  <div className="books-results">
                    {results.map((c, i) => {
                      const already = shelved(c);
                      return (
                        <button
                          key={`${c.sourceKey ?? c.title}-${i}`}
                          className="books-result"
                          disabled={already}
                          onClick={() => onAdd(make(c))}
                        >
                          <span className="books-result-thumb">
                            {c.thumbUrl ? (
                              <img
                                src={c.thumbUrl}
                                alt=""
                                loading="lazy"
                                onError={(e) => e.currentTarget.replaceWith(Object.assign(document.createElement('span'), { className: 'books-result-nocover' }))}
                              />
                            ) : (
                              <span className="books-result-nocover" />
                            )}
                          </span>
                          <span className="books-result-text">
                            <span className="books-result-title">{c.title}</span>
                            <span className="books-result-meta">
                              {[c.author, c.year].filter(Boolean).join(' · ')}
                              {c.source === 'google' && <em> · Google Books</em>}
                            </span>
                          </span>
                          <span className="books-result-action">{already ? 'ON SHELF' : 'ADD'}</span>
                        </button>
                      );
                    })}
                    {error && !loading && <p className="books-results-note">{error}</p>}
                  </div>
                  <div className="books-modal-footer">
                    <span>Covers from Open Library</span>
                    <button className="books-link-btn" onClick={() => setManual(true)}>
                      ADD MANUALLY
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="books-manual">
                    {(
                      [
                        ['title', 'Title', true],
                        ['author', 'Author', false],
                        ['isbn', 'ISBN (for the cover)', false],
                        ['year', 'Year', false],
                      ] as const
                    ).map(([k, label, auto]) => (
                      <label key={k} className="books-field">
                        <span>{label}</span>
                        <input
                          autoFocus={auto}
                          value={form[k]}
                          inputMode={k === 'year' || k === 'isbn' ? 'numeric' : undefined}
                          onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && submitManual()}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="books-modal-footer">
                    <button className="books-link-btn" onClick={() => setManual(false)}>
                      ← BACK TO SEARCH
                    </button>
                    <button className="books-primary-btn" disabled={!form.title.trim()} onClick={submitManual}>
                      ADD BOOK
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Detail drawer ──────────────────────────────────────────────────────────

const REVIEW_SAVE_DELAY_MS = 600;

function BookDetail({
  book,
  onClose,
  onUpdate,
  onDelete,
}: {
  book: Book;
  onClose: () => void;
  onUpdate: (b: Book) => void;
  onDelete: (id: string) => void;
}) {
  const [review, setReview] = useState(book.review);
  const [tagDraft, setTagDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const latest = useRef(book);
  latest.current = book;
  const pendingReview = useRef<string | null>(null);

  // Reset local edits when switching books.
  useEffect(() => {
    setReview(book.review);
    setConfirmDelete(false);
    setTagDraft('');
  }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced review save; flushed on unmount or book switch.
  useEffect(() => {
    if (review === latest.current.review) return;
    pendingReview.current = review;
    const t = setTimeout(() => {
      pendingReview.current = null;
      onUpdate({ ...latest.current, review });
    }, REVIEW_SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [review]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = book.id;
    return () => {
      // Only flush into the book the edit was made on.
      if (pendingReview.current !== null && latest.current.id === id) {
        onUpdate({ ...latest.current, review: pendingReview.current });
      }
      pendingReview.current = null;
    };
  }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const set = (patch: Partial<Book>) => onUpdate({ ...latest.current, review, ...patch });

  const setStatus = (status: BookStatus) => {
    const patch: Partial<Book> = { status };
    if (status === 'reading' && !book.startedOn) patch.startedOn = todayISO();
    if (status === 'read' && !book.finishedOn) patch.finishedOn = todayISO();
    set(patch);
  };

  const addTags = () => {
    const next = tagDraft
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t && !book.tags.includes(t));
    if (next.length) set({ tags: [...book.tags, ...next] });
    setTagDraft('');
  };

  const meta = [book.year, book.pages && `${book.pages} pp.`, book.isbn && `ISBN ${book.isbn}`].filter(Boolean);

  return (
    <>
      <motion.div
        className="drawer-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        className="book-detail"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
        aria-label={`${book.title} details`}
      >
        <button className="book-detail-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className="book-detail-hero">
          <BookCover book={book} className="book-detail-cover" />
        </div>

        <div className="book-detail-body">
          <h2 className="book-detail-title">{book.title}</h2>
          {book.author && <p className="book-detail-author">{book.author}</p>}
          {meta.length > 0 && <p className="book-detail-meta">{meta.join(' · ')}</p>}

          <section className="book-detail-section">
            <span className="book-detail-label">Rating</span>
            <div className="book-detail-rating">
              <StarRating value={book.rating} size={26} onChange={(rating) => set({ rating })} />
              <span className="book-detail-rating-num">{book.rating ? `${book.rating} / 5` : 'Not rated'}</span>
            </div>
          </section>

          <section className="book-detail-section">
            <span className="book-detail-label">Status</span>
            <div className="lib-filter-pills">
              {STATUSES.map((s) => (
                <button
                  key={s.id}
                  className={`lib-tag-pill ${book.status === s.id ? 'lib-tag-pill--active' : ''}`}
                  onClick={() => setStatus(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </section>

          <section className="book-detail-section book-detail-dates">
            <label className="books-field">
              <span>Started</span>
              <input
                type="date"
                value={book.startedOn ?? ''}
                onChange={(e) => set({ startedOn: e.target.value || undefined })}
              />
            </label>
            <label className="books-field">
              <span>Finished</span>
              <input
                type="date"
                value={book.finishedOn ?? ''}
                onChange={(e) => set({ finishedOn: e.target.value || undefined })}
              />
            </label>
          </section>

          <section className="book-detail-section">
            <span className="book-detail-label">Tags</span>
            <div className="book-detail-tags">
              {book.tags.map((t) => (
                <span key={t} className="book-tag">
                  {t}
                  <button aria-label={`Remove ${t}`} onClick={() => set({ tags: book.tags.filter((x) => x !== t) })}>
                    ×
                  </button>
                </span>
              ))}
              <input
                className="book-tag-input"
                placeholder={book.tags.length ? 'Add…' : 'fiction, poetry, …'}
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ',') && (e.preventDefault(), addTags())}
                onBlur={addTags}
              />
            </div>
          </section>

          <section className="book-detail-section">
            <span className="book-detail-label">Review &amp; notes</span>
            <textarea
              className="book-detail-review"
              placeholder="What stayed with you?"
              value={review}
              onChange={(e) => setReview(e.target.value)}
            />
          </section>

          <div className="book-detail-footer">
            {book.sourceKey ? (
              <a
                className="books-link-btn"
                href={`https://openlibrary.org${book.sourceKey}`}
                target="_blank"
                rel="noreferrer"
              >
                OPEN LIBRARY <ExternalLink size={11} />
              </a>
            ) : (
              <span />
            )}
            <button
              className={`books-link-btn books-delete ${confirmDelete ? 'books-delete--confirm' : ''}`}
              onClick={() => (confirmDelete ? onDelete(book.id) : setConfirmDelete(true))}
              onBlur={() => setConfirmDelete(false)}
            >
              {confirmDelete ? 'CONFIRM DELETE' : 'DELETE'}
            </button>
          </div>
        </div>
      </motion.aside>
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function Books({ books, cloud, onAdd, onUpdate, onDelete }: BooksProps) {
  const [status, setStatus] = useState<BookStatus | 'all'>('all');
  const [sort, setSortState] = useState<SortKey>(loadSort);
  const setSort = (next: SortKey) => {
    setSortState(next);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, next);
    } catch {}
  };
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const year = new Date().getFullYear();
  const stats = useMemo(() => {
    const rated = books.filter((b) => b.rating > 0);
    return {
      // Only books with a finish date count; imported history has none.
      readThisYear: books.filter((b) => b.status === 'read' && b.finishedOn?.startsWith(String(year))).length,
      avg: rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : 0,
      counts: Object.fromEntries(STATUSES.map((s) => [s.id, books.filter((b) => b.status === s.id).length])) as Record<
        BookStatus,
        number
      >,
    };
  }, [books, year]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = books.filter(
      (b) =>
        (status === 'all' || b.status === status) &&
        (!q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || b.tags.some((t) => t.includes(q))),
    );
    const by: Record<SortKey, (a: Book, b: Book) => number> = {
      'added-desc': (a, b) => b.addedAt - a.addedAt,
      'added-asc': (a, b) => a.addedAt - b.addedAt,
      // Books with a finish date first (newest first), then the rest by date added.
      'finished-desc': (a, b) =>
        (b.finishedOn ?? '').localeCompare(a.finishedOn ?? '') || b.addedAt - a.addedAt,
      rating: (a, b) => b.rating - a.rating || b.addedAt - a.addedAt,
      title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title),
    };
    return list.sort(by[sort]);
  }, [books, status, sort, query]);

  const openBook = books.find((b) => b.id === openId) ?? null;

  return (
    <div className="lib books">
      <div className="lib-header">
        <div className="lib-header-top books-header-top">
          <div>
            <h1 className="lib-title">Books</h1>
            <span className="lib-count">
              {books.length} book{books.length !== 1 ? 's' : ''} · {stats.readThisYear} read in {year}
              {stats.avg > 0 && ` · avg ★ ${stats.avg.toFixed(1)}`}
            </span>
          </div>
          <button className="books-primary-btn" onClick={() => setAdding(true)}>
            <Plus size={13} /> ADD BOOK
          </button>
        </div>

        {(cloud === 'missing-table' || cloud === 'error') && (
          <p className="books-cloud-note">
            {cloud === 'missing-table'
              ? 'Saved on this device only — run supabase/books.sql in your Supabase SQL editor to sync books to your account.'
              : 'Couldn’t reach the cloud — books are being saved on this device.'}
          </p>
        )}

        <div className="lib-filter-bar books-filter-bar">
          <div className="lib-filter-pills">
            <button
              className={`lib-tag-pill ${status === 'all' ? 'lib-tag-pill--active' : ''}`}
              onClick={() => setStatus('all')}
            >
              All {books.length}
            </button>
            {STATUSES.map((s) => (
              <button
                key={s.id}
                className={`lib-tag-pill ${status === s.id ? 'lib-tag-pill--active' : ''}`}
                onClick={() => setStatus(s.id)}
              >
                {s.label} {stats.counts[s.id]}
              </button>
            ))}
          </div>
          <div className="books-filter-right">
            <input
              className="books-filter-input"
              placeholder="Filter shelf…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="books-sort">
              <span>Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="books-grid">
        {shown.length === 0 && (
          <div className="lib-empty books-empty">
            {books.length === 0 ? (
              <>
                <p>Your shelf is empty.</p>
                <button className="books-link-btn" onClick={() => setAdding(true)}>
                  ADD YOUR FIRST BOOK
                </button>
              </>
            ) : (
              <p>No books match.</p>
            )}
          </div>
        )}
        <AnimatePresence initial={false}>
          {shown.map((b, i) => (
            <motion.button
              key={b.id}
              className="book-card"
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.02 } }}
              exit={{ opacity: 0 }}
              onClick={() => setOpenId(b.id)}
            >
              <TileStage book={b} />
              <div className="book-card-meta">
                <span className="book-card-title">{b.title}</span>
                {b.author && <span className="book-card-author">{b.author}</span>}
                <div className="book-card-bottom">
                  {b.rating > 0 ? <StarRating value={b.rating} size={12} /> : <span className="book-card-unrated">—</span>}
                  <span className={`book-card-status book-card-status--${b.status}`}>{statusLabel(b.status)}</span>
                </div>
              </div>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      <AddBookModal
        open={adding}
        books={books}
        onClose={() => setAdding(false)}
        onAdd={(b) => {
          onAdd(b);
          setAdding(false);
          setOpenId(b.id); // straight to rating
        }}
      />

      <AnimatePresence>
        {openBook && (
          <BookDetail
            key="book-detail"
            book={openBook}
            onClose={() => setOpenId(null)}
            onUpdate={onUpdate}
            onDelete={(id) => {
              setOpenId(null);
              onDelete(id);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
