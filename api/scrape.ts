import './polyfill.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { scrapeAndProcess } from '../server/scraper.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { url } = req.body as { url?: string };

  if (!url) {
    return res.status(400).json({ error: 'URL is required.' });
  }

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format.' });
  }

  try {
    const article = await scrapeAndProcess(url);
    return res.json(article);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[scrape error]', message);
    return res.status(500).json({ error: message });
  }
}
