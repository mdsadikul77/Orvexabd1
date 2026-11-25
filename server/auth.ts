import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';

const SECRET_SETTINGS_KEY = '__internal_session_secret';

function resolveEnvSessionSecret(): string {
  const raw = (process.env.SESSION_SECRET || '').trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (raw.length >= 16) return raw;
  if (raw.length >= 8) {
    return crypto.createHash('sha256').update(`orvexa:${raw}`).digest('hex');
  }
  return '';
}

let cachedSessionSecret = resolveEnvSessionSecret();

export async function initSessionSecret(): Promise<string> {
  const envSecret = resolveEnvSessionSecret();
  if (envSecret) {
    cachedSessionSecret = envSecret;
    return cachedSessionSecret;
  }

  try {
    const existing = await db.get<{ value: string }>(
      `SELECT value FROM site_settings WHERE key = ? LIMIT 1`,
      SECRET_SETTINGS_KEY
    );
    if (existing?.value) {
      const parsed = JSON.parse(existing.value);
      if (typeof parsed === 'string' && parsed.length >= 32) {
        cachedSessionSecret = parsed;
        return cachedSessionSecret;
      }
    }

    const generated = crypto.randomBytes(32).toString('hex');
    await db.run(
      `INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)`,
      SECRET_SETTINGS_KEY,
      JSON.stringify(generated)
    );

    const stored = await db.get<{ value: string }>(
      `SELECT value FROM site_settings WHERE key = ? LIMIT 1`,
      SECRET_SETTINGS_KEY
    );
    if (stored?.value) {
      const parsed = JSON.parse(stored.value);
      if (typeof parsed === 'string' && parsed.length >= 32) {
        cachedSessionSecret = parsed;
        return cachedSessionSecret;
      }
    }

    cachedSessionSecret = generated;
    return cachedSessionSecret;
  } catch {
    if (!cachedSessionSecret) {
      cachedSessionSecret = crypto.randomBytes(32).toString('hex');
    }
    return cachedSessionSecret;
  }
}

function getSessionSecret(): string {
  if (!cachedSessionSecret) {
    cachedSessionSecret = resolveEnvSessionSecret() || crypto.randomBytes(32).toString('hex');
  }
  return cachedSessionSecret;
}

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 365; // 1 year signed bearer TTL
export const SESSION_COOKIE_NAME = 'orvexa_session';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years persistent until logout

export interface AuthUser {
  id: string;
  fullName: string;
  username: string;
  emailOrPhone: string;
  role: 'buyer' | 'seller' | 'admin';
  shopName: string | null;
  shopDescription: string | null;
  avatarUrl: string | null;
  status: 'active' | 'blocked' | 'suspended';
  createdAt: number;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function signToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      uid?: string;
      exp?: number;
    };
    if (!decoded.uid || !decoded.exp || decoded.exp < Date.now()) {
      return null;
    }
    return decoded.uid;
  } catch {
    return null;
  }
}

function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export async function createPersistentSession(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(rawToken);
  const now = Date.now();
  await db.run(
    `INSERT INTO sessions (id, userId, tokenHash, createdAt, lastUsedAt) VALUES (?, ?, ?, ?, ?)`,
    `sess-${crypto.randomUUID()}`,
    userId,
    tokenHash,
    now,
    now
  );
  return rawToken;
}

export async function verifyPersistentSession(rawToken: string): Promise<AuthUser | null> {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const tokenHash = hashSessionToken(rawToken);
  const session = await db.get<{ id: string; userId: string; lastUsedAt: number }>(
    `SELECT id, userId, lastUsedAt FROM sessions WHERE tokenHash = ? LIMIT 1`,
    tokenHash
  );
  if (!session) return null;

  const user = await getUserById(session.userId);
  if (!user || user.status !== 'active') return null;

  const now = Date.now();
  if (now - Number(session.lastUsedAt || 0) > 5 * 60 * 1000) {
    await db.run(`UPDATE sessions SET lastUsedAt = ? WHERE id = ?`, now, session.id);
  }
  return user;
}

export async function revokePersistentSession(rawToken: string): Promise<void> {
  if (!rawToken || typeof rawToken !== 'string') return;
  const tokenHash = hashSessionToken(rawToken);
  await db.run(`DELETE FROM sessions WHERE tokenHash = ?`, tokenHash);
}

