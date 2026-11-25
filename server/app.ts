import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createPersistentSession,
  extractBearerUser,
  extractRequestHostCandidates,
  getUserById,
  initSessionSecret,
  parseCookieValue,
  requireAdmin,
  requireAuth,
  requireSeller,
  revokePersistentSession,
  setSessionCookie,
  signToken,
  type AuthedRequest,
} from './auth.ts';
import { db, hashPassword, initDatabase, isServerlessEnv, uploadsDir, verifyPassword } from './db.ts';
import { seedInitialData } from './seed.ts';
import {
  buildOrderConfirmSmsBody,
  dispatchSms,
  getSmsGatewayConfig,
  isLikelyPhone,
  normalizeBdPhone,
  validateSafeHttpsWebhook,
  type SmsProviderType,
} from './sms.ts';

export interface CreateAppOptions {
  pushToUser?: (userId: string, event: unknown) => void;
  wsEnabled?: boolean;
}

let readyPromise: Promise<void> | null = null;

export async function ensureReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initDatabase();
      await initSessionSecret();
      await seedInitialData();
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

function asyncHandler(
  fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<void> | void
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next);
  };
}

function normalizeOriginHost(urlStr?: string | null): string | null {
  if (!urlStr) return null;
  const trimmed = urlStr.trim();
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProto).origin;
  } catch {
    return null;
  }
}

