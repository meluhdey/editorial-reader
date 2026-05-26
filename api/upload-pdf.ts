import './polyfill.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { processPDFBuffer } from '../server/scraper.js';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { name, file } = req.body as { name?: string; file?: string };

  if (!name || !file) {
    return res.status(400).json({ error: 'Name and file payload are required.' });
  }

  try {
    const base64Data = file.split(';base64,').pop() || '';
    const buffer = Buffer.from(base64Data, 'base64');

    // Save uploaded PDF file locally if the filesystem permits (useful for local development)
    try {
      const uploadsDir = join(process.cwd(), 'uploads');
      if (!existsSync(uploadsDir)) {
        mkdirSync(uploadsDir, { recursive: true });
      }
      const filePath = join(uploadsDir, name);
      writeFileSync(filePath, buffer);
    } catch (fsErr) {
      console.warn('[FS Warning] Could not save physical PDF locally (running in serverless/read-only environment):', fsErr);
    }

    const article = await processPDFBuffer(buffer, name, `/api/uploads/${encodeURIComponent(name)}`);
    return res.json(article);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pdf upload error]', message);
    return res.status(500).json({ error: message });
  }
}
