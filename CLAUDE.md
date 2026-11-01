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
  headerImageUrl: string; // og:image; '' when none — client picks a painting/gradient
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

1. Fetch with a desktop-Chrome User-Agent (`CHROME_UA`)
   - On a bot-block / upstream failure (403 / 429 / 451 / 5xx), `scrapeBlocked`
     runs a fallback chain (45 s budget; `vercel.json` maxDuration 60):
     1. **Publisher feed** (`PUBLISHER_FEEDS`, currently The Atlantic's section +
        site feeds) — full text, author, image for recent articles; ~1 s.
     2. **Wayback Machine** (background) — newest accessible capture from CDX
        (some captures 402 "contact the site owner"; tries up to 4). Old articles.
     3. **Reader** `r.jina.ai` in JSON+HTML mode → our Readability pipeline. A
        cached Cloudflare challenge (upstream 403) is retried with `X-No-Cache`.
        Do not send a browser UA to it (it 403s those). `READER_PROXY_URL`,
        `JINA_API_KEY` optional.
     First result ≥ 6000 chars (feed: ≥ 800) wins, else the longest. Stubs
     (< 250 plain words, "Page not found") are rejected. A real 404/401/410 from
     the direct fetch or the reader surfaces as-is.
2. **Stage 1 — Mozilla Readability**: best-quality article extraction
3. **Stage 2 — Cheerio heuristics**: fallback if Readability yields < 300 chars
4. **Stage 3 — Largest paragraph block**: last resort
5. Convert cleaned HTML → Markdown via Turndown
6. Extract tags from: JSON-LD `keywords`, `<meta name="keywords">`, `article:tag`, DOM tag links
7. Header image: `og:image` → `twitter:image` → first large `<img>`, else `''`.
   When empty (or a legacy generated SVG), the client shows a stable pick from
   10 Unsplash paintings + 50 gradients (`src/lib/fallbackCovers.ts`; images in
   `public/covers/gradients`, web copies of "Vibed Applications/Gradients" at
   1000px JPEG q60). The Library card's shuffle button picks another and saves it.

## Reader layout

The Reader is a full-viewport split:
- **Left panel** (`reader-left`): scrollable — hero image, article header, Markdown content
- **Right panel** (`reader-right`): scrollable — Topics (editable tags), Notes (textarea), Highlights list
- Text selection (`mouseup`) triggers the highlight popup (colour + optional note)

## Books page (`src/components/Books.tsx`, `src/lib/books.ts`)

- Shelf of books with half-star ratings (0 = unrated), status (want / reading /
  read / abandoned), started/finished dates, tags and a review. Nav tab: BOOKS.
- **Covers**: Open Library search API + covers CDN (keyless, CORS-open) —
  `covers.openlibrary.org/b/id/{cover_i}-L.jpg`, or by ISBN when a work has no
  cover id. Google Books fills gaps only when Open Library has < 3 covered
  hits; it 429s without a key (`VITE_GOOGLE_BOOKS_KEY`, optional). No usable
  cover → a jacket with the title set on one of the gradients (`gradientFor`).
- **Persistence** (`useBooks`): always mirrored to localStorage
  (`footnotes-books:<userId|guest>`); synced to the Supabase `books` table
  when signed in. If the table is missing (PGRST205) the page keeps working
  locally and shows a note; local books are uploaded on the first successful
  sync. Create the table with `supabase/books.sql`.
- To test without signing in: `VITE_SUPABASE_URL= npx vite --port 5174` →
  "Enter as local guest".

## Newsletter tab (`src/components/Newsletters.tsx`, `src/lib/newsletters.ts`)

- Daily "Morning briefing" issues written by a Claude routine at 7am Sydney
  (claude.ai routine "Morning news briefing (7am Sydney)"). The routine posts
  each issue to the Supabase RPC `ingest_newsletter` (see
  `supabase/newsletters.sql`) using the public publishable key plus a shared
  secret token from the cloud environment variable `FOOTNOTES_NEWSLETTER_TOKEN`.
  No service-role key is involved; the function only inserts/replaces issues
  for the one configured account (one per `issue_date`).
- Grid reuses the Library card styles; cover = lead article's og:image, falling
  back to a gradient. Reader is a single read-only column (Markdown only, no
  raw HTML rendered), no side panel.

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
