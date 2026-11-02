import { useCallback, useEffect, useState } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Newsletter } from '../types';
import { supabase, isSupabaseConfigured } from './supabase';

// Newsletters are written by the 7am Claude routine (via the ingest_newsletter
// function in supabase/newsletters.sql) and are read-only in the app, apart from
// marking an issue read and deleting it. A local copy is cached per account so the tab opens
// instantly and still shows the last issues when offline.

type CloudState = 'off' | 'loading' | 'ok' | 'missing-table' | 'error';

const cacheKey = (user: SupabaseUser | null) => `footnotes-newsletters:${user?.id ?? 'guest'}`;
// Read marks are also kept locally, so they survive before newsletters-read.sql
// has been run (or while offline).
const readKey = (user: SupabaseUser | null) => `footnotes-newsletters-read:${user?.id ?? 'guest'}`;

function readMarks(user: SupabaseUser | null): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(readKey(user)) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function writeMarks(user: SupabaseUser | null, marks: Record<string, number>): void {
  try {
    localStorage.setItem(readKey(user), JSON.stringify(marks));
  } catch {}
}

const withMarks = (items: Newsletter[], marks: Record<string, number>) =>
  items.map((n) => (n.readAt || !marks[n.id] ? n : { ...n, readAt: marks[n.id] }));

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
  readAt: r.read_at ? Number(r.read_at) : undefined,
});

const isMissingTable = (err: { code?: string; message?: string }) =>
  err.code === '42P01' || err.code === 'PGRST205' || /could not find the table|does not exist/i.test(err.message ?? '');

export function useNewsletters(user: SupabaseUser | null) {
  const [store, setStore] = useState(() => ({ key: cacheKey(user), items: withMarks(readCache(user), readMarks(user)) }));
  const [cloud, setCloud] = useState<CloudState>('off');
  const items = store.key === cacheKey(user) ? store.items : [];

  const load = useCallback(async () => {
    const key = cacheKey(user);
    setStore({ key, items: withMarks(readCache(user), readMarks(user)) });
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
    const next = withMarks((data ?? []).map(fromRow), readMarks(user));
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

  const setRead = useCallback(
    async (id: string, read: boolean) => {
      const readAt = read ? Date.now() : undefined;
      const marks = readMarks(user);
      if (readAt) marks[id] = readAt;
      else delete marks[id];
      writeMarks(user, marks);
      setStore((s) => {
        const next = s.items.map((n) => (n.id === id ? { ...n, readAt } : n));
        writeCache(user, next);
        return { ...s, items: next };
      });
      if (user && isSupabaseConfigured()) {
        const { error } = await supabase.from('newsletters').update({ read_at: readAt ?? null }).eq('id', id);
        // Before newsletters-read.sql is run the column doesn't exist; the local mark still applies.
        if (error) console.warn('[newsletters] read status not synced —', error.message);
      }
    },
    [user],
  );

  return { newsletters: items, cloud, refresh: load, deleteNewsletter, setRead };
}

/** Reading time at ~230 words a minute. */
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 230));

/** The briefing's own "# Morning briefing — …" title duplicates the page header. */
export function stripLeadingTitle(markdown: string): string {
  return markdown.replace(/^\s*#\s+[^\n]*\n+/, '');
}

export interface IssueSection {
  id: string;
  title: string;
  stories: { id: string; title: string }[];
}

const plainHeading = (s: string) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();

/**
 * Sections (## headings) and their stories (### headings), in document order.
 * Ids match the ones rehypeHeadingIds assigns: sec-N for ##, story-N for ###.
 */
export function issueOutline(markdown: string): IssueSection[] {
  const sections: IssueSection[] = [];
  let h2 = 0;
  let h3 = 0;
  for (const line of markdown.split('\n')) {
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    if (m[1] === '##') sections.push({ id: `sec-${h2++}`, title: plainHeading(m[2]), stories: [] });
    else {
      const story = { id: `story-${h3++}`, title: plainHeading(m[2]) };
      if (sections.length) sections[sections.length - 1].stories.push(story);
    }
  }
  return sections;
}

/** Rehype plugin: give ## and ### headings the ids issueOutline() predicts. */
export function rehypeHeadingIds() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    let h2 = 0;
    let h3 = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (node: any) => {
      if (node.type === 'element' && (node.tagName === 'h2' || node.tagName === 'h3')) {
        node.properties = { ...node.properties, id: node.tagName === 'h2' ? `sec-${h2++}` : `story-${h3++}` };
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
