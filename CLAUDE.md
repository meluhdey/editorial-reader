# Editorial Reader — Project Context

A full-stack article-saving and annotation app. No AI/LLM dependencies — all scraping is deterministic.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React 18, TypeScript, `motion/react` animations |
| Backend | Express 4 (Node.js, ES Modules) |
| Scraping | `@mozilla/readability` + `jsdom` → `turndown` (HTML→Markdown) |
| Styling | Single `src/index.css` (no Tailwind, no CSS-in-JS) |
| State | `useState` in `App.tsx` → persisted to `localStorage` |

## Running locally

```bash
npm run dev        # starts both servers concurrently
# Express  → http://localhost:3001
# Vite     → http://localhost:5173  (visit this one)
```

No `.env` file or API keys are required.

## Project structure

```
editorial-reader/
├── server/
│   ├── index.ts        # Express: POST /api/scrape, GET /api/health
│   └── scraper.ts      # Fetch → Readability → Turndown → return Article JSON
├── src/
│   ├── types.ts        # Article, Highlight, AppState interfaces
│   ├── App.tsx         # Root: state, localStorage, view routing
│   ├── index.css       # All styles — CSS custom properties at :root
│   └── components/
│       ├── Navbar.tsx  # Library / Index tabs
│       ├── Library.tsx # Article grid + URL save form
│       ├── Reader.tsx  # Two-panel reader: article left, notes right
│       └── Graph.tsx   # SVG knowledge web (circular layout, tag links)
```

## Data schema

```ts
interface Highlight {
  id: string;
  text: string;       // verbatim selection
  comment?: string;
  color: 'yellow' | 'blue';
  createdAt: number;
}

interface Article {
  id: string;
  title: string;
  content: string;    // Markdown, cleaned by Turndown
  url: string;
  tags: string[];     // extracted from page meta; user can add/remove in Reader
  headerImageUrl: string; // og:image, or fallback SVG (base64)
  highlights: Highlight[];
  notes: string;
  savedAt: number;
}
```

## Design system

All tokens are CSS custom properties in `src/index.css`:

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#ECEAE3` | Page background |
| `--surface` | `#F5F4EE` | Cards, panels |
| `--ink` | `#1A1916` | All text |
| `--muted` | `#797570` | Labels, meta |
| `--faint` | `#AEADA5` | Placeholders, dividers |
| `--border` | `#CCCAB8` | Hairline 1px borders |
| `--mono` | `'Space Mono'` | Article body, titles, mono UI |
| `--sans` | `'Inter'` | Navigation, buttons, labels |

**Rules:** No shadows. No border-radius (max 0px). No accent colour — fully monochrome. Uppercase + tracked (`letter-spacing: 0.14–0.22em`) for all labels.

## Scraping pipeline (`server/scraper.ts`)

1. Fetch with Googlebot User-Agent (bypasses some paywalls)
2. **Stage 1 — Mozilla Readability**: best-quality article extraction
3. **Stage 2 — Cheerio heuristics**: fallback if Readability yields < 300 chars
4. **Stage 3 — Largest paragraph block**: last resort
5. Convert cleaned HTML → Markdown via Turndown
6. Extract tags from: JSON-LD `keywords`, `<meta name="keywords">`, `article:tag`, DOM tag links
7. Header image: `og:image` → `twitter:image` → first large `<img>` → geometric SVG fallback

## Reader layout

The Reader is a full-viewport split:
- **Left panel** (`reader-left`): scrollable — hero image, article header, Markdown content
- **Right panel** (`reader-right`): scrollable — Topics (editable tags), Notes (textarea), Highlights list
- Text selection (`mouseup`) triggers the highlight popup (colour + optional note)

## Graph view

- Nodes: one per article, arranged in a circle
- Links: drawn between any two articles sharing ≥ 1 tag
- Click a node → opens that article in Reader
- Dot indicator on node = article has highlights or notes

## Known limitations / good next tasks

- No server-side persistence — all state lives in `localStorage` (could add SQLite or a simple JSON file store)
- No search / filter in the Library view
- Readability sometimes fails on heavily JS-rendered pages (SPAs) — could add a Playwright fallback
- Tags auto-extracted from metadata are sparse for many sites; the manual tag UI in the Reader sidebar compensates
