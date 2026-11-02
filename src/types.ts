export interface Highlight {
  id: string;
  text: string;
  comment?: string;
  color: string;
  createdAt: number;
}

export interface Article {
  id: string;
  title: string;
  author?: string;
  content: string;
  url: string;
  tags: string[];
  headerImageUrl: string;
  highlights: Highlight[];
  notes: string;
  savedAt: number;
}

export interface NotebookNote {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export type BookStatus = 'want' | 'reading' | 'read' | 'abandoned';

export interface Book {
  id: string;
  title: string;
  author: string;
  year?: number;
  isbn?: string;
  pages?: number;
  coverUrl: string;        // '' → a generated cover is drawn instead
  sourceKey?: string;      // Open Library work key, e.g. "/works/OL1998433W"
  status: BookStatus;
  rating: number;          // 0 = unrated; otherwise 0.5–5 in half steps
  review: string;
  tags: string[];
  startedOn?: string;      // YYYY-MM-DD
  finishedOn?: string;     // YYYY-MM-DD
  addedAt: number;
  updatedAt: number;
}

export interface Newsletter {
  id: string;
  issueDate: string;      // YYYY-MM-DD (Sydney date of the issue)
  title: string;          // e.g. "Morning briefing — Tuesday 3 November 2026"
  headline: string;       // lead story headline, shown on the card
  summary: string;        // one-line dek
  coverUrl: string;       // lead article's image; '' → gradient
  coverSourceUrl?: string;
  content: string;        // full briefing, Markdown
  wordCount: number;
  createdAt: number;
  readAt?: number;        // set when marked read; greys out the cover
}

export type View = 'library' | 'reader' | 'graph' | 'paste' | 'notebook' | 'books' | 'newsletters';

export interface AppState {
  articles: Article[];
  currentView: View;
  selectedArticleId: string | null;
  openArticleIds: string[];
  notebookNotes?: NotebookNote[];
  selectedNotebookNoteId?: string | null;
}

