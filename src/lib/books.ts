import { useCallback, useEffect, useRef, useState } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Book } from '../types';
import { supabase, isSupabaseConfigured } from './supabase';

// ── Cover search (Open Library, with Google Books as a backup) ─────────────
//
// Open Library is free, keyless, CORS-open, and its cover CDN is stable — so
// it's the primary source. Google Books fills gaps when Open Library has no
// match, but is rate-limited without an API key (VITE_GOOGLE_BOOKS_KEY).

export interface BookCandidate {
  title: string;
  author: string;
  year?: number;
  isbn?: string;
  pages?: number;
  coverUrl: string;
  thumbUrl: string;
  sourceKey?: string;
  source: 'openlibrary' | 'google';
}

const OL_FIELDS = 'key,title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median';

export const olCoverById = (id: number, size: 'S' | 'M' | 'L' = 'L') =>
  `https://covers.openlibrary.org/b/id/${id}-${size}.jpg`;

/** Open Library serves a 1×1 blank for unknown ISBNs unless `default=false` (then 404). */
export const olCoverByIsbn = (isbn: string) =>
  `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`;

async function searchOpenLibrary(query: string, signal: AbortSignal): Promise<BookCandidate[]> {
  const res = await fetch(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=${OL_FIELDS}&limit=12`,
    { signal },
  );
  if (!res.ok) throw new Error(`Open Library ${res.status}`);
  const data = (await res.json()) as {
    docs: {
      key: string;
      title: string;
      author_name?: string[];
      first_publish_year?: number;
      cover_i?: number;
      isbn?: string[];
      number_of_pages_median?: number;
    }[];
  };
  return data.docs.map((d) => {
    const isbn = d.isbn?.find((i) => i.length === 13) ?? d.isbn?.[0];
    // No work-level cover: an edition's cover is often still on file by ISBN.
    const byIsbn = !d.cover_i && isbn;
    return {
      title: d.title,
      author: (d.author_name ?? []).slice(0, 3).join(', '),
      year: d.first_publish_year,
      isbn,
      pages: d.number_of_pages_median,
      coverUrl: d.cover_i ? olCoverById(d.cover_i, 'L') : byIsbn ? olCoverByIsbn(isbn) : '',
      thumbUrl: d.cover_i
        ? olCoverById(d.cover_i, 'S')
        : byIsbn
          ? `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-S.jpg?default=false`
          : '',
      sourceKey: d.key,
      source: 'openlibrary' as const,
    };
  });
}

async function searchGoogleBooks(query: string, signal: AbortSignal): Promise<BookCandidate[]> {
  const key = import.meta.env.VITE_GOOGLE_BOOKS_KEY;
  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10&printType=books${key ? `&key=${key}` : ''}`,
    { signal },
  );
  if (!res.ok) throw new Error(`Google Books ${res.status}`);
  const data = (await res.json()) as {
    items?: {
      volumeInfo: {
        title: string;
        authors?: string[];
        publishedDate?: string;
        pageCount?: number;
        industryIdentifiers?: { type: string; identifier: string }[];
        imageLinks?: { thumbnail?: string; smallThumbnail?: string };
      };
    }[];
  };
  return (data.items ?? []).map(({ volumeInfo: v }) => {
    // Google thumbnails are http:// and tiny by default; zoom=0 asks for the largest.
    const thumb = (v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail ?? '').replace(/^http:/, 'https:');
    return {
      title: v.title,
      author: (v.authors ?? []).slice(0, 3).join(', '),
      year: v.publishedDate ? Number(v.publishedDate.slice(0, 4)) || undefined : undefined,
      isbn: v.industryIdentifiers?.find((i) => i.type === 'ISBN_13')?.identifier,
      pages: v.pageCount,
      coverUrl: thumb.replace('&edge=curl', '').replace(/zoom=\d/, 'zoom=0'),
      thumbUrl: thumb,
      source: 'google' as const,
    };
  });
}

/** Search both sources; Open Library results first, Google only fills gaps. */
export async function searchBooks(query: string, signal: AbortSignal): Promise<BookCandidate[]> {
  const ol = await searchOpenLibrary(query, signal).catch((err) => {
    if (signal.aborted) throw err;
    return [] as BookCandidate[];
  });
  if (ol.filter((c) => c.coverUrl).length >= 3) return ol;

  const google = await searchGoogleBooks(query, signal).catch(() => [] as BookCandidate[]);
  const seen = new Set(ol.map((c) => `${c.title}|${c.author}`.toLowerCase()));
  return [...ol, ...google.filter((g) => !seen.has(`${g.title}|${g.author}`.toLowerCase()))];
}

// ── Persistence ────────────────────────────────────────────────────────────
//
// Books are always mirrored to localStorage. When signed in, they also sync to
// the Supabase `books` table — if that table doesn't exist yet (see
// supabase/books.sql), the page keeps working locally and uploads the local
// books the first time the table becomes available.

type CloudState = 'off' | 'loading' | 'ok' | 'missing-table' | 'error';

interface LocalCache {
  books: Book[];
  uploaded: boolean; // true once these books have been pushed to the cloud table
}