export function parseCookieValue(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === name) {
      const val = part.slice(eqIdx + 1).trim();
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    }
  }
  return null;
}

function isHttpsRequest(req?: Request): boolean {
  if (!req) return true;
  if (req.secure) return true;
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  if (typeof proto === 'string' && proto.split(',').some((p) => p.trim().toLowerCase() === 'https')) {
    return true;
  }
  const sslHeader = req.headers['x-forwarded-ssl'];
  if (typeof sslHeader === 'string' && sslHeader.trim().toLowerCase() === 'on') {
    return true;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.toLowerCase().startsWith('https://')) {
    return true;
  }
  return false;
}

export function extractRequestHostCandidates(req: Request): string[] {
  const rawValues: string[] = [];
  for (const h of [req.headers['x-forwarded-host'], req.headers['x-original-host'], req.headers.host]) {
    if (Array.isArray(h)) {
      rawValues.push(...h);
    } else if (typeof h === 'string' && h.trim()) {
      rawValues.push(h);
    }
  }
  const set = new Set<string>();
  for (const raw of rawValues) {
    for (const part of raw.split(',')) {
      const cleaned = part.trim().toLowerCase();
      if (!cleaned) continue;
      set.add(cleaned);
      const hostnameOnly = cleaned.replace(/:\d+$/, '');
      if (hostnameOnly) set.add(hostnameOnly);
    }
  }
  return Array.from(set);
}

export function setSessionCookie(res: Response, rawToken: string, req?: Request): void {
  const secureAttrs = isHttpsRequest(req) ? 'Secure; SameSite=None; Partitioned' : 'SameSite=Lax';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; ${secureAttrs}; Max-Age=${COOKIE_MAX_AGE_SECONDS}`
  );
}

export function clearSessionCookie(res: Response, req?: Request): void {
  const secureAttrs = isHttpsRequest(req) ? 'Secure; SameSite=None; Partitioned' : 'SameSite=Lax';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; ${secureAttrs}; Max-Age=0`
  );
}

function isSameOriginOrCustomHeader(req: Request): boolean {
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    return true;
  }
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const parsedOrigin = new URL(origin);
    const candidates = extractRequestHostCandidates(req);
    const originHost = parsedOrigin.host.toLowerCase();
    const originHostname = parsedOrigin.hostname.toLowerCase();
    return candidates.includes(originHost) || candidates.includes(originHostname);
  } catch {
    return false;
  }
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  const row = await db.get<AuthUser>(
    `SELECT id, fullName, username, emailOrPhone, role, shopName, shopDescription, avatarUrl, status, createdAt FROM users WHERE id = ?`,
    userId
  );
  return row || null;
}

export async function extractBearerUser(req: Request): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const uid = verifyToken(token);
    if (uid) {
      const user = await getUserById(uid);
      if (user && user.status === 'active') return user;
    }
  }

  const cookieToken = parseCookieValue(req, SESSION_COOKIE_NAME);
  if (!cookieToken) return null;

  // CSRF defense on state-changing requests authenticated via cookie
  const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  if (mutatingMethods.has(req.method.toUpperCase()) && !isSameOriginOrCustomHeader(req)) {
    return null;
  }

  return verifyPersistentSession(cookieToken);
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const user = await extractBearerUser(req);
    if (!user) {
      res.status(401).json({ error: 'অনুগ্রহ করে আগে সাইন ইন করুন।' });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireSeller(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const user = await extractBearerUser(req);
    if (!user) {
      res.status(401).json({ error: 'অনুগ্রহ করে আগে সাইন ইন করুন।' });
      return;
    }
    if (user.role !== 'seller' && user.role !== 'admin') {
      res.status(403).json({ error: 'এই সুবিধাটি শুধুমাত্র সেলার অ্যাকাউন্টের জন্য।' });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const user = await extractBearerUser(req);
    if (!user) {
      res.status(401).json({ error: 'অ্যাডমিন প্রমাণীকরণ প্রয়োজন।' });
      return;
    }
    if (user.role !== 'admin') {
      res.status(403).json({ error: 'অ্যাডমিন অনুমতি নেই।' });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
