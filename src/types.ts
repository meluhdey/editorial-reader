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

export type View = 'library' | 'reader' | 'graph' | 'paste' | 'notebook';

export interface AppState {
  articles: Article[];
  currentView: View;
  selectedArticleId: string | null;
  openArticleIds: string[];
  notebookNotes?: NotebookNote[];
  selectedNotebookNoteId?: string | null;
}

