import express from 'express';
import cors from 'cors';
import { scrapeAndProcess, processPDFBuffer } from './scraper.js';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as cheerio from 'cheerio';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

app.post('/api/upload-pdf', async (req, res) => {
  const { name, file } = req.body as { name?: string; file?: string };

  if (!name || !file) {
    res.status(400).json({ error: 'Name and file payload are required.' });
    return;
  }

  try {
    const base64Data = file.split(';base64,').pop() || '';
    const buffer = Buffer.from(base64Data, 'base64');
    const article = await processPDFBuffer(buffer, name);
    res.json(article);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[pdf upload error]', message);
    res.status(500).json({ error: message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/proxy', async (req, res) => {
  const { url } = req.query as { url?: string };
  if (!url) {
    res.status(400).send('URL is required.');
    return;
  }

  try {
    const targetUrl = new URL(url);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      res.status(response.status).send(`Failed to fetch page: HTTP ${response.status}`);
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      res.redirect(url);
      return;
    }

    const rawHtml = await response.text();
    const $ = cheerio.load(rawHtml);

    // 1. Inject <base href="..."> and Content Security Policy (script-src 'none'; media-src 'none'; frame-src 'none') into head to block all scripts and video ads
    const baseHref = `${targetUrl.origin}${targetUrl.pathname}${targetUrl.search}`;
    const baseTag = `<base href="${baseHref}">`;
    const cspTag = `<meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' data: blob:; script-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none';">`;
    if ($('head').length) {
      $('head').prepend(cspTag);
      $('head').prepend(baseTag);
    } else {
      $('html').prepend(`<head>${baseTag}${cspTag}</head>`);
    }

    // 2. Inject aggressive CSS rules to hide ad containers, floating video panels, and autoplay video elements
    const adBlockStyle = `
      <style id="editorial-reader-adblock">
        /* Block all video tags, autoplaying elements, and video ad wrappers */
        video,
        video[autoplay],
        video.autoplay,
        .fluid-width-video-wrapper,
        .video-ad-container,
        .ad-video-container,
        .floating-video,
        .sticky-video,
        .outstream-video,
        .video-player-container,
        [class*="video-ad"],
        [class*="ad-video"],
        [class*="floating-video"],
        [class*="sticky-video"],
        [class*="outstream-video"],
        [id*="video-ad"],
        [id*="ad-video"],
        [id*="floating-video"],
        [id*="sticky-video"],
        
        /* Video player and network integrations */
        .jwplayer, .vjs-tech, .videojs,
        .pmc-video-player,
        .connatix-player,
        .cnx-player,
        .anyclip-player,
        .exco-player,
        .jw-player,
        .jw-wrapper,
        [class*="connatix"],
        [class*="cnx-"],
        [class*="anyclip"],
        [class*="exco"],
        [class*="jwplayer"],
        [class*="jw-player"],
        [id*="connatix"],
        [id*="cnx-"],
        [id*="anyclip"],
        [id*="exco"],
        [id*="jwplayer"],
        
        /* Banner, overlay, popup, and sidebar ad blocks */
        .ad, .ads, .ad-container, .advertisement, .ad-banner, .banner-ad,
        .overlay-ad, .popup-ad, .ad-box, .ad-wrapper,
        [class*="ad-container"],
        [class*="advertisement"],
        [class*="ad-banner"],
        [class*="banner-ad"],
        [class*="overlay-ad"],
        [class*="popup-ad"],
        [id*="ad-container"],
        [id*="advertisement"],
        [id*="ad-banner"],
        [id*="banner-ad"],
        
        /* Native recommendation widgets (Taboola, Outbrain, etc.) */
        .taboola, .outbrain, [class*="taboola"], [class*="outbrain"],
        
        /* Third-party iframe tracking and dynamic banner ads */
        iframe[src*="doubleclick"],
        iframe[src*="adnxs"],
        iframe[src*="adsystem"],
        iframe[src*="ads"],
        iframe[src*="youtube-nocookie"],
        iframe[src*="connatix"],
        iframe[src*="anyclip"],
        iframe[src*="ex.co"],
        iframe[src*="playbuzz"],
        iframe[src*="jwplayer"],
        iframe[src*="dailymotion"] {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
          height: 0 !important;
          width: 0 !important;
          max-height: 0 !important;
          max-width: 0 !important;
          visibility: hidden !important;
        }
      </style>
    `;
    $('head').append(adBlockStyle);

    // 3. Absolute Script Purge: Strip ALL <script> tags to ensure a completely static rendering environment
    $('script').remove();

    // 4. Inline Event scrubbing: Strip all inline JavaScript event handlers (onload, onclick, etc.)
    $('*').each((_, el) => {
      if (el.type === 'tag' && el.attribs) {
        Object.keys(el.attribs).forEach(attr => {
          if (attr.startsWith('on')) {
            $(el).removeAttr(attr);
          }
        });
      }
    });

    // 5. Absolute Video & Frame Block: Remove all video, audio, frame, embed, and object tags
    $('video, audio, object, embed, iframe').remove();

    // 6. Lazy-Loaded Image Resolver: Copy data-src and other lazy attributes directly to src/srcset
    // so images display natively and statically without JavaScript execution
    $('img').each((_, el) => {
      const img = $(el);
      const dataSrc = img.attr('data-src') || 
                      img.attr('data-lazy-src') || 
                      img.attr('data-original') || 
                      img.attr('data-src-medium') || 
                      img.attr('data-src-large');
      if (dataSrc) {
        img.attr('src', dataSrc);
      }
      
      const dataSrcset = img.attr('data-srcset') || img.attr('data-lazy-srcset');
      if (dataSrcset) {
        img.attr('srcset', dataSrcset);
      }
      
      // Remove loading="lazy" to ensure the browser loads it immediately even without scrolling/scripting
      img.removeAttr('loading');
    });

    // Set correct content type and CSP to block dynamic/static media elements and nested iframes
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' data: blob:; script-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none';");
    
    // We do NOT set frame-ancestors or X-Frame-Options that restrict framing!
    res.send($.html());
  } catch (err) {
    res.status(500).send(`Proxy error: ${err instanceof Error ? err.message : String(err)}`);
  }
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