export function createApp(options: CreateAppOptions = {}) {
  const pushToUser = options.pushToUser || (() => {});
  const app = express();

  app.set('trust proxy', 1);

  // Normalize Netlify Functions base path so Express routes always match `/api/...`
  app.use((req, _res, next) => {
    if (req.url.startsWith('/.netlify/functions/api')) {
      const rest = req.url.slice('/.netlify/functions/api'.length);
      req.url = rest ? (rest.startsWith('/') ? `/api${rest}` : `/api/${rest}`) : '/api';
    }
    next();
  });

  // Portable CORS middleware for single-origin, reverse-proxy, AI Studio preview, and split-hosted deployments
  const configuredOrigins = new Set(
    (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => normalizeOriginHost(s))
      .filter((s): s is string => Boolean(s))
  );
  for (const envUrl of [
    process.env.APP_URL,
    process.env.SHARED_APP_URL,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.DEPLOY_URL,
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    process.env.CORS_ORIGIN,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN,
    process.env.KOYEB_PUBLIC_DOMAIN,
  ]) {
    const normalized = normalizeOriginHost(envUrl);
    if (normalized) {
      configuredOrigins.add(normalized);
      // Automatically pair AI Studio dev <-> pre origins for the same applet hash (including regional subdomains)
      const aiStudioMatch = normalized.match(/^https:\/\/ais-(dev|pre)-([a-z0-9.-]+)\.run\.app$/i);
      if (aiStudioMatch) {
        const siblingPrefix = aiStudioMatch[1].toLowerCase() === 'dev' ? 'pre' : 'dev';
        configuredOrigins.add(`https://ais-${siblingPrefix}-${aiStudioMatch[2]}.run.app`);
      }
    }
  }

  function isOriginPermitted(origin: string, req: Request): boolean {
    const normalizedOrigin = normalizeOriginHost(origin);
    if (normalizedOrigin && configuredOrigins.has(normalizedOrigin)) {
      return true;
    }
    try {
      const parsedOrigin = new URL(origin);
      const originHost = parsedOrigin.host.toLowerCase();
      const originHostname = parsedOrigin.hostname.toLowerCase();

      // Local development origins
      if (originHostname === 'localhost' || originHostname === '127.0.0.1' || originHostname === '[::1]') {
        return true;
      }

      // Same-host / reverse-proxy host comparison (handles comma-separated X-Forwarded-Host and proxy port mapping)
      const requestHosts = extractRequestHostCandidates(req);
      if (requestHosts.includes(originHost) || requestHosts.includes(originHostname)) {
        return true;
      }

      // AI Studio dev <-> pre sibling preview match against the active proxy host
      const originAiMatch = originHostname.match(/^ais-(dev|pre)-(.+)\.run\.app$/i);
      if (originAiMatch) {
        const expectedCore = originAiMatch[2].toLowerCase();
        if (
          requestHosts.some((rh) => {
            const rhMatch = rh.match(/^ais-(?:dev|pre)-(.+)\.run\.app$/i);
            return Boolean(rhMatch && rhMatch[1].toLowerCase() === expectedCore);
          })
        ) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isOriginPermitted(origin, req)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Requested-With, Accept, Cache-Control, Pragma'
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use((req, _res, next) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('multipart/form-data') && req.body !== undefined) {
      if (typeof req.body === 'string') {
        try {
          req.body = req.body.trim() ? JSON.parse(req.body) : {};
        } catch {
          // keep string body if not JSON
        }
      } else if (Buffer.isBuffer(req.body)) {
        try {
          const text = req.body.toString('utf8').trim();
          req.body = text ? JSON.parse(text) : {};
        } catch {
          // keep buffer body if not JSON
        }
      }
      (req as any)._body = true;
    }
    next();
  });

  app.use(express.json({ limit: '5mb' }));
  app.use('/uploads', express.static(uploadsDir));

  // Never cache auth or health API responses at CDN/proxy edges (Vercel/Netlify/Cloudflare)
  app.use(['/api/auth', '/api/health'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    next();
  });

  // Ensure DB schema, session secret, and initial seed exist on cold starts
  // (Skip pre-handler async wait for multipart uploads so request stream chunks aren't missed before Multer attaches)
  app.use(
    '/api',
    asyncHandler(async (req, _res, next) => {
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      if (req.path === '/upload' && contentType.includes('multipart/form-data')) {
        next();
        return;
      }
      await ensureReady();
      next();
    })
  );

  // Health check for Render / Railway / Koyeb / Fly.io / Vercel / Netlify / Cloud Run
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'orvexa',
      db: db.isRemote ? 'turso' : 'sqlite',
      dbMode: db.mode,
      isRemote: db.isRemote,
      isServerless: isServerlessEnv,
      wsEnabled: Boolean(options.wsEnabled),
      uptime: Math.round(process.uptime()),
      timestamp: Date.now(),
    });
  });

  // Multer configuration for DB-backed permanent image uploads (4MB limit fits serverless limits)
  const allowedMimes = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/bmp',
  ]);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const mime = (file.mimetype || '').toLowerCase();
      const hasImageExt = /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.originalname || '');
      if (allowedMimes.has(mime) || ((!mime || mime === 'application/octet-stream') && hasImageExt)) {
        cb(null, true);
      } else {
        cb(new Error('শুধুমাত্র JPG, PNG, WebP বা GIF ছবি আপলোড করা যাবে।'));
      }
    },
  });

  async function createNotification(
    userId: string,
    type: string,
    title: string,
    body: string,
    link?: string
  ) {
    const id = `notif-${crypto.randomUUID()}`;
    const now = Date.now();
    await db.run(
      `INSERT INTO notifications (id, userId, type, title, body, link, isRead, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      id,
      userId,
      type,
      title,
      body,
      link || null,
      now
    );

    pushToUser(userId, {
      type: 'notification:new',
      notification: { id, userId, type, title, body, link: link || null, isRead: 0, createdAt: now },
    });
  }

  function safeUrl(input: unknown): string | null {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return trimmed;
      }
      return null;
    } catch {
      return null;
    }
  }

  function safeJsonParse<T>(raw: unknown, fallback: T): T {
    if (typeof raw !== 'string' || !raw.trim()) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : (parsed as T);
    } catch {
      return fallback;
    }
  }

  async function getSetting<T>(key: string, fallback: T): Promise<T> {
    const row = await db.get<{ value: string }>(`SELECT value FROM site_settings WHERE key = ?`, key);
    if (!row) return fallback;
    return safeJsonParse<T>(row.value, fallback);
  }

  function isDhakaDistrict(district: string): boolean {
    const clean = district.trim().toLowerCase();
    return clean === 'ঢাকা' || clean === 'dhaka' || /^ঢাকা(\s*\(.*\))?$/i.test(district.trim());
  }

  function calculateDeliveryFeeForDistrict(district: string, paymentCfg?: any): number {
    const dhakaFee = Number(paymentCfg?.dhakaDeliveryFee ?? 70);
    const outsideFee = Number(paymentCfg?.outsideDhakaDeliveryFee ?? 120);
    return isDhakaDistrict(district) ? dhakaFee : outsideFee;
  }

  function generatePromoCode7(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const all = upper + lower + digits;
    const chars: string[] = [
      upper[crypto.randomInt(0, upper.length)],
      lower[crypto.randomInt(0, lower.length)],
      digits[crypto.randomInt(0, digits.length)],
    ];
    while (chars.length < 7) {
      chars.push(all[crypto.randomInt(0, all.length)]);
    }
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  const PROMO_FONT_STYLES = ['mono', 'serif', 'display', 'tracking'] as const;
  const promoVerifyAttempts = new Map<string, { count: number; resetAt: number }>();

  function checkPromoVerifyRateLimit(key: string): boolean {
    const now = Date.now();
    const cur = promoVerifyAttempts.get(key);
    if (!cur || cur.resetAt < now) {
      promoVerifyAttempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
      return true;
    }
    if (cur.count >= 15) return false;
    cur.count += 1;
    return true;
  }

  async function computePhoneOrderStatsMap(
    targetOrders: Array<{ id: string; customerPhone: string }>
  ): Promise<
    Map<
      string,
      {
        normalizedPhone: string;
        confirmedCount: number;
        cancelledCount: number;
        pendingCount: number;
        totalCount: number;
        isFirstTimeBuyer: boolean;
      }
    >
  > {
    const resultMap = new Map<
      string,
      {
        normalizedPhone: string;
        confirmedCount: number;
        cancelledCount: number;
        pendingCount: number;
        totalCount: number;
        isFirstTimeBuyer: boolean;
      }
    >();
    if (targetOrders.length === 0) return resultMap;

    const allOrders = await db.all<{ id: string; customerPhone: string; status: string }>(
      `SELECT id, customerPhone, status FROM orders`
    );

    const byNorm = new Map<string, Array<{ id: string; status: string }>>();
    for (const row of allOrders) {
      const norm = normalizeBdPhone(row.customerPhone);
      if (!norm) continue;
      if (!byNorm.has(norm)) byNorm.set(norm, []);
      byNorm.get(norm)!.push({ id: row.id, status: row.status });
    }

    const confirmedStatuses = new Set(['Confirmed', 'Processing', 'Shipped', 'Delivered']);
    for (const target of targetOrders) {
      const norm = normalizeBdPhone(target.customerPhone);
      const list = norm ? byNorm.get(norm) || [] : [];
      let confirmedCount = 0;
      let cancelledCount = 0;
      let pendingCount = 0;
      let otherCount = 0;
      for (const item of list) {
        if (item.id !== target.id) otherCount++;
        if (confirmedStatuses.has(item.status)) confirmedCount++;
        else if (item.status === 'Cancelled') cancelledCount++;
        else pendingCount++;
      }
      const isFirstTimeBuyer = otherCount === 0 && confirmedCount === 0 && cancelledCount === 0;
      resultMap.set(target.id, {
        normalizedPhone: norm || target.customerPhone,
        confirmedCount,
        cancelledCount,
        pendingCount,
        totalCount: list.length,
        isFirstTimeBuyer,
      });
    }
    return resultMap;
  }

  function parseProductRow(row: any, opts: { includePromoSecret?: boolean } = {}) {
    if (!row) return null;
    const hasPromoCode = Boolean(row.promoCode && Number(row.promoDiscount || 0) > 0);
    const parsed: any = {
      ...row,
      images: (() => {
        try {
          return JSON.parse(row.images || '[]');
        } catch {
          return [];
        }
      })(),
      variations: (() => {
        try {
          return JSON.parse(row.variations || '{}');
        } catch {
          return {};
        }
      })(),
      isFeatured: Boolean(row.isFeatured),
      isTrending: Boolean(row.isTrending),
      isRecommended: Boolean(row.isRecommended),
      isHidden: Boolean(row.isHidden),
      hasPromoCode,
      promoFontStyle: row.promoFontStyle || null,
    };
    if (!opts.includePromoSecret) {
      delete parsed.promoCode;
      delete parsed.promoDiscount;
    } else {
      parsed.promoCode = row.promoCode || null;
      parsed.promoDiscount = Number(row.promoDiscount || 0);
    }
    return parsed;
  }

  async function isMediaReferenced(mediaId: string): Promise<boolean> {
    const needle = `%/api/media/${mediaId}%`;
    const refProd = await db.get(`SELECT id FROM products WHERE images LIKE ? LIMIT 1`, needle);
    if (refProd) return true;
    const refAd = await db.get(`SELECT id FROM homepage_product_ads WHERE customImageUrl LIKE ? LIMIT 1`, needle);
    if (refAd) return true;
    const refBanner = await db.get(`SELECT id FROM advertisements WHERE imageUrl LIKE ? LIMIT 1`, needle);
    if (refBanner) return true;
    const refCat = await db.get(`SELECT id FROM categories WHERE imageUrl LIKE ? LIMIT 1`, needle);
    if (refCat) return true;
    const refUser = await db.get(`SELECT id FROM users WHERE avatarUrl LIKE ? LIMIT 1`, needle);
    if (refUser) return true;
    const refSettings = await db.get(
      `SELECT key FROM site_settings WHERE key NOT LIKE '__internal%' AND key != 'deployHook' AND value LIKE ? LIMIT 1`,
      needle
    );
    return Boolean(refSettings);
  }

  async function cleanupOrphanedMedia(urls: string[]) {
    for (const u of urls) {
      if (typeof u !== 'string') continue;
      const match = u.match(/\/api\/media\/(med-[a-zA-Z0-9-]+)/);
      if (!match) continue;
      const mediaId = match[1];
      if (await isMediaReferenced(mediaId)) continue;
      await db.run(`DELETE FROM media WHERE id = ?`, mediaId);
    }
  }

  function isPrivateOrReservedIp(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
    if (lower.startsWith('::ffff:')) {
      return isPrivateOrReservedIp(lower.slice(7));
    }
    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map(Number);
      if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
      const [a, b] = parts;
      if (a === 0 || a === 10 || a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      if (a >= 224) return true;
    }
    return false;
  }

  async function validateDeployHookUrl(rawUrl: string): Promise<URL> {
    const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 });
    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw bad('অবৈধ Deploy Hook URL। সঠিক https:// লিংক দিন।');
    }
    if (parsed.protocol !== 'https:') {
      throw bad('নিরাপত্তার জন্য শুধুমাত্র HTTPS Deploy Hook URL অনুমোদিত।');
    }
    const host = parsed.hostname.toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.localhost')
    ) {
      throw bad('লোকাল বা প্রাইভেট হোস্ট অনুমোদিত নয়।');
    }
    if (net.isIP(host) && isPrivateOrReservedIp(host)) {
      throw bad('প্রাইভেট বা রিজার্ভড IP অনুমোদিত নয়।');
    }
    try {
      const records = await dns.lookup(host, { all: true });
      for (const rec of records) {
        if (isPrivateOrReservedIp(rec.address)) {
          throw bad('প্রাইভেট নেটওয়ার্ক টার্গেট অনুমোদিত নয়।');
        }
      }
    } catch (err: any) {
      if (err?.status === 400 || err?.message?.includes('অনুমোদিত নয়')) throw err;
    }
    return parsed;
  }

  function maskDeployHookUrl(rawUrl: string): string {
    try {
      const u = new URL(rawUrl);
      const pathParts = u.pathname.split('/').filter(Boolean);
      const last = pathParts[pathParts.length - 1] || '';
      const maskedTail = last.length > 6 ? `${last.slice(0, 3)}••••${last.slice(-4)}` : '••••';
      const prefix = pathParts.slice(0, -1).join('/');
      return `${u.origin}/${prefix ? `${prefix}/` : ''}${maskedTail}`;
    } catch {
      return '••••••••';
    }
  }

  // =======================
  // UPLOAD & MEDIA SERVING
  // =======================
  app.post('/api/upload', (req: AuthedRequest, res, next) => {
    upload.single('image')(req, res, async (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_SIZE'
            ? 'ছবির সাইজ ৪ মেগাবাইটের কম হতে হবে।'
            : err.message || 'ছবি আপলোড ব্যর্থ হয়েছে।';
        res.status(400).json({ error: msg });
        return;
      }
      try {
        await ensureReady();
        const user = await extractBearerUser(req);
        if (!user) {
          res.status(401).json({ error: 'অনুগ্রহ করে আগে সাইন ইন করুন।' });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: 'কোনো ছবি নির্বাচন করা হয়নি।' });
          return;
        }
        const id = `med-${crypto.randomUUID()}`;
        const base64 = req.file.buffer.toString('base64');
        const normalizedMime =
          !req.file.mimetype || req.file.mimetype === 'image/jpg' || req.file.mimetype === 'application/octet-stream'
            ? 'image/jpeg'
            : req.file.mimetype;
        await db.run(
          `INSERT INTO media (id, mimeType, dataBase64, sizeBytes, uploaderId, createdAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
          id,
          normalizedMime,
          base64,
          req.file.size,
          user.id,
          Date.now()
        );
        res.json({ url: `/api/media/${id}` });
      } catch (uploadErr) {
        next(uploadErr);
      }
    });
  });

  app.get(
    '/api/media/:id',
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      if (!/^med-[a-zA-Z0-9-]+$/.test(id)) {
        res.status(400).json({ error: 'অবৈধ মিডিয়া আইডি।' });
        return;
      }
      const row = await db.get<{ mimeType: string; dataBase64: string }>(
        `SELECT mimeType, dataBase64 FROM media WHERE id = ? LIMIT 1`,
        id
      );
      if (!row) {
        res.status(404).json({ error: 'ছবি পাওয়া যায়নি।' });
        return;
      }
      const buf = Buffer.from(row.dataBase64, 'base64');
      res.setHeader('Content-Type', row.mimeType || 'image/jpeg');
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(buf);
    })
  );

  // =======================
  // AUTH ENDPOINTS
  // =======================
  app.post(
    '/api/auth/register',
    asyncHandler(async (req, res) => {
      const { role, fullName, shopName, username, emailOrPhone, password, confirmPassword } = req.body || {};

      if (role !== 'buyer' && role !== 'seller') {
        res.status(400).json({ error: 'সঠিক অ্যাকাউন্টের ধরন (Buyer বা Seller) নির্বাচন করুন।' });
        return;
      }
      if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
        res.status(400).json({ error: 'পূর্ণ নাম লিখুন।' });
        return;
      }
      if (role === 'seller' && (!shopName || typeof shopName !== 'string' || shopName.trim().length < 2)) {
        res.status(400).json({ error: 'আপনার শপের নাম লিখুন।' });
        return;
      }
      if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,30}$/.test(username.trim())) {
        res.status(400).json({ error: 'ইউজারনেম ৩ থেকে ৩০ অক্ষরের মধ্যে হতে হবে (শুধুমাত্র অক্ষর, সংখ্যা, _ . -)।' });
        return;
      }
      if (!emailOrPhone || typeof emailOrPhone !== 'string' || emailOrPhone.trim().length < 5) {
        res.status(400).json({ error: 'সঠিক ইমেইল বা মোবাইল নম্বর দিন।' });
        return;
      }
      if (!password || typeof password !== 'string' || password.length < 6) {
        res.status(400).json({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' });
        return;
      }
      if (password !== confirmPassword) {
        res.status(400).json({ error: 'পাসওয়ার্ড এবং কনফার্ম পাসওয়ার্ড মিলছে না।' });
        return;
      }

      const cleanUsername = username.trim().toLowerCase();
      const rawContact = emailOrPhone.trim();
      const cleanContact = isLikelyPhone(rawContact)
        ? normalizeBdPhone(rawContact)
        : rawContact.toLowerCase();

      let dup = await db.get(
        `SELECT id FROM users WHERE LOWER(username) = ? OR LOWER(emailOrPhone) = ?`,
        cleanUsername,
        cleanContact
      );
      if (!dup && isLikelyPhone(rawContact)) {
        const phoneCandidates = await db.all<{ id: string; emailOrPhone: string }>(
          `SELECT id, emailOrPhone FROM users WHERE emailOrPhone NOT LIKE '%@%'`
        );
        dup = phoneCandidates.find((u) => normalizeBdPhone(u.emailOrPhone) === cleanContact);
      }
      if (dup) {
        res.status(409).json({ error: 'এই ইউজারনেম অথবা ইমেইল/মোবাইল নম্বর দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে।' });
        return;
      }

      const id = `usr-${crypto.randomUUID()}`;
      const now = Date.now();
      await db.run(
        `INSERT INTO users (id, fullName, username, emailOrPhone, passwordHash, role, shopName, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        id,
        fullName.trim(),
        cleanUsername,
        cleanContact,
        hashPassword(password),
        role,
        role === 'seller' ? shopName.trim() : null,
        now
      );

      await createNotification(
        id,
        'account',
        'Orvexa-তে স্বাগতম!',
        role === 'seller'
          ? 'আপনার সেলার অ্যাকাউন্ট তৈরি হয়েছে। এখনই পণ্য যোগ করে বিক্রি শুরু করুন।'
          : 'আপনার ক্রেতা অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে।',
        role === 'seller' ? '/seller' : '/profile'
      );

      const user = (await getUserById(id))!;
      const sessionToken = await createPersistentSession(id);
      setSessionCookie(res, sessionToken, req);
      const token = signToken(id);
      res.status(201).json({ token, user });
    })
  );

  app.post(
    '/api/auth/login',
    asyncHandler(async (req, res) => {
      const { identifier, password } = req.body || {};
      if (!identifier || typeof identifier !== 'string' || !password || typeof password !== 'string') {
        res.status(400).json({ error: 'ইউজারনেম/ইমেইল/ফোন এবং পাসওয়ার্ড দিন।' });
        return;
      }

      const cleanId = identifier.trim().toLowerCase();
      const normPhone = isLikelyPhone(cleanId) ? normalizeBdPhone(cleanId) : '';
      let row = await db.get<{ id: string; passwordHash: string; status: string }>(
        `SELECT id, passwordHash, status FROM users WHERE LOWER(username) = ? OR LOWER(emailOrPhone) = ? LIMIT 1`,
        cleanId,
        cleanId
      );
      if (!row && normPhone) {
        const phoneCandidates = await db.all<{ id: string; emailOrPhone: string; passwordHash: string; status: string }>(
          `SELECT id, emailOrPhone, passwordHash, status FROM users WHERE emailOrPhone NOT LIKE '%@%'`
        );
        row = phoneCandidates.find((u) => normalizeBdPhone(u.emailOrPhone) === normPhone);
      }

      if (!row || !verifyPassword(password, row.passwordHash)) {
        res.status(401).json({ error: 'ইউজারনেম/ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।' });
        return;
      }

      if (row.status === 'blocked') {
        res.status(403).json({ error: 'আপনার অ্যাকাউন্টটি ব্লক করা হয়েছে। সহায়তার জন্য অ্যাডমিনের সাথে যোগাযোগ করুন।' });
        return;
      }
      if (row.status === 'suspended') {
        res.status(403).json({ error: 'আপনার অ্যাকাউন্টটি সাময়িকভাবে স্থগিত করা হয়েছে।' });
        return;
      }

      const user = await getUserById(row.id);
      if (!user) {
        res.status(401).json({ error: 'অ্যাকাউন্টের তথ্য পাওয়া যায়নি।' });
        return;
      }
      const sessionToken = await createPersistentSession(row.id);
      setSessionCookie(res, sessionToken, req);
      const token = signToken(row.id);
      res.json({ token, user });
    })
  );

  app.post(
    '/api/auth/logout',
    asyncHandler(async (req, res) => {
      const rawToken = parseCookieValue(req, SESSION_COOKIE_NAME);
      if (rawToken) {
        await revokePersistentSession(rawToken);
      }
      clearSessionCookie(res, req);
      res.json({ ok: true });
    })
  );

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const token = signToken(req.user!.id);
    res.json({ user: req.user, token });
  });

  app.get(
    '/api/auth/session',
    asyncHandler(async (req, res) => {
      const user = await extractBearerUser(req);
      if (!user) {
        res.json({ authenticated: false, user: null, token: null });
        return;
      }
      const hasCookie = Boolean(parseCookieValue(req, SESSION_COOKIE_NAME));
      if (!hasCookie) {
        const sessionToken = await createPersistentSession(user.id);
        setSessionCookie(res, sessionToken, req);
      }
      const token = signToken(user.id);
      res.json({ authenticated: true, user, token });
    })
  );

  app.put(
    '/api/auth/profile',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const user = req.user!;
      const { fullName, shopName, shopDescription, avatarUrl, emailOrPhone } = req.body || {};

      const nextFullName =
        typeof fullName === 'string' && fullName.trim().length >= 2 ? fullName.trim() : user.fullName;
      const nextShopName =
        user.role === 'seller' && typeof shopName === 'string' && shopName.trim().length >= 2
          ? shopName.trim()
          : user.shopName;
      const nextShopDesc =
        typeof shopDescription === 'string' ? shopDescription.trim().slice(0, 600) : user.shopDescription;
      const nextAvatar = avatarUrl === null ? null : safeUrl(avatarUrl) || user.avatarUrl;
      let nextContact = user.emailOrPhone;

      if (typeof emailOrPhone === 'string' && emailOrPhone.trim().length >= 5) {
        const clean = emailOrPhone.trim().toLowerCase();
        const conflict = await db.get(
          `SELECT id FROM users WHERE LOWER(emailOrPhone) = ? AND id != ?`,
          clean,
          user.id
        );
        if (conflict) {
          res.status(409).json({ error: 'এই ইমেইল বা ফোন নম্বর অন্য অ্যাকাউন্টে ব্যবহৃত হচ্ছে।' });
          return;
        }
        nextContact = clean;
      }

      await db.run(
        `UPDATE users SET fullName = ?, shopName = ?, shopDescription = ?, avatarUrl = ?, emailOrPhone = ?
         WHERE id = ?`,
        nextFullName,
        nextShopName,
        nextShopDesc,
        nextAvatar,
        nextContact,
        user.id
      );

      if (user.role === 'seller' && nextShopName && nextShopName !== user.shopName) {
        await db.run(`UPDATE products SET shopName = ? WHERE sellerId = ?`, nextShopName, user.id);
      }

      res.json({ user: await getUserById(user.id) });
    })
  );

  app.post(
    '/api/auth/change-password',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const user = req.user!;
      const { currentPassword, newPassword, confirmNewPassword } = req.body || {};

      if (!currentPassword || !newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
        res.status(400).json({ error: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' });
        return;
      }
      if (newPassword !== confirmNewPassword) {
        res.status(400).json({ error: 'নতুন পাসওয়ার্ড এবং কনফার্ম পাসওয়ার্ড মিলছে না।' });
        return;
      }

      const row = await db.get<{ passwordHash: string }>(
        `SELECT passwordHash FROM users WHERE id = ?`,
        user.id
      );
      if (!row || !verifyPassword(currentPassword, row.passwordHash)) {
        res.status(400).json({ error: 'বর্তমান পাসওয়ার্ড সঠিক নয়।' });
        return;
      }

      await db.run(`UPDATE users SET passwordHash = ? WHERE id = ?`, hashPassword(newPassword), user.id);
      await createNotification(
        user.id,
        'account',
        'পাসওয়ার্ড পরিবর্তিত হয়েছে',
        'আপনার অ্যাকাউন্টের পাসওয়ার্ড সফলভাবে আপডেট করা হয়েছে।',
        '/profile'
      );
      res.json({ message: 'পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।' });
    })
  );

  app.post(
    '/api/auth/forgot-password',
    asyncHandler(async (req, res) => {
      const { identifier } = req.body || {};
      if (!identifier || typeof identifier !== 'string') {
        res.status(400).json({ error: 'আপনার ইউজারনেম, ইমেইল অথবা মোবাইল নম্বর দিন।' });
        return;
      }
      const cleanId = identifier.trim().toLowerCase();
      const normPhone = isLikelyPhone(cleanId) ? normalizeBdPhone(cleanId) : '';
      const row = await db.get<{ id: string; fullName: string; emailOrPhone: string; role: string }>(
        `SELECT id, fullName, emailOrPhone, role
         FROM users
         WHERE LOWER(username) = ? OR LOWER(emailOrPhone) = ?
         LIMIT 1`,
        cleanId,
        cleanId
      );

      let matchedRow = row;
      if (!matchedRow && normPhone) {
        const candidates = await db.all<{ id: string; fullName: string; emailOrPhone: string; role: string }>(
          `SELECT id, fullName, emailOrPhone, role FROM users WHERE emailOrPhone NOT LIKE '%@%'`
        );
        matchedRow = candidates.find((u) => normalizeBdPhone(u.emailOrPhone) === normPhone);
      }

      if (!matchedRow) {
        res.status(404).json({ error: 'এই তথ্যের সাথে কোনো অ্যাকাউন্ট পাওয়া যায়নি।' });
        return;
      }

      if (matchedRow.role === 'admin') {
        res.status(400).json({
          error: 'অ্যাডমিন অ্যাকাউন্টের পাসওয়ার্ড পরিবর্তনের জন্য লগইন করে প্রোফাইল → পাসওয়ার্ড পরিবর্তন অপশন ব্যবহার করুন।',
        });
        return;
      }

      const phoneRecipient = isLikelyPhone(matchedRow.emailOrPhone)
        ? normalizeBdPhone(matchedRow.emailOrPhone)
        : normPhone;

      if (!phoneRecipient) {
        res.status(400).json({
          error:
            'এই অ্যাকাউন্টে কোনো বৈধ মোবাইল নম্বর যুক্ত নেই। SMS OTP পেতে আপনার মোবাইল নম্বর বা সঠিক ইউজারনেম ব্যবহার করুন।',
        });
        return;
      }

      const resetCode = String(crypto.randomInt(100000, 1000000));
      const codeHash = crypto.createHash('sha256').update(resetCode).digest('hex');
      const expires = Date.now() + 10 * 60 * 1000;
      await db.run(
        `UPDATE users SET resetTokenHash = ?, resetTokenExpires = ?, resetAttempts = 0 WHERE id = ?`,
        codeHash,
        expires,
        matchedRow.id
      );

      const generalCfg = await getSetting<{ siteName?: string }>('generalSettings', { siteName: 'Orvexa' });
      const brandName = generalCfg?.siteName || 'Orvexa';

      const otpMessage = `${brandName} OTP: আপনার পাসওয়ার্ড রিসেট কোড হলো ${resetCode}। মেয়াদ ১০ মিনিট। কাউকে এই কোড দেবেন না।`;
      const maskedLogMessage = `${brandName} OTP: আপনার পাসওয়ার্ড রিসেট কোড হলো ******। মেয়াদ ১০ মিনিট। কাউকে এই কোড দেবেন না।`;

      const smsRes = await dispatchSms({
        recipientPhone: phoneRecipient,
        messageType: 'otp_reset',
        messageBody: otpMessage,
        logBodyOverride: maskedLogMessage,
        referenceId: matchedRow.id,
      });

      if (!smsRes.deliveredViaCarrier) {
        await db.run(
          `UPDATE users SET resetTokenHash = NULL, resetTokenExpires = NULL, resetAttempts = 0 WHERE id = ?`,
          matchedRow.id
        );
        res.status(503).json({
          error:
            smsRes.provider === 'built_in'
              ? 'SMS OTP পাঠানোর জন্য লাইভ SMS গেটওয়ে এখনো যুক্ত করা হয়নি। সাইট অ্যাডমিনকে Admin → SMS ও OTP গেটওয়ে থেকে BulkSMSBD / GreenWeb / Twilio API যুক্ত করতে বলুন। (নিরাপত্তার কারণে OTP স্ক্রিনে দেখানো হয় না।)'
              : 'আপনার নম্বরে SMS OTP পাঠানো যায়নি। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন অথবা অ্যাডমিনকে SMS গেটওয়ে যাচাই করতে বলুন।',
        });
        return;
      }

      const maskedContact = `${phoneRecipient.slice(0, 3)}••••${phoneRecipient.slice(-2)}`;

      res.json({
        message: `আপনার নম্বরে (${maskedContact}) ৬ ডিজিটের OTP পাঠানো হয়েছে। অনুগ্রহ করে ১০ মিনিটের মধ্যে কোডটি লিখে নতুন পাসওয়ার্ড সেট করুন।`,
        otpSentTo: maskedContact,
        provider: smsRes.provider,
        deliveredViaCarrier: true,
      });
    })
  );

  app.post(
    '/api/auth/reset-password',
    asyncHandler(async (req, res) => {
      const { identifier, code, newPassword, confirmPassword } = req.body || {};
      if (!identifier || !code || !newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
        res.status(400).json({ error: 'সঠিক ৬ ডিজিটের OTP এবং কমপক্ষে ৬ অক্ষরের নতুন পাসওয়ার্ড দিন।' });
        return;
      }
      if (newPassword !== confirmPassword) {
        res.status(400).json({ error: 'পাসওয়ার্ড এবং কনফার্ম পাসওয়ার্ড মিলছে না।' });
        return;
      }

      const cleanId = String(identifier).trim().toLowerCase();
      const normPhone = isLikelyPhone(cleanId) ? normalizeBdPhone(cleanId) : '';
      let row = await db.get<{
        id: string;
        resetTokenHash: string | null;
        resetTokenExpires: number | null;
        resetAttempts: number | null;
      }>(
        `SELECT id, resetTokenHash, resetTokenExpires, resetAttempts
         FROM users
         WHERE LOWER(username) = ? OR LOWER(emailOrPhone) = ?
         LIMIT 1`,
        cleanId,
        cleanId
      );

      if (!row && normPhone) {
        const candidates = await db.all<{
          id: string;
          emailOrPhone: string;
          resetTokenHash: string | null;
          resetTokenExpires: number | null;
          resetAttempts: number | null;
        }>(
          `SELECT id, emailOrPhone, resetTokenHash, resetTokenExpires, resetAttempts FROM users WHERE emailOrPhone NOT LIKE '%@%'`
        );
        const found = candidates.find((u) => normalizeBdPhone(u.emailOrPhone) === normPhone);
        if (found) row = found;
      }

      if (!row || !row.resetTokenHash || !row.resetTokenExpires || row.resetTokenExpires < Date.now()) {
        res.status(400).json({ error: 'OTP কোডটি সঠিক নয় বা মেয়াদ শেষ হয়ে গেছে।' });
        return;
      }

      const attempts = Number(row.resetAttempts || 0);
      if (attempts >= 5) {
        res.status(429).json({ error: 'অনেকবার ভুল OTP চেষ্টা করা হয়েছে। অনুগ্রহ করে পুনরায় নতুন OTP নিন।' });
        return;
      }

      const codeHash = crypto.createHash('sha256').update(String(code).trim()).digest('hex');
      const expectedBuf = Buffer.from(row.resetTokenHash, 'hex');
      const providedBuf = Buffer.from(codeHash, 'hex');
      const isMatch = expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);

      if (!isMatch) {
        await db.run(`UPDATE users SET resetAttempts = COALESCE(resetAttempts, 0) + 1 WHERE id = ?`, row.id);
        res.status(400).json({ error: 'প্রদত্ত OTP কোডটি সঠিক নয়। আবার যাচাই করুন।' });
        return;
      }

      await db.run(
        `UPDATE users SET passwordHash = ?, resetTokenHash = NULL, resetTokenExpires = NULL, resetAttempts = 0 WHERE id = ?`,
        hashPassword(newPassword),
        row.id
      );
      await db.run(`DELETE FROM sessions WHERE userId = ?`, row.id);
      res.json({ message: 'OTP যাচাই করে পাসওয়ার্ড সফলভাবে রিসেট করা হয়েছে। এখন লগইন করুন।' });
    })
  );

  // =======================
  // PUBLIC STOREFRONT & CATALOG
  // =======================
  app.get(
    '/api/storefront',
    asyncHandler(async (_req, res) => {
      const rawCategories = await db.all<any>(`SELECT * FROM categories ORDER BY sortOrder ASC, nameEn ASC`);
      const categories = rawCategories.map((c) => ({
        ...c,
        subcategories: (() => {
          try {
            return JSON.parse(c.subcategories || '[]');
          } catch {
            return [];
          }
        })(),
      }));

      const now = Date.now();
      const rawProductAds = await db.all<any>(
        `SELECT a.id as adId, a.promoText, a.customImageUrl, a.sortOrder, a.isActive, a.expiresAt,
                p.*, u.username as sellerUsername, u.fullName as sellerFullName, u.avatarUrl as sellerAvatarUrl
         FROM homepage_product_ads a
         JOIN products p ON p.id = a.productId
         LEFT JOIN users u ON u.id = p.sellerId
         WHERE a.isActive = 1 AND p.isHidden = 0 AND (a.expiresAt IS NULL OR a.expiresAt > ?)
         ORDER BY a.sortOrder ASC, a.createdAt DESC`,
        now
      );

      const homepageProductAds = rawProductAds
        .map((row) => ({
          adId: row.adId,
          promoText: row.promoText,
          customImageUrl: row.customImageUrl,
          sortOrder: row.sortOrder,
          expiresAt: row.expiresAt,
          product: parseProductRow(row),
        }))
        .filter((ad) => Boolean(ad.product && ad.product.id));

      const ads = await db.all<any>(`SELECT * FROM advertisements WHERE isActive = 1 ORDER BY createdAt DESC`);

      const defaultHeroBanners = [
        {
          id: 'banner-1',
          title: 'বাংলাদেশের নির্ভরযোগ্য মাল্টি-ভেন্ডর মার্কেটপ্লেস',
          subtitle:
            'যাচাইকৃত সেলারদের সেরা মানের ফ্যাশন, গ্যাজেট, হোম ডেকোর এবং নিত্যপ্রয়োজনীয় পণ্য কিনুন সাশ্রয়ী মূল্যে ও ক্যাশ অন ডেলিভারিতে।',
          ctaLabel: 'শপিং শুরু করুন',
          ctaTarget: 'products',
          imageUrl: '/src/assets/images/banner_seller_ads_1795274485740.jpg',
          isActive: true,
        },
      ];
      const defaultProductAdsSection = {
        enabled: true,
        heading: 'স্পন্সরড ও বিশেষ প্রচারমূলক পণ্য',
        subheading: 'হোমপেজের শীর্ষে প্রদর্শিত নির্বাচিত সেলারদের পণ্যসমূহ',
      };
      const defaultSellerProductAdsPage = {
        bannerTitle: 'আপনার পণ্যকে আরও বেশি ক্রেতার সামনে তুলে ধরুন!',
        bannerSubtitle: 'Orvexa-তে স্পন্সরড বিজ্ঞাপনের মাধ্যমে আপনার শপের বিক্রি ও পরিচিতি বহুগুণ বাড়িয়ে তুলুন।',
        bannerImageUrl: '/src/assets/images/banner_seller_ads_1795274485740.jpg',
        description:
          'আপনার পণ্যের বিজ্ঞাপন হোমপেজের বিশেষ প্রচারমূলক অংশে প্রকাশ করার মাধ্যমে আরও বেশি ক্রেতার নজরে আসার সুযোগ তৈরি করুন।',
        benefits: [] as string[],
        howItWorks: [] as string[],
        contactHeading: 'আপনার পণ্যের বিজ্ঞাপন প্রকাশ করতে Admin-এর সাথে যোগাযোগ করুন',
        whatsappNumbers: ['01622922252'],
        ctaText: 'WhatsApp-এ মেসেজ দিন',
      };
      const defaultPaymentOptions = {
        cashOnDelivery: true,
        bkashEnabled: false,
        nagadEnabled: false,
        deliveryFee: 70,
        dhakaDeliveryFee: 70,
        outsideDhakaDeliveryFee: 120,
        freeDeliveryThreshold: 0,
      };
      const defaultContactInfo = {
        email: 'support@orvexa.com',
        phone: '01622922252',
        whatsapp: '01622922252',
        address: 'ঢাকা, বাংলাদেশ',
      };
      const defaultFooterSettings = {
        aboutText:
          'Orvexa হলো বাংলাদেশের আধুনিক মাল্টি-ভেন্ডর ই-কমার্স মার্কেটপ্লেস, যেখানে ক্রেতা ও বিক্রেতারা সরাসরি যুক্ত হয়ে নিরাপদ ও দ্রুত কেনাকাটা করতে পারেন।',
        copyrightText: '© ২০২৬ Orvexa. সর্বস্বত্ব সংরক্ষিত।',
      };
      const defaultGeneralSettings = {
        siteName: 'Orvexa',
        announcementText: 'সারা বাংলাদেশে দ্রুত হোম ডেলিভারি ও ক্যাশ অন ডেলিভারি সুবিধা উপলব্ধ।',
        announcementActive: true,
      };
      const defaultCustomCode = {
        enabled: true,
        customCss: '',
        customBannerHtml: '',
        headScripts: '',
        customJs: '',
      };

      const [
        rawHeroBanners,
        rawProductAdsSection,
        rawSellerProductAdsPage,
        rawPay,
        rawContactInfo,
        rawFooterSettings,
        rawGeneralSettings,
        rawCustomCode,
        customPages,
        customBlocks,
      ] = await Promise.all([
        getSetting('heroBanners', defaultHeroBanners),
        getSetting('productAdsSection', defaultProductAdsSection),
        getSetting('sellerProductAdsPage', defaultSellerProductAdsPage),
        getSetting('paymentOptions', defaultPaymentOptions),
        getSetting('contactInfo', defaultContactInfo),
        getSetting('footerSettings', defaultFooterSettings),
        getSetting('generalSettings', defaultGeneralSettings),
        getSetting('customCode', defaultCustomCode),
        getSetting('customPages', []),
        getSetting('customBlocks', []),
      ]);

      const mergedSellerAdsPage = {
        ...defaultSellerProductAdsPage,
        ...(rawSellerProductAdsPage && typeof rawSellerProductAdsPage === 'object' ? rawSellerProductAdsPage : {}),
      };
      mergedSellerAdsPage.whatsappNumbers = Array.isArray(mergedSellerAdsPage.whatsappNumbers)
        ? mergedSellerAdsPage.whatsappNumbers
        : defaultSellerProductAdsPage.whatsappNumbers;
      mergedSellerAdsPage.benefits = Array.isArray(mergedSellerAdsPage.benefits) ? mergedSellerAdsPage.benefits : [];
      mergedSellerAdsPage.howItWorks = Array.isArray(mergedSellerAdsPage.howItWorks)
        ? mergedSellerAdsPage.howItWorks
        : [];

      const safePay = rawPay && typeof rawPay === 'object' ? (rawPay as any) : {};

      res.json({
        wsEnabled: Boolean(options.wsEnabled),
        categories,
        homepageProductAds,
        advertisements: ads,
        settings: {
          heroBanners:
            Array.isArray(rawHeroBanners) && rawHeroBanners.length > 0 ? rawHeroBanners : defaultHeroBanners,
          productAdsSection: {
            ...defaultProductAdsSection,
            ...(rawProductAdsSection && typeof rawProductAdsSection === 'object' ? rawProductAdsSection : {}),
          },
          sellerProductAdsPage: mergedSellerAdsPage,
          paymentOptions: {
            ...defaultPaymentOptions,
            ...safePay,
            deliveryFee: Number(safePay.dhakaDeliveryFee ?? 70),
            dhakaDeliveryFee: Number(safePay.dhakaDeliveryFee ?? 70),
            outsideDhakaDeliveryFee: Number(safePay.outsideDhakaDeliveryFee ?? 120),
            freeDeliveryThreshold: 0,
            cashOnDelivery: true,
            bkashEnabled: false,
            nagadEnabled: false,
          },
          contactInfo: {
            ...defaultContactInfo,
            ...(rawContactInfo && typeof rawContactInfo === 'object' ? rawContactInfo : {}),
          },
          footerSettings: {
            ...defaultFooterSettings,
            ...(rawFooterSettings && typeof rawFooterSettings === 'object' ? rawFooterSettings : {}),
          },
          generalSettings: {
            ...defaultGeneralSettings,
            ...(rawGeneralSettings && typeof rawGeneralSettings === 'object' ? rawGeneralSettings : {}),
          },
          customCode: {
            ...defaultCustomCode,
            ...(rawCustomCode && typeof rawCustomCode === 'object' ? rawCustomCode : {}),
          },
          customPages: Array.isArray(customPages) ? customPages : [],
          customBlocks: Array.isArray(customBlocks) ? customBlocks : [],
        },
      });
    })
  );

  app.get(
    '/api/categories',
    asyncHandler(async (_req, res) => {
      const rawCategories = await db.all<any>(`SELECT * FROM categories ORDER BY sortOrder ASC, nameEn ASC`);
      const categories = rawCategories.map((c) => ({
        ...c,
        subcategories: (() => {
          try {
            return JSON.parse(c.subcategories || '[]');
          } catch {
            return [];
          }
        })(),
      }));
      res.json({ categories });
    })
  );

  app.get(
    '/api/products',
    asyncHandler(async (req, res) => {
      const { search, category, subcategory, sellerId, minPrice, maxPrice, sort, tab } = req.query;

      const where: string[] = ['p.isHidden = 0'];
      const params: unknown[] = [];

      if (typeof search === 'string' && search.trim()) {
        const q = `%${search.trim().toLowerCase()}%`;
        where.push(
          `(LOWER(p.name) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(p.shopName) LIKE ? OR LOWER(p.subcategory) LIKE ? OR LOWER(c.nameEn) LIKE ? OR LOWER(c.nameBn) LIKE ?)`
        );
        params.push(q, q, q, q, q, q);
      }
      if (typeof category === 'string' && category.trim() && category !== 'all') {
        where.push(`(p.categoryId = ? OR c.slug = ?)`);
        params.push(category.trim(), category.trim());
      }
      if (typeof subcategory === 'string' && subcategory.trim() && subcategory !== 'all') {
        where.push(`LOWER(p.subcategory) = ?`);
        params.push(subcategory.trim().toLowerCase());
      }
      if (typeof sellerId === 'string' && sellerId.trim()) {
        where.push(`p.sellerId = ?`);
        params.push(sellerId.trim());
      }
      if (minPrice !== undefined && !Number.isNaN(Number(minPrice)) && String(minPrice).trim() !== '') {
        where.push(`p.currentPrice >= ?`);
        params.push(Number(minPrice));
      }
      if (maxPrice !== undefined && !Number.isNaN(Number(maxPrice)) && String(maxPrice).trim() !== '') {
        where.push(`p.currentPrice <= ?`);
        params.push(Number(maxPrice));
      }

      if (tab === 'featured') where.push('p.isFeatured = 1');
      else if (tab === 'trending') where.push('p.isTrending = 1');
      else if (tab === 'recommended') where.push('p.isRecommended = 1');
      else if (tab === 'discounted') where.push('p.previousPrice IS NOT NULL AND p.previousPrice > p.currentPrice');

      let orderBy = 'p.createdAt DESC';
      if (sort === 'price_asc') orderBy = 'p.currentPrice ASC';
      else if (sort === 'price_desc') orderBy = 'p.currentPrice DESC';
      else if (sort === 'popular' || tab === 'popular') orderBy = 'p.views DESC, p.ratingAvg DESC';

      const rows = await db.all<any>(
        `SELECT p.*, c.nameEn as categoryNameEn, c.nameBn as categoryNameBn,
                u.username as sellerUsername, u.fullName as sellerFullName, u.avatarUrl as sellerAvatarUrl
         FROM products p
         LEFT JOIN categories c ON c.id = p.categoryId
         LEFT JOIN users u ON u.id = p.sellerId
         WHERE ${where.join(' AND ')}
         ORDER BY ${orderBy}`,
        ...params
      );

      res.json({ products: rows.map((r) => parseProductRow(r)) });
    })
  );

  app.get(
    '/api/products/:id',
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const row = await db.get<any>(
        `SELECT p.*, c.nameEn as categoryNameEn, c.nameBn as categoryNameBn,
                u.fullName as sellerFullName, u.username as sellerUsername, u.shopDescription as sellerShopDescription, u.avatarUrl as sellerAvatarUrl
         FROM products p
         LEFT JOIN categories c ON c.id = p.categoryId
         LEFT JOIN users u ON u.id = p.sellerId
         WHERE (p.id = ? OR p.slug = ?) AND p.isHidden = 0
         LIMIT 1`,
        id,
        id
      );

      if (!row) {
        res.status(404).json({ error: 'পণ্যটি খুঁজে পাওয়া যায়নি।' });
        return;
      }

      await db.run(`UPDATE products SET views = views + 1 WHERE id = ?`, row.id);
      const reviews = await db.all<any>(
        `SELECT * FROM reviews WHERE productId = ? ORDER BY createdAt DESC`,
        row.id
      );

      res.json({
        product: parseProductRow({ ...row, views: Number(row.views || 0) + 1 }),
        reviews,
      });
    })
  );

  app.get(
    '/api/sellers/:identifier',
    asyncHandler(async (req, res) => {
      const rawIdentifier = String(req.params.identifier || '').trim().replace(/^@+/, '');
      if (!rawIdentifier || rawIdentifier.length > 100) {
        res.status(400).json({ error: 'সেলারের সঠিক তথ্য দিন।' });
        return;
      }

      const sellerRow = await db.get<any>(
        `SELECT id, username, fullName, role, shopName, shopDescription, avatarUrl, status, createdAt
         FROM users
         WHERE (id = ? OR LOWER(username) = LOWER(?))
           AND status = 'active'
           AND (
             role = 'seller'
             OR EXISTS (SELECT 1 FROM products px WHERE px.sellerId = users.id AND px.isHidden = 0)
           )
         LIMIT 1`,
        rawIdentifier,
        rawIdentifier
      );

      if (!sellerRow) {
        res.status(404).json({ error: 'দুঃখিত, এই সেলারের প্রোফাইল খুঁজে পাওয়া যায়নি।' });
        return;
      }

      const [productRows, deliveredRow] = await Promise.all([
        db.all<any>(
          `SELECT p.*, c.nameEn as categoryNameEn, c.nameBn as categoryNameBn,
                  ? as sellerUsername, ? as sellerFullName, ? as sellerAvatarUrl
           FROM products p
           LEFT JOIN categories c ON c.id = p.categoryId
           WHERE p.sellerId = ? AND p.isHidden = 0
           ORDER BY p.createdAt DESC`,
          sellerRow.username,
          sellerRow.fullName,
          sellerRow.avatarUrl || null,
          sellerRow.id
        ),
        db.get<{ cnt: number }>(
          `SELECT COUNT(DISTINCT o.id) as cnt
           FROM orders o
           JOIN order_items oi ON oi.orderId = o.id
           WHERE oi.sellerId = ? AND o.status = 'Delivered'`,
          sellerRow.id
        ),
      ]);

      const products = productRows.map((r) => parseProductRow(r));
      let totalViews = 0;
      let totalReviews = 0;
      let weightedRatingSum = 0;

      for (const p of products) {
        totalViews += Number(p.views || 0);
        const rc = Number(p.ratingCount || 0);
        const ra = Number(p.ratingAvg || 0);
        if (rc > 0) {
          totalReviews += rc;
          weightedRatingSum += ra * rc;
        }
      }

      const avgRating = totalReviews > 0 ? Number((weightedRatingSum / totalReviews).toFixed(1)) : 0;

      res.json({
        seller: {
          id: sellerRow.id,
          username: sellerRow.username,
          fullName: sellerRow.fullName,
          shopName: sellerRow.shopName || sellerRow.fullName,
          shopDescription: sellerRow.shopDescription || null,
          avatarUrl: sellerRow.avatarUrl || null,
          createdAt: Number(sellerRow.createdAt || Date.now()),
          stats: {
            totalProducts: products.length,
            totalViews,
            avgRating,
            totalReviews,
            deliveredOrders: Number(deliveredRow?.cnt || 0),
          },
        },
        products,
      });
    })
  );

  app.post(
    '/api/products/:id/verify-promo',
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const rawCode = typeof req.body?.promoCode === 'string' ? req.body.promoCode.trim() : '';
      if (!rawCode || rawCode.length > 20) {
        res.status(400).json({ error: 'সঠিক ৭ অক্ষরের প্রোমো কোড দিন।' });
        return;
      }

      const ip = (req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || 'unknown').trim();
      if (!checkPromoVerifyRateLimit(`${ip}:${id}`)) {
        res.status(429).json({ error: 'অনেকবার ভুল প্রোমো কোড চেষ্টা করা হয়েছে। ১০ মিনিট পর আবার চেষ্টা করুন।' });
        return;
      }

      const prod = await db.get<any>(
        `SELECT id, currentPrice, promoCode, promoDiscount FROM products WHERE (id = ? OR slug = ?) AND isHidden = 0 LIMIT 1`,
        id,
        id
      );
      if (!prod) {
        res.status(404).json({ error: 'পণ্যটি খুঁজে পাওয়া যায়নি।' });
        return;
      }
      if (!prod.promoCode || Number(prod.promoDiscount || 0) <= 0) {
        res.status(400).json({ error: 'এই পণ্যটির জন্য কোনো সক্রিয় প্রোমো কোড নেই।' });
        return;
      }

      const expected = Buffer.from(String(prod.promoCode));
      const provided = Buffer.from(rawCode);
      const matched = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
      if (!matched) {
        res.status(400).json({ error: 'প্রোমো কোডটি সঠিক নয়। অনুগ্রহ করে যাচাই করে আবার দিন।' });
        return;
      }

      const originalPrice = Number(prod.currentPrice);
      const promoDiscount = Math.min(Math.max(0, Number(prod.promoDiscount || 0)), Math.max(0, originalPrice - 1));
      const finalPrice = Math.max(1, originalPrice - promoDiscount);

      res.json({
        valid: true,
        productId: prod.id,
        promoCode: prod.promoCode,
        promoDiscount,
        originalPrice,
        finalPrice,
        message: `অভিনন্দন! প্রোমো কোড যাচাই হয়েছে (৳${promoDiscount} ছাড় প্রযোজ্য)।`,
      });
    })
  );

  app.post(
    '/api/products/:id/reviews',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const { rating, comment } = req.body || {};
      const numRating = Number(rating);
      if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
        res.status(400).json({ error: '১ থেকে ৫ এর মধ্যে রেটিং দিন।' });
        return;
      }
      if (!comment || typeof comment !== 'string' || comment.trim().length < 2) {
        res.status(400).json({ error: 'মতামত লিখুন।' });
        return;
      }

      const product = await db.get(`SELECT id FROM products WHERE id = ?`, id);
      if (!product) {
        res.status(404).json({ error: 'পণ্যটি পাওয়া যায়নি।' });
        return;
      }

      const revId = `rev-${crypto.randomUUID()}`;
      const now = Date.now();
      await db.run(
        `INSERT INTO reviews (id, productId, userId, userName, rating, comment, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        revId,
        id,
        req.user!.id,
        req.user!.fullName,
        numRating,
        comment.trim().slice(0, 1000),
        now
      );

      const stats = await db.get<{ avgRating: number; cnt: number }>(
        `SELECT AVG(rating) as avgRating, COUNT(*) as cnt FROM reviews WHERE productId = ?`,
        id
      );
      const nextAvg = Number(Number(stats?.avgRating || numRating).toFixed(1));
      const nextCount = Number(stats?.cnt || 1);
      await db.run(
        `UPDATE products SET ratingAvg = ?, ratingCount = ? WHERE id = ?`,
        nextAvg,
        nextCount,
        id
      );

      res.status(201).json({
        ratingAvg: nextAvg,
        ratingCount: nextCount,
        review: {
          id: revId,
          productId: id,
          userId: req.user!.id,
          userName: req.user!.fullName,
          rating: numRating,
          comment: comment.trim().slice(0, 1000),
          createdAt: now,
        },
      });
    })
  );

  app.post(
    '/api/reports',
    asyncHandler(async (req, res) => {
      const user = await extractBearerUser(req);
      const { reporterName, reportType, targetId, targetName, subject, message } = req.body || {};
      const validTypes = new Set(['customer_message', 'seller_report', 'product_report']);
      if (!validTypes.has(reportType)) {
        res.status(400).json({ error: 'সঠিক রিপোর্টের ধরন নির্বাচন করুন।' });
        return;
      }
      if (!subject || typeof subject !== 'string' || !message || typeof message !== 'string') {
        res.status(400).json({ error: 'বিষয় এবং বিস্তারিত বার্তা লিখুন।' });
        return;
      }

      const id = `rep-${crypto.randomUUID()}`;
      const now = Date.now();
      await db.run(
        `INSERT INTO reports (id, reporterId, reporterName, reportType, targetId, targetName, subject, message, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?)`,
        id,
        user?.id || null,
        user?.fullName || (typeof reporterName === 'string' && reporterName.trim() ? reporterName.trim() : 'ভিজিটর'),
        reportType,
        typeof targetId === 'string' ? targetId : null,
        typeof targetName === 'string' ? targetName : null,
        subject.trim().slice(0, 200),
        message.trim().slice(0, 2000),
        now
      );

      res.status(201).json({ message: 'আপনার বার্তা/রিপোর্ট অ্যাডমিনের কাছে পাঠানো হয়েছে।' });
    })
  );

  // =======================
  // CART & FAVORITES
  // =======================
  app.get(
    '/api/cart',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const rows = await db.all<any>(
        `SELECT c.id, c.productId, c.quantity, c.selectedVariation, c.appliedPromoCode, c.createdAt,
                p.name, p.currentPrice, p.previousPrice, p.stock, p.images, p.shopName, p.sellerId, p.isHidden,
                p.promoCode, p.promoDiscount
         FROM cart_items c
         JOIN products p ON p.id = c.productId
         WHERE c.userId = ?
         ORDER BY c.createdAt DESC`,
        req.user!.id
      );
      res.json({
        items: rows.map((r) => {
          const hasPromoCode = Boolean(r.promoCode && Number(r.promoDiscount || 0) > 0);
          const codeMatches =
            hasPromoCode &&
            typeof r.appliedPromoCode === 'string' &&
            r.appliedPromoCode.trim() === String(r.promoCode);
          const promoDiscount = codeMatches
            ? Math.min(Math.max(0, Number(r.promoDiscount || 0)), Math.max(0, Number(r.currentPrice) - 1))
            : 0;
          const effectivePrice = Math.max(1, Number(r.currentPrice) - promoDiscount);
          const { promoCode: _secret, ...safeRow } = r;
          return {
            ...safeRow,
            images: JSON.parse(r.images || '[]'),
            isHidden: Boolean(r.isHidden),
            hasPromoCode,
            appliedPromoCode: codeMatches ? r.appliedPromoCode : null,
            promoDiscount,
            effectivePrice,
          };
        }),
      });
    })
  );

  app.post(
    '/api/cart',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { productId, quantity, selectedVariation, promoCode } = req.body || {};
      const qty = Math.max(1, Math.min(99, Number(quantity) || 1));

      const product = await db.get<{
        id: string;
        stock: number;
        isHidden: number;
        promoCode: string | null;
        promoDiscount: number | null;
      }>(`SELECT id, stock, isHidden, promoCode, promoDiscount FROM products WHERE id = ?`, productId);

      if (!product || product.isHidden) {
        res.status(404).json({ error: 'পণ্যটি পাওয়া যায়নি।' });
        return;
      }
      if (product.stock < 1) {
        res.status(400).json({ error: 'দুঃখিত, এই পণ্যটি বর্তমানে স্টকে নেই।' });
        return;
      }

      const cleanPromo = typeof promoCode === 'string' ? promoCode.trim() : '';
      const validPromoToApply =
        cleanPromo && product.promoCode && Number(product.promoDiscount || 0) > 0 && cleanPromo === product.promoCode
          ? cleanPromo
          : null;

      const varText = typeof selectedVariation === 'string' ? selectedVariation.trim() : '';
      const existing = await db.get<{ id: string; quantity: number; appliedPromoCode: string | null }>(
        `SELECT id, quantity, appliedPromoCode FROM cart_items WHERE userId = ? AND productId = ? AND COALESCE(selectedVariation, '') = ?`,
        req.user!.id,
        productId,
        varText
      );

      if (existing) {
        const newQty = Math.min(product.stock, existing.quantity + qty);
        await db.run(
          `UPDATE cart_items SET quantity = ?, appliedPromoCode = COALESCE(?, appliedPromoCode) WHERE id = ?`,
          newQty,
          validPromoToApply,
          existing.id
        );
      } else {
        await db.run(
          `INSERT INTO cart_items (id, userId, productId, quantity, selectedVariation, appliedPromoCode, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          `cart-${crypto.randomUUID()}`,
          req.user!.id,
          productId,
          Math.min(product.stock, qty),
          varText || null,
          validPromoToApply,
          Date.now()
        );
      }

      res.status(201).json({ message: 'পণ্যটি কার্টে যোগ করা হয়েছে।' });
    })
  );

  app.patch(
    '/api/cart/:id/promo',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const remove = Boolean(req.body?.remove);
      const rawCode = typeof req.body?.promoCode === 'string' ? req.body.promoCode.trim() : '';

      const item = await db.get<{
        id: string;
        productId: string;
        currentPrice: number;
        promoCode: string | null;
        promoDiscount: number | null;
      }>(
        `SELECT c.id, c.productId, p.currentPrice, p.promoCode, p.promoDiscount
         FROM cart_items c
         JOIN products p ON p.id = c.productId
         WHERE c.id = ? AND c.userId = ?`,
        id,
        req.user!.id
      );

      if (!item) {
        res.status(404).json({ error: 'কার্ট আইটেম পাওয়া যায়নি।' });
        return;
      }

      if (remove || !rawCode) {
        await db.run(`UPDATE cart_items SET appliedPromoCode = NULL WHERE id = ?`, id);
        res.json({ message: 'প্রোমো কোড সরানো হয়েছে।', promoDiscount: 0, effectivePrice: Number(item.currentPrice) });
        return;
      }

      if (!item.promoCode || Number(item.promoDiscount || 0) <= 0) {
        res.status(400).json({ error: 'এই পণ্যটির জন্য কোনো সক্রিয় প্রোমো কোড নেই।' });
        return;
      }

      const expected = Buffer.from(String(item.promoCode));
      const provided = Buffer.from(rawCode);
      const matched = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
      if (!matched) {
        res.status(400).json({ error: 'এই প্রোমো কোডটি এই পণ্যের জন্য সঠিক নয়।' });
        return;
      }

      await db.run(`UPDATE cart_items SET appliedPromoCode = ? WHERE id = ?`, item.promoCode, id);
      const discount = Math.min(Math.max(0, Number(item.promoDiscount || 0)), Math.max(0, Number(item.currentPrice) - 1));
      res.json({
        message: `প্রোমো কোড যুক্ত হয়েছে! ৳${discount} ছাড় প্রযোজ্য।`,
        appliedPromoCode: item.promoCode,
        promoDiscount: discount,
        effectivePrice: Math.max(1, Number(item.currentPrice) - discount),
      });
    })
  );

  app.patch(
    '/api/cart/:id',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const qty = Number(req.body?.quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        res.status(400).json({ error: 'সঠিক পরিমাণ দিন।' });
        return;
      }
      const item = await db.get<{ id: string; stock: number }>(
        `SELECT c.id, p.stock FROM cart_items c JOIN products p ON p.id = c.productId WHERE c.id = ? AND c.userId = ?`,
        id,
        req.user!.id
      );
      if (!item) {
        res.status(404).json({ error: 'কার্ট আইটেম পাওয়া যায়নি।' });
        return;
      }
      await db.run(`UPDATE cart_items SET quantity = ? WHERE id = ?`, Math.min(item.stock, qty), id);
      res.json({ message: 'কার্ট আপডেট হয়েছে।' });
    })
  );

  app.delete(
    '/api/cart/:id',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      await db.run(`DELETE FROM cart_items WHERE id = ? AND userId = ?`, req.params.id, req.user!.id);
      res.json({ message: 'পণ্যটি কার্ট থেকে সরানো হয়েছে।' });
    })
  );

  app.get(
    '/api/favorites',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const rows = await db.all<any>(
        `SELECT p.*, c.nameEn as categoryNameEn, c.nameBn as categoryNameBn
         FROM favorites f
         JOIN products p ON p.id = f.productId
         LEFT JOIN categories c ON c.id = p.categoryId
         WHERE f.userId = ? AND p.isHidden = 0
         ORDER BY f.createdAt DESC`,
        req.user!.id
      );
      res.json({ favorites: rows.map((r) => parseProductRow(r)) });
    })
  );

  app.post(
    '/api/favorites/toggle',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { productId } = req.body || {};
      const exists = await db.get<{ id: string }>(
        `SELECT id FROM favorites WHERE userId = ? AND productId = ?`,
        req.user!.id,
        productId
      );

      if (exists) {
        await db.run(`DELETE FROM favorites WHERE id = ?`, exists.id);
        res.json({ favorited: false, message: 'পছন্দের তালিকা থেকে সরানো হয়েছে।' });
      } else {
        const product = await db.get(`SELECT id FROM products WHERE id = ?`, productId);
        if (!product) {
          res.status(404).json({ error: 'পণ্যটি পাওয়া যায়নি।' });
          return;
        }
        await db.run(
          `INSERT INTO favorites (id, userId, productId, createdAt) VALUES (?, ?, ?, ?)`,
          `fav-${crypto.randomUUID()}`,
          req.user!.id,
          productId,
          Date.now()
        );
        res.json({ favorited: true, message: 'পছন্দের তালিকায় সংরক্ষণ করা হয়েছে।' });
      }
    })
  );

  // =======================
  // ORDERS & CHECKOUT
  // =======================
  app.post(
    '/api/orders',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const user = req.user!;
      const {
        customerName,
        customerPhone,
        backupPhone,
        district,
        thana,
        deliveryAddress,
        directItems,
        fromCart,
      } = req.body || {};

      if (!customerName || typeof customerName !== 'string' || customerName.trim().length < 2) {
        res.status(400).json({ error: 'আপনার পূর্ণ নাম লিখুন।' });
        return;
      }
      const cleanPhone = typeof customerPhone === 'string' ? customerPhone.trim() : '';
      if (!cleanPhone || cleanPhone.includes('@') || !/^[0-9+\-\s]{10,16}$/.test(cleanPhone)) {
        res.status(400).json({ error: 'সঠিক মোবাইল নম্বর দিন (যেমন: 01XXXXXXXXX)। ইমেইল গ্রহণযোগ্য নয়।' });
        return;
      }
      const cleanBackupPhone = typeof backupPhone === 'string' ? backupPhone.trim() : '';
      if (cleanBackupPhone && (cleanBackupPhone.includes('@') || !/^[0-9+\-\s]{10,16}$/.test(cleanBackupPhone))) {
        res.status(400).json({ error: 'সঠিক বিকল্প / দ্বিতীয় মোবাইল নম্বর দিন।' });
        return;
      }
      if (!district || typeof district !== 'string' || !district.trim()) {
        res.status(400).json({ error: 'অনুগ্রহ করে আপনার জেলা নির্বাচন করুন।' });
        return;
      }
      if (!thana || typeof thana !== 'string' || !thana.trim()) {
        res.status(400).json({ error: 'অনুগ্রহ করে আপনার থানা/উপজেলা নির্বাচন করুন।' });
        return;
      }
      if (!deliveryAddress || typeof deliveryAddress !== 'string' || deliveryAddress.trim().length < 4) {
        res.status(400).json({ error: 'ডেলিভারির ঠিকানা লিখুন।' });
        return;
      }

      const paymentCfg = await getSetting('paymentOptions', {
        cashOnDelivery: true,
        bkashEnabled: false,
        nagadEnabled: false,
        deliveryFee: 70,
        dhakaDeliveryFee: 70,
        outsideDhakaDeliveryFee: 120,
        freeDeliveryThreshold: 0,
      });

      const chosenMethod = 'Cash on Delivery';

      try {
        const result = await db.transaction(async (tx) => {
          let requestedItems: Array<{
            productId: string;
            quantity: number;
            variation?: string | null;
            promoCode?: string | null;
          }> = [];

          if (fromCart) {
            const cartRows = await tx.all<{
              productId: string;
              quantity: number;
              selectedVariation: string | null;
              appliedPromoCode: string | null;
            }>(
              `SELECT productId, quantity, selectedVariation, appliedPromoCode FROM cart_items WHERE userId = ?`,
              user.id
            );
            requestedItems = cartRows.map((c) => ({
              productId: c.productId,
              quantity: c.quantity,
              variation: c.selectedVariation,
              promoCode: c.appliedPromoCode,
            }));
          } else if (Array.isArray(directItems)) {
            requestedItems = directItems.map((i: any) => ({
              productId: String(i.productId),
              quantity: Math.max(1, Number(i.quantity) || 1),
              variation: i.variation ? String(i.variation) : null,
              promoCode: i.promoCode ? String(i.promoCode).trim() : null,
            }));
          }

          if (requestedItems.length === 0) {
            throw new Error('অর্ডার করার জন্য কমপক্ষে একটি পণ্য নির্বাচন করুন।');
          }

          let subtotal = 0;
          const lineItems: Array<{
            productId: string;
            sellerId: string;
            productName: string;
            productImage: string;
            shopName: string;
            price: number;
            quantity: number;
            variation: string | null;
            appliedPromoCode: string | null;
            promoDiscount: number;
          }> = [];

          for (const reqItem of requestedItems) {
            const prod = await tx.get<any>(
              `SELECT * FROM products WHERE id = ? AND isHidden = 0`,
              reqItem.productId
            );
            if (!prod) {
              throw new Error('একটি পণ্য আর উপলব্ধ নেই।');
            }
            if (prod.stock < reqItem.quantity) {
              throw new Error(`"${prod.name}" পণ্যটির পর্যাপ্ত স্টক নেই (উপলব্ধ: ${prod.stock})।`);
            }
            const imgs = JSON.parse(prod.images || '[]');
            const basePrice = Number(prod.currentPrice);
            const hasActivePromo = Boolean(prod.promoCode && Number(prod.promoDiscount || 0) > 0);
            const isPromoMatched =
              hasActivePromo &&
              typeof reqItem.promoCode === 'string' &&
              reqItem.promoCode.trim() === String(prod.promoCode);
            const unitPromoDiscount = isPromoMatched
              ? Math.min(Math.max(0, Number(prod.promoDiscount || 0)), Math.max(0, basePrice - 1))
              : 0;
            const unitFinalPrice = Math.max(1, basePrice - unitPromoDiscount);

            subtotal += unitFinalPrice * reqItem.quantity;
            lineItems.push({
              productId: prod.id,
              sellerId: prod.sellerId,
              productName: prod.name,
              productImage: imgs[0] || '',
              shopName: prod.shopName,
              price: unitFinalPrice,
              quantity: reqItem.quantity,
              variation: reqItem.variation || null,
              appliedPromoCode: isPromoMatched ? prod.promoCode : null,
              promoDiscount: unitPromoDiscount,
            });

            await tx.run(`UPDATE products SET stock = stock - ? WHERE id = ?`, reqItem.quantity, prod.id);
          }

          const fee = calculateDeliveryFeeForDistrict(district, paymentCfg);
          const totalAmount = subtotal + fee;
          const orderId = `ord-${crypto.randomUUID()}`;
          const orderNumber = `ORV-${Math.floor(100000 + Math.random() * 900000)}`;
          const now = Date.now();

          await tx.run(
            `INSERT INTO orders (id, orderNumber, buyerId, customerName, customerPhone, backupPhone, district, thana, deliveryAddress, paymentMethod, subtotal, deliveryFee, totalAmount, status, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`,
            orderId,
            orderNumber,
            user.id,
            customerName.trim(),
            cleanPhone,
            cleanBackupPhone || null,
            district.trim(),
            thana.trim(),
            deliveryAddress.trim(),
            chosenMethod,
            subtotal,
            fee,
            totalAmount,
            now,
            now
          );

          const sellerMap = new Map<
            string,
            {
              sellerId: string;
              items: Array<{
                id: string;
                orderId: string;
                productId: string;
                sellerId: string;
                productName: string;
                productImage: string;
                shopName: string;
                price: number;
                quantity: number;
                variation: string | null;
                itemStatus: string;
                appliedPromoCode: string | null;
                promoDiscount: number;
              }>;
              sellerSubtotal: number;
              sellerItemCount: number;
            }
          >();

          for (const li of lineItems) {
            const oiId = `oi-${crypto.randomUUID()}`;
            await tx.run(
              `INSERT INTO order_items (id, orderId, productId, sellerId, productName, productImage, shopName, price, quantity, variation, itemStatus, appliedPromoCode, promoDiscount)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`,
              oiId,
              orderId,
              li.productId,
              li.sellerId,
              li.productName,
              li.productImage,
              li.shopName,
              li.price,
              li.quantity,
              li.variation,
              li.appliedPromoCode,
              li.promoDiscount
            );
            if (!sellerMap.has(li.sellerId)) {
              sellerMap.set(li.sellerId, {
                sellerId: li.sellerId,
                items: [],
                sellerSubtotal: 0,
                sellerItemCount: 0,
              });
            }
            const entry = sellerMap.get(li.sellerId)!;
            entry.items.push({
              id: oiId,
              orderId,
              productId: li.productId,
              sellerId: li.sellerId,
              productName: li.productName,
              productImage: li.productImage,
              shopName: li.shopName,
              price: li.price,
              quantity: li.quantity,
              variation: li.variation,
              itemStatus: 'Pending',
              appliedPromoCode: li.appliedPromoCode,
              promoDiscount: li.promoDiscount,
            });
            entry.sellerSubtotal += li.price * li.quantity;
            entry.sellerItemCount += li.quantity;
          }

          if (fromCart) {
            await tx.run(`DELETE FROM cart_items WHERE userId = ?`, user.id);
          }

          return {
            orderId,
            orderNumber,
            subtotal,
            deliveryFee: fee,
            totalAmount,
            createdAt: now,
            sellerPayloads: Array.from(sellerMap.values()),
          };
        });

        const [phoneStatsMap, smsCfg, generalCfg] = await Promise.all([
          computePhoneOrderStatsMap([{ id: result.orderId, customerPhone: cleanPhone }]),
          getSmsGatewayConfig(),
          getSetting<{ siteName?: string }>('generalSettings', { siteName: 'Orvexa' }),
        ]);
        const phoneStats = phoneStatsMap.get(result.orderId);

        let smsNotification: {
          sent: boolean;
          senderName: string;
          phone: string;
          messageBody: string;
          provider: string;
          status: string;
        } | null = null;

        if (smsCfg.autoOrderSmsEnabled) {
          const siteBrand = generalCfg?.siteName || smsCfg.senderName || 'Orvexa';
          const smsBody = buildOrderConfirmSmsBody(siteBrand, result.orderNumber);
          try {
            const smsRes = await dispatchSms({
              recipientPhone: cleanPhone,
              messageType: 'order_confirmation',
              messageBody: smsBody,
              referenceId: result.orderNumber,
            });
            smsNotification = {
              sent: true,
              senderName: smsRes.senderName,
              phone: cleanPhone,
              messageBody: smsBody,
              provider: smsRes.provider,
              status: smsRes.status,
            };
          } catch {
            // non-fatal SMS logging error should never roll back committed order
          }
        }

        await createNotification(
          user.id,
          'order',
          'অর্ডার সফলভাবে গৃহীত হয়েছে',
          `আপনার অর্ডার #${result.orderNumber} নিশ্চিতকরণের জন্য প্রক্রিয়াধীন রয়েছে।`,
          '/profile'
        );

        const isMultiVendorOrder = result.sellerPayloads.length > 1;
        for (const sp of result.sellerPayloads) {
          const productPreview = sp.items
            .slice(0, 2)
            .map((it) => `${it.productName} ×${it.quantity}`)
            .join(', ');
          const extraMore = sp.items.length > 2 ? ` +আরও ${sp.items.length - 2}টি` : '';
          const phoneLabel = cleanBackupPhone ? `${cleanPhone} / ${cleanBackupPhone}` : cleanPhone;

          await createNotification(
            sp.sellerId,
            'order',
            `নতুন অর্ডার এসেছে! #${result.orderNumber}`,
            `ক্রেতা: ${customerName.trim()} (${phoneLabel}) · ${thana.trim()}, ${district.trim()} · ${productPreview}${extraMore} · মোট ৳${Math.round(sp.sellerSubtotal).toLocaleString('en-US')}`,
            `/seller/orders/${result.orderId}`
          );

          pushToUser(sp.sellerId, {
            type: 'order:new',
            order: {
              id: result.orderId,
              orderNumber: result.orderNumber,
              buyerId: user.id,
              buyerUsername: user.username,
              buyerFullName: user.fullName,
              customerName: customerName.trim(),
              customerPhone: cleanPhone,
              backupPhone: cleanBackupPhone || null,
              district: district.trim(),
              thana: thana.trim(),
              deliveryAddress: deliveryAddress.trim(),
              paymentMethod: chosenMethod,
              subtotal: result.subtotal,
              sellerSubtotal: sp.sellerSubtotal,
              sellerItemCount: sp.sellerItemCount,
              isMultiVendorOrder,
              deliveryFee: result.deliveryFee,
              totalAmount: result.totalAmount,
              status: 'Pending',
              createdAt: result.createdAt,
              updatedAt: result.createdAt,
              items: sp.items,
              phoneStats,
            },
          });
        }

        res.status(201).json({
          orderId: result.orderId,
          orderNumber: result.orderNumber,
          subtotal: result.subtotal,
          deliveryFee: result.deliveryFee,
          totalAmount: result.totalAmount,
          smsNotification,
        });
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'অর্ডার সম্পন্ন করা যায়নি।' });
      }
    })
  );

  app.get(
    '/api/orders',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const user = req.user!;
      const orders = await db.all<any>(
        `SELECT * FROM orders WHERE buyerId = ? ORDER BY createdAt DESC`,
        user.id
      );

      const hydrated = await Promise.all(
        orders.map(async (o) => ({
          ...o,
          items: await db.all<any>(`SELECT * FROM order_items WHERE orderId = ?`, o.id),
        }))
      );

      res.json({ orders: hydrated });
    })
  );

  // =======================
  // SELLER DASHBOARD ENDPOINTS
  // =======================
  app.get(
    '/api/seller/overview',
    requireSeller,
    asyncHandler(async (req: AuthedRequest, res) => {
      const sellerId = req.user!.id;
      const [prodStats, orderStats, unreadInbox] = await Promise.all([
        db.get<{ totalProducts: number; totalViews: number }>(
          `SELECT COUNT(*) as totalProducts, COALESCE(SUM(views), 0) as totalViews FROM products WHERE sellerId = ?`,
          sellerId
        ),
        db.get<{ totalOrders: number; totalRevenue: number }>(
          `SELECT COUNT(DISTINCT oi.orderId) as totalOrders,
                  COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN oi.price * oi.quantity ELSE 0 END), 0) as totalRevenue
           FROM order_items oi
           JOIN orders o ON o.id = oi.orderId
           WHERE oi.sellerId = ?`,
          sellerId
        ),
        db.get<{ cnt: number }>(
          `SELECT COALESCE(SUM(sellerUnread), 0) as cnt FROM conversations WHERE sellerId = ?`,
          sellerId
        ),
      ]);

      res.json({
        totalProducts: Number(prodStats?.totalProducts || 0),
        totalViews: Number(prodStats?.totalViews || 0),
        totalOrders: Number(orderStats?.totalOrders || 0),
        totalRevenue: Number(orderStats?.totalRevenue || 0),
        unreadMessages: Number(unreadInbox?.cnt || 0),
      });
    })
  );

  app.get(
    '/api/seller/products',
    requireSeller,
    asyncHandler(async (req: AuthedRequest, res) => {
      const rows = await db.all<any>(
        `SELECT p.*, c.nameEn as categoryNameEn, c.nameBn as categoryNameBn
         FROM products p LEFT JOIN categories c ON c.id = p.categoryId
         WHERE p.sellerId = ?
         ORDER BY p.createdAt DESC`,
        req.user!.id
      );
      res.json({ products: rows.map((r) => parseProductRow(r, { includePromoSecret: true })) });
    })
  );

  app.post(
    '/api/seller/products',
    requireSeller,
    asyncHandler(async (req: AuthedRequest, res) => {
      const user = req.user!;
      const {
        name,
        description,
        categoryId,
        subcategory,
        previousPrice,
        currentPrice,
        stock,
        images,
        variations,
        shopName,
        promoEnabled,
        promoDiscount,
        promoCode,
        promoFontStyle,
      } = req.body || {};

      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        res.status(400).json({ error: 'পণ্যের নাম লিখুন।' });
        return;
      }
      const priceNum = Number(currentPrice);
      if (Number.isNaN(priceNum) || priceNum <= 0) {
        res.status(400).json({ error: 'সঠিক বিক্রয় মূল্য দিন।' });
        return;
      }
      const prevNum =
        previousPrice !== undefined && previousPrice !== null && previousPrice !== '' ? Number(previousPrice) : null;
      const stockNum = Math.max(0, parseInt(String(stock ?? 0), 10) || 0);
      const imgArray = Array.isArray(images) ? images.filter((u) => typeof u === 'string' && u.trim()) : [];
      if (imgArray.length === 0) {
        res.status(400).json({ error: 'কমপক্ষে একটি পণ্যের ছবি যোগ করুন।' });
        return;
      }

      let finalPromoCode: string | null = null;
      let finalPromoDiscount = 0;
      let finalPromoFont: string | null = null;
      if (promoEnabled) {
        const disc = Number(promoDiscount);
        if (Number.isNaN(disc) || disc <= 0 || disc >= priceNum) {
          res.status(400).json({ error: 'প্রোমো ছাড়ের পরিমাণ ১ টাকা থেকে বিক্রয় মূল্যের কম হতে হবে।' });
          return;
        }
        finalPromoDiscount = Math.round(disc);
        const reqCode = typeof promoCode === 'string' ? promoCode.trim() : '';
        finalPromoCode = /^[A-Za-z0-9]{7}$/.test(reqCode) ? reqCode : generatePromoCode7();
        finalPromoFont =
          typeof promoFontStyle === 'string' && (PROMO_FONT_STYLES as readonly string[]).includes(promoFontStyle)
            ? promoFontStyle
            : PROMO_FONT_STYLES[crypto.randomInt(0, PROMO_FONT_STYLES.length)];
      }

      const id = `prod-${crypto.randomUUID()}`;
      const slugBase =
        name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'product';
      const slug = `${slugBase}-${id.slice(-6)}`;
      const now = Date.now();

      await db.run(
        `INSERT INTO products (
          id, slug, sellerId, shopName, name, description, categoryId, subcategory,
          previousPrice, currentPrice, stock, images, variations,
          promoCode, promoDiscount, promoFontStyle,
          isFeatured, isTrending, isRecommended, isHidden, views, ratingAvg, ratingCount, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 5.0, 0, ?)`,
        id,
        slug,
        user.id,
        (typeof shopName === 'string' && shopName.trim()) || user.shopName || user.fullName,
        name.trim(),
        typeof description === 'string' ? description.trim() : '',
        String(categoryId || 'cat-other'),
        String(subcategory || 'Other Products'),
        prevNum,
        priceNum,
        stockNum,
        JSON.stringify(imgArray),
        JSON.stringify(variations && typeof variations === 'object' ? variations : {}),
        finalPromoCode,
        finalPromoDiscount,
        finalPromoFont,
        now
      );

      const created = await db.get(`SELECT * FROM products WHERE id = ?`, id);
      res.status(201).json({ product: parseProductRow(created, { includePromoSecret: true }) });
    })
  );

  app.put(
    '/api/seller/products/:id',
    requireSeller,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const existing = await db.get<any>(`SELECT * FROM products WHERE id = ?`, id);
      if (!existing) {
        res.status(404).json({ error: 'পণ্যটি পাওয়া যায়নি।' });
        return;
      }
      if (existing.sellerId !== req.user!.id && req.user!.role !== 'admin') {
        res.status(403).json({ error: 'আপনি এই পণ্য সম্পাদনা করতে পারবেন না।' });
        return;
      }

      const {
        name,
        description,
        categoryId,
        subcategory,
        previousPrice,
        currentPrice,
        stock,
        shopName,
        images,
        variations,
        promoEnabled,
        promoDiscount,
        promoCode,
        promoFontStyle,
      } = req.body || {};

      const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
      const nextShopName =
        typeof shopName === 'string' && shopName.trim() ? shopName.trim() : existing.shopName;
      const nextDesc = typeof description === 'string' ? description.trim() : existing.description;
      const nextCat = typeof categoryId === 'string' ? categoryId : existing.categoryId;
      const nextSub = typeof subcategory === 'string' ? subcategory : existing.subcategory;
      const nextPrice = currentPrice !== undefined ? Number(currentPrice) : existing.currentPrice;
      const nextPrev =
        previousPrice === '' || previousPrice === null
          ? null
          : previousPrice !== undefined
            ? Number(previousPrice)
            : existing.previousPrice;
      const nextStock = stock !== undefined ? Math.max(0, parseInt(String(stock), 10) || 0) : existing.stock;
      const nextImages = Array.isArray(images) && images.length > 0 ? JSON.stringify(images) : existing.images;
      const nextVars = variations ? JSON.stringify(variations) : existing.variations;

      let nextPromoCode: string | null = existing.promoCode || null;
      let nextPromoDiscount = Number(existing.promoDiscount || 0);
      let nextPromoFont: string | null = existing.promoFontStyle || null;

      if (promoEnabled === false) {
        nextPromoCode = null;
        nextPromoDiscount = 0;
        nextPromoFont = null;
      } else if (promoEnabled === true) {
        const disc = Number(promoDiscount);
        if (Number.isNaN(disc) || disc <= 0 || disc >= nextPrice) {
          res.status(400).json({ error: 'প্রোমো ছাড়ের পরিমাণ ১ টাকা থেকে বিক্রয় মূল্যের কম হতে হবে।' });
          return;
        }
        nextPromoDiscount = Math.round(disc);
        const reqCode = typeof promoCode === 'string' ? promoCode.trim() : '';
        nextPromoCode = /^[A-Za-z0-9]{7}$/.test(reqCode)
          ? reqCode
          : existing.promoCode && /^[A-Za-z0-9]{7}$/.test(String(existing.promoCode))
            ? existing.promoCode
            : generatePromoCode7();
        nextPromoFont =
          typeof promoFontStyle === 'string' && (PROMO_FONT_STYLES as readonly string[]).includes(promoFontStyle)
            ? promoFontStyle
            : existing.promoFontStyle || PROMO_FONT_STYLES[crypto.randomInt(0, PROMO_FONT_STYLES.length)];
      }

      await db.run(
        `UPDATE products
         SET name = ?, shopName = ?, description = ?, categoryId = ?, subcategory = ?, previousPrice = ?, currentPrice = ?, stock = ?, images = ?, variations = ?,
             promoCode = ?, promoDiscount = ?, promoFontStyle = ?
         WHERE id = ?`,
        nextName,
        nextShopName,
        nextDesc,
        nextCat,
        nextSub,
        nextPrev,
        nextPrice,
        nextStock,
        nextImages,
        nextVars,
        nextPromoCode,
        nextPromoDiscount,
        nextPromoFont,
        id
      );

      if (Array.isArray(images) && images.length > 0) {
        try {
          const oldImages: string[] = JSON.parse(existing.images || '[]');
          const nextSet = new Set(images);
          const removed = oldImages.filter((u) => !nextSet.has(u));
          if (removed.length > 0) await cleanupOrphanedMedia(removed);
        } catch {
          // non-fatal cleanup
        }
      }

      const updated = await db.get(`SELECT * FROM products WHERE id = ?`, id);
      res.json({ product: parseProductRow(updated, { includePromoSecret: true }) });
    })
  );

  app.delete(
    '/api/seller/products/:id',
    requireSeller,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const existing = await db.get<{ sellerId: string; images: string }>(
        `SELECT sellerId, images FROM products WHERE id = ?`,
        id
      );
      if (!existing) {
        res.status(404).json({ error: 'পণ্যটি পাওয়া যায়নি।' });
        return;
      }
      if (existing.sellerId !== req.user!.id && req.user!.role !== 'admin') {
        res.status(403).json({ error: 'আপনি এই পণ্য মুছতে পারবেন না।' });
        return;
      }
      await db.run(`DELETE FROM products WHERE id = ?`, id);
      try {
        await cleanupOrphanedMedia(JSON.parse(existing.images || '[]'));
      } catch {
        // non-fatal cleanup
      }
      res.json({ message: 'পণ্যটি মুছে ফেলা হয়েছে।' });
    })
  );

  app.get(
    '/api/seller/orders',
    requireSeller,
    asyncHandler(async (req: AuthedRequest, res) => {
      const sellerId = req.user!.id;
      const orders = await db.all<any>(
        `SELECT DISTINCT o.*, b.username as buyerUsername, b.fullName as buyerFullName
         FROM orders o
         JOIN order_items oi ON oi.orderId = o.id
         LEFT JOIN users b ON b.id = o.buyerId
         WHERE oi.sellerId = ?
         ORDER BY o.createdAt DESC`,
        sellerId
      );

      const phoneStatsMap = await computePhoneOrderStatsMap(orders);

      const hydrated = await Promise.all(
        orders.map(async (o) => {
          const [items, totalCntRow] = await Promise.all([
            db.all<any>(`SELECT * FROM order_items WHERE orderId = ? AND sellerId = ?`, o.id, sellerId),
            db.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM order_items WHERE orderId = ?`, o.id),
          ]);
          const sellerSubtotal = items.reduce(
            (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
            0
          );
          const sellerItemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
          return {
            ...o,
            items,
            sellerSubtotal,
            sellerItemCount,
            isMultiVendorOrder: Number(totalCntRow?.cnt || 0) > items.length,
            phoneStats: phoneStatsMap.get(o.id),
          };
        })
      );

      res.json({ orders: hydrated });
    })
  );

  app.post(
    '/api/seller/orders/:orderId/conversation',
    requireSeller,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { orderId } = req.params;
      const sellerId = req.user!.id;

      const ownedItem = await db.get<any>(
        `SELECT * FROM order_items WHERE orderId = ? AND sellerId = ? LIMIT 1`,
        orderId,
        sellerId
      );

      if (!ownedItem) {
        res.status(403).json({ error: 'এই অর্ডারের ক্রেতার সাথে চ্যাট করার অনুমতি নেই।' });
        return;
      }

      const order = await db.get<{ id: string; buyerId: string; orderNumber: string }>(
        `SELECT id, buyerId, orderNumber FROM orders WHERE id = ?`,
        orderId
      );
      if (!order) {
        res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি।' });
        return;
      }
      if (order.buyerId === sellerId) {
        res.status(400).json({ error: 'নিজের সাথে চ্যাট শুরু করা যাবে না।' });
        return;
      }

      const existing = await db.get<any>(
        `SELECT * FROM conversations WHERE buyerId = ? AND sellerId = ? AND COALESCE(productId, '') = ? LIMIT 1`,
        order.buyerId,
        sellerId,
        ownedItem.productId || ''
      );

      if (existing) {
        res.json({ conversation: existing });
        return;
      }

      const anyConv = await db.get<any>(
        `SELECT * FROM conversations WHERE buyerId = ? AND sellerId = ? ORDER BY lastMessageAt DESC LIMIT 1`,
        order.buyerId,
        sellerId
      );

      if (anyConv) {
        res.json({ conversation: anyConv });
        return;
      }

      const id = `conv-${crypto.randomUUID()}`;
      const now = Date.now();
      await db.run(
        `INSERT INTO conversations (id, buyerId, sellerId, productId, productName, productImage, productPrice, lastMessage, lastMessageAt, buyerUnread, sellerUnread)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        id,
        order.buyerId,
        sellerId,
        ownedItem.productId || null,
        ownedItem.productName || `অর্ডার #${order.orderNumber}`,
        ownedItem.productImage || null,
        ownedItem.price || null,
        `অর্ডার #${order.orderNumber} সংক্রান্ত যোগাযোগ`,
        now
      );

      const created = await db.get(`SELECT * FROM conversations WHERE id = ?`, id);
      res.status(201).json({ conversation: created });
    })
  );

  app.patch(
    '/api/seller/orders/:orderId/status',
    requireSeller,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { orderId } = req.params;
      const { status } = req.body || {};
      const validStatuses = new Set(['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled']);
      if (!validStatuses.has(status)) {
        res.status(400).json({ error: 'সঠিক অর্ডার স্ট্যাটাস দিন।' });
        return;
      }

      const ownsItem = await db.get(
        `SELECT id FROM order_items WHERE orderId = ? AND sellerId = ? LIMIT 1`,
        orderId,
        req.user!.id
      );
      if (!ownsItem && req.user!.role !== 'admin') {
        res.status(403).json({ error: 'এই অর্ডার পরিবর্তন করার অনুমতি নেই।' });
        return;
      }

      const order = await db.get<any>(`SELECT * FROM orders WHERE id = ?`, orderId);
      if (!order) {
        res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি।' });
        return;
      }

      await db.transaction(async (tx) => {
        if (order.status !== 'Cancelled' && status === 'Cancelled') {
          const sellerItems = await tx.all<{ productId: string; quantity: number }>(
            `SELECT productId, quantity FROM order_items WHERE orderId = ? AND sellerId = ? AND itemStatus != 'Cancelled'`,
            orderId,
            req.user!.id
          );
          for (const it of sellerItems) {
            await tx.run(`UPDATE products SET stock = stock + ? WHERE id = ?`, Number(it.quantity || 0), it.productId);
          }
        }
        await tx.run(
          `UPDATE order_items SET itemStatus = ? WHERE orderId = ? AND sellerId = ?`,
          status,
          orderId,
          req.user!.id
        );
        await tx.run(`UPDATE orders SET status = ?, updatedAt = ? WHERE id = ?`, status, Date.now(), orderId);
      });

      await createNotification(
        order.buyerId,
        'order',
        'অর্ডার স্ট্যাটাস আপডেট',
        `আপনার অর্ডার #${order.orderNumber} এর বর্তমান অবস্থা: ${status}`,
        '/profile'
      );
      pushToUser(order.buyerId, { type: 'order:updated', orderId, status });
      pushToUser(req.user!.id, { type: 'order:updated', orderId, status });

      res.json({ message: 'অর্ডার স্ট্যাটাস আপডেট হয়েছে।' });
    })
  );

  // =======================
  // MESSAGING / INBOX
  // =======================
  app.get(
    '/api/conversations',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const uid = req.user!.id;
      const rows = await db.all<any>(
        `SELECT c.*,
                b.fullName as buyerName, b.username as buyerUsername, b.avatarUrl as buyerAvatar,
                s.fullName as sellerName, s.shopName as sellerShopName, s.username as sellerUsername, s.avatarUrl as sellerAvatar
         FROM conversations c
         JOIN users b ON b.id = c.buyerId
         JOIN users s ON s.id = c.sellerId
         WHERE c.buyerId = ? OR c.sellerId = ?
         ORDER BY c.lastMessageAt DESC`,
        uid,
        uid
      );
      res.json({ conversations: rows });
    })
  );

  app.post(
    '/api/conversations',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const user = req.user!;
      const { sellerId, productId } = req.body || {};

      if (!sellerId || typeof sellerId !== 'string') {
        res.status(400).json({ error: 'সেলার তথ্য প্রয়োজন।' });
        return;
      }
      if (sellerId === user.id) {
        res.status(400).json({ error: 'নিজের সাথে চ্যাট শুরু করা যাবে না।' });
        return;
      }

      const seller = await db.get<{ id: string; role: string }>(
        `SELECT id, role FROM users WHERE id = ?`,
        sellerId
      );
      if (!seller) {
        res.status(404).json({ error: 'সেলার অ্যাকাউন্ট পাওয়া যায়নি।' });
        return;
      }

      const existing = await db.get<any>(
        `SELECT * FROM conversations WHERE buyerId = ? AND sellerId = ? AND COALESCE(productId, '') = ? LIMIT 1`,
        user.id,
        sellerId,
        productId || ''
      );

      if (existing) {
        res.json({ conversation: existing });
        return;
      }

      let prodName: string | null = null;
      let prodImg: string | null = null;
      let prodPrice: number | null = null;
      if (productId) {
        const prod = await db.get<any>(`SELECT name, images, currentPrice FROM products WHERE id = ?`, productId);
        if (prod) {
          prodName = prod.name;
          const imgs = JSON.parse(prod.images || '[]');
          prodImg = imgs[0] || null;
          prodPrice = prod.currentPrice;
        }
      }

      const id = `conv-${crypto.randomUUID()}`;
      const now = Date.now();
      await db.run(
        `INSERT INTO conversations (id, buyerId, sellerId, productId, productName, productImage, productPrice, lastMessage, lastMessageAt, buyerUnread, sellerUnread)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, 0, 0)`,
        id,
        user.id,
        sellerId,
        productId || null,
        prodName,
        prodImg,
        prodPrice,
        now
      );

      const created = await db.get(`SELECT * FROM conversations WHERE id = ?`, id);
      res.status(201).json({ conversation: created });
    })
  );

  app.get(
    '/api/conversations/:id/messages',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const user = req.user!;
      const conv = await db.get<any>(`SELECT * FROM conversations WHERE id = ?`, id);
      if (!conv) {
        res.status(404).json({ error: 'কথোপকথন পাওয়া যায়নি।' });
        return;
      }
      if (conv.buyerId !== user.id && conv.sellerId !== user.id && user.role !== 'admin') {
        res.status(403).json({ error: 'এই মেসেজ দেখার অনুমতি নেই।' });
        return;
      }

      if (conv.buyerId === user.id) {
        await db.run(`UPDATE conversations SET buyerUnread = 0 WHERE id = ?`, id);
      } else if (conv.sellerId === user.id) {
        await db.run(`UPDATE conversations SET sellerUnread = 0 WHERE id = ?`, id);
      }

      const messages = await db.all<any>(
        `SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC`,
        id
      );
      res.json({ conversation: conv, messages });
    })
  );

  app.post(
    '/api/conversations/:id/messages',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const user = req.user!;
      const { text } = req.body || {};

      if (!text || typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ error: 'বার্তা লিখুন।' });
        return;
      }

      const conv = await db.get<any>(`SELECT * FROM conversations WHERE id = ?`, id);
      if (!conv) {
        res.status(404).json({ error: 'কথোপকথন পাওয়া যায়নি।' });
        return;
      }
      if (conv.buyerId !== user.id && conv.sellerId !== user.id) {
        res.status(403).json({ error: 'মেসেজ পাঠানোর অনুমতি নেই।' });
        return;
      }

      const cleanText = text.trim().slice(0, 2000);
      const msgId = `msg-${crypto.randomUUID()}`;
      const now = Date.now();

      await db.run(
        `INSERT INTO messages (id, conversationId, senderId, text, createdAt) VALUES (?, ?, ?, ?, ?)`,
        msgId,
        id,
        user.id,
        cleanText,
        now
      );

      const isBuyerSender = conv.buyerId === user.id;
      const recipientId = isBuyerSender ? conv.sellerId : conv.buyerId;
      await db.run(
        `UPDATE conversations
         SET lastMessage = ?, lastMessageAt = ?,
             sellerUnread = sellerUnread + ?,
             buyerUnread = buyerUnread + ?
         WHERE id = ?`,
        cleanText,
        now,
        isBuyerSender ? 1 : 0,
        isBuyerSender ? 0 : 1,
        id
      );

      const message = { id: msgId, conversationId: id, senderId: user.id, text: cleanText, createdAt: now };

      pushToUser(recipientId, { type: 'message:new', conversationId: id, message });
      pushToUser(user.id, { type: 'message:new', conversationId: id, message });

      await createNotification(
        recipientId,
        'message',
        `${user.shopName || user.fullName} থেকে নতুন মেসেজ`,
        cleanText.slice(0, 80),
        '/inbox'
      );

      res.status(201).json({ message });
    })
  );

  // =======================
  // NOTIFICATIONS
  // =======================
  app.get(
    '/api/notifications',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const rows = await db.all<any>(
        `SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 50`,
        req.user!.id
      );
      res.json({ notifications: rows });
    })
  );

  app.post(
    '/api/notifications/read-all',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      await db.run(`UPDATE notifications SET isRead = 1 WHERE userId = ?`, req.user!.id);
      res.json({ ok: true });
    })
  );

  app.patch(
    '/api/notifications/:id/read',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      await db.run(
        `UPDATE notifications SET isRead = 1 WHERE id = ? AND userId = ?`,
        req.params.id,
        req.user!.id
      );
      res.json({ ok: true });
    })
  );

  // =======================
  // ADMIN DASHBOARD ROUTES
  // =======================
  async function fetchAdminOverview() {
    const [uRow, bRow, sRow, pRow, oRow, mRow, rRow, revRow] = await Promise.all([
      db.get<{ c: number }>(`SELECT COUNT(*) as c FROM users WHERE role != 'admin'`),
      db.get<{ c: number }>(`SELECT COUNT(*) as c FROM users WHERE role = 'buyer'`),
      db.get<{ c: number }>(`SELECT COUNT(*) as c FROM users WHERE role = 'seller'`),
      db.get<{ c: number }>(`SELECT COUNT(*) as c FROM products`),
      db.get<{ c: number }>(`SELECT COUNT(*) as c FROM orders`),
      db.get<{ c: number }>(`SELECT COUNT(*) as c FROM messages`),
      db.get<{ c: number }>(`SELECT COUNT(*) as c FROM reports WHERE status = 'Open'`),
      db.get<{ s: number }>(`SELECT COALESCE(SUM(totalAmount), 0) as s FROM orders WHERE status != 'Cancelled'`),
    ]);
    return {
      totalUsers: Number(uRow?.c || 0),
      totalBuyers: Number(bRow?.c || 0),
      totalSellers: Number(sRow?.c || 0),
      totalProducts: Number(pRow?.c || 0),
      totalOrders: Number(oRow?.c || 0),
      totalMessages: Number(mRow?.c || 0),
      openReports: Number(rRow?.c || 0),
      totalRevenue: Number(revRow?.s || 0),
    };
  }

  app.get(
    '/api/admin/bootstrap',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const [overview, users, prodRows, rawOrders, rawProductAds, ads, reports, conversations] = await Promise.all([
        fetchAdminOverview(),
        db.all<any>(
          `SELECT id, fullName, username, emailOrPhone, role, shopName, shopDescription, avatarUrl, status, createdAt
           FROM users ORDER BY createdAt DESC`
        ),
        db.all<any>(
          `SELECT p.*, c.nameEn as categoryNameEn, c.nameBn as categoryNameBn
           FROM products p LEFT JOIN categories c ON c.id = p.categoryId
           ORDER BY p.createdAt DESC`
        ),
        db.all<any>(`SELECT * FROM orders ORDER BY createdAt DESC`),
        db.all<any>(
          `SELECT a.*, p.name as productName, p.currentPrice, p.images, p.shopName
           FROM homepage_product_ads a
           JOIN products p ON p.id = a.productId
           ORDER BY a.sortOrder ASC, a.createdAt DESC`
        ),
        db.all<any>(`SELECT * FROM advertisements ORDER BY createdAt DESC`),
        db.all<any>(`SELECT * FROM reports ORDER BY createdAt DESC`),
        db.all<any>(
          `SELECT c.*, b.fullName as buyerName, s.shopName as sellerShopName, s.fullName as sellerName
           FROM conversations c
           JOIN users b ON b.id = c.buyerId
           JOIN users s ON s.id = c.sellerId
           ORDER BY c.lastMessageAt DESC LIMIT 100`
        ),
      ]);

      const phoneStatsMap = await computePhoneOrderStatsMap(rawOrders);
      const orders = await Promise.all(
        rawOrders.map(async (o) => ({
          ...o,
          items: (await db.all<any>(`SELECT * FROM order_items WHERE orderId = ?`, o.id)) || [],
          phoneStats: phoneStatsMap.get(o.id),
        }))
      );

      res.json({
        overview,
        users,
        products: prodRows.map((r) => parseProductRow(r, { includePromoSecret: true })).filter(Boolean),
        orders,
        productAds: rawProductAds.map((r) => ({ ...r, images: safeJsonParse<string[]>(r.images, []), isActive: Boolean(r.isActive) })),
        ads,
        reports,
        conversations,
        storageStatus: {
          isRemote: db.isRemote,
          isServerless: isServerlessEnv,
          dbMode: db.mode,
        },
      });
    })
  );

  app.get(
    '/api/admin/overview',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      res.json(await fetchAdminOverview());
    })
  );

  app.get(
    '/api/admin/users',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const users = await db.all<any>(
        `SELECT id, fullName, username, emailOrPhone, role, shopName, shopDescription, avatarUrl, status, createdAt
         FROM users ORDER BY createdAt DESC`
      );
      res.json({ users });
    })
  );

  app.patch(
    '/api/admin/users/:id/status',
    requireAdmin,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const { status } = req.body || {};
      if (!['active', 'blocked', 'suspended'].includes(status)) {
        res.status(400).json({ error: 'সঠিক স্ট্যাটাস দিন।' });
        return;
      }
      if (id === req.user!.id) {
        res.status(400).json({ error: 'নিজের অ্যাডমিন অ্যাকাউন্ট ব্লক করা যাবে না।' });
        return;
      }
      await db.run(`UPDATE users SET status = ? WHERE id = ?`, status, id);
      res.json({ message: 'ব্যবহারকারীর স্ট্যাটাস আপডেট হয়েছে।' });
    })
  );

  app.delete(
    '/api/admin/users/:id',
    requireAdmin,
    asyncHandler(async (req: AuthedRequest, res) => {
      const { id } = req.params;
      if (id === req.user!.id) {
        res.status(400).json({ error: 'নিজের অ্যাডমিন অ্যাকাউন্ট মুছা যাবে না।' });
        return;
      }
      await db.run(`DELETE FROM users WHERE id = ?`, id);
      res.json({ message: 'ব্যবহারকারী মুছে ফেলা হয়েছে।' });
    })
  );

  app.get(
    '/api/admin/products',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const rows = await db.all<any>(
        `SELECT p.*, c.nameEn as categoryNameEn, c.nameBn as categoryNameBn
         FROM products p LEFT JOIN categories c ON c.id = p.categoryId
         ORDER BY p.createdAt DESC`
      );
      res.json({ products: rows.map((r) => parseProductRow(r, { includePromoSecret: true })) });
    })
  );

  app.patch(
    '/api/admin/products/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const existing = await db.get<any>(`SELECT * FROM products WHERE id = ?`, id);
      if (!existing) {
        res.status(404).json({ error: 'পণ্য পাওয়া যায়নি।' });
        return;
      }
      const { isHidden, isFeatured, isTrending, isRecommended, name, currentPrice, previousPrice, stock, categoryId, subcategory } =
        req.body || {};

      await db.run(
        `UPDATE products
         SET isHidden = ?, isFeatured = ?, isTrending = ?, isRecommended = ?,
             name = ?, currentPrice = ?, previousPrice = ?, stock = ?, categoryId = ?, subcategory = ?
         WHERE id = ?`,
        isHidden !== undefined ? (isHidden ? 1 : 0) : existing.isHidden,
        isFeatured !== undefined ? (isFeatured ? 1 : 0) : existing.isFeatured,
        isTrending !== undefined ? (isTrending ? 1 : 0) : existing.isTrending,
        isRecommended !== undefined ? (isRecommended ? 1 : 0) : existing.isRecommended,
        typeof name === 'string' && name.trim() ? name.trim() : existing.name,
        currentPrice !== undefined ? Number(currentPrice) : existing.currentPrice,
        previousPrice !== undefined
          ? previousPrice === null || previousPrice === ''
            ? null
            : Number(previousPrice)
          : existing.previousPrice,
        stock !== undefined ? Number(stock) : existing.stock,
        typeof categoryId === 'string' ? categoryId : existing.categoryId,
        typeof subcategory === 'string' ? subcategory : existing.subcategory,
        id
      );

      res.json({ product: parseProductRow(await db.get(`SELECT * FROM products WHERE id = ?`, id), { includePromoSecret: true }) });
    })
  );

  app.delete(
    '/api/admin/products/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const existing = await db.get<{ images: string }>(`SELECT images FROM products WHERE id = ?`, req.params.id);
      await db.run(`DELETE FROM products WHERE id = ?`, req.params.id);
      if (existing?.images) {
        try {
          await cleanupOrphanedMedia(JSON.parse(existing.images || '[]'));
        } catch {
          // ignore
        }
      }
      res.json({ message: 'পণ্যটি মুছে ফেলা হয়েছে।' });
    })
  );

  app.post(
    '/api/admin/categories',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { nameEn, nameBn, imageUrl, subcategories, sortOrder } = req.body || {};
      if (!nameEn || !nameBn) {
        res.status(400).json({ error: 'ক্যাটাগরির নাম লিখুন।' });
        return;
      }
      const id = `cat-${crypto.randomUUID().slice(0, 8)}`;
      const slug =
        String(nameEn)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') +
        '-' +
        id.slice(-4);
      await db.run(
        `INSERT INTO categories (id, nameEn, nameBn, slug, imageUrl, subcategories, sortOrder)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        String(nameEn).trim(),
        String(nameBn).trim(),
        slug,
        String(imageUrl || '/src/assets/images/cat_baby_gifts_1795274484045.jpg'),
        JSON.stringify(Array.isArray(subcategories) ? subcategories : []),
        Number(sortOrder) || 99
      );
      res.status(201).json({ message: 'ক্যাটাগরি যোগ করা হয়েছে।' });
    })
  );

  app.put(
    '/api/admin/categories/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { nameEn, nameBn, imageUrl, subcategories, sortOrder } = req.body || {};
      const existing = await db.get<any>(`SELECT * FROM categories WHERE id = ?`, id);
      if (!existing) {
        res.status(404).json({ error: 'ক্যাটাগরি পাওয়া যায়নি।' });
        return;
      }
      const nextImg = imageUrl ? String(imageUrl).trim() : existing.imageUrl;
      await db.run(
        `UPDATE categories SET nameEn = ?, nameBn = ?, imageUrl = ?, subcategories = ?, sortOrder = ? WHERE id = ?`,
        nameEn ? String(nameEn).trim() : existing.nameEn,
        nameBn ? String(nameBn).trim() : existing.nameBn,
        nextImg,
        Array.isArray(subcategories) ? JSON.stringify(subcategories) : existing.subcategories,
        sortOrder !== undefined ? Number(sortOrder) : existing.sortOrder,
        id
      );
      if (existing.imageUrl && existing.imageUrl !== nextImg) {
        try {
          await cleanupOrphanedMedia([existing.imageUrl]);
        } catch {
          // non-fatal
        }
      }
      res.json({ message: 'ক্যাটাগরি আপডেট হয়েছে।' });
    })
  );

  app.delete(
    '/api/admin/categories/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const existing = await db.get<{ imageUrl: string }>(`SELECT imageUrl FROM categories WHERE id = ?`, req.params.id);
      await db.run(`DELETE FROM categories WHERE id = ?`, req.params.id);
      if (existing?.imageUrl) {
        try {
          await cleanupOrphanedMedia([existing.imageUrl]);
        } catch {
          // non-fatal
        }
      }
      res.json({ message: 'ক্যাটাগরি মুছে ফেলা হয়েছে।' });
    })
  );

  app.get(
    '/api/admin/orders',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const orders = await db.all<any>(`SELECT * FROM orders ORDER BY createdAt DESC`);
      const phoneStatsMap = await computePhoneOrderStatsMap(orders);
      const hydrated = await Promise.all(
        orders.map(async (o) => ({
          ...o,
          items: (await db.all<any>(`SELECT * FROM order_items WHERE orderId = ?`, o.id)) || [],
          phoneStats: phoneStatsMap.get(o.id),
        }))
      );
      res.json({ orders: hydrated });
    })
  );

  app.patch(
    '/api/admin/orders/:id/status',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { status } = req.body || {};
      if (!['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'].includes(status)) {
        res.status(400).json({ error: 'সঠিক স্ট্যাটাস দিন।' });
        return;
      }
      const order = await db.get<any>(`SELECT * FROM orders WHERE id = ?`, id);
      if (!order) {
        res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি।' });
        return;
      }
      await db.transaction(async (tx) => {
        if (order.status !== 'Cancelled' && status === 'Cancelled') {
          const items = await tx.all<{ productId: string; quantity: number }>(
            `SELECT productId, quantity FROM order_items WHERE orderId = ? AND itemStatus != 'Cancelled'`,
            id
          );
          for (const it of items) {
            await tx.run(`UPDATE products SET stock = stock + ? WHERE id = ?`, Number(it.quantity || 0), it.productId);
          }
        }
        await tx.run(`UPDATE orders SET status = ?, updatedAt = ? WHERE id = ?`, status, Date.now(), id);
        await tx.run(`UPDATE order_items SET itemStatus = ? WHERE orderId = ?`, status, id);
      });
      await createNotification(
        order.buyerId,
        'order',
        'অর্ডার স্ট্যাটাস আপডেট (Admin)',
        `আপনার অর্ডার #${order.orderNumber} এর বর্তমান অবস্থা: ${status}`,
        '/profile'
      );
      pushToUser(order.buyerId, { type: 'order:updated', orderId: id, status });
      res.json({ message: 'অর্ডার স্ট্যাটাস আপডেট হয়েছে।' });
    })
  );

  app.get(
    '/api/admin/product-ads',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const rows = await db.all<any>(
        `SELECT a.*, p.name as productName, p.currentPrice, p.images, p.shopName
         FROM homepage_product_ads a
         JOIN products p ON p.id = a.productId
         ORDER BY a.sortOrder ASC, a.createdAt DESC`
      );
      res.json({
        productAds: rows.map((r) => ({ ...r, images: safeJsonParse<string[]>(r.images, []), isActive: Boolean(r.isActive) })),
      });
    })
  );

  app.post(
    '/api/admin/product-ads',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { productId, promoText, customImageUrl, sortOrder, durationDays } = req.body || {};
      const prod = await db.get(`SELECT id FROM products WHERE id = ?`, productId);
      if (!prod) {
        res.status(404).json({ error: 'পণ্য পাওয়া যায়নি।' });
        return;
      }
      const id = `hpad-${crypto.randomUUID().slice(0, 8)}`;
      const expiresAt =
        durationDays && Number(durationDays) > 0 ? Date.now() + Number(durationDays) * 86400000 : null;
      await db.run(
        `INSERT INTO homepage_product_ads (id, productId, promoText, customImageUrl, sortOrder, isActive, expiresAt, createdAt)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        id,
        productId,
        typeof promoText === 'string' ? promoText.trim() : null,
        typeof customImageUrl === 'string' && customImageUrl.trim() ? customImageUrl.trim() : null,
        Number(sortOrder) || 1,
        expiresAt,
        Date.now()
      );
      res.status(201).json({ message: 'হোমপেজ Product Ad যুক্ত হয়েছে।' });
    })
  );

  app.put(
    '/api/admin/product-ads/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const existing = await db.get<any>(`SELECT * FROM homepage_product_ads WHERE id = ?`, id);
      if (!existing) {
        res.status(404).json({ error: 'Product Ad পাওয়া যায়নি।' });
        return;
      }
      const { promoText, customImageUrl, sortOrder, isActive, durationDays } = req.body || {};
      const expiresAt =
        durationDays === 0
          ? null
          : durationDays && Number(durationDays) > 0
            ? Date.now() + Number(durationDays) * 86400000
            : existing.expiresAt;

      await db.run(
        `UPDATE homepage_product_ads
         SET promoText = ?, customImageUrl = ?, sortOrder = ?, isActive = ?, expiresAt = ?
         WHERE id = ?`,
        promoText !== undefined ? (promoText ? String(promoText).trim() : null) : existing.promoText,
        customImageUrl !== undefined ? (customImageUrl ? String(customImageUrl).trim() : null) : existing.customImageUrl,
        sortOrder !== undefined ? Number(sortOrder) : existing.sortOrder,
        isActive !== undefined ? (isActive ? 1 : 0) : existing.isActive,
        expiresAt,
        id
      );
      res.json({ message: 'Product Ad আপডেট হয়েছে।' });
    })
  );

  app.delete(
    '/api/admin/product-ads/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      await db.run(`DELETE FROM homepage_product_ads WHERE id = ?`, req.params.id);
      res.json({ message: 'Product Ad মুছে ফেলা হয়েছে।' });
    })
  );

  app.get(
    '/api/admin/ads',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const ads = await db.all<any>(`SELECT * FROM advertisements ORDER BY createdAt DESC`);
      res.json({ ads });
    })
  );

  app.post(
    '/api/admin/ads',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { title, placement, adType, imageUrl, targetUrl, htmlCode, jsCode } = req.body || {};
      if (!title || !placement || !adType) {
        res.status(400).json({ error: 'বিজ্ঞাপনের শিরোনাম, স্থান ও ধরন দিন।' });
        return;
      }
      const id = `ad-${crypto.randomUUID().slice(0, 8)}`;
      await db.run(
        `INSERT INTO advertisements (id, title, placement, adType, imageUrl, targetUrl, htmlCode, jsCode, isActive, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        id,
        String(title).trim(),
        placement,
        adType,
        typeof imageUrl === 'string' && imageUrl.trim() ? imageUrl.trim() : null,
        safeUrl(targetUrl),
        typeof htmlCode === 'string' ? htmlCode : null,
        typeof jsCode === 'string' ? jsCode : null,
        Date.now()
      );
      res.status(201).json({ message: 'বিজ্ঞাপন তৈরি হয়েছে।' });
    })
  );

  app.put(
    '/api/admin/ads/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const existing = await db.get<any>(`SELECT * FROM advertisements WHERE id = ?`, id);
      if (!existing) {
        res.status(404).json({ error: 'বিজ্ঞাপন পাওয়া যায়নি।' });
        return;
      }
      const { title, placement, adType, imageUrl, targetUrl, htmlCode, jsCode, isActive } = req.body || {};
      const nextImg = imageUrl !== undefined ? (imageUrl ? String(imageUrl).trim() : null) : existing.imageUrl;
      await db.run(
        `UPDATE advertisements
         SET title = ?, placement = ?, adType = ?, imageUrl = ?, targetUrl = ?, htmlCode = ?, jsCode = ?, isActive = ?
         WHERE id = ?`,
        title !== undefined ? String(title).trim() : existing.title,
        placement || existing.placement,
        adType || existing.adType,
        nextImg,
        targetUrl !== undefined ? safeUrl(targetUrl) : existing.targetUrl,
        htmlCode !== undefined ? htmlCode : existing.htmlCode,
        jsCode !== undefined ? jsCode : existing.jsCode,
        isActive !== undefined ? (isActive ? 1 : 0) : existing.isActive,
        id
      );
      if (existing.imageUrl && existing.imageUrl !== nextImg) {
        try {
          await cleanupOrphanedMedia([existing.imageUrl]);
        } catch {
          // non-fatal
        }
      }
      res.json({ message: 'বিজ্ঞাপন আপডেট হয়েছে।' });
    })
  );

  app.delete(
    '/api/admin/ads/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const existing = await db.get<{ imageUrl: string | null }>(`SELECT imageUrl FROM advertisements WHERE id = ?`, req.params.id);
      await db.run(`DELETE FROM advertisements WHERE id = ?`, req.params.id);
      if (existing?.imageUrl) {
        try {
          await cleanupOrphanedMedia([existing.imageUrl]);
        } catch {
          // non-fatal
        }
      }
      res.json({ message: 'বিজ্ঞাপন মুছে ফেলা হয়েছে।' });
    })
  );

  app.get(
    '/api/admin/reports',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const reports = await db.all<any>(`SELECT * FROM reports ORDER BY createdAt DESC`);
      res.json({ reports });
    })
  );

  app.patch(
    '/api/admin/reports/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { status } = req.body || {};
      if (!['Open', 'Resolved', 'Dismissed'].includes(status)) {
        res.status(400).json({ error: 'সঠিক স্ট্যাটাস দিন।' });
        return;
      }
      await db.run(`UPDATE reports SET status = ? WHERE id = ?`, status, req.params.id);
      res.json({ message: 'রিপোর্ট স্ট্যাটাস আপডেট হয়েছে।' });
    })
  );

  app.get(
    '/api/admin/messages',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const conversations = await db.all<any>(
        `SELECT c.*, b.fullName as buyerName, s.shopName as sellerShopName, s.fullName as sellerName
         FROM conversations c
         JOIN users b ON b.id = c.buyerId
         JOIN users s ON s.id = c.sellerId
         ORDER BY c.lastMessageAt DESC LIMIT 100`
      );
      res.json({ conversations });
    })
  );

  // Admin: SMS Gateway Configuration & Logs (Order Confirmation + Forgot-Password OTP)
  app.get(
    '/api/admin/sms-settings',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const cfg = await getSmsGatewayConfig();
      const maskSecret = (val?: string) => (val ? `${val.slice(0, 3)}••••${val.slice(-3)}` : '');
      res.json({
        provider: cfg.provider,
        senderName: cfg.senderName || 'Orvexa',
        autoOrderSmsEnabled: cfg.autoOrderSmsEnabled,
        hasApiKey: Boolean(cfg.apiKey),
        maskedApiKey: maskSecret(cfg.apiKey),
        hasApiSecret: Boolean(cfg.apiSecret),
        maskedApiSecret: maskSecret(cfg.apiSecret),
        webhookUrl: cfg.webhookUrl || '',
        fromNumber: cfg.fromNumber || '',
      });
    })
  );

  app.put(
    '/api/admin/sms-settings',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const existing = await getSmsGatewayConfig();
      const { provider, senderName, autoOrderSmsEnabled, apiKey, apiSecret, webhookUrl, fromNumber } = req.body || {};

      const validProviders = new Set<SmsProviderType>(['built_in', 'bulksmsbd', 'greenweb', 'twilio', 'webhook']);
      const nextProvider: SmsProviderType = validProviders.has(provider) ? provider : existing.provider;

      const cleanWebhook = typeof webhookUrl === 'string' ? webhookUrl.trim() : existing.webhookUrl || '';
      if (nextProvider === 'webhook' && cleanWebhook) {
        try {
          await validateSafeHttpsWebhook(cleanWebhook);
        } catch (err: any) {
          res.status(400).json({ error: err?.message || 'অবৈধ SMS Webhook URL।' });
          return;
        }
      }

      const nextCfg = {
        provider: nextProvider,
        senderName:
          typeof senderName === 'string' && senderName.trim() ? senderName.trim().slice(0, 20) : existing.senderName || 'Orvexa',
        autoOrderSmsEnabled:
          autoOrderSmsEnabled !== undefined ? Boolean(autoOrderSmsEnabled) : existing.autoOrderSmsEnabled,
        apiKey: typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : existing.apiKey || '',
        apiSecret: typeof apiSecret === 'string' && apiSecret.trim() ? apiSecret.trim() : existing.apiSecret || '',
        webhookUrl: cleanWebhook,
        fromNumber: typeof fromNumber === 'string' ? fromNumber.trim() : existing.fromNumber || '',
      };

      await db.run(
        `INSERT OR REPLACE INTO site_settings (key, value) VALUES ('smsGateway', ?)`,
        JSON.stringify(nextCfg)
      );

      res.json({ message: 'SMS গেটওয়ে সেটিংস নিরাপদভাবে সংরক্ষিত হয়েছে।' });
    })
  );

  app.get(
    '/api/admin/sms-logs',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const logs = await db.all<any>(`SELECT * FROM sms_logs ORDER BY createdAt DESC LIMIT 100`);
      res.json({ logs });
    })
  );

  app.post(
    '/api/admin/sms-test',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { phone } = req.body || {};
      const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
      if (!isLikelyPhone(cleanPhone)) {
        res.status(400).json({ error: 'সঠিক মোবাইল নম্বর দিন (যেমন: 01XXXXXXXXX)।' });
        return;
      }
      const cfg = await getSmsGatewayConfig();
      const smsRes = await dispatchSms({
        recipientPhone: cleanPhone,
        messageType: 'test',
        messageBody: buildOrderConfirmSmsBody(cfg.senderName || 'Orvexa', 'TEST-101'),
        referenceId: 'admin-test',
      });
      res.json({
        message: 'টেস্ট SMS প্রক্রিয়া সম্পন্ন হয়েছে। নিচে SMS লগে ফলাফল দেখুন।',
        result: smsRes,
      });
    })
  );

  app.put(
    '/api/admin/settings/:key',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const allowedKeys = new Set([
        'heroBanners',
        'productAdsSection',
        'sellerProductAdsPage',
        'paymentOptions',
        'contactInfo',
        'footerSettings',
        'generalSettings',
        'customCode',
        'customPages',
        'customBlocks',
      ]);
      const { key } = req.params;
      if (!allowedKeys.has(key)) {
        res.status(400).json({ error: 'অবৈধ সেটিংস কী।' });
        return;
      }
      await db.run(
        `INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)`,
        key,
        JSON.stringify(req.body ?? {})
      );
      res.json({ message: 'সেটিংস সফলভাবে সংরক্ষণ করা হয়েছে।' });
    })
  );

  // Admin: Package Import (.zip / .json site bundle)
  app.post(
    '/api/admin/import-package',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const payload = req.body || {};
      const allowedSettingsKeys = new Set([
        'heroBanners',
        'productAdsSection',
        'sellerProductAdsPage',
        'paymentOptions',
        'contactInfo',
        'footerSettings',
        'generalSettings',
        'customCode',
        'customPages',
        'customBlocks',
      ]);
      const validPlacements = new Set([
        'homepage_top',
        'homepage_middle',
        'homepage_bottom',
        'category_page',
        'product_page',
        'sidebar',
        'other',
      ]);
      const validAdTypes = new Set(['image', 'banner', 'html', 'js']);

      let settingsUpdated = 0;
      let categoriesImported = 0;
      let adsImported = 0;
      let productAdsImported = 0;

      await db.transaction(async (tx) => {
        if (payload.settings && typeof payload.settings === 'object') {
          for (const [key, val] of Object.entries(payload.settings)) {
            if (!allowedSettingsKeys.has(key) || val === undefined) continue;
            await tx.run(`INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)`, key, JSON.stringify(val));
            settingsUpdated++;
          }
        }

        if (Array.isArray(payload.categories)) {
          for (const c of payload.categories) {
            if (!c || !c.nameEn || !c.nameBn) continue;
            const id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `cat-${crypto.randomUUID().slice(0, 8)}`;
            const slug =
              typeof c.slug === 'string' && c.slug.trim()
                ? c.slug.trim()
                : `${String(c.nameEn).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${id.slice(-4)}`;
            await tx.run(
              `INSERT OR REPLACE INTO categories (id, nameEn, nameBn, slug, imageUrl, subcategories, sortOrder)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              id,
              String(c.nameEn).trim(),
              String(c.nameBn).trim(),
              slug,
              String(c.imageUrl || '/src/assets/images/cat_baby_gifts_1795274484045.jpg'),
              JSON.stringify(Array.isArray(c.subcategories) ? c.subcategories : []),
              Number(c.sortOrder ?? 99)
            );
            categoriesImported++;
          }
        }

        if (Array.isArray(payload.advertisements)) {
          for (const ad of payload.advertisements) {
            if (!ad || !ad.title || !validPlacements.has(ad.placement) || !validAdTypes.has(ad.adType)) continue;
            const id = typeof ad.id === 'string' && ad.id.trim() ? ad.id.trim() : `ad-${crypto.randomUUID().slice(0, 8)}`;
            await tx.run(
              `INSERT OR REPLACE INTO advertisements (id, title, placement, adType, imageUrl, targetUrl, htmlCode, jsCode, isActive, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              id,
              String(ad.title).trim(),
              ad.placement,
              ad.adType,
              typeof ad.imageUrl === 'string' && ad.imageUrl.trim() ? ad.imageUrl.trim() : null,
              safeUrl(ad.targetUrl),
              typeof ad.htmlCode === 'string' ? ad.htmlCode : null,
              typeof ad.jsCode === 'string' ? ad.jsCode : null,
              ad.isActive === 0 || ad.isActive === false ? 0 : 1,
              Number(ad.createdAt) || Date.now()
            );
            adsImported++;
          }
        }

        if (Array.isArray(payload.homepageProductAds)) {
          for (const pad of payload.homepageProductAds) {
            const prodId = pad?.productId || pad?.product?.id;
            if (!prodId) continue;
            const prodExists = await tx.get(`SELECT id FROM products WHERE id = ?`, prodId);
            if (!prodExists) continue;
            const id = typeof pad.id === 'string' && pad.id.trim()
              ? pad.id.trim()
              : typeof pad.adId === 'string' && pad.adId.trim()
                ? pad.adId.trim()
                : `hpad-${crypto.randomUUID().slice(0, 8)}`;
            await tx.run(
              `INSERT OR REPLACE INTO homepage_product_ads (id, productId, promoText, customImageUrl, sortOrder, isActive, expiresAt, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              id,
              prodId,
              typeof pad.promoText === 'string' ? pad.promoText.trim() : null,
              typeof pad.customImageUrl === 'string' && pad.customImageUrl.trim() ? pad.customImageUrl.trim() : null,
              Number(pad.sortOrder ?? 1),
              pad.isActive === 0 || pad.isActive === false ? 0 : 1,
              pad.expiresAt ? Number(pad.expiresAt) : null,
              Number(pad.createdAt) || Date.now()
            );
            productAdsImported++;
          }
        }
      });

      res.json({
        message: 'প্যাকেজ সফলভাবে ইমপোর্ট ও প্রয়োগ করা হয়েছে!',
        summary: { settingsUpdated, categoriesImported, adsImported, productAdsImported },
      });
    })
  );

  // Admin: Deploy Hook Configuration & Trigger (strictly server-side & SSRF-protected)
  app.get(
    '/api/admin/deploy-hook',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const cfg = await getSetting<{
        url?: string;
        providerHint?: string;
        lastTriggeredAt?: number | null;
        lastStatus?: string | null;
      }>('deployHook', {});
      res.json({
        configured: Boolean(cfg.url),
        maskedUrl: cfg.url ? maskDeployHookUrl(cfg.url) : '',
        providerHint: cfg.providerHint || 'Vercel / Netlify / Render',
        lastTriggeredAt: cfg.lastTriggeredAt || null,
        lastStatus: cfg.lastStatus || null,
      });
    })
  );

  app.put(
    '/api/admin/deploy-hook',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { url, providerHint } = req.body || {};
      const existing = await getSetting<{
        url?: string;
        providerHint?: string;
        lastTriggeredAt?: number | null;
        lastStatus?: string | null;
      }>('deployHook', {});

      const cleanUrl = typeof url === 'string' ? url.trim() : '';
      if (!cleanUrl) {
        await db.run(`DELETE FROM site_settings WHERE key = 'deployHook'`);
        res.json({
          configured: false,
          maskedUrl: '',
          providerHint: 'Vercel / Netlify / Render',
          lastTriggeredAt: null,
          lastStatus: null,
          message: 'Deploy Hook সংযোগ সরানো হয়েছে।',
        });
        return;
      }

      let validated: URL;
      try {
        validated = await validateDeployHookUrl(cleanUrl);
      } catch (err: any) {
        res.status(400).json({ error: err?.message || 'অবৈধ Deploy Hook URL।' });
        return;
      }
      const nextCfg = {
        url: validated.toString(),
        providerHint:
          typeof providerHint === 'string' && providerHint.trim()
            ? providerHint.trim().slice(0, 60)
            : existing.providerHint || 'Vercel / Netlify / Render',
        lastTriggeredAt: existing.lastTriggeredAt || null,
        lastStatus: existing.lastStatus || null,
      };
      await db.run(`INSERT OR REPLACE INTO site_settings (key, value) VALUES ('deployHook', ?)`, JSON.stringify(nextCfg));
      res.json({
        configured: true,
        maskedUrl: maskDeployHookUrl(nextCfg.url),
        providerHint: nextCfg.providerHint,
        lastTriggeredAt: nextCfg.lastTriggeredAt,
        lastStatus: nextCfg.lastStatus,
        message: 'Deploy Hook নিরাপদভাবে সংরক্ষিত হয়েছে!',
      });
    })
  );

  app.post(
    '/api/admin/deploy-hook/trigger',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const cfg = await getSetting<{
        url?: string;
        providerHint?: string;
        lastTriggeredAt?: number | null;
        lastStatus?: string | null;
      }>('deployHook', {});

      if (!cfg.url) {
        res.status(400).json({ error: 'প্রথমে একটি Deploy Hook URL সেট করে সংরক্ষণ করুন।' });
        return;
      }

      let validated: URL;
      try {
        validated = await validateDeployHookUrl(cfg.url);
      } catch (err: any) {
        res.status(400).json({ error: err?.message || 'অবৈধ Deploy Hook URL।' });
        return;
      }
      let statusMsg = '';
      let ok = false;
      try {
        const hookRes = await fetch(validated.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ triggeredBy: 'orvexa-admin', timestamp: Date.now() }),
          signal: AbortSignal.timeout(12000),
        });
        ok = hookRes.ok;
        statusMsg = hookRes.ok ? `Success (HTTP ${hookRes.status})` : `Failed (HTTP ${hookRes.status})`;
      } catch (err: any) {
        statusMsg = `Network error: ${err?.message || 'Timeout'}`;
      }

      const now = Date.now();
      const updatedCfg = { ...cfg, lastTriggeredAt: now, lastStatus: statusMsg };
      await db.run(
        `INSERT OR REPLACE INTO site_settings (key, value) VALUES ('deployHook', ?)`,
        JSON.stringify(updatedCfg)
      );

      if (!ok) {
        res.status(502).json({ error: `Deploy Hook কল ব্যর্থ হয়েছে: ${statusMsg}`, lastTriggeredAt: now, lastStatus: statusMsg });
        return;
      }

      res.json({
        message: 'রি-ডেপ্লয়মেন্ট ট্রিগার সফলভাবে পাঠানো হয়েছে!',
        lastTriggeredAt: now,
        lastStatus: statusMsg,
      });
    })
  );

  // Admin: 10-20 Year Long-Term Storage Health & Maintenance Cleanup
  app.get(
    '/api/admin/storage/stats',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const now = Date.now();
      const sessionCutoff = now - 180 * 86400000; // 180 days idle
      const notifCutoff = now - 90 * 86400000; // 90 days read notifications

      const [
        mediaStats,
        usersCount,
        productsCount,
        ordersCount,
        messagesCount,
        notifStats,
        sessionStats,
        mediaIds,
      ] = await Promise.all([
        db.get<{ count: number; totalBytes: number }>(
          `SELECT COUNT(*) as count, COALESCE(SUM(sizeBytes), 0) as totalBytes FROM media`
        ),
        db.get<{ c: number }>(`SELECT COUNT(*) as c FROM users`),
        db.get<{ c: number }>(`SELECT COUNT(*) as c FROM products`),
        db.get<{ c: number }>(`SELECT COUNT(*) as c FROM orders`),
        db.get<{ c: number }>(`SELECT COUNT(*) as c FROM messages`),
        db.get<{ total: number; stale: number }>(
          `SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN isRead = 1 AND createdAt < ? THEN 1 ELSE 0 END), 0) as stale FROM notifications`,
          notifCutoff
        ),
        db.get<{ total: number; stale: number }>(
          `SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN lastUsedAt < ? THEN 1 ELSE 0 END), 0) as stale FROM sessions`,
          sessionCutoff
        ),
        db.all<{ id: string; sizeBytes: number }>(`SELECT id, sizeBytes FROM media`),
      ]);

      let orphanMediaCount = 0;
      let orphanMediaBytes = 0;
      for (const m of mediaIds) {
        if (!(await isMediaReferenced(m.id))) {
          orphanMediaCount++;
          orphanMediaBytes += Number(m.sizeBytes || 0);
        }
      }

      res.json({
        isRemote: db.isRemote,
        isServerless: isServerlessEnv,
        dbMode: db.mode,
        dbEngine:
          db.mode === 'turso'
            ? 'Turso Cloud (LibSQL)'
            : db.mode === 'sqlite-memory'
              ? 'In-Memory SQLite (Temporary)'
              : 'Local SQLite (WAL)',
        mediaCount: Number(mediaStats?.count || 0),
        mediaBytes: Number(mediaStats?.totalBytes || 0),
        orphanMediaCount,
        orphanMediaBytes,
        staleSessionsCount: Number(sessionStats?.stale || 0),
        staleNotificationsCount: Number(notifStats?.stale || 0),
        tableCounts: {
          users: Number(usersCount?.c || 0),
          products: Number(productsCount?.c || 0),
          orders: Number(ordersCount?.c || 0),
          messages: Number(messagesCount?.c || 0),
          notifications: Number(notifStats?.total || 0),
          sessions: Number(sessionStats?.total || 0),
        },
      });
    })
  );

  app.post(
    '/api/admin/storage/cleanup',
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const now = Date.now();
      const sessionCutoff = now - 180 * 86400000;
      const notifCutoff = now - 90 * 86400000;

      const [sessRes, notifRes, mediaIds] = await Promise.all([
        db.run(`DELETE FROM sessions WHERE lastUsedAt < ?`, sessionCutoff),
        db.run(`DELETE FROM notifications WHERE isRead = 1 AND createdAt < ?`, notifCutoff),
        db.all<{ id: string; sizeBytes: number }>(`SELECT id, sizeBytes FROM media`),
      ]);

      let deletedOrphanMedia = 0;
      let freedMediaBytes = 0;
      for (const m of mediaIds) {
        if (!(await isMediaReferenced(m.id))) {
          await db.run(`DELETE FROM media WHERE id = ?`, m.id);
          deletedOrphanMedia++;
          freedMediaBytes += Number(m.sizeBytes || 0);
        }
      }

      res.json({
        deletedSessions: sessRes.changes,
        deletedNotifications: notifRes.changes,
        deletedOrphanMedia,
        freedMediaBytes,
        message: 'ডাটাবেস ও স্টোরেজ অপটিমাইজেশন সম্পন্ন হয়েছে!',
      });
    })
  );

  // Ensure unmatched /api/* endpoints always return JSON (never HTML)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Global JSON error handler for API errors
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    console.error('[Orvexa API Error]', req.method, req.originalUrl, err?.message || err);
    if (res.headersSent) return;
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'পাঠানো তথ্যের আকার অনেক বড় হয়েছে। অনুগ্রহ করে ছোট ফাইল বা তথ্য ব্যবহার করুন।' });
      return;
    }
    const status = typeof err?.status === 'number' && err.status >= 400 ? err.status : 500;
    res.status(status).json({
      error:
        status >= 500
          ? 'সার্ভারে একটি অস্থায়ী সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
          : err?.message || 'অনুরোধটি সম্পন্ন করা যায়নি।',
    });
  });

  return app;
}
