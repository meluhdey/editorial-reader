import express from 'express';
import cors from 'cors';
import { scrapeAndProcess } from './scraper.js';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/scrape', async (req, res) => {
  const { url } = req.body as { url?: string };

  if (!url) {
    res.status(400).json({ error: 'URL is required.' });
    return;
  }

  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: 'Invalid URL format.' });
    return;
  }

  try {
    const article = await scrapeAndProcess(url);
    res.json(article);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scrape error]', message);
    res.status(500).json({ error: message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Serve Vite frontend in production
const distPath = join(__dirname, '../dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(join(distPath, 'index.html'));
  });
}

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`Editorial Reader server → http://localhost:${PORT}`);
});
