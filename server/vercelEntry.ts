import 'dotenv/config';
import type { Request, Response } from 'express';
import { createApp, ensureReady } from './app.ts';

const app = createApp({ wsEnabled: false });

export default async function handler(req: Request, res: Response) {
  const origHeader =
    (req.headers['x-vercel-original-uri'] as string | undefined) ||
    (req.headers['x-matched-path'] as string | undefined);
  if (
    (!req.url || req.url === '/' || req.url === '/api/index' || req.url === '/api/index.mjs') &&
    origHeader &&
    origHeader.startsWith('/api') &&
    !origHeader.startsWith('/api/index')
  ) {
    req.url = origHeader;
  }

  if (!req.url || req.url === '/') {
    req.url = '/api';
  } else if (!req.url.startsWith('/api')) {
    req.url = req.url.startsWith('/') ? `/api${req.url}` : `/api/${req.url}`;
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  try {
    if (!contentType.includes('multipart/form-data')) {
      await ensureReady();
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      res.once('finish', done);
      res.once('close', done);
      res.once('error', done);
      try {
        app(req, res);
      } catch (err) {
        console.error('[Orvexa Vercel Handler Error]', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'সার্ভারে একটি অস্থায়ী সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।' });
        }
        done();
      }
    });
  } catch (err) {
    console.error('[Orvexa Vercel Cold Start Error]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'সার্ভার চালু হতে সমস্যা হয়েছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।' });
    }
  }
}