const cacheKey = (user: SupabaseUser | null) => `footnotes-books:${user?.id ?? 'guest'}`;

function readCache(user: SupabaseUser | null): LocalCache {
  try {
    const raw = localStorage.getItem(cacheKey(user));
    if (raw) return JSON.parse(raw) as LocalCache;
  } catch {}
  return { books: [], uploaded: false };
}

function writeCache(user: SupabaseUser | null, cache: LocalCache): void {
  try {
    localStorage.setItem(cacheKey(user), JSON.stringify(cache));
  } catch {}
}

const toRow = (b: Book) => ({
  id: b.id,
  title: b.title,
  author: b.author,
  year: b.year ?? null,
  isbn: b.isbn ?? null,
  pages: b.pages ?? null,
  cover_url: b.coverUrl,
  source_key: b.sourceKey ?? null,
  status: b.status,
  rating: b.rating,
  review: b.review,
  tags: b.tags,
  started_on: b.startedOn || null,
  finished_on: b.finishedOn || null,
  added_at: b.addedAt,
  updated_at: b.updatedAt,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromRow = (r: any): Book => ({
  id: r.id,
  title: r.title,
  author: r.author ?? '',
  year: r.year ?? undefined,
  isbn: r.isbn ?? undefined,
  pages: r.pages ?? undefined,
  coverUrl: r.cover_url ?? '',
  sourceKey: r.source_key ?? undefined,
  status: r.status,
  rating: Number(r.rating) || 0,
  review: r.review ?? '',
  tags: Array.isArray(r.tags) ? r.tags : [],
  startedOn: r.started_on ?? undefined,
  finishedOn: r.finished_on ?? undefined,
  addedAt: Number(r.added_at),
  updatedAt: Number(r.updated_at),
});

const isMissingTable = (err: { code?: string; message?: string }) =>
  err.code === '42P01' || err.code === 'PGRST205' || /relation .*books.* does not exist|could not find the table/i.test(err.message ?? '');

export function useBooks(user: SupabaseUser | null) {
  // Books are stored with the cache key they belong to, so a stale list can
  // never be written under a different account's key while switching users.
  const [store, setStore] = useState(() => ({ key: cacheKey(user), books: readCache(user).books }));
  const [cloud, setCloud] = useState<CloudState>('off');
  const cloudRef = useRef<CloudState>('off');
  cloudRef.current = cloud;
  const books = store.key === cacheKey(user) ? store.books : [];

  // Load whenever the signed-in user changes.
  useEffect(() => {
    let cancelled = false;
    const key = cacheKey(user);
    const cache = readCache(user);
    setStore({ key, books: cache.books });

    if (!user || !isSupabaseConfigured()) {
      setCloud('off');
      return;
    }

    setCloud('loading');
    (async () => {
      const { data, error } = await supabase.from('books').select('*').order('added_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        console.warn('[books] cloud unavailable, using local storage —', error.message);
        setCloud(isMissingTable(error) ? 'missing-table' : 'error');
        return;
      }

      let remote = (data ?? []).map(fromRow);
      // First successful sync: push books that were only ever saved locally.
      if (!cache.uploaded) {
        const remoteIds = new Set(remote.map((b) => b.id));
        const localOnly = cache.books.filter((b) => !remoteIds.has(b.id));
        if (localOnly.length) {
          const up = await supabase.from('books').upsert(localOnly.map(toRow));
          if (!up.error) remote = [...localOnly, ...remote];
        }
      }
      if (cancelled) return;
      remote.sort((a, b) => b.addedAt - a.addedAt);
      writeCache(user, { books: remote, uploaded: true });
      setStore({ key, books: remote });
      setCloud('ok');
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Mirror every change to the local cache of the account it belongs to.
  useEffect(() => {
    try {
      const prev = JSON.parse(localStorage.getItem(store.key) ?? 'null') as LocalCache | null;
      localStorage.setItem(
        store.key,
        JSON.stringify({ books: store.books, uploaded: !!prev?.uploaded || cloudRef.current === 'ok' }),
      );
    } catch {}
  }, [store]);

  const sync = useCallback(async (op: () => PromiseLike<{ error: unknown }>) => {
    if (cloudRef.current !== 'ok') return;
    const { error } = await op();
    if (error) console.error('[books] sync failed', error);
  }, []);

  const addBook = useCallback(
    (book: Book) => {
      setStore((s) => ({ ...s, books: [book, ...s.books] }));
      sync(() => supabase.from('books').insert(toRow(book)));
    },
    [sync],
  );

  const updateBook = useCallback(
    (book: Book) => {
      const next = { ...book, updatedAt: Date.now() };
      setStore((s) => ({ ...s, books: s.books.map((b) => (b.id === next.id ? next : b)) }));
      sync(() => supabase.from('books').update(toRow(next)).eq('id', next.id));
    },
    [sync],
  );

  const deleteBook = useCallback(
    (id: string) => {
      setStore((s) => ({ ...s, books: s.books.filter((b) => b.id !== id) }));
      sync(() => supabase.from('books').delete().eq('id', id));
    },
    [sync],
  );

  return { books, cloud, addBook, updateBook, deleteBook };
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
