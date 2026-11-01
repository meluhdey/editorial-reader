import { useCallback, useEffect, useState } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Newsletter } from '../types';
import { supabase, isSupabaseConfigured } from './supabase';

// Newsletters are written by the 7am Claude routine (via the ingest_newsletter
// function in supabase/newsletters.sql) and are read-only in the app, apart from
// deleting an issue. A local copy is cached per account so the tab opens
// instantly and still shows the last issues when offline.

type CloudState = 'off' | 'loading' | 'ok' | 'missing-table' | 'error';

const cacheKey = (user: SupabaseUser | null) => `footnotes-newsletters:${user?.id ?? 'guest'}`;

function readCache(user: SupabaseUser | null): Newsletter[] {
  try {
    const raw = localStorage.getItem(cacheKey(user));
    if (raw) return JSON.parse(raw) as Newsletter[];
  } catch {}
  return [];
}

function writeCache(user: SupabaseUser | null, items: Newsletter[]): void {
  try {
    localStorage.setItem(cacheKey(user), JSON.stringify(items));
  } catch {}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromRow = (r: any): Newsletter => ({
  id: r.id,
  issueDate: r.issue_date,
  title: r.title ?? '',
  headline: r.headline ?? '',
  summary: r.summary ?? '',
  coverUrl: r.cover_url ?? '',
  coverSourceUrl: r.cover_source_url ?? undefined,
  content: r.content ?? '',
  wordCount: Number(r.word_count) || 0,
  createdAt: Number(r.created_at) || 0,
});

const isMissingTable = (err: { code?: string; message?: string }) =>
  err.code === '42P01' || err.code === 'PGRST205' || /could not find the table|does not exist/i.test(err.message ?? '');

export function useNewsletters(user: SupabaseUser | null) {
  const [store, setStore] = useState(() => ({ key: cacheKey(user), items: readCache(user) }));
  const [cloud, setCloud] = useState<CloudState>('off');
  const items = store.key === cacheKey(user) ? store.items : [];

  const load = useCallback(async () => {
    const key = cacheKey(user);
    setStore({ key, items: readCache(user) });
    if (!user || !isSupabaseConfigured()) {
      setCloud('off');
      return;
    }
    setCloud('loading');
    const { data, error } = await supabase
      .from('newsletters')
      .select('*')
      .order('issue_date', { ascending: false });
    if (error) {
      console.warn('[newsletters] cloud unavailable —', error.message);
      setCloud(isMissingTable(error) ? 'missing-table' : 'error');
      return;
    }
    const next = (data ?? []).map(fromRow);
    writeCache(user, next);
    setStore({ key, items: next });
    setCloud('ok');
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const deleteNewsletter = useCallback(
    async (id: string) => {
      setStore((s) => {
        const next = s.items.filter((n) => n.id !== id);
        writeCache(user, next);
        return { ...s, items: next };
      });
      if (user && isSupabaseConfigured()) {
        const { error } = await supabase.from('newsletters').delete().eq('id', id);
        if (error) console.error('[newsletters] delete failed', error);
      }
    },
    [user],
  );

  return { newsletters: items, cloud, refresh: load, deleteNewsletter };
}

/** Reading time at ~230 words a minute. */
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 230));

/** The briefing's own "# Morning briefing — …" title duplicates the page header. */
export function stripLeadingTitle(markdown: string): string {
  return markdown.replace(/^\s*#\s+[^\n]*\n+/, '');
}
