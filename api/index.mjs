// server/vercelEntry.ts
import "dotenv/config";

// server/app.ts
import crypto5 from "crypto";
import dns2 from "dns/promises";
import net2 from "net";
import express from "express";
import multer from "multer";

// server/auth.ts
import crypto2 from "crypto";

// server/db.ts
import "dotenv/config";
import { createClient as createWebClient } from "@libsql/client/web";
import crypto from "crypto";
import fs from "fs";
import { createRequire } from "module";
import os from "os";
import path from "path";
var require2 = createRequire(import.meta.url);
function isWritableDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const probe = path.join(dirPath, `.probe-${process.pid}`);
    fs.writeFileSync(probe, "1");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}
var isServerlessEnv = Boolean(
  process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT
);
function resolveStorageDir(envValue, folderName) {
  if (envValue && envValue.trim()) {
    const custom = path.resolve(envValue.trim());
    try {
      fs.mkdirSync(custom, { recursive: true });
      return custom;
    } catch {
    }
  }
  const localDir = path.resolve(process.cwd(), folderName);
  if (!isServerlessEnv && isWritableDir(localDir)) {
    return localDir;
  }
  const tmpDir = path.join(os.tmpdir(), `orvexa-${folderName}`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch {
  }
  return tmpDir;
}
var dataDir = resolveStorageDir(process.env.DATA_DIR, "data");
var uploadsDir = resolveStorageDir(process.env.UPLOADS_DIR, "uploads");
var dbPath = path.join(dataDir, "orvexa.db");
function normalizeArgs(params) {
  return params.map((v) => {
    if (v === void 0) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    return v;
  });
}
function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const key of Object.keys(row)) {
    const val = row[key];
    out[key] = typeof val === "bigint" ? Number(val) : val;
  }
  return out;
}
function resolveRemoteDbUrl() {
  const url = process.env.TURSO_DATABASE_URL?.trim() || process.env.LIBSQL_URL?.trim() || (process.env.DATABASE_URL && /^(libsql|https?):\/\//i.test(process.env.DATABASE_URL.trim()) ? process.env.DATABASE_URL.trim() : "");
  if (!url) return null;
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim() || process.env.LIBSQL_AUTH_TOKEN?.trim() || void 0;
  return { url, authToken };
}
function createLibsqlAdapter(url, authToken, mode) {
  let client;
  if (mode === "turso") {
    client = createWebClient(authToken ? { url, authToken } : { url });
  } else {
    const { createClient: createNodeClient } = require2("@libsql/client");
    client = createNodeClient(authToken ? { url, authToken } : { url });
  }
  const wrapExecutor = (execTarget) => ({
    async get(sql, ...params) {
      const rs = await execTarget.execute({ sql, args: normalizeArgs(params) });
      return rs.rows[0] ? normalizeRow(rs.rows[0]) : void 0;
    },
    async all(sql, ...params) {
      const rs = await execTarget.execute({ sql, args: normalizeArgs(params) });
      return rs.rows.map((r) => normalizeRow(r));
    },
    async run(sql, ...params) {
      const rs = await execTarget.execute({ sql, args: normalizeArgs(params) });
      return { changes: rs.rowsAffected };
    }
  });
  const base = wrapExecutor(client);
  return {
    isRemote: mode === "turso",
    mode,
    ...base,
    async exec(sql) {
      await client.executeMultiple(sql);
    },
    async transaction(fn) {
      const tx = await client.transaction("write");
      try {
        const result = await fn(wrapExecutor(tx));
        await tx.commit();
        return result;
      } catch (err) {
        try {
          await tx.rollback();
        } catch {
        }
        throw err;
      }
    }
  };
}
function createNativeSqliteAdapter() {
  const Database = require2("better-sqlite3");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  let txQueue = Promise.resolve();
  const adapter = {
    isRemote: false,
    mode: "sqlite-file",
    async get(sql, ...params) {
      const row = sqlite.prepare(sql).get(...normalizeArgs(params));
      return row ? normalizeRow(row) : void 0;
    },
    async all(sql, ...params) {
      const rows = sqlite.prepare(sql).all(...normalizeArgs(params));
      return rows.map((r) => normalizeRow(r));
    },
    async run(sql, ...params) {
      const info = sqlite.prepare(sql).run(...normalizeArgs(params));
      return { changes: info.changes };
    },
    async exec(sql) {
      sqlite.exec(sql);
    },
    async transaction(fn) {
      const prev = txQueue;
      let release;
      txQueue = new Promise((res) => {
        release = res;
      });
      await prev;
      try {
        sqlite.exec("BEGIN IMMEDIATE");
        const result = await fn(adapter);
        sqlite.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          sqlite.exec("ROLLBACK");
        } catch {
        }
        throw err;
      } finally {
        release();
      }
    }
  };
  return adapter;
}
function initDbAdapter() {
  const remoteCfg = resolveRemoteDbUrl();
  if (remoteCfg) {
    return createLibsqlAdapter(remoteCfg.url, remoteCfg.authToken, "turso");
  }
  if (!isServerlessEnv) {
    try {
      return createNativeSqliteAdapter();
    } catch (err) {
      console.warn("[Orvexa DB] better-sqlite3 unavailable, falling back to libsql local file:", err?.message);
    }
  }
  try {
    return createLibsqlAdapter(`file:${dbPath}`, void 0, "sqlite-file");
  } catch (fileErr) {
    console.warn("[Orvexa DB] local file SQLite unavailable, falling back to :memory:", fileErr?.message);
    return createLibsqlAdapter(":memory:", void 0, "sqlite-memory");
  }
}
var db = initDbAdapter();
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, storedHash) {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, "hex");
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}
async function initDatabase() {
  if (db.isRemote) {
    await db.exec(`PRAGMA foreign_keys = ON;`);
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      fullName TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      emailOrPhone TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('buyer', 'seller', 'admin')),
      shopName TEXT,
      shopDescription TEXT,
      avatarUrl TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'blocked', 'suspended')),
      resetTokenHash TEXT,
      resetTokenExpires INTEGER,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tokenHash TEXT UNIQUE NOT NULL,
      createdAt INTEGER NOT NULL,
      lastUsedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      mimeType TEXT NOT NULL,
      dataBase64 TEXT NOT NULL,
      sizeBytes INTEGER NOT NULL DEFAULT 0,
      uploaderId TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      nameEn TEXT NOT NULL,
      nameBn TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      imageUrl TEXT NOT NULL,
      subcategories TEXT NOT NULL DEFAULT '[]',
      sortOrder INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      sellerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shopName TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      categoryId TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      previousPrice REAL,
      currentPrice REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      images TEXT NOT NULL DEFAULT '[]',
      variations TEXT NOT NULL DEFAULT '{}',
      isFeatured INTEGER NOT NULL DEFAULT 0,
      isTrending INTEGER NOT NULL DEFAULT 0,
      isRecommended INTEGER NOT NULL DEFAULT 0,
      isHidden INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      ratingAvg REAL NOT NULL DEFAULT 4.8,
      ratingCount INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      userName TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 1,
      selectedVariation TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      createdAt INTEGER NOT NULL,
      UNIQUE(userId, productId)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      orderNumber TEXT UNIQUE NOT NULL,
      buyerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customerName TEXT NOT NULL,
      customerPhone TEXT NOT NULL,
      backupPhone TEXT,
      district TEXT,
      thana TEXT,
      deliveryAddress TEXT NOT NULL,
      paymentMethod TEXT NOT NULL DEFAULT 'Cash on Delivery',
      subtotal REAL NOT NULL,
      deliveryFee REAL NOT NULL DEFAULT 70,
      totalAmount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled')),
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      productId TEXT NOT NULL,
      sellerId TEXT NOT NULL,
      productName TEXT NOT NULL,
      productImage TEXT NOT NULL,
      shopName TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      variation TEXT,
      itemStatus TEXT NOT NULL DEFAULT 'Pending'
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      buyerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sellerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      productId TEXT,
      productName TEXT,
      productImage TEXT,
      productPrice REAL,
      lastMessage TEXT,
      lastMessageAt INTEGER NOT NULL,
      buyerUnread INTEGER NOT NULL DEFAULT 0,
      sellerUnread INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      senderId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT,
      isRead INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS homepage_product_ads (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      promoText TEXT,
      customImageUrl TEXT,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      isActive INTEGER NOT NULL DEFAULT 1,
      expiresAt INTEGER,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS advertisements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      placement TEXT NOT NULL CHECK(placement IN ('homepage_top', 'homepage_middle', 'homepage_bottom', 'category_page', 'product_page', 'sidebar', 'other')),
      adType TEXT NOT NULL CHECK(adType IN ('image', 'banner', 'html', 'js')),
      imageUrl TEXT,
      targetUrl TEXT,
      htmlCode TEXT,
      jsCode TEXT,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporterId TEXT,
      reporterName TEXT NOT NULL,
      reportType TEXT NOT NULL CHECK(reportType IN ('customer_message', 'seller_report', 'product_report')),
      targetId TEXT,
      targetName TEXT,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open', 'Resolved', 'Dismissed')),
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sms_logs (
      id TEXT PRIMARY KEY,
      recipientPhone TEXT NOT NULL,
      senderName TEXT NOT NULL DEFAULT 'Orvexa',
      messageType TEXT NOT NULL CHECK(messageType IN ('otp_reset', 'order_confirmation', 'test')),
      messageBody TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'built_in',
      status TEXT NOT NULL DEFAULT 'sent',
      referenceId TEXT,
      errorDetail TEXT,
      createdAt INTEGER NOT NULL
    );
  `);
  const orderCols = await db.all(`PRAGMA table_info(orders)`);
  const existingOrderColNames = new Set(orderCols.map((c) => c.name));
  if (!existingOrderColNames.has("backupPhone")) {
    await db.exec(`ALTER TABLE orders ADD COLUMN backupPhone TEXT;`);
  }
  if (!existingOrderColNames.has("district")) {
    await db.exec(`ALTER TABLE orders ADD COLUMN district TEXT;`);
  }
  if (!existingOrderColNames.has("thana")) {
    await db.exec(`ALTER TABLE orders ADD COLUMN thana TEXT;`);
  }
  const userCols = await db.all(`PRAGMA table_info(users)`);
  const existingUserColNames = new Set(userCols.map((c) => c.name));
  if (!existingUserColNames.has("resetAttempts")) {
    await db.exec(`ALTER TABLE users ADD COLUMN resetAttempts INTEGER NOT NULL DEFAULT 0;`);
  }
  const prodCols = await db.all(`PRAGMA table_info(products)`);
  const existingProdColNames = new Set(prodCols.map((c) => c.name));
  if (!existingProdColNames.has("promoCode")) {
    await db.exec(`ALTER TABLE products ADD COLUMN promoCode TEXT;`);
  }
  if (!existingProdColNames.has("promoDiscount")) {
    await db.exec(`ALTER TABLE products ADD COLUMN promoDiscount REAL NOT NULL DEFAULT 0;`);
  }
  if (!existingProdColNames.has("promoFontStyle")) {
    await db.exec(`ALTER TABLE products ADD COLUMN promoFontStyle TEXT;`);
  }
  const cartCols = await db.all(`PRAGMA table_info(cart_items)`);
  const existingCartColNames = new Set(cartCols.map((c) => c.name));
  if (!existingCartColNames.has("appliedPromoCode")) {
    await db.exec(`ALTER TABLE cart_items ADD COLUMN appliedPromoCode TEXT;`);
  }
  const orderItemCols = await db.all(`PRAGMA table_info(order_items)`);
  const existingOrderItemColNames = new Set(orderItemCols.map((c) => c.name));
  if (!existingOrderItemColNames.has("appliedPromoCode")) {
    await db.exec(`ALTER TABLE order_items ADD COLUMN appliedPromoCode TEXT;`);
  }
  if (!existingOrderItemColNames.has("promoDiscount")) {
    await db.exec(`ALTER TABLE order_items ADD COLUMN promoDiscount REAL NOT NULL DEFAULT 0;`);
  }
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
    CREATE INDEX IF NOT EXISTS idx_sessions_last_used ON sessions(lastUsedAt);
    CREATE INDEX IF NOT EXISTS idx_products_seller ON products(sellerId);
    CREATE INDEX IF NOT EXISTS idx_products_cat_hidden ON products(categoryId, isHidden, createdAt);
    CREATE INDEX IF NOT EXISTS idx_orders_buyer_created ON orders(buyerId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customerPhone);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(orderId);
    CREATE INDEX IF NOT EXISTS idx_order_items_seller ON order_items(sellerId);
    CREATE INDEX IF NOT EXISTS idx_conversations_buyer ON conversations(buyerId, lastMessageAt);
    CREATE INDEX IF NOT EXISTS idx_conversations_seller ON conversations(sellerId, lastMessageAt);
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversationId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_media_created ON media(createdAt);
    CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(productId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_sms_logs_created ON sms_logs(createdAt);
  `);
}

// server/auth.ts
var SECRET_SETTINGS_KEY = "__internal_session_secret";
function resolveEnvSessionSecret() {
  const raw = process.env.SESSION_SECRET?.trim() || "";
  if (raw.length >= 16) return raw;
  if (raw.length >= 8) {
    return crypto2.createHash("sha256").update(`orvexa:${raw}`).digest("hex");
  }
  return "";
}
var cachedSessionSecret = resolveEnvSessionSecret();
async function initSessionSecret() {
  const envSecret = resolveEnvSessionSecret();
  if (envSecret) {
    cachedSessionSecret = envSecret;
    return cachedSessionSecret;
  }
  try {
    const existing = await db.get(
      `SELECT value FROM site_settings WHERE key = ? LIMIT 1`,
      SECRET_SETTINGS_KEY
    );
    if (existing?.value) {
      const parsed = JSON.parse(existing.value);
      if (typeof parsed === "string" && parsed.length >= 32) {
        cachedSessionSecret = parsed;
        return cachedSessionSecret;
      }
    }
    const generated = crypto2.randomBytes(32).toString("hex");
    await db.run(
      `INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)`,
      SECRET_SETTINGS_KEY,
      JSON.stringify(generated)
    );
    const stored = await db.get(
      `SELECT value FROM site_settings WHERE key = ? LIMIT 1`,
      SECRET_SETTINGS_KEY
    );
    if (stored?.value) {
      const parsed = JSON.parse(stored.value);
      if (typeof parsed === "string" && parsed.length >= 32) {
        cachedSessionSecret = parsed;
        return cachedSessionSecret;
      }
    }
    cachedSessionSecret = generated;
    return cachedSessionSecret;
  } catch {
    if (!cachedSessionSecret) {
      cachedSessionSecret = crypto2.randomBytes(32).toString("hex");
    }
    return cachedSessionSecret;
  }
}
function getSessionSecret() {
  if (!cachedSessionSecret) {
    cachedSessionSecret = resolveEnvSessionSecret() || crypto2.randomBytes(32).toString("hex");
  }
  return cachedSessionSecret;
}
var TOKEN_TTL_MS = 1e3 * 60 * 60 * 24 * 365;
var SESSION_COOKIE_NAME = "orvexa_session";
var COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;
function signToken(userId) {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS })
  ).toString("base64url");
  const sig = crypto2.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto2.createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto2.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded.uid || !decoded.exp || decoded.exp < Date.now()) {
      return null;
    }
    return decoded.uid;
  } catch {
    return null;
  }
}
function hashSessionToken(rawToken) {
  return crypto2.createHash("sha256").update(rawToken).digest("hex");
}
async function createPersistentSession(userId) {
  const rawToken = crypto2.randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(rawToken);
  const now = Date.now();
  await db.run(
    `INSERT INTO sessions (id, userId, tokenHash, createdAt, lastUsedAt) VALUES (?, ?, ?, ?, ?)`,
    `sess-${crypto2.randomUUID()}`,
    userId,
    tokenHash,
    now,
    now
  );
  return rawToken;
}
async function verifyPersistentSession(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  const tokenHash = hashSessionToken(rawToken);
  const session = await db.get(
    `SELECT id, userId, lastUsedAt FROM sessions WHERE tokenHash = ? LIMIT 1`,
    tokenHash
  );
  if (!session) return null;
  const user = await getUserById(session.userId);
  if (!user || user.status !== "active") return null;
  const now = Date.now();
  if (now - Number(session.lastUsedAt || 0) > 5 * 60 * 1e3) {
    await db.run(`UPDATE sessions SET lastUsedAt = ? WHERE id = ?`, now, session.id);
  }
  return user;
}
async function revokePersistentSession(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return;
  const tokenHash = hashSessionToken(rawToken);
  await db.run(`DELETE FROM sessions WHERE tokenHash = ?`, tokenHash);
}
function parseCookieValue(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(";");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
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
function isHttpsRequest(req) {
  if (!req) return true;
  if (req.secure) return true;
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  if (typeof proto === "string" && proto.split(",").some((p) => p.trim().toLowerCase() === "https")) {
    return true;
  }
  const sslHeader = req.headers["x-forwarded-ssl"];
  if (typeof sslHeader === "string" && sslHeader.trim().toLowerCase() === "on") {
    return true;
  }
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.toLowerCase().startsWith("https://")) {
    return true;
  }
  return false;
}
function extractRequestHostCandidates(req) {
  const rawValues = [];
  for (const h of [req.headers["x-forwarded-host"], req.headers["x-original-host"], req.headers.host]) {
    if (Array.isArray(h)) {
      rawValues.push(...h);
    } else if (typeof h === "string" && h.trim()) {
      rawValues.push(h);
    }
  }
  const set = /* @__PURE__ */ new Set();
  for (const raw of rawValues) {
    for (const part of raw.split(",")) {
      const cleaned = part.trim().toLowerCase();
      if (!cleaned) continue;
      set.add(cleaned);
      const hostnameOnly = cleaned.replace(/:\d+$/, "");
      if (hostnameOnly) set.add(hostnameOnly);
    }
  }
  return Array.from(set);
}
function setSessionCookie(res, rawToken, req) {
  const secureAttrs = isHttpsRequest(req) ? "Secure; SameSite=None; Partitioned" : "SameSite=Lax";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; ${secureAttrs}; Max-Age=${COOKIE_MAX_AGE_SECONDS}`
  );
}
function clearSessionCookie(res, req) {
  const secureAttrs = isHttpsRequest(req) ? "Secure; SameSite=None; Partitioned" : "SameSite=Lax";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; ${secureAttrs}; Max-Age=0`
  );
}
function isSameOriginOrCustomHeader(req) {
  if (req.headers["x-requested-with"] === "XMLHttpRequest") {
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
async function getUserById(userId) {
  const row = await db.get(
    `SELECT id, fullName, username, emailOrPhone, role, shopName, shopDescription, avatarUrl, status, createdAt FROM users WHERE id = ?`,
    userId
  );
  return row || null;
}
async function extractBearerUser(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const uid = verifyToken(token);
    if (uid) {
      const user = await getUserById(uid);
      if (user && user.status === "active") return user;
    }
  }
  const cookieToken = parseCookieValue(req, SESSION_COOKIE_NAME);
  if (!cookieToken) return null;
  const mutatingMethods = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
  if (mutatingMethods.has(req.method.toUpperCase()) && !isSameOriginOrCustomHeader(req)) {
    return null;
  }
  return verifyPersistentSession(cookieToken);
}
async function requireAuth(req, res, next) {
  try {
    const user = await extractBearerUser(req);
    if (!user) {
      res.status(401).json({ error: "\u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u0986\u0997\u09C7 \u09B8\u09BE\u0987\u09A8 \u0987\u09A8 \u0995\u09B0\u09C1\u09A8\u0964" });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
async function requireSeller(req, res, next) {
  try {
    const user = await extractBearerUser(req);
    if (!user) {
      res.status(401).json({ error: "\u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u0986\u0997\u09C7 \u09B8\u09BE\u0987\u09A8 \u0987\u09A8 \u0995\u09B0\u09C1\u09A8\u0964" });
      return;
    }
    if (user.role !== "seller" && user.role !== "admin") {
      res.status(403).json({ error: "\u098F\u0987 \u09B8\u09C1\u09AC\u09BF\u09A7\u09BE\u099F\u09BF \u09B6\u09C1\u09A7\u09C1\u09AE\u09BE\u09A4\u09CD\u09B0 \u09B8\u09C7\u09B2\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF\u0964" });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
async function requireAdmin(req, res, next) {
  try {
    const user = await extractBearerUser(req);
    if (!user) {
      res.status(401).json({ error: "\u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8 \u09AA\u09CD\u09B0\u09AE\u09BE\u09A3\u09C0\u0995\u09B0\u09A3 \u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u099C\u09A8\u0964" });
      return;
    }
    if (user.role !== "admin") {
      res.status(403).json({ error: "\u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8 \u0985\u09A8\u09C1\u09AE\u09A4\u09BF \u09A8\u09C7\u0987\u0964" });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// server/seed.ts
import crypto3 from "crypto";
async function seedInitialData() {
  const now = Date.now();
  const existingAdmin = await db.get(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (!existingAdmin) {
    const adminUsername = process.env.ADMIN_USERNAME || "tmxjakir";
    const adminInitialPassword = process.env.ADMIN_INITIAL_PASSWORD || "tmxjakir";
    await db.run(
      `INSERT OR IGNORE INTO users (id, fullName, username, emailOrPhone, passwordHash, role, shopName, status, createdAt)
       VALUES (?, ?, ?, ?, ?, 'admin', ?, 'active', ?)`,
      "admin-root",
      "Orvexa Administrator",
      adminUsername,
      "admin@orvexa.com",
      hashPassword(adminInitialPassword),
      "Orvexa Admin",
      now
    );
  }
  const catRow = await db.get(`SELECT COUNT(*) as cnt FROM categories`);
  const catCount = Number(catRow?.cnt || 0);
  if (catCount > 0) return;
  const categories = [
    {
      id: "cat-fashion",
      nameEn: "Fashion & Clothing",
      nameBn: "\u09AB\u09CD\u09AF\u09BE\u09B6\u09A8 \u0993 \u09AA\u09CB\u09B6\u09BE\u0995",
      slug: "fashion-clothing",
      imageUrl: "/src/assets/images/cat_fashion_clothing_1795274483854.jpg",
      sortOrder: 1,
      subcategories: [
        { nameEn: "Men's Clothing", nameBn: "\u099B\u09C7\u09B2\u09C7\u09A6\u09C7\u09B0 \u09AA\u09CB\u09B6\u09BE\u0995" },
        { nameEn: "Women's Clothing", nameBn: "\u09AE\u09C7\u09AF\u09BC\u09C7\u09A6\u09C7\u09B0 \u09AA\u09CB\u09B6\u09BE\u0995" },
        { nameEn: "Kids' Clothing", nameBn: "\u09B6\u09BF\u09B6\u09C1\u09A6\u09C7\u09B0 \u09AA\u09CB\u09B6\u09BE\u0995" },
        { nameEn: "T-Shirts", nameBn: "\u099F\u09BF-\u09B6\u09BE\u09B0\u09CD\u099F" },
        { nameEn: "Shirts", nameBn: "\u09B6\u09BE\u09B0\u09CD\u099F" },
        { nameEn: "Polo Shirts", nameBn: "\u09AA\u09CB\u09B2\u09CB \u09B6\u09BE\u09B0\u09CD\u099F" },
        { nameEn: "Pants", nameBn: "\u09AA\u09CD\u09AF\u09BE\u09A8\u09CD\u099F" },
        { nameEn: "Jeans", nameBn: "\u099C\u09BF\u09A8\u09CD\u09B8" },
        { nameEn: "Shorts", nameBn: "\u09B6\u09B0\u09CD\u099F\u09B8" },
        { nameEn: "Jackets", nameBn: "\u099C\u09CD\u09AF\u09BE\u0995\u09C7\u099F" },
        { nameEn: "Hoodies", nameBn: "\u09B9\u09C1\u09A1\u09BF" },
        { nameEn: "Sweaters", nameBn: "\u09B8\u09CB\u09AF\u09BC\u09C7\u099F\u09BE\u09B0" },
        { nameEn: "Dresses", nameBn: "\u09A1\u09CD\u09B0\u09C7\u09B8" },
        { nameEn: "Sarees", nameBn: "\u09B6\u09BE\u09A1\u09BC\u09BF" },
        { nameEn: "Panjabi", nameBn: "\u09AA\u09BE\u099E\u09CD\u099C\u09BE\u09AC\u09BF" },
        { nameEn: "Three-Piece", nameBn: "\u09A5\u09CD\u09B0\u09BF-\u09AA\u09BF\u09B8" },
        { nameEn: "Shoes", nameBn: "\u099C\u09C1\u09A4\u09BE" },
        { nameEn: "Sneakers", nameBn: "\u09B8\u09CD\u09A8\u09BF\u0995\u09BE\u09B0\u09CD\u09B8" },
        { nameEn: "Sandals", nameBn: "\u09B8\u09CD\u09AF\u09BE\u09A8\u09CD\u09A1\u09C7\u09B2" },
        { nameEn: "Bags", nameBn: "\u09AC\u09CD\u09AF\u09BE\u0997" },
        { nameEn: "Watches", nameBn: "\u0998\u09A1\u09BC\u09BF" },
        { nameEn: "Accessories", nameBn: "\u0985\u09CD\u09AF\u09BE\u0995\u09CD\u09B8\u09C7\u09B8\u09B0\u09BF\u099C" }
      ]
    },
    {
      id: "cat-electronics",
      nameEn: "Electronics",
      nameBn: "\u0987\u09B2\u09C7\u0995\u099F\u09CD\u09B0\u09A8\u09BF\u0995\u09CD\u09B8",
      slug: "electronics",
      imageUrl: "/src/assets/images/cat_electronics_tech_1795274484317.jpg",
      sortOrder: 2,
      subcategories: [
        { nameEn: "Mobile Phones", nameBn: "\u09AE\u09CB\u09AC\u09BE\u0987\u09B2 \u09AB\u09CB\u09A8" },
        { nameEn: "Smartphones", nameBn: "\u09B8\u09CD\u09AE\u09BE\u09B0\u09CD\u099F\u09AB\u09CB\u09A8" },
        { nameEn: "Tablets", nameBn: "\u099F\u09CD\u09AF\u09BE\u09AC\u09B2\u09C7\u099F" },
        { nameEn: "Laptops", nameBn: "\u09B2\u09CD\u09AF\u09BE\u09AA\u099F\u09AA" },
        { nameEn: "Desktop Computers", nameBn: "\u09A1\u09C7\u09B8\u09CD\u0995\u099F\u09AA \u0995\u09AE\u09CD\u09AA\u09BF\u0989\u099F\u09BE\u09B0" },
        { nameEn: "Computer Accessories", nameBn: "\u0995\u09AE\u09CD\u09AA\u09BF\u0989\u099F\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u0995\u09CD\u09B8\u09C7\u09B8\u09B0\u09BF\u099C" },
        { nameEn: "Headphones", nameBn: "\u09B9\u09C7\u09A1\u09AB\u09CB\u09A8" },
        { nameEn: "Earphones", nameBn: "\u0987\u09AF\u09BC\u09BE\u09B0\u09AB\u09CB\u09A8" },
        { nameEn: "Speakers", nameBn: "\u09B8\u09CD\u09AA\u09BF\u0995\u09BE\u09B0" },
        { nameEn: "Smart Watches", nameBn: "\u09B8\u09CD\u09AE\u09BE\u09B0\u09CD\u099F \u0993\u09AF\u09BC\u09BE\u099A" },
        { nameEn: "Cameras", nameBn: "\u0995\u09CD\u09AF\u09BE\u09AE\u09C7\u09B0\u09BE" },
        { nameEn: "Gaming Accessories", nameBn: "\u0997\u09C7\u09AE\u09BF\u0982 \u0985\u09CD\u09AF\u09BE\u0995\u09CD\u09B8\u09C7\u09B8\u09B0\u09BF\u099C" },
        { nameEn: "Chargers", nameBn: "\u099A\u09BE\u09B0\u09CD\u099C\u09BE\u09B0" },
        { nameEn: "Power Banks", nameBn: "\u09AA\u09BE\u0993\u09AF\u09BC\u09BE\u09B0 \u09AC\u09CD\u09AF\u09BE\u0982\u0995" },
        { nameEn: "Keyboards", nameBn: "\u0995\u09C0\u09AC\u09CB\u09B0\u09CD\u09A1" },
        { nameEn: "Mouse", nameBn: "\u09AE\u09BE\u0989\u09B8" }
      ]
    },
    {
      id: "cat-home",
      nameEn: "Home & Living",
      nameBn: "\u09B9\u09CB\u09AE \u0993 \u09B2\u09BF\u09AD\u09BF\u0982",
      slug: "home-living",
      imageUrl: "/src/assets/images/cat_home_living_1795274486801.jpg",
      sortOrder: 3,
      subcategories: [
        { nameEn: "Furniture", nameBn: "\u09AB\u09BE\u09B0\u09CD\u09A8\u09BF\u099A\u09BE\u09B0" },
        { nameEn: "Home Decor", nameBn: "\u09B9\u09CB\u09AE \u09A1\u09C7\u0995\u09CB\u09B0" },
        { nameEn: "Lighting", nameBn: "\u09B2\u09BE\u0987\u099F\u09BF\u0982" },
        { nameEn: "Kitchen Accessories", nameBn: "\u0995\u09BF\u099A\u09C7\u09A8 \u0985\u09CD\u09AF\u09BE\u0995\u09CD\u09B8\u09C7\u09B8\u09B0\u09BF\u099C" },
        { nameEn: "Cookware", nameBn: "\u0995\u09C1\u0995\u0993\u09AF\u09BC\u09CD\u09AF\u09BE\u09B0" },
        { nameEn: "Home Appliances", nameBn: "\u09B9\u09CB\u09AE \u0985\u09CD\u09AF\u09BE\u09AA\u09CD\u09B2\u09BE\u09AF\u09BC\u09C7\u09A8\u09CD\u09B8" },
        { nameEn: "Storage", nameBn: "\u09B8\u09CD\u099F\u09CB\u09B0\u09C7\u099C" },
        { nameEn: "Bedding", nameBn: "\u09AC\u09C7\u09A1\u09BF\u0982 \u0993 \u09AC\u09BF\u099B\u09BE\u09A8\u09BE\u09B0 \u099A\u09BE\u09A6\u09B0" },
        { nameEn: "Bathroom Accessories", nameBn: "\u09AC\u09BE\u09A5\u09B0\u09C1\u09AE \u0985\u09CD\u09AF\u09BE\u0995\u09CD\u09B8\u09C7\u09B8\u09B0\u09BF\u099C" }
      ]
    },
    {
      id: "cat-beauty",
      nameEn: "Beauty & Personal Care",
      nameBn: "\u09AC\u09BF\u0989\u099F\u09BF \u0993 \u09AA\u09BE\u09B0\u09CD\u09B8\u09CB\u09A8\u09BE\u09B2 \u0995\u09C7\u09AF\u09BC\u09BE\u09B0",
      slug: "beauty-personal-care",
      imageUrl: "/src/assets/images/cat_beauty_skincare_1795274483955.jpg",
      sortOrder: 4,
      subcategories: [
        { nameEn: "Skincare", nameBn: "\u09B8\u09CD\u0995\u09BF\u09A8\u0995\u09C7\u09AF\u09BC\u09BE\u09B0" },
        { nameEn: "Hair Care", nameBn: "\u09B9\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09C7\u09AF\u09BC\u09BE\u09B0" },
        { nameEn: "Cosmetics", nameBn: "\u0995\u09B8\u09AE\u09C7\u099F\u09BF\u0995\u09CD\u09B8" },
        { nameEn: "Makeup Accessories", nameBn: "\u09AE\u09C7\u0995\u0986\u09AA \u0985\u09CD\u09AF\u09BE\u0995\u09CD\u09B8\u09C7\u09B8\u09B0\u09BF\u099C" },
        { nameEn: "Personal Care", nameBn: "\u09AA\u09BE\u09B0\u09CD\u09B8\u09CB\u09A8\u09BE\u09B2 \u0995\u09C7\u09AF\u09BC\u09BE\u09B0" }
      ]
    },
    {
      id: "cat-sports",
      nameEn: "Sports & Outdoor",
      nameBn: "\u09B8\u09CD\u09AA\u09CB\u09B0\u09CD\u099F\u09B8 \u0993 \u0986\u0989\u099F\u09A1\u09CB\u09B0",
      slug: "sports-outdoor",
      imageUrl: "/src/assets/images/cat_sports_outdoor_1795274483907.jpg",
      sortOrder: 5,
      subcategories: [
        { nameEn: "Football", nameBn: "\u09AB\u09C1\u099F\u09AC\u09B2" },
        { nameEn: "Sports Clothing", nameBn: "\u09B8\u09CD\u09AA\u09CB\u09B0\u09CD\u099F\u09B8 \u09AA\u09CB\u09B6\u09BE\u0995" },
        { nameEn: "Sports Shoes", nameBn: "\u09B8\u09CD\u09AA\u09CB\u09B0\u09CD\u099F\u09B8 \u099C\u09C1\u09A4\u09BE" },
        { nameEn: "Fitness Accessories", nameBn: "\u09AB\u09BF\u099F\u09A8\u09C7\u09B8 \u09B8\u09B0\u099E\u09CD\u099C\u09BE\u09AE" },
        { nameEn: "Outdoor Accessories", nameBn: "\u0986\u0989\u099F\u09A1\u09CB\u09B0 \u09B8\u09B0\u099E\u09CD\u099C\u09BE\u09AE" }
      ]
    },
    {
      id: "cat-books",
      nameEn: "Books & Stationery",
      nameBn: "\u09AC\u0987 \u0993 \u09B8\u09CD\u099F\u09C7\u09B6\u09A8\u09BE\u09B0\u09BF",
      slug: "books-stationery",
      imageUrl: "/src/assets/images/cat_books_stationery_1795274483743.jpg",
      sortOrder: 6,
      subcategories: [
        { nameEn: "Books", nameBn: "\u09AC\u0987" },
        { nameEn: "Educational Books", nameBn: "\u09B6\u09BF\u0995\u09CD\u09B7\u09BE\u09AE\u09C2\u09B2\u0995 \u09AC\u0987" },
        { nameEn: "Notebooks", nameBn: "\u09A8\u09CB\u099F\u09AC\u09C1\u0995 \u0993 \u0996\u09BE\u09A4\u09BE" },
        { nameEn: "Stationery", nameBn: "\u09B8\u09CD\u099F\u09C7\u09B6\u09A8\u09BE\u09B0\u09BF" },
        { nameEn: "Office Supplies", nameBn: "\u0985\u09AB\u09BF\u09B8 \u09B8\u09BE\u09AE\u0997\u09CD\u09B0\u09C0" }
      ]
    },
    {
      id: "cat-food",
      nameEn: "Food & Grocery",
      nameBn: "\u0996\u09BE\u09AC\u09BE\u09B0 \u0993 \u0997\u09CD\u09B0\u09CB\u09B8\u09BE\u09B0\u09BF",
      slug: "food-grocery",
      imageUrl: "/src/assets/images/cat_food_grocery_1795274484128.jpg",
      sortOrder: 7,
      subcategories: [
        { nameEn: "Snacks", nameBn: "\u09B8\u09CD\u09A8\u09CD\u09AF\u09BE\u0995\u09B8" },
        { nameEn: "Packaged Food", nameBn: "\u09AA\u09CD\u09AF\u09BE\u0995\u09C7\u099F\u099C\u09BE\u09A4 \u0996\u09BE\u09AC\u09BE\u09B0" },
        { nameEn: "Grocery", nameBn: "\u0997\u09CD\u09B0\u09CB\u09B8\u09BE\u09B0\u09BF" },
        { nameEn: "Kitchen Essentials", nameBn: "\u09B0\u09BE\u09A8\u09CD\u09A8\u09BE\u0998\u09B0\u09C7\u09B0 \u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u099C\u09A8\u09C0\u09AF\u09BC \u09B8\u09BE\u09AE\u0997\u09CD\u09B0\u09C0" }
      ]
    },
    {
      id: "cat-baby",
      nameEn: "Baby & Kids",
      nameBn: "\u09AC\u09C7\u09AC\u09BF \u0993 \u0995\u09BF\u09A1\u09B8",
      slug: "baby-kids",
      imageUrl: "/src/assets/images/cat_baby_gifts_1795274484045.jpg",
      sortOrder: 8,
      subcategories: [
        { nameEn: "Baby Clothing", nameBn: "\u09B6\u09BF\u09B6\u09C1\u09A6\u09C7\u09B0 \u09AA\u09CB\u09B6\u09BE\u0995" },
        { nameEn: "Baby Accessories", nameBn: "\u09AC\u09C7\u09AC\u09BF \u0985\u09CD\u09AF\u09BE\u0995\u09CD\u09B8\u09C7\u09B8\u09B0\u09BF\u099C" },
        { nameEn: "Toys", nameBn: "\u0996\u09C7\u09B2\u09A8\u09BE" },
        { nameEn: "Kids' Accessories", nameBn: "\u0995\u09BF\u09A1\u09B8 \u0985\u09CD\u09AF\u09BE\u0995\u09CD\u09B8\u09C7\u09B8\u09B0\u09BF\u099C" }
      ]
    },
    {
      id: "cat-automotive",
      nameEn: "Automotive",
      nameBn: "\u0985\u099F\u09CB\u09AE\u09CB\u099F\u09BF\u09AD",
      slug: "automotive",
      imageUrl: "/src/assets/images/cat_automotive_gear_1795274484811.jpg",
      sortOrder: 9,
      subcategories: [
        { nameEn: "Car Accessories", nameBn: "\u0995\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u0995\u09CD\u09B8\u09C7\u09B8\u09B0\u09BF\u099C" },
        { nameEn: "Motorcycle Accessories", nameBn: "\u09AE\u09CB\u099F\u09B0\u09B8\u09BE\u0987\u0995\u09C7\u09B2 \u0985\u09CD\u09AF\u09BE\u0995\u09CD\u09B8\u09C7\u09B8\u09B0\u09BF\u099C" },
        { nameEn: "Vehicle Accessories", nameBn: "\u09AF\u09BE\u09A8\u09AC\u09BE\u09B9\u09A8 \u09B8\u09B0\u099E\u09CD\u099C\u09BE\u09AE" }
      ]
    },
    {
      id: "cat-other",
      nameEn: "Other",
      nameBn: "\u0985\u09A8\u09CD\u09AF\u09BE\u09A8\u09CD\u09AF",
      slug: "other",
      imageUrl: "/src/assets/images/cat_baby_gifts_1795274484045.jpg",
      sortOrder: 10,
      subcategories: [
        { nameEn: "Gifts", nameBn: "\u0989\u09AA\u09B9\u09BE\u09B0 \u09B8\u09BE\u09AE\u0997\u09CD\u09B0\u09C0" },
        { nameEn: "Handmade Products", nameBn: "\u09B9\u09B8\u09CD\u09A4\u09B6\u09BF\u09B2\u09CD\u09AA \u09AA\u09A3\u09CD\u09AF" },
        { nameEn: "Accessories", nameBn: "\u0985\u09CD\u09AF\u09BE\u0995\u09CD\u09B8\u09C7\u09B8\u09B0\u09BF\u099C" },
        { nameEn: "Other Products", nameBn: "\u0985\u09A8\u09CD\u09AF\u09BE\u09A8\u09CD\u09AF \u09AA\u09A3\u09CD\u09AF" }
      ]
    }
  ];
  const demoSellerPass = hashPassword(crypto3.randomBytes(16).toString("hex"));
  const sellers = [
    {
      id: "seller-dhaka-craft",
      fullName: "\u09B0\u09BE\u09B6\u09C7\u09A6\u09C1\u09B2 \u0995\u09B0\u09BF\u09AE",
      username: "dhakacraft",
      emailOrPhone: "store@dhakacraft.bd",
      shopName: "\u09A2\u09BE\u0995\u09BE \u0995\u09CD\u09B0\u09CD\u09AF\u09BE\u09AB\u099F \u0993 \u09AB\u09CD\u09AF\u09BE\u09B6\u09A8",
      shopDescription: "\u09AA\u09CD\u09B0\u09BF\u09AE\u09BF\u09AF\u09BC\u09BE\u09AE \u09AA\u09BE\u099E\u09CD\u099C\u09BE\u09AC\u09BF, \u09A6\u09C7\u09B6\u09C0\u09AF\u09BC \u09B6\u09BE\u09A1\u09BC\u09BF \u0993 \u0986\u09A7\u09C1\u09A8\u09BF\u0995 \u09AB\u09CD\u09AF\u09BE\u09B6\u09A8 \u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u09AC\u09BF\u09B6\u09CD\u09AC\u09B8\u09CD\u09A4 \u09A0\u09BF\u0995\u09BE\u09A8\u09BE\u0964"
    },
    {
      id: "seller-tech-pulse",
      fullName: "\u09A4\u09BE\u09A8\u09AD\u09C0\u09B0 \u0986\u09B9\u09AE\u09C7\u09A6",
      username: "techpulsebd",
      emailOrPhone: "sales@techpulse.bd",
      shopName: "\u099F\u09C7\u0995\u09AA\u09BE\u09B2\u09B8 \u0997\u09CD\u09AF\u09BE\u099C\u09C7\u099F",
      shopDescription: "\u0985\u09B0\u09BF\u099C\u09BF\u09A8\u09BE\u09B2 \u09B8\u09CD\u09AE\u09BE\u09B0\u09CD\u099F\u0993\u09AF\u09BC\u09BE\u099A, \u09B9\u09C7\u09A1\u09AB\u09CB\u09A8, \u099A\u09BE\u09B0\u09CD\u099C\u09BE\u09B0 \u0993 \u09B8\u09CD\u09AE\u09BE\u09B0\u09CD\u099F \u0997\u09CD\u09AF\u09BE\u099C\u09C7\u099F \u0995\u09BE\u09B2\u09C7\u0995\u09B6\u09A8\u0964"
    },
    {
      id: "seller-pure-living",
      fullName: "\u09A8\u09C1\u09B8\u09B0\u09BE\u09A4 \u099C\u09BE\u09B9\u09BE\u09A8",
      username: "purelivingbd",
      emailOrPhone: "hello@pureliving.bd",
      shopName: "\u09AA\u09BF\u0993\u09B0 \u09B2\u09BF\u09AD\u09BF\u0982 \u09B8\u09CD\u099F\u09CB\u09B0",
      shopDescription: "\u09B9\u09CB\u09AE \u09A1\u09C7\u0995\u09CB\u09B0, \u09B8\u09CD\u0995\u09BF\u09A8\u0995\u09C7\u09AF\u09BC\u09BE\u09B0, \u0985\u09B0\u09CD\u0997\u09BE\u09A8\u09BF\u0995 \u09AE\u09A7\u09C1 \u0993 \u0997\u09CD\u09B0\u09CB\u09B8\u09BE\u09B0\u09BF \u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u09A8\u09BF\u09B0\u09CD\u09AD\u09B0\u09AF\u09CB\u0997\u09CD\u09AF \u09B6\u09AA\u0964"
    }
  ];
  const products = [
    {
      id: "prod-emerald-panjabi",
      slug: "emerald-cotton-panjabi",
      sellerId: "seller-dhaka-craft",
      shopName: "\u09A2\u09BE\u0995\u09BE \u0995\u09CD\u09B0\u09CD\u09AF\u09BE\u09AB\u099F \u0993 \u09AB\u09CD\u09AF\u09BE\u09B6\u09A8",
      name: "\u09AA\u09CD\u09B0\u09BF\u09AE\u09BF\u09AF\u09BC\u09BE\u09AE \u098F\u09AE\u09C7\u09B0\u09BE\u09B2\u09CD\u09A1 \u0995\u099F\u09A8 \u09AA\u09BE\u099E\u09CD\u099C\u09BE\u09AC\u09BF",
      description: "\u09E7\u09E6\u09E6% \u0996\u09BE\u0981\u099F\u09BF \u0995\u09AE\u09AB\u09CB\u09B0\u09CD\u099F \u0995\u099F\u09A8 \u09AB\u09C7\u09AC\u09CD\u09B0\u09BF\u0995 \u09A6\u09BF\u09AF\u09BC\u09C7 \u09A4\u09C8\u09B0\u09BF \u0985\u09AD\u09BF\u099C\u09BE\u09A4 \u098F\u09AE\u09C7\u09B0\u09BE\u09B2\u09CD\u09A1 \u09B8\u09AC\u09C1\u099C \u09AA\u09BE\u099E\u09CD\u099C\u09BE\u09AC\u09BF\u0964 \u0989\u09CE\u09B8\u09AC, \u0988\u09A6 \u098F\u09AC\u0982 \u09AF\u09C7\u0995\u09CB\u09A8\u09CB \u09AC\u09BF\u09B6\u09C7\u09B7 \u0985\u09A8\u09C1\u09B7\u09CD\u09A0\u09BE\u09A8\u09C7 \u0986\u09B0\u09BE\u09AE\u09A6\u09BE\u09AF\u09BC\u0995 \u0993 \u09B8\u09CD\u099F\u09BE\u0987\u09B2\u09BF\u09B6 \u09B2\u09C1\u0995\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u0989\u09AA\u09AF\u09CB\u0997\u09C0\u0964 \u09A8\u09BF\u0996\u09C1\u0981\u09A4 \u098F\u09AE\u09AC\u09CD\u09B0\u09AF\u09BC\u09A1\u09BE\u09B0\u09BF \u0995\u09B2\u09BE\u09B0 \u0993 \u09AA\u09CD\u09B2\u09C7\u099F \u09A1\u09BF\u099C\u09BE\u0987\u09A8\u0964",
      categoryId: "cat-fashion",
      subcategory: "Panjabi",
      previousPrice: 2450,
      currentPrice: 1790,
      stock: 28,
      images: ["/src/assets/images/prod_panjabi_heritage_1795274483747.jpg", "/src/assets/images/cat_fashion_clothing_1795274483854.jpg"],
      variations: { sizes: ["M", "L", "XL", "XXL"], colors: ["\u098F\u09AE\u09C7\u09B0\u09BE\u09B2\u09CD\u09A1 \u0997\u09CD\u09B0\u09BF\u09A8", "\u09A8\u09C7\u09AD\u09BF \u09AC\u09CD\u09B2\u09C1"] },
      isFeatured: 1,
      isTrending: 1,
      isRecommended: 1,
      views: 420,
      ratingAvg: 4.9,
      ratingCount: 34
    },
    {
      id: "prod-linen-fashion-set",
      slug: "classic-linen-shirt-sneakers",
      sellerId: "seller-dhaka-craft",
      shopName: "\u09A2\u09BE\u0995\u09BE \u0995\u09CD\u09B0\u09CD\u09AF\u09BE\u09AB\u099F \u0993 \u09AB\u09CD\u09AF\u09BE\u09B6\u09A8",
      name: "\u0995\u09CD\u09B2\u09BE\u09B8\u09BF\u0995 \u09B2\u09BF\u09A8\u09C7\u09A8 \u09B6\u09BE\u09B0\u09CD\u099F \u0993 \u09B8\u09CD\u09A8\u09BF\u0995\u09BE\u09B0\u09CD\u09B8 \u0995\u09BE\u09B2\u09C7\u0995\u09B6\u09A8",
      description: "\u0997\u09CD\u09B0\u09C0\u09B7\u09CD\u09AE\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u0986\u09B0\u09BE\u09AE\u09A6\u09BE\u09AF\u09BC\u0995 \u09AA\u09CD\u09B0\u09BF\u09AE\u09BF\u09AF\u09BC\u09BE\u09AE \u09B2\u09BF\u09A8\u09C7\u09A8 \u0995\u09CD\u09AF\u09BE\u099C\u09C1\u09AF\u09BC\u09BE\u09B2 \u09B6\u09BE\u09B0\u09CD\u099F\u0964 \u09AC\u09CD\u09B0\u09C7\u09A5\u09C7\u09AC\u09B2 \u09AB\u09C7\u09AC\u09CD\u09B0\u09BF\u0995, \u09A8\u09BF\u0996\u09C1\u0981\u09A4 \u09B8\u09CD\u099F\u09BF\u099A\u09BF\u0982 \u098F\u09AC\u0982 \u09A6\u09C0\u09B0\u09CD\u0998\u09B8\u09CD\u09A5\u09BE\u09AF\u09BC\u09C0 \u09B0\u0999\u0964 \u0985\u09AB\u09BF\u09B8 \u0993 \u0995\u09CD\u09AF\u09BE\u099C\u09C1\u09AF\u09BC\u09BE\u09B2 \u0986\u0989\u099F\u09BF\u0982\u09AF\u09BC\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u09B8\u09C7\u09B0\u09BE \u09AA\u099B\u09A8\u09CD\u09A6\u0964",
      categoryId: "cat-fashion",
      subcategory: "Shirts",
      previousPrice: 1850,
      currentPrice: 1390,
      stock: 42,
      images: ["/src/assets/images/cat_fashion_clothing_1795274483854.jpg"],
      variations: { sizes: ["S", "M", "L", "XL"], colors: ["\u09AC\u09C7\u0987\u099C", "\u09B8\u09BE\u09A6\u09BE"] },
      isFeatured: 1,
      isTrending: 0,
      isRecommended: 1,
      views: 310,
      ratingAvg: 4.7,
      ratingCount: 19
    },
    {
      id: "prod-anc-headphones",
      slug: "studio-wireless-anc-headphones",
      sellerId: "seller-tech-pulse",
      shopName: "\u099F\u09C7\u0995\u09AA\u09BE\u09B2\u09B8 \u0997\u09CD\u09AF\u09BE\u099C\u09C7\u099F",
      name: "\u0985\u09CD\u09AF\u09BE\u0995\u09CD\u099F\u09BF\u09AD \u09A8\u09AF\u09BC\u09C7\u099C \u0995\u09CD\u09AF\u09BE\u09A8\u09CD\u09B8\u09C7\u09B2\u09BF\u0982 \u0993\u09AF\u09BC\u09CD\u09AF\u09BE\u09B0\u09B2\u09C7\u09B8 \u09B9\u09C7\u09A1\u09AB\u09CB\u09A8",
      description: "\u09EA\u09E6 \u0998\u09A8\u09CD\u099F\u09BE \u09AC\u09CD\u09AF\u09BE\u099F\u09BE\u09B0\u09BF \u09AC\u09CD\u09AF\u09BE\u0995\u0986\u09AA, \u09AC\u09CD\u09B2\u09C1\u099F\u09C1\u09A5 \u09EB.\u09E9, \u09A1\u09BF\u09AA \u09AC\u09C7\u09B8 \u09B8\u09BE\u0989\u09A8\u09CD\u09A1 \u098F\u09AC\u0982 \u09B9\u09BE\u0987\u09AC\u09CD\u09B0\u09BF\u09A1 \u0985\u09CD\u09AF\u09BE\u0995\u09CD\u099F\u09BF\u09AD \u09A8\u09AF\u09BC\u09C7\u099C \u0995\u09CD\u09AF\u09BE\u09A8\u09CD\u09B8\u09C7\u09B2\u09C7\u09B6\u09A8 \u09B8\u09C1\u09AC\u09BF\u09A7\u09BE\u0964 \u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u0995 \u09AB\u09CD\u09B0\u09AE \u09B9\u09CB\u09AE, \u0997\u09C7\u09AE\u09BF\u0982 \u098F\u09AC\u0982 \u09AE\u09BF\u0989\u099C\u09BF\u0995 \u09B2\u09BE\u09AD\u09BE\u09B0\u09A6\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u099A\u09AE\u09CE\u0995\u09BE\u09B0 \u09AA\u09BE\u09B0\u09AB\u09B0\u09AE\u09CD\u09AF\u09BE\u09A8\u09CD\u09B8\u0964",
      categoryId: "cat-electronics",
      subcategory: "Headphones",
      previousPrice: 4990,
      currentPrice: 3650,
      stock: 15,
      images: ["/src/assets/images/cat_electronics_tech_1795274484317.jpg"],
      variations: { colors: ["\u09AE\u09CD\u09AF\u09BE\u099F \u09AC\u09CD\u09B2\u09CD\u09AF\u09BE\u0995", "\u09B8\u09BF\u09B2\u09AD\u09BE\u09B0"] },
      isFeatured: 1,
      isTrending: 1,
      isRecommended: 1,
      views: 685,
      ratingAvg: 4.9,
      ratingCount: 52
    },
    {
      id: "prod-amoled-smartwatch",
      slug: "aurora-amoled-smartwatch",
      sellerId: "seller-tech-pulse",
      shopName: "\u099F\u09C7\u0995\u09AA\u09BE\u09B2\u09B8 \u0997\u09CD\u09AF\u09BE\u099C\u09C7\u099F",
      name: "\u0985\u09B0\u09CB\u09B0\u09BE \u0985\u09CD\u09AF\u09BE\u09AE\u09CB\u09B2\u09C7\u09A1 \u09B8\u09CD\u09AE\u09BE\u09B0\u09CD\u099F\u0993\u09AF\u09BC\u09BE\u099A \u0993 \u0995\u09B2\u09BF\u0982 \u09B8\u09BE\u09AA\u09CB\u09B0\u09CD\u099F",
      description: "\u09E7.\u09EF\u09EC \u0987\u099E\u09CD\u099A\u09BF \u0995\u09BE\u09B0\u09CD\u09AD\u09A1 \u0985\u09CD\u09AF\u09BE\u09AE\u09CB\u09B2\u09C7\u09A1 \u09A1\u09BF\u09B8\u09AA\u09CD\u09B2\u09C7, \u09AC\u09CD\u09B2\u09C1\u099F\u09C1\u09A5 \u0995\u09B2\u09BF\u0982, \u09B9\u09BE\u09B0\u09CD\u099F \u09B0\u09C7\u099F \u0993 SpO2 \u09AE\u09A8\u09BF\u099F\u09B0 \u098F\u09AC\u0982 \u0993\u09AF\u09BC\u09BE\u099F\u09BE\u09B0-\u09B0\u09C7\u099C\u09BF\u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u09A8\u09CD\u099F \u09A1\u09BF\u099C\u09BE\u0987\u09A8\u0964 \u09E7 \u09AC\u099B\u09B0\u09C7\u09B0 \u0985\u09AB\u09BF\u09B8\u09BF\u09AF\u09BC\u09BE\u09B2 \u0993\u09AF\u09BC\u09BE\u09B0\u09C7\u09A8\u09CD\u099F\u09BF \u09B8\u09B9\u0964",
      categoryId: "cat-electronics",
      subcategory: "Smart Watches",
      previousPrice: 3800,
      currentPrice: 2890,
      stock: 22,
      images: ["/src/assets/images/banner_seller_ads_1795274485740.jpg", "/src/assets/images/cat_electronics_tech_1795274484317.jpg"],
      variations: { colors: ["\u09AE\u09BF\u09A1\u09A8\u09BE\u0987\u099F \u09AC\u09CD\u09B2\u09CD\u09AF\u09BE\u0995", "\u0997\u09CB\u09B2\u09CD\u09A1\u09C7\u09A8"] },
      isFeatured: 1,
      isTrending: 1,
      isRecommended: 0,
      views: 540,
      ratingAvg: 4.8,
      ratingCount: 41
    },
    {
      id: "prod-ceramic-table-lamp",
      slug: "scandinavian-ceramic-lamp",
      sellerId: "seller-pure-living",
      shopName: "\u09AA\u09BF\u0993\u09B0 \u09B2\u09BF\u09AD\u09BF\u0982 \u09B8\u09CD\u099F\u09CB\u09B0",
      name: "\u09B8\u09CD\u0995\u09CD\u09AF\u09BE\u09A8\u09CD\u09A1\u09BF\u09A8\u09C7\u09AD\u09BF\u09AF\u09BC\u09BE\u09A8 \u09B8\u09BF\u09B0\u09BE\u09AE\u09BF\u0995 \u099F\u09C7\u09AC\u09BF\u09B2 \u09B2\u09CD\u09AF\u09BE\u09AE\u09CD\u09AA \u0993 \u09B9\u09CB\u09AE \u09A1\u09C7\u0995\u09CB\u09B0",
      description: "\u09B9\u09BE\u09A4\u09C7 \u09A4\u09C8\u09B0\u09BF \u09AE\u09CD\u09AF\u09BE\u099F \u09B8\u09BF\u09B0\u09BE\u09AE\u09BF\u0995 \u09AC\u09C7\u09B8 \u0993 \u09B2\u09BF\u09A8\u09C7\u09A8 \u09B6\u09C7\u09A1 \u09B2\u09CD\u09AF\u09BE\u09AE\u09CD\u09AA\u0964 \u09AC\u09C7\u09A1\u09B0\u09C1\u09AE \u09AC\u09BE \u09A1\u09CD\u09B0\u09AF\u09BC\u09BF\u0982\u09B0\u09C1\u09AE\u09C7\u09B0 \u09AA\u09B0\u09BF\u09AC\u09C7\u09B6\u0995\u09C7 \u0986\u09B0\u0993 \u0989\u09B7\u09CD\u09A3 \u0993 \u09A8\u09BE\u09A8\u09CD\u09A6\u09A8\u09BF\u0995 \u0995\u09B0\u09C7 \u09A4\u09CB\u09B2\u09C7\u0964 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u09A8\u09CD\u09A1\u09BE\u09B0\u09CD\u09A1 E27 \u09AC\u09BE\u09B2\u09CD\u09AC \u09B8\u09BE\u09AA\u09CB\u09B0\u09CD\u099F\u09C7\u09A1\u0964",
      categoryId: "cat-home",
      subcategory: "Lighting",
      previousPrice: 3200,
      currentPrice: 2490,
      stock: 14,
      images: ["/src/assets/images/cat_home_living_1795274486801.jpg"],
      variations: { colors: ["\u0995\u09CD\u09B0\u09BF\u09AE \u09B9\u09CB\u09AF\u09BC\u09BE\u0987\u099F", "\u09A8\u09CD\u09AF\u09BE\u099A\u09BE\u09B0\u09BE\u09B2 \u0993\u0995"] },
      isFeatured: 0,
      isTrending: 1,
      isRecommended: 1,
      views: 275,
      ratingAvg: 4.9,
      ratingCount: 16
    },
    {
      id: "prod-botanical-serum",
      slug: "radiance-botanical-glow-serum",
      sellerId: "seller-pure-living",
      shopName: "\u09AA\u09BF\u0993\u09B0 \u09B2\u09BF\u09AD\u09BF\u0982 \u09B8\u09CD\u099F\u09CB\u09B0",
      name: "\u09B0\u09C7\u09A1\u09BF\u09AF\u09BC\u09C7\u09A8\u09CD\u09B8 \u09AC\u09CB\u099F\u09BE\u09A8\u09BF\u0995\u09CD\u09AF\u09BE\u09B2 \u0997\u09CD\u09B2\u09CB \u09B8\u09BF\u09B0\u09BE\u09AE \u0993 \u099C\u09C7\u09A1 \u09B0\u09CB\u09B2\u09BE\u09B0 \u09B8\u09C7\u099F",
      description: "\u09AD\u09BF\u099F\u09BE\u09AE\u09BF\u09A8-\u09B8\u09BF, \u09B9\u09BE\u09AF\u09BC\u09BE\u09B2\u09C1\u09B0\u09CB\u09A8\u09BF\u0995 \u0985\u09CD\u09AF\u09BE\u09B8\u09BF\u09A1 \u098F\u09AC\u0982 \u09AA\u09CD\u09B0\u09BE\u0995\u09C3\u09A4\u09BF\u0995 \u0989\u09A6\u09CD\u09AD\u09BF\u09A6 \u09A8\u09BF\u09B0\u09CD\u09AF\u09BE\u09B8 \u09B8\u09AE\u09C3\u09A6\u09CD\u09A7 \u09B8\u09CD\u0995\u09BF\u09A8\u0995\u09C7\u09AF\u09BC\u09BE\u09B0 \u09B8\u09C7\u099F\u0964 \u09A4\u09CD\u09AC\u0995\u09C7\u09B0 \u0989\u099C\u09CD\u099C\u09CD\u09AC\u09B2\u09A4\u09BE \u09AC\u09C3\u09A6\u09CD\u09A7\u09BF \u0995\u09B0\u09C7 \u098F\u09AC\u0982 \u0986\u09B0\u09CD\u09A6\u09CD\u09B0\u09A4\u09BE \u09A7\u09B0\u09C7 \u09B0\u09BE\u0996\u09C7\u0964 \u09B8\u09AC \u09A7\u09B0\u09A8\u09C7\u09B0 \u09A4\u09CD\u09AC\u0995\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6\u0964",
      categoryId: "cat-beauty",
      subcategory: "Skincare",
      previousPrice: 1950,
      currentPrice: 1450,
      stock: 36,
      images: ["/src/assets/images/cat_beauty_skincare_1795274483955.jpg"],
      variations: { sizes: ["\u09E9\u09E6 \u09AE\u09BF\u09B2\u09BF \u09B8\u09BF\u09B0\u09BE\u09AE + \u09B0\u09CB\u09B2\u09BE\u09B0", "\u09B6\u09C1\u09A7\u09C1 \u09E9\u09E6 \u09AE\u09BF\u09B2\u09BF"] },
      isFeatured: 1,
      isTrending: 1,
      isRecommended: 1,
      views: 490,
      ratingAvg: 4.8,
      ratingCount: 29
    },
    {
      id: "prod-pro-running-shoes",
      slug: "velocity-pro-running-sneakers",
      sellerId: "seller-dhaka-craft",
      shopName: "\u09A2\u09BE\u0995\u09BE \u0995\u09CD\u09B0\u09CD\u09AF\u09BE\u09AB\u099F \u0993 \u09AB\u09CD\u09AF\u09BE\u09B6\u09A8",
      name: "\u09AD\u09C7\u09B2\u09CB\u09B8\u09BF\u099F\u09BF \u09AA\u09CD\u09B0\u09CB \u09B0\u09BE\u09A8\u09BF\u0982 \u09B8\u09CD\u09A8\u09BF\u0995\u09BE\u09B0\u09CD\u09B8 \u0993 \u09B8\u09CD\u09AA\u09CB\u09B0\u09CD\u099F\u09B8 \u099C\u09C1\u09A4\u09BE",
      description: "\u0986\u09B2\u09CD\u099F\u09CD\u09B0\u09BE-\u09B2\u09BE\u0987\u099F \u0995\u09C1\u09B6\u09A8\u09A1 \u09B8\u09CB\u09B2 \u098F\u09AC\u0982 \u09AC\u09CD\u09B0\u09C7\u09A5\u09C7\u09AC\u09B2 \u09AE\u09C7\u09B6 \u0986\u09AA\u09BE\u09B0 \u09A6\u09BF\u09AF\u09BC\u09C7 \u09A4\u09C8\u09B0\u09BF \u09B0\u09BE\u09A8\u09BF\u0982 \u0993 \u099C\u09BF\u09AE \u099C\u09C1\u09A4\u09BE\u0964 \u09A6\u09CC\u09A1\u09BC\u09BE\u09A8\u09CB, \u09B9\u09BE\u0981\u099F\u09BE \u098F\u09AC\u0982 \u09A6\u09C8\u09A8\u09A8\u09CD\u09A6\u09BF\u09A8 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u0985\u09B8\u09BE\u09A7\u09BE\u09B0\u09A3 \u0997\u09CD\u09B0\u09BF\u09AA \u0993 \u0986\u09B0\u09BE\u09AE\u0964",
      categoryId: "cat-sports",
      subcategory: "Sports Shoes",
      previousPrice: 3400,
      currentPrice: 2590,
      stock: 19,
      images: ["/src/assets/images/cat_sports_outdoor_1795274483907.jpg"],
      variations: { sizes: ["40", "41", "42", "43", "44"], colors: ["\u0985\u09B0\u09C7\u099E\u09CD\u099C \u09AC\u09CD\u09B2\u09CD\u09AF\u09BE\u0995"] },
      isFeatured: 0,
      isTrending: 1,
      isRecommended: 1,
      views: 360,
      ratingAvg: 4.7,
      ratingCount: 23
    },
    {
      id: "prod-artisan-notebook-pen",
      slug: "executive-notebook-fountain-pen-set",
      sellerId: "seller-pure-living",
      shopName: "\u09AA\u09BF\u0993\u09B0 \u09B2\u09BF\u09AD\u09BF\u0982 \u09B8\u09CD\u099F\u09CB\u09B0",
      name: "\u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u099F\u09BF\u09AD \u09B9\u09BE\u09B0\u09CD\u09A1\u0995\u09AD\u09BE\u09B0 \u09A8\u09CB\u099F\u09AC\u09C1\u0995 \u0993 \u09AA\u09BF\u09A4\u09B2\u09C7\u09B0 \u09AB\u09BE\u0989\u09A8\u09CD\u099F\u09C7\u09A8 \u09AA\u09C7\u09A8 \u09B8\u09C7\u099F",
      description: "\u09E7\u09E8\u09E6 \u099C\u09BF\u098F\u09B8\u098F\u09AE \u09AA\u09CD\u09B0\u09BF\u09AE\u09BF\u09AF\u09BC\u09BE\u09AE \u0995\u09CD\u09B0\u09BE\u09AB\u099F \u09AA\u09C7\u09AA\u09BE\u09B0 \u09A8\u09CB\u099F\u09AC\u09C1\u0995 \u0993 \u0995\u09CD\u09B2\u09BE\u09B8\u09BF\u0995 \u09AC\u09CD\u09B0\u09BE\u09B8 \u09AB\u09BE\u0989\u09A8\u09CD\u099F\u09C7\u09A8 \u09AA\u09C7\u09A8\u0964 \u09B2\u09C7\u0996\u09BE\u09B2\u09C7\u0996\u09BF, \u099C\u09BE\u09B0\u09CD\u09A8\u09BE\u09B2\u09BF\u0982 \u09AC\u09BE \u09AA\u09CD\u09B0\u09BF\u09AF\u09BC\u099C\u09A8\u0995\u09C7 \u0989\u09AA\u09B9\u09BE\u09B0 \u09A6\u09C7\u0993\u09AF\u09BC\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u09A6\u09BE\u09B0\u09C1\u09A3 \u098F\u0995\u099F\u09BF \u09AA\u09CD\u09AF\u09BE\u0995\u09C7\u099C\u0964",
      categoryId: "cat-books",
      subcategory: "Notebooks",
      previousPrice: 1250,
      currentPrice: 950,
      stock: 50,
      images: ["/src/assets/images/cat_books_stationery_1795274483743.jpg"],
      variations: { colors: ["\u0995\u09CD\u09B0\u09BE\u09AB\u099F \u09AC\u09CD\u09B0\u09BE\u0989\u09A8", "\u09AB\u09B0\u09C7\u09B8\u09CD\u099F \u0997\u09CD\u09B0\u09BF\u09A8"] },
      isFeatured: 0,
      isTrending: 0,
      isRecommended: 1,
      views: 195,
      ratingAvg: 4.8,
      ratingCount: 14
    },
    {
      id: "prod-sundarban-honey-tea",
      slug: "organic-wildflower-honey-tea-combo",
      sellerId: "seller-pure-living",
      shopName: "\u09AA\u09BF\u0993\u09B0 \u09B2\u09BF\u09AD\u09BF\u0982 \u09B8\u09CD\u099F\u09CB\u09B0",
      name: "\u0996\u09BE\u0981\u099F\u09BF \u09B8\u09C1\u09A8\u09CD\u09A6\u09B0\u09AC\u09A8\u09C7\u09B0 \u09AE\u09A7\u09C1 \u0993 \u09AA\u09CD\u09B0\u09BF\u09AE\u09BF\u09AF\u09BC\u09BE\u09AE \u0997\u09CD\u09B0\u09BF\u09A8 \u099F\u09BF \u0995\u09AE\u09CD\u09AC\u09CB",
      description: "\u09E7\u09E6\u09E6% \u09AA\u09CD\u09B0\u09BE\u0995\u09C3\u09A4\u09BF\u0995 \u0993 \u09B2\u09CD\u09AF\u09BE\u09AC-\u099F\u09C7\u09B8\u09CD\u099F\u09C7\u09A1 \u09AC\u09C1\u09A8\u09CB \u09AB\u09C1\u09B2\u09C7\u09B0 \u09AE\u09A7\u09C1 (\u09EB\u09E6\u09E6 \u0997\u09CD\u09B0\u09BE\u09AE) \u098F\u09AC\u0982 \u09B8\u09BF\u09B2\u09C7\u099F\u09C7\u09B0 \u09AC\u09BE\u0997\u09BE\u09A8 \u09A5\u09C7\u0995\u09C7 \u09B8\u0982\u0997\u09C3\u09B9\u09C0\u09A4 \u09AA\u09CD\u09B0\u09BF\u09AE\u09BF\u09AF\u09BC\u09BE\u09AE \u099A\u09BE \u09AA\u09BE\u09A4\u09BE\u0964 \u09AA\u09B0\u09BF\u09AC\u09BE\u09B0\u09C7\u09B0 \u09AA\u09CD\u09B0\u09A4\u09BF\u09A6\u09BF\u09A8\u09C7\u09B0 \u09B8\u09C1\u09B8\u09CD\u09A5\u09A4\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF\u0964",
      categoryId: "cat-food",
      subcategory: "Grocery",
      previousPrice: 1400,
      currentPrice: 1090,
      stock: 60,
      images: ["/src/assets/images/cat_food_grocery_1795274484128.jpg"],
      variations: { sizes: ["\u09EB\u09E6\u09E6 \u0997\u09CD\u09B0\u09BE\u09AE \u0995\u09AE\u09CD\u09AC\u09CB", "\u09E7 \u0995\u09C7\u099C\u09BF \u09AB\u09CD\u09AF\u09BE\u09AE\u09BF\u09B2\u09BF \u09AA\u09CD\u09AF\u09BE\u0995"] },
      isFeatured: 1,
      isTrending: 0,
      isRecommended: 1,
      views: 380,
      ratingAvg: 4.9,
      ratingCount: 47
    },
    {
      id: "prod-wooden-baby-gift-box",
      slug: "eco-wooden-toys-organic-baby-set",
      sellerId: "seller-pure-living",
      shopName: "\u09AA\u09BF\u0993\u09B0 \u09B2\u09BF\u09AD\u09BF\u0982 \u09B8\u09CD\u099F\u09CB\u09B0",
      name: "\u09B6\u09BF\u09B6\u09C1\u09A6\u09C7\u09B0 \u0985\u09B0\u09CD\u0997\u09BE\u09A8\u09BF\u0995 \u09A8\u09BF\u099F\u0993\u09AF\u09BC\u09CD\u09AF\u09BE\u09B0 \u0993 \u0995\u09BE\u09A0\u09C7\u09B0 \u0996\u09C7\u09B2\u09A8\u09BE \u0997\u09BF\u09AB\u099F \u09AC\u0995\u09CD\u09B8",
      description: "\u09A8\u09AC\u099C\u09BE\u09A4\u0995 \u0993 \u09B6\u09BF\u09B6\u09C1\u09A6\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u09A8\u09B0\u09AE \u0985\u09B0\u09CD\u0997\u09BE\u09A8\u09BF\u0995 \u0995\u099F\u09A8 \u09B8\u09CB\u09AF\u09BC\u09C7\u099F\u09BE\u09B0 \u098F\u09AC\u0982 \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6 \u0995\u09C7\u09AE\u09BF\u0995\u09CD\u09AF\u09BE\u09B2\u09AE\u09C1\u0995\u09CD\u09A4 \u09AA\u09CD\u09B0\u09BE\u0995\u09C3\u09A4\u09BF\u0995 \u0995\u09BE\u09A0\u09C7\u09B0 \u09AC\u09CD\u09B2\u0995 \u0996\u09C7\u09B2\u09A8\u09BE\u0964 \u0986\u0995\u09B0\u09CD\u09B7\u09A3\u09C0\u09AF\u09BC \u09B0\u09BF\u09AC\u09A8 \u0997\u09BF\u09AB\u099F \u09AC\u0995\u09CD\u09B8\u09C7 \u09AA\u09B0\u09BF\u09AC\u09C7\u09B6\u09BF\u09A4\u0964",
      categoryId: "cat-baby",
      subcategory: "Toys",
      previousPrice: 2100,
      currentPrice: 1650,
      stock: 20,
      images: ["/src/assets/images/cat_baby_gifts_1795274484045.jpg"],
      variations: { sizes: ["\u09EC-\u09E7\u09E8 \u09AE\u09BE\u09B8", "\u09E7-\u09E8 \u09AC\u099B\u09B0"] },
      isFeatured: 0,
      isTrending: 1,
      isRecommended: 0,
      views: 240,
      ratingAvg: 4.9,
      ratingCount: 18
    },
    {
      id: "prod-matte-helmet-inflator",
      slug: "pro-matte-motorcycle-helmet-air-pump",
      sellerId: "seller-tech-pulse",
      shopName: "\u099F\u09C7\u0995\u09AA\u09BE\u09B2\u09B8 \u0997\u09CD\u09AF\u09BE\u099C\u09C7\u099F",
      name: "DOT \u09B8\u09BE\u09B0\u09CD\u099F\u09BF\u09AB\u09BE\u09AF\u09BC\u09C7\u09A1 \u09AE\u09CD\u09AF\u09BE\u099F \u09B9\u09C7\u09B2\u09AE\u09C7\u099F \u0993 \u09AA\u09CB\u09B0\u09CD\u099F\u09C7\u09AC\u09B2 \u099F\u09BE\u09AF\u09BC\u09BE\u09B0 \u09AA\u09BE\u09AE\u09CD\u09AA",
      description: "\u09AE\u099C\u09AC\u09C1\u09A4 \u098F\u09AC\u09BF\u098F\u09B8 \u09B6\u09C7\u09B2 \u09AB\u09C1\u09B2-\u09AB\u09C7\u09B8 \u09AE\u09CD\u09AF\u09BE\u099F \u09AC\u09CD\u09B2\u09CD\u09AF\u09BE\u0995 \u09AE\u09CB\u099F\u09B0\u09B8\u09BE\u0987\u0995\u09C7\u09B2 \u09B9\u09C7\u09B2\u09AE\u09C7\u099F \u0993 \u09A1\u09BF\u099C\u09BF\u099F\u09BE\u09B2 \u09AA\u09CB\u09B0\u09CD\u099F\u09C7\u09AC\u09B2 \u098F\u09AF\u09BC\u09BE\u09B0 \u0987\u09A8\u09AB\u09CD\u09B2\u09C7\u099F\u09B0\u0964 \u09AC\u09BE\u0987\u0995\u09BE\u09B0\u09A6\u09C7\u09B0 \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6 \u09AD\u09CD\u09B0\u09AE\u09A3\u09C7\u09B0 \u09A8\u09BF\u09B0\u09CD\u09AD\u09B0\u09AF\u09CB\u0997\u09CD\u09AF \u09B8\u0999\u09CD\u0997\u09C0\u0964",
      categoryId: "cat-automotive",
      subcategory: "Motorcycle Accessories",
      previousPrice: 5200,
      currentPrice: 4190,
      stock: 11,
      images: ["/src/assets/images/cat_automotive_gear_1795274484811.jpg"],
      variations: { sizes: ["M", "L", "XL"], colors: ["\u09AE\u09CD\u09AF\u09BE\u099F \u09AC\u09CD\u09B2\u09CD\u09AF\u09BE\u0995"] },
      isFeatured: 0,
      isTrending: 1,
      isRecommended: 0,
      views: 315,
      ratingAvg: 4.8,
      ratingCount: 21
    }
  ];
  const defaultSettings = {
    heroBanners: [
      {
        id: "banner-1",
        title: "\u09AC\u09BE\u0982\u09B2\u09BE\u09A6\u09C7\u09B6\u09C7\u09B0 \u09A8\u09BF\u09B0\u09CD\u09AD\u09B0\u09AF\u09CB\u0997\u09CD\u09AF \u09AE\u09BE\u09B2\u09CD\u099F\u09BF-\u09AD\u09C7\u09A8\u09CD\u09A1\u09B0 \u09AE\u09BE\u09B0\u09CD\u0995\u09C7\u099F\u09AA\u09CD\u09B2\u09C7\u09B8",
        subtitle: "\u09AF\u09BE\u099A\u09BE\u0987\u0995\u09C3\u09A4 \u09B8\u09C7\u09B2\u09BE\u09B0\u09A6\u09C7\u09B0 \u09B8\u09C7\u09B0\u09BE \u09AE\u09BE\u09A8\u09C7\u09B0 \u09AB\u09CD\u09AF\u09BE\u09B6\u09A8, \u0997\u09CD\u09AF\u09BE\u099C\u09C7\u099F, \u09B9\u09CB\u09AE \u09A1\u09C7\u0995\u09CB\u09B0 \u098F\u09AC\u0982 \u09A8\u09BF\u09A4\u09CD\u09AF\u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u099C\u09A8\u09C0\u09AF\u09BC \u09AA\u09A3\u09CD\u09AF \u0995\u09BF\u09A8\u09C1\u09A8 \u09B8\u09BE\u09B6\u09CD\u09B0\u09AF\u09BC\u09C0 \u09AE\u09C2\u09B2\u09CD\u09AF\u09C7 \u0993 \u0995\u09CD\u09AF\u09BE\u09B6 \u0985\u09A8 \u09A1\u09C7\u09B2\u09BF\u09AD\u09BE\u09B0\u09BF\u09A4\u09C7\u0964",
        ctaLabel: "\u09B6\u09AA\u09BF\u0982 \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09C1\u09A8",
        ctaTarget: "products",
        imageUrl: "/src/assets/images/banner_seller_ads_1795274485740.jpg",
        isActive: true
      }
    ],
    productAdsSection: {
      enabled: true,
      heading: "\u09B8\u09CD\u09AA\u09A8\u09CD\u09B8\u09B0\u09A1 \u0993 \u09AC\u09BF\u09B6\u09C7\u09B7 \u09AA\u09CD\u09B0\u099A\u09BE\u09B0\u09AE\u09C2\u09B2\u0995 \u09AA\u09A3\u09CD\u09AF",
      subheading: "\u09B9\u09CB\u09AE\u09AA\u09C7\u099C\u09C7\u09B0 \u09B6\u09C0\u09B0\u09CD\u09B7\u09C7 \u09AA\u09CD\u09B0\u09A6\u09B0\u09CD\u09B6\u09BF\u09A4 \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09BF\u09A4 \u09B8\u09C7\u09B2\u09BE\u09B0\u09A6\u09C7\u09B0 \u09AA\u09A3\u09CD\u09AF\u09B8\u09AE\u09C2\u09B9"
    },
    sellerProductAdsPage: {
      bannerTitle: "\u0986\u09AA\u09A8\u09BE\u09B0 \u09AA\u09A3\u09CD\u09AF\u0995\u09C7 \u0986\u09B0\u0993 \u09AC\u09C7\u09B6\u09BF \u0995\u09CD\u09B0\u09C7\u09A4\u09BE\u09B0 \u09B8\u09BE\u09AE\u09A8\u09C7 \u09A4\u09C1\u09B2\u09C7 \u09A7\u09B0\u09C1\u09A8!",
      bannerSubtitle: "Orvexa-\u09A4\u09C7 \u09B8\u09CD\u09AA\u09A8\u09CD\u09B8\u09B0\u09A1 \u09AC\u09BF\u099C\u09CD\u099E\u09BE\u09AA\u09A8\u09C7\u09B0 \u09AE\u09BE\u09A7\u09CD\u09AF\u09AE\u09C7 \u0986\u09AA\u09A8\u09BE\u09B0 \u09B6\u09AA\u09C7\u09B0 \u09AC\u09BF\u0995\u09CD\u09B0\u09BF \u0993 \u09AA\u09B0\u09BF\u099A\u09BF\u09A4\u09BF \u09AC\u09B9\u09C1\u0997\u09C1\u09A3 \u09AC\u09BE\u09A1\u09BC\u09BF\u09AF\u09BC\u09C7 \u09A4\u09C1\u09B2\u09C1\u09A8\u0964",
      bannerImageUrl: "/src/assets/images/banner_seller_ads_1795274485740.jpg",
      description: "\u0986\u09AA\u09A8\u09BE\u09B0 \u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u09AC\u09BF\u099C\u09CD\u099E\u09BE\u09AA\u09A8 \u09B9\u09CB\u09AE\u09AA\u09C7\u099C\u09C7\u09B0 \u09AC\u09BF\u09B6\u09C7\u09B7 \u09AA\u09CD\u09B0\u099A\u09BE\u09B0\u09AE\u09C2\u09B2\u0995 \u0985\u0982\u09B6\u09C7 \u09AA\u09CD\u09B0\u0995\u09BE\u09B6 \u0995\u09B0\u09BE\u09B0 \u09AE\u09BE\u09A7\u09CD\u09AF\u09AE\u09C7 \u0986\u09B0\u0993 \u09AC\u09C7\u09B6\u09BF \u0995\u09CD\u09B0\u09C7\u09A4\u09BE\u09B0 \u09A8\u099C\u09B0\u09C7 \u0986\u09B8\u09BE\u09B0 \u09B8\u09C1\u09AF\u09CB\u0997 \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09C1\u09A8\u0964 \u09AC\u09BF\u099C\u09CD\u099E\u09BE\u09AA\u09BF\u09A4 \u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u09B9\u09CB\u09AE\u09AA\u09C7\u099C\u09C7\u09B0 \u0989\u09AA\u09B0\u09C7\u09B0 \u0985\u0982\u09B6\u09C7 \u0986\u0995\u09B0\u09CD\u09B7\u09A3\u09C0\u09AF\u09BC\u09AD\u09BE\u09AC\u09C7 \u09AA\u09CD\u09B0\u09A6\u09B0\u09CD\u09B6\u09BF\u09A4 \u09B9\u09AC\u09C7 \u098F\u09AC\u0982 \u0995\u09CD\u09B0\u09C7\u09A4\u09BE\u09B0\u09BE View \u09AC\u09BE\u099F\u09A8\u09C7 \u0995\u09CD\u09B2\u09BF\u0995 \u0995\u09B0\u09C7 \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF \u0986\u09AA\u09A8\u09BE\u09B0 \u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u09AC\u09BF\u09B8\u09CD\u09A4\u09BE\u09B0\u09BF\u09A4 \u09AA\u09C7\u099C\u09C7 \u09AF\u09C7\u09A4\u09C7 \u09AA\u09BE\u09B0\u09AC\u09C7\u09A8\u0964\n\n\u0986\u09AA\u09A8\u09BE\u09B0 \u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u09AA\u09CD\u09B0\u099A\u09BE\u09B0 \u09AC\u09C3\u09A6\u09CD\u09A7\u09BF \u0995\u09B0\u09C1\u09A8, \u0986\u09B0\u0993 \u09AC\u09C7\u09B6\u09BF \u09AE\u09BE\u09A8\u09C1\u09B7\u09C7\u09B0 \u0995\u09BE\u099B\u09C7 \u09AA\u09CC\u0981\u099B\u09BE\u09A8 \u098F\u09AC\u0982 \u09AC\u09BF\u0995\u09CD\u09B0\u09BF\u09B0 \u09B8\u09AE\u09CD\u09AD\u09BE\u09AC\u09A8\u09BE \u09AC\u09BE\u09A1\u09BC\u09BF\u09AF\u09BC\u09C7 \u09A4\u09C1\u09B2\u09C1\u09A8\u0964",
      benefits: [
        "\u09B9\u09CB\u09AE\u09AA\u09C7\u099C\u09C7\u09B0 \u098F\u0995\u09A6\u09AE \u0989\u09AA\u09B0\u09C7\u09B0 \u09AA\u09CD\u09B0\u09BE\u0987\u09AE \u09B8\u09C7\u0995\u09B6\u09A8\u09C7 \u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u09AC\u09BF\u09B6\u09C7\u09B7 \u09AA\u09CD\u09B0\u09A6\u09B0\u09CD\u09B6\u09A8\u09C0",
        "\u09B8\u09B0\u09BE\u09B8\u09B0\u09BF View \u09AC\u09BE\u099F\u09A8\u09C7\u09B0 \u09AE\u09BE\u09A7\u09CD\u09AF\u09AE\u09C7 \u0995\u09CD\u09B0\u09C7\u09A4\u09BE\u09A6\u09C7\u09B0 \u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u09AC\u09BF\u09B8\u09CD\u09A4\u09BE\u09B0\u09BF\u09A4 \u09AA\u09C7\u099C\u09C7 \u09AA\u09CD\u09B0\u09AC\u09C7\u09B6",
        "\u09B8\u09C7\u09B2\u09BE\u09B0 \u0987\u09A8\u09AC\u0995\u09CD\u09B8\u09C7 \u0995\u09CD\u09B0\u09C7\u09A4\u09BE\u09A6\u09C7\u09B0 \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF \u099C\u09BF\u099C\u09CD\u099E\u09BE\u09B8\u09BE \u0993 \u09A6\u09CD\u09B0\u09C1\u09A4 \u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09AC\u09C3\u09A6\u09CD\u09A7\u09BF\u09B0 \u09B8\u09C1\u09AF\u09CB\u0997",
        "\u09A8\u09BF\u09B0\u09CD\u09A7\u09BE\u09B0\u09BF\u09A4 \u09B8\u09AE\u09AF\u09BC\u09B8\u09C0\u09AE\u09BE \u0985\u09A8\u09C1\u09AF\u09BE\u09AF\u09BC\u09C0 Admin \u09A6\u09CD\u09AC\u09BE\u09B0\u09BE \u09AA\u09B0\u09BF\u099A\u09BE\u09B2\u09BF\u09A4 \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6 \u0993 \u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u09AA\u09CD\u09B0\u099A\u09BE\u09B0\u09A3\u09BE"
      ],
      howItWorks: [
        "\u0986\u09AA\u09A8\u09BE\u09B0 \u09B8\u09C7\u09B2\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09C7 \u0986\u0997\u09C7 \u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u09AA\u09CD\u09B0\u0995\u09BE\u09B6 \u0995\u09B0\u09C1\u09A8 \u098F\u09AC\u0982 \u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u09B2\u09BF\u0982\u0995 \u0995\u09AA\u09BF \u0995\u09B0\u09C1\u09A8\u0964",
        "\u09A8\u09BF\u099A\u09C7\u09B0 WhatsApp \u09A8\u09AE\u09CD\u09AC\u09B0\u09C7 Admin-\u098F\u09B0 \u09B8\u09BE\u09A5\u09C7 \u09AF\u09CB\u0997\u09BE\u09AF\u09CB\u0997 \u0995\u09B0\u09C7 \u0986\u09AA\u09A8\u09BE\u09B0 \u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u09B2\u09BF\u0982\u0995 \u0993 \u09B6\u09AA\u09C7\u09B0 \u09A8\u09BE\u09AE \u09AA\u09BE\u09A0\u09BE\u09A8\u0964",
        "\u09AC\u09BF\u099C\u09CD\u099E\u09BE\u09AA\u09A8\u09C7\u09B0 \u09B8\u09AE\u09AF\u09BC\u0995\u09BE\u09B2 \u0993 \u09AC\u09BF\u09AC\u09B0\u09A3 \u09A8\u09BF\u09B6\u09CD\u099A\u09BF\u09A4 \u09B9\u09B2\u09C7 Admin \u0986\u09AA\u09A8\u09BE\u09B0 \u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u09B9\u09CB\u09AE\u09AA\u09C7\u099C\u09C7\u09B0 Product Ads \u09B8\u09C7\u0995\u09B6\u09A8\u09C7 \u09AF\u09C1\u0995\u09CD\u09A4 \u0995\u09B0\u09C7 \u09A6\u09C7\u09AC\u09C7\u09A8\u0964"
      ],
      contactHeading: "\u0986\u09AA\u09A8\u09BE\u09B0 \u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u09AC\u09BF\u099C\u09CD\u099E\u09BE\u09AA\u09A8 \u09AA\u09CD\u09B0\u0995\u09BE\u09B6 \u0995\u09B0\u09A4\u09C7 Admin-\u098F\u09B0 \u09B8\u09BE\u09A5\u09C7 \u09AF\u09CB\u0997\u09BE\u09AF\u09CB\u0997 \u0995\u09B0\u09C1\u09A8",
      whatsappNumbers: ["01622922252", "01329205761"],
      ctaText: "WhatsApp-\u098F \u09AE\u09C7\u09B8\u09C7\u099C \u09A6\u09BF\u09A8"
    },
    paymentOptions: {
      cashOnDelivery: true,
      bkashEnabled: false,
      nagadEnabled: false,
      deliveryFee: 70,
      dhakaDeliveryFee: 70,
      outsideDhakaDeliveryFee: 120,
      freeDeliveryThreshold: 0
    },
    contactInfo: {
      email: "support@orvexa.com",
      phone: "01622922252",
      whatsapp: "01622922252",
      address: "\u09A2\u09BE\u0995\u09BE, \u09AC\u09BE\u0982\u09B2\u09BE\u09A6\u09C7\u09B6"
    },
    footerSettings: {
      aboutText: "Orvexa \u09B9\u09B2\u09CB \u09AC\u09BE\u0982\u09B2\u09BE\u09A6\u09C7\u09B6\u09C7\u09B0 \u0986\u09A7\u09C1\u09A8\u09BF\u0995 \u09AE\u09BE\u09B2\u09CD\u099F\u09BF-\u09AD\u09C7\u09A8\u09CD\u09A1\u09B0 \u0987-\u0995\u09AE\u09BE\u09B0\u09CD\u09B8 \u09AE\u09BE\u09B0\u09CD\u0995\u09C7\u099F\u09AA\u09CD\u09B2\u09C7\u09B8, \u09AF\u09C7\u0996\u09BE\u09A8\u09C7 \u0995\u09CD\u09B0\u09C7\u09A4\u09BE \u0993 \u09AC\u09BF\u0995\u09CD\u09B0\u09C7\u09A4\u09BE\u09B0\u09BE \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF \u09AF\u09C1\u0995\u09CD\u09A4 \u09B9\u09AF\u09BC\u09C7 \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6 \u0993 \u09A6\u09CD\u09B0\u09C1\u09A4 \u0995\u09C7\u09A8\u09BE\u0995\u09BE\u099F\u09BE \u0995\u09B0\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7\u09A8\u0964",
      copyrightText: "\xA9 \u09E8\u09E6\u09E8\u09EC Orvexa. \u09B8\u09B0\u09CD\u09AC\u09B8\u09CD\u09AC\u09A4\u09CD\u09AC \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09BF\u09A4\u0964"
    },
    generalSettings: {
      siteName: "Orvexa",
      announcementText: "\u09B8\u09BE\u09B0\u09BE \u09AC\u09BE\u0982\u09B2\u09BE\u09A6\u09C7\u09B6\u09C7 \u09A6\u09CD\u09B0\u09C1\u09A4 \u09B9\u09CB\u09AE \u09A1\u09C7\u09B2\u09BF\u09AD\u09BE\u09B0\u09BF \u0993 \u0995\u09CD\u09AF\u09BE\u09B6 \u0985\u09A8 \u09A1\u09C7\u09B2\u09BF\u09AD\u09BE\u09B0\u09BF \u09B8\u09C1\u09AC\u09BF\u09A7\u09BE \u0989\u09AA\u09B2\u09AC\u09CD\u09A7\u0964",
      announcementActive: true
    },
    customCode: {
      enabled: true,
      customCss: "",
      customBannerHtml: "",
      headScripts: "",
      customJs: ""
    },
    customPages: [],
    customBlocks: []
  };
  await db.transaction(async (tx) => {
    for (const c of categories) {
      await tx.run(
        `INSERT OR IGNORE INTO categories (id, nameEn, nameBn, slug, imageUrl, subcategories, sortOrder)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        c.id,
        c.nameEn,
        c.nameBn,
        c.slug,
        c.imageUrl,
        JSON.stringify(c.subcategories),
        c.sortOrder
      );
    }
    for (const s of sellers) {
      await tx.run(
        `INSERT OR IGNORE INTO users (id, fullName, username, emailOrPhone, passwordHash, role, shopName, shopDescription, status, createdAt)
         VALUES (?, ?, ?, ?, ?, 'seller', ?, ?, 'active', ?)`,
        s.id,
        s.fullName,
        s.username,
        s.emailOrPhone,
        demoSellerPass,
        s.shopName,
        s.shopDescription,
        now
      );
    }
    for (let idx = 0; idx < products.length; idx++) {
      const p = products[idx];
      await tx.run(
        `INSERT OR IGNORE INTO products (
          id, slug, sellerId, shopName, name, description, categoryId, subcategory,
          previousPrice, currentPrice, stock, images, variations,
          isFeatured, isTrending, isRecommended, isHidden, views, ratingAvg, ratingCount, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        p.id,
        p.slug,
        p.sellerId,
        p.shopName,
        p.name,
        p.description,
        p.categoryId,
        p.subcategory,
        p.previousPrice,
        p.currentPrice,
        p.stock,
        JSON.stringify(p.images),
        JSON.stringify(p.variations),
        p.isFeatured,
        p.isTrending,
        p.isRecommended,
        p.views,
        p.ratingAvg,
        p.ratingCount,
        now - idx * 36e5
      );
    }
    const adProds = [
      ["hpad-1", "prod-emerald-panjabi", "\u09AC\u09BF\u09B6\u09C7\u09B7 \u0989\u09CE\u09B8\u09AC \u0985\u09AB\u09BE\u09B0 \u2014 \u09E8\u09ED% \u099B\u09BE\u09DC", null, 1, now],
      ["hpad-2", "prod-anc-headphones", "\u099F\u09AA \u09B8\u09C7\u09B2\u09BE\u09B0 \u09B8\u09CD\u09AA\u099F\u09B2\u09BE\u0987\u099F", null, 2, now],
      ["hpad-3", "prod-amoled-smartwatch", "\u09B8\u09C0\u09AE\u09BF\u09A4 \u09B8\u09AE\u09DF\u09C7\u09B0 \u09AA\u09CD\u09B0\u099A\u09BE\u09B0\u09A3\u09BE", null, 3, now],
      ["hpad-4", "prod-botanical-serum", "\u099C\u09A8\u09AA\u09CD\u09B0\u09BF\u09DF \u09B8\u09CD\u0995\u09BF\u09A8\u0995\u09C7\u09AF\u09BC\u09BE\u09B0 \u09B8\u09C7\u099F", null, 4, now]
    ];
    for (const row of adProds) {
      await tx.run(
        `INSERT OR IGNORE INTO homepage_product_ads (id, productId, promoText, customImageUrl, sortOrder, isActive, expiresAt, createdAt)
         VALUES (?, ?, ?, ?, ?, 1, NULL, ?)`,
        ...row
      );
    }
    await tx.run(
      `INSERT OR IGNORE INTO advertisements (id, title, placement, adType, imageUrl, targetUrl, htmlCode, jsCode, isActive, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      "ad-home-mid",
      "\u09B8\u09C7\u09B2\u09BE\u09B0 \u09AE\u09C7\u0997\u09BE \u0995\u09CD\u09AF\u09BE\u09AE\u09CD\u09AA\u09C7\u0987\u09A8",
      "homepage_middle",
      "banner",
      "/src/assets/images/banner_seller_ads_1795274485740.jpg",
      "#products",
      null,
      null,
      now
    );
    for (const [key, val] of Object.entries(defaultSettings)) {
      await tx.run(
        `INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)`,
        key,
        JSON.stringify(val)
      );
    }
  });
}

// server/sms.ts
import crypto4 from "crypto";
import dns from "dns/promises";
import net from "net";
function normalizeBdPhone(raw) {
  if (!raw || typeof raw !== "string") return "";
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+880")) {
    digits = `0${digits.slice(4)}`;
  } else if (digits.startsWith("880") && digits.length >= 13) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }
  return digits.trim();
}
function isLikelyPhone(raw) {
  if (!raw || typeof raw !== "string" || raw.includes("@")) return false;
  const cleaned = normalizeBdPhone(raw);
  return /^[0-9]{10,15}$/.test(cleaned);
}
function formatToIntlBdPhone(raw) {
  const norm = normalizeBdPhone(raw);
  if (/^01[0-9]{9}$/.test(norm)) {
    return `88${norm}`;
  }
  return norm;
}
function isPrivateIp(ip) {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }
  if (lower.startsWith("::ffff:")) {
    return isPrivateIp(lower.slice(7));
  }
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
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
async function validateSafeHttpsWebhook(rawUrl) {
  const parsed = new URL(rawUrl.trim());
  if (parsed.protocol !== "https:") {
    throw new Error("\u09A8\u09BF\u09B0\u09BE\u09AA\u09A4\u09CD\u09A4\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u09B6\u09C1\u09A7\u09C1\u09AE\u09BE\u09A4\u09CD\u09B0 HTTPS Webhook URL \u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4\u0964");
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("\u09B2\u09CB\u0995\u09BE\u09B2 \u09AC\u09BE \u09AA\u09CD\u09B0\u09BE\u0987\u09AD\u09C7\u099F \u09B9\u09CB\u09B8\u09CD\u099F \u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4 \u09A8\u09AF\u09BC\u0964");
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error("\u09AA\u09CD\u09B0\u09BE\u0987\u09AD\u09C7\u099F IP \u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4 \u09A8\u09AF\u09BC\u0964");
  }
  try {
    const records = await dns.lookup(host, { all: true });
    for (const r of records) {
      if (isPrivateIp(r.address)) {
        throw new Error("\u09AA\u09CD\u09B0\u09BE\u0987\u09AD\u09C7\u099F \u09A8\u09C7\u099F\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u0995 \u099F\u09BE\u09B0\u09CD\u0997\u09C7\u099F \u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4 \u09A8\u09AF\u09BC\u0964");
      }
    }
  } catch (err) {
    if (err?.message?.includes("\u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4 \u09A8\u09AF\u09BC")) throw err;
  }
  return parsed;
}
async function getSmsGatewayConfig() {
  let dbCfg = {};
  try {
    const row = await db.get(`SELECT value FROM site_settings WHERE key = 'smsGateway' LIMIT 1`);
    if (row?.value) {
      dbCfg = JSON.parse(row.value);
    }
  } catch {
  }
  let siteName = "Orvexa";
  try {
    const genRow = await db.get(`SELECT value FROM site_settings WHERE key = 'generalSettings' LIMIT 1`);
    if (genRow?.value) {
      const gen = JSON.parse(genRow.value);
      if (gen?.siteName && typeof gen.siteName === "string" && gen.siteName.trim()) {
        siteName = gen.siteName.trim();
      }
    }
  } catch {
  }
  const envProvider = (process.env.SMS_PROVIDER || "").trim().toLowerCase();
  const provider = dbCfg.provider && ["built_in", "bulksmsbd", "greenweb", "twilio", "webhook"].includes(dbCfg.provider) ? dbCfg.provider : envProvider && ["built_in", "bulksmsbd", "greenweb", "twilio", "webhook"].includes(envProvider) ? envProvider : "built_in";
  return {
    provider,
    senderName: (dbCfg.senderName || process.env.SMS_SENDER_ID || siteName || "Orvexa").trim(),
    autoOrderSmsEnabled: dbCfg.autoOrderSmsEnabled !== void 0 ? Boolean(dbCfg.autoOrderSmsEnabled) : true,
    apiKey: (dbCfg.apiKey || process.env.SMS_API_KEY || process.env.BULKSMSBD_API_KEY || process.env.GREENWEB_TOKEN || process.env.TWILIO_ACCOUNT_SID || "").trim(),
    apiSecret: (dbCfg.apiSecret || process.env.SMS_API_SECRET || process.env.TWILIO_AUTH_TOKEN || "").trim(),
    webhookUrl: (dbCfg.webhookUrl || process.env.SMS_WEBHOOK_URL || "").trim(),
    fromNumber: (dbCfg.fromNumber || process.env.TWILIO_FROM_NUMBER || "").trim()
  };
}
async function dispatchSms(params) {
  const cfg = await getSmsGatewayConfig();
  const senderName = cfg.senderName || "Orvexa";
  const cleanPhone = normalizeBdPhone(params.recipientPhone) || params.recipientPhone.trim();
  const id = `sms-${crypto4.randomUUID().slice(0, 12)}`;
  const now = Date.now();
  let status = "logged";
  let deliveredViaCarrier = false;
  let errorDetail = null;
  try {
    if (cfg.provider === "bulksmsbd") {
      if (!cfg.apiKey) {
        status = "failed";
        errorDetail = "BulkSMSBD API Key \u09B8\u09C7\u099F \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF\u0964";
      } else {
        const form = new URLSearchParams({
          api_key: cfg.apiKey,
          type: "text",
          number: formatToIntlBdPhone(cleanPhone),
          senderid: senderName,
          message: params.messageBody
        });
        const resp = await fetch("https://bulksmsbd.net/api/smsapi", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
          signal: AbortSignal.timeout(15e3)
        });
        const rawText = await resp.text().catch(() => "");
        let parsed = null;
        try {
          parsed = rawText ? JSON.parse(rawText) : null;
        } catch {
          parsed = null;
        }
        const respCode = parsed?.response_code !== void 0 ? Number(parsed.response_code) : null;
        if (resp.ok && (respCode === 202 || respCode === null && /success|submitted/i.test(rawText))) {
          status = "sent";
          deliveredViaCarrier = true;
        } else {
          status = "failed";
          errorDetail = parsed?.error_message || (respCode ? `BulkSMSBD code ${respCode}` : rawText.slice(0, 180) || `HTTP ${resp.status}`);
        }
      }
    } else if (cfg.provider === "greenweb") {
      if (!cfg.apiKey) {
        status = "failed";
        errorDetail = "GreenWeb API Token \u09B8\u09C7\u099F \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF\u0964";
      } else {
        const form = new URLSearchParams({
          token: cfg.apiKey,
          to: formatToIntlBdPhone(cleanPhone),
          message: params.messageBody
        });
        const resp = await fetch("https://api.greenweb.com.bd/api.php", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
          signal: AbortSignal.timeout(15e3)
        });
        const rawText = (await resp.text().catch(() => "")).trim();
        const isOk = resp.ok && /^ok\b/i.test(rawText) && !/^error\b/i.test(rawText);
        if (isOk) {
          status = "sent";
          deliveredViaCarrier = true;
        } else {
          status = "failed";
          errorDetail = rawText.slice(0, 180) || `HTTP ${resp.status}`;
        }
      }
    } else if (cfg.provider === "twilio") {
      if (!cfg.apiKey || !cfg.apiSecret || !cfg.fromNumber) {
        status = "failed";
        errorDetail = "Twilio SID, Auth Token \u0985\u09A5\u09AC\u09BE From Number \u0985\u09B8\u09AE\u09CD\u09AA\u09C2\u09B0\u09CD\u09A3\u0964";
      } else {
        const toIntl = cleanPhone.startsWith("01") ? `+88${cleanPhone}` : cleanPhone.startsWith("+") ? cleanPhone : `+${cleanPhone}`;
        const form = new URLSearchParams({
          To: toIntl,
          From: cfg.fromNumber,
          Body: params.messageBody
        });
        const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64");
        const resp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.apiKey)}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body: form.toString(),
            signal: AbortSignal.timeout(15e3)
          }
        );
        if (resp.ok) {
          status = "sent";
          deliveredViaCarrier = true;
        } else {
          const errJson = await resp.json().catch(() => null);
          status = "failed";
          errorDetail = errJson?.message || `HTTP ${resp.status}`;
        }
      }
    } else if (cfg.provider === "webhook") {
      if (!cfg.webhookUrl) {
        status = "failed";
        errorDetail = "Custom HTTPS Webhook URL \u09B8\u09C7\u099F \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF\u0964";
      } else {
        const safeUrl = await validateSafeHttpsWebhook(cfg.webhookUrl);
        const resp = await fetch(safeUrl.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}
          },
          body: JSON.stringify({
            sender: senderName,
            to: cleanPhone,
            message: params.messageBody,
            type: params.messageType,
            referenceId: params.referenceId || null
          }),
          signal: AbortSignal.timeout(15e3)
        });
        if (resp.ok) {
          status = "sent";
          deliveredViaCarrier = true;
        } else {
          const rawErr = await resp.text().catch(() => "");
          status = "failed";
          errorDetail = rawErr.slice(0, 180) || `HTTP ${resp.status}`;
        }
      }
    } else {
      status = "logged";
      deliveredViaCarrier = false;
      errorDetail = "Built-in \u09AA\u09CD\u09B0\u09BF\u09AD\u09BF\u0989 \u09AE\u09CB\u09A1 \u09B8\u0995\u09CD\u09B0\u09BF\u09AF\u09BC \u2014 \u09B2\u09BE\u0987\u09AD \u09AE\u09CB\u09AC\u09BE\u0987\u09B2\u09C7 SMS \u09AA\u09BE\u09A0\u09BE\u09A4\u09C7 BulkSMSBD / GreenWeb / Twilio \u09AF\u09C1\u0995\u09CD\u09A4 \u0995\u09B0\u09C1\u09A8\u0964";
    }
  } catch (err) {
    status = "failed";
    errorDetail = err?.message || "SMS gateway error";
  }
  await db.run(
    `INSERT INTO sms_logs (id, recipientPhone, senderName, messageType, messageBody, provider, status, referenceId, errorDetail, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    cleanPhone,
    senderName,
    params.messageType,
    params.logBodyOverride ?? params.messageBody,
    cfg.provider,
    status,
    params.referenceId || null,
    errorDetail,
    now
  );
  return { id, status, provider: cfg.provider, senderName, deliveredViaCarrier, errorDetail };
}
function buildOrderConfirmSmsBody(siteName, orderNumber) {
  const brand = siteName || "Orvexa";
  return `${brand}: \u0986\u09AA\u09A8\u09BE\u09B0 \u0985\u09B0\u09CD\u09A1\u09BE\u09B0\u099F\u09BF (#${orderNumber}) \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u0995\u09A8\u09AB\u09BE\u09B0\u09CD\u09AE \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u0986\u0997\u09BE\u09AE\u09C0 \u09E9 \u09A6\u09BF\u09A8\u09C7\u09B0 \u09AE\u09A7\u09CD\u09AF\u09C7 \u09AA\u09CD\u09B0\u09CB\u09A1\u09BE\u0995\u09CD\u099F\u099F\u09BF \u09B9\u09BE\u09A4\u09C7 \u09AA\u09C7\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AC\u09C7\u09A8\u0964 \u0985\u09A8\u09C1\u09B0\u09CB\u09A7 \u09B0\u0987\u09B2\u2014\u0995\u09CB\u09A8\u09CB \u0995\u09BE\u09B0\u09A3\u09C7 \u0985\u09B0\u09CD\u09A1\u09BE\u09B0\u099F\u09BF \u09AC\u09BE\u09A4\u09BF\u09B2 \u0995\u09B0\u09B2\u09C7 \u09AC\u09BE \u09B0\u09BF\u09B8\u09BF\u09AD \u09A8\u09BE \u0995\u09B0\u09B2\u09C7 \u0986\u09AE\u09BE\u09A6\u09C7\u09B0 \u09ED\u09E6-\u09E7\u09E8\u09E6 \u099F\u09BE\u0995\u09BE \u09A1\u09C7\u09B2\u09BF\u09AD\u09BE\u09B0\u09BF \u099A\u09BE\u09B0\u09CD\u099C \u09B2\u09CB\u0995\u09B8\u09BE\u09A8 \u09B9\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AC\u09C7, \u09A4\u09BE\u0987 \u0986\u09AE\u09BE\u09A6\u09C7\u09B0 \u09B2\u09CB\u0995\u09B8\u09BE\u09A8\u09C7\u09B0 \u0995\u09A5\u09BE \u09AD\u09C7\u09AC\u09C7 \u0985\u09B0\u09CD\u09A1\u09BE\u09B0\u099F\u09BF \u09B0\u09BF\u09B8\u09BF\u09AD \u0995\u09B0\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u0986\u09A8\u09CD\u09A4\u09B0\u09BF\u0995\u09AD\u09BE\u09AC\u09C7 \u0985\u09A8\u09C1\u09B0\u09CB\u09A7 \u09B0\u0987\u09B2\u0964 \u09A7\u09A8\u09CD\u09AF\u09AC\u09BE\u09A6! - ${brand}`;
}

// server/app.ts
var readyPromise = null;
async function ensureReady() {
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
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
function normalizeOriginHost(urlStr) {
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
function createApp(options = {}) {
  const pushToUser = options.pushToUser || (() => {
  });
  const app2 = express();
  app2.set("trust proxy", 1);
  app2.use((req, _res, next) => {
    if (req.url.startsWith("/.netlify/functions/api")) {
      const rest = req.url.slice("/.netlify/functions/api".length);
      req.url = rest ? rest.startsWith("/") ? `/api${rest}` : `/api/${rest}` : "/api";
    }
    next();
  });
  const configuredOrigins = new Set(
    (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => normalizeOriginHost(s)).filter((s) => Boolean(s))
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
    process.env.KOYEB_PUBLIC_DOMAIN
  ]) {
    const normalized = normalizeOriginHost(envUrl);
    if (normalized) {
      configuredOrigins.add(normalized);
      const aiStudioMatch = normalized.match(/^https:\/\/ais-(dev|pre)-([a-z0-9.-]+)\.run\.app$/i);
      if (aiStudioMatch) {
        const siblingPrefix = aiStudioMatch[1].toLowerCase() === "dev" ? "pre" : "dev";
        configuredOrigins.add(`https://ais-${siblingPrefix}-${aiStudioMatch[2]}.run.app`);
      }
    }
  }
  function isOriginPermitted(origin, req) {
    const normalizedOrigin = normalizeOriginHost(origin);
    if (normalizedOrigin && configuredOrigins.has(normalizedOrigin)) {
      return true;
    }
    try {
      const parsedOrigin = new URL(origin);
      const originHost = parsedOrigin.host.toLowerCase();
      const originHostname = parsedOrigin.hostname.toLowerCase();
      if (originHostname === "localhost" || originHostname === "127.0.0.1" || originHostname === "[::1]") {
        return true;
      }
      const requestHosts = extractRequestHostCandidates(req);
      if (requestHosts.includes(originHost) || requestHosts.includes(originHostname)) {
        return true;
      }
      const originAiMatch = originHostname.match(/^ais-(dev|pre)-(.+)\.run\.app$/i);
      if (originAiMatch) {
        const expectedCore = originAiMatch[2].toLowerCase();
        if (requestHosts.some((rh) => {
          const rhMatch = rh.match(/^ais-(?:dev|pre)-(.+)\.run\.app$/i);
          return Boolean(rhMatch && rhMatch[1].toLowerCase() === expectedCore);
        })) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }
  app2.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isOriginPermitted(origin, req)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With, Accept, Cache-Control, Pragma"
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app2.use((req, _res, next) => {
    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    if (!contentType.includes("multipart/form-data") && req.body !== void 0) {
      if (typeof req.body === "string") {
        try {
          req.body = req.body.trim() ? JSON.parse(req.body) : {};
        } catch {
        }
      } else if (Buffer.isBuffer(req.body)) {
        try {
          const text = req.body.toString("utf8").trim();
          req.body = text ? JSON.parse(text) : {};
        } catch {
        }
      }
      req._body = true;
    }
    next();
  });
  app2.use(express.json({ limit: "5mb" }));
  app2.use("/uploads", express.static(uploadsDir));
  app2.use(["/api/auth", "/api/health"], (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    next();
  });
  app2.use(
    "/api",
    asyncHandler(async (req, _res, next) => {
      const contentType = String(req.headers["content-type"] || "").toLowerCase();
      if (req.path === "/upload" && contentType.includes("multipart/form-data")) {
        next();
        return;
      }
      await ensureReady();
      next();
    })
  );
  app2.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "orvexa",
      db: db.isRemote ? "turso" : "sqlite",
      dbMode: db.mode,
      isRemote: db.isRemote,
      isServerless: isServerlessEnv,
      wsEnabled: Boolean(options.wsEnabled),
      uptime: Math.round(process.uptime()),
      timestamp: Date.now()
    });
  });
  const allowedMimes = /* @__PURE__ */ new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/bmp"
  ]);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const mime = (file.mimetype || "").toLowerCase();
      const hasImageExt = /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.originalname || "");
      if (allowedMimes.has(mime) || (!mime || mime === "application/octet-stream") && hasImageExt) {
        cb(null, true);
      } else {
        cb(new Error("\u09B6\u09C1\u09A7\u09C1\u09AE\u09BE\u09A4\u09CD\u09B0 JPG, PNG, WebP \u09AC\u09BE GIF \u099B\u09AC\u09BF \u0986\u09AA\u09B2\u09CB\u09A1 \u0995\u09B0\u09BE \u09AF\u09BE\u09AC\u09C7\u0964"));
      }
    }
  });
  async function createNotification(userId, type, title, body, link) {
    const id = `notif-${crypto5.randomUUID()}`;
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
      type: "notification:new",
      notification: { id, userId, type, title, body, link: link || null, isRead: 0, createdAt: now }
    });
  }
  function safeUrl(input) {
    if (typeof input !== "string") return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return trimmed;
      }
      return null;
    } catch {
      return null;
    }
  }
  async function getSetting(key, fallback) {
    const row = await db.get(`SELECT value FROM site_settings WHERE key = ?`, key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return fallback;
    }
  }
  function isDhakaDistrict(district) {
    const clean = district.trim().toLowerCase();
    return clean === "\u09A2\u09BE\u0995\u09BE" || clean === "dhaka" || /^ঢাকা(\s*\(.*\))?$/i.test(district.trim());
  }
  function calculateDeliveryFeeForDistrict(district, paymentCfg) {
    const dhakaFee = Number(paymentCfg?.dhakaDeliveryFee ?? 70);
    const outsideFee = Number(paymentCfg?.outsideDhakaDeliveryFee ?? 120);
    return isDhakaDistrict(district) ? dhakaFee : outsideFee;
  }
  function generatePromoCode7() {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghijkmnopqrstuvwxyz";
    const digits = "23456789";
    const all = upper + lower + digits;
    const chars = [
      upper[crypto5.randomInt(0, upper.length)],
      lower[crypto5.randomInt(0, lower.length)],
      digits[crypto5.randomInt(0, digits.length)]
    ];
    while (chars.length < 7) {
      chars.push(all[crypto5.randomInt(0, all.length)]);
    }
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto5.randomInt(0, i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
  }
  const PROMO_FONT_STYLES = ["mono", "serif", "display", "tracking"];
  const promoVerifyAttempts = /* @__PURE__ */ new Map();
  function checkPromoVerifyRateLimit(key) {
    const now = Date.now();
    const cur = promoVerifyAttempts.get(key);
    if (!cur || cur.resetAt < now) {
      promoVerifyAttempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1e3 });
      return true;
    }
    if (cur.count >= 15) return false;
    cur.count += 1;
    return true;
  }
  async function computePhoneOrderStatsMap(targetOrders) {
    const resultMap = /* @__PURE__ */ new Map();
    if (targetOrders.length === 0) return resultMap;
    const allOrders = await db.all(
      `SELECT id, customerPhone, status FROM orders`
    );
    const byNorm = /* @__PURE__ */ new Map();
    for (const row of allOrders) {
      const norm = normalizeBdPhone(row.customerPhone);
      if (!norm) continue;
      if (!byNorm.has(norm)) byNorm.set(norm, []);
      byNorm.get(norm).push({ id: row.id, status: row.status });
    }
    const confirmedStatuses = /* @__PURE__ */ new Set(["Confirmed", "Processing", "Shipped", "Delivered"]);
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
        else if (item.status === "Cancelled") cancelledCount++;
        else pendingCount++;
      }
      const isFirstTimeBuyer = otherCount === 0 && confirmedCount === 0 && cancelledCount === 0;
      resultMap.set(target.id, {
        normalizedPhone: norm || target.customerPhone,
        confirmedCount,
        cancelledCount,
        pendingCount,
        totalCount: list.length,
        isFirstTimeBuyer
      });
    }
    return resultMap;
  }
  function parseProductRow(row, opts = {}) {
    if (!row) return null;
    const hasPromoCode = Boolean(row.promoCode && Number(row.promoDiscount || 0) > 0);
    const parsed = {
      ...row,
      images: (() => {
        try {
          return JSON.parse(row.images || "[]");
        } catch {
          return [];
        }
      })(),
      variations: (() => {
        try {
          return JSON.parse(row.variations || "{}");
        } catch {
          return {};
        }
      })(),
      isFeatured: Boolean(row.isFeatured),
      isTrending: Boolean(row.isTrending),
      isRecommended: Boolean(row.isRecommended),
      isHidden: Boolean(row.isHidden),
      hasPromoCode,
      promoFontStyle: row.promoFontStyle || null
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
  async function isMediaReferenced(mediaId) {
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
  async function cleanupOrphanedMedia(urls) {
    for (const u of urls) {
      if (typeof u !== "string") continue;
      const match = u.match(/\/api\/media\/(med-[a-zA-Z0-9-]+)/);
      if (!match) continue;
      const mediaId = match[1];
      if (await isMediaReferenced(mediaId)) continue;
      await db.run(`DELETE FROM media WHERE id = ?`, mediaId);
    }
  }
  function isPrivateOrReservedIp(ip) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
      return true;
    }
    if (lower.startsWith("::ffff:")) {
      return isPrivateOrReservedIp(lower.slice(7));
    }
    if (net2.isIPv4(ip)) {
      const parts = ip.split(".").map(Number);
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
  async function validateDeployHookUrl(rawUrl) {
    const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
    let parsed;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw bad("\u0985\u09AC\u09C8\u09A7 Deploy Hook URL\u0964 \u09B8\u09A0\u09BF\u0995 https:// \u09B2\u09BF\u0982\u0995 \u09A6\u09BF\u09A8\u0964");
    }
    if (parsed.protocol !== "https:") {
      throw bad("\u09A8\u09BF\u09B0\u09BE\u09AA\u09A4\u09CD\u09A4\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u09B6\u09C1\u09A7\u09C1\u09AE\u09BE\u09A4\u09CD\u09B0 HTTPS Deploy Hook URL \u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4\u0964");
    }
    const host = parsed.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
      throw bad("\u09B2\u09CB\u0995\u09BE\u09B2 \u09AC\u09BE \u09AA\u09CD\u09B0\u09BE\u0987\u09AD\u09C7\u099F \u09B9\u09CB\u09B8\u09CD\u099F \u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4 \u09A8\u09AF\u09BC\u0964");
    }
    if (net2.isIP(host) && isPrivateOrReservedIp(host)) {
      throw bad("\u09AA\u09CD\u09B0\u09BE\u0987\u09AD\u09C7\u099F \u09AC\u09BE \u09B0\u09BF\u099C\u09BE\u09B0\u09CD\u09AD\u09A1 IP \u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4 \u09A8\u09AF\u09BC\u0964");
    }
    try {
      const records = await dns2.lookup(host, { all: true });
      for (const rec of records) {
        if (isPrivateOrReservedIp(rec.address)) {
          throw bad("\u09AA\u09CD\u09B0\u09BE\u0987\u09AD\u09C7\u099F \u09A8\u09C7\u099F\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u0995 \u099F\u09BE\u09B0\u09CD\u0997\u09C7\u099F \u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4 \u09A8\u09AF\u09BC\u0964");
        }
      }
    } catch (err) {
      if (err?.status === 400 || err?.message?.includes("\u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4 \u09A8\u09AF\u09BC")) throw err;
    }
    return parsed;
  }
  function maskDeployHookUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      const pathParts = u.pathname.split("/").filter(Boolean);
      const last = pathParts[pathParts.length - 1] || "";
      const maskedTail = last.length > 6 ? `${last.slice(0, 3)}\u2022\u2022\u2022\u2022${last.slice(-4)}` : "\u2022\u2022\u2022\u2022";
      const prefix = pathParts.slice(0, -1).join("/");
      return `${u.origin}/${prefix ? `${prefix}/` : ""}${maskedTail}`;
    } catch {
      return "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
    }
  }
  app2.post("/api/upload", (req, res, next) => {
    upload.single("image")(req, res, async (err) => {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE" ? "\u099B\u09AC\u09BF\u09B0 \u09B8\u09BE\u0987\u099C \u09EA \u09AE\u09C7\u0997\u09BE\u09AC\u09BE\u0987\u099F\u09C7\u09B0 \u0995\u09AE \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7\u0964" : err.message || "\u099B\u09AC\u09BF \u0986\u09AA\u09B2\u09CB\u09A1 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964";
        res.status(400).json({ error: msg });
        return;
      }
      try {
        await ensureReady();
        const user = await extractBearerUser(req);
        if (!user) {
          res.status(401).json({ error: "\u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u0986\u0997\u09C7 \u09B8\u09BE\u0987\u09A8 \u0987\u09A8 \u0995\u09B0\u09C1\u09A8\u0964" });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: "\u0995\u09CB\u09A8\u09CB \u099B\u09AC\u09BF \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09A8 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF\u0964" });
          return;
        }
        const id = `med-${crypto5.randomUUID()}`;
        const base64 = req.file.buffer.toString("base64");
        const normalizedMime = !req.file.mimetype || req.file.mimetype === "image/jpg" || req.file.mimetype === "application/octet-stream" ? "image/jpeg" : req.file.mimetype;
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
  app2.get(
    "/api/media/:id",
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      if (!/^med-[a-zA-Z0-9-]+$/.test(id)) {
        res.status(400).json({ error: "\u0985\u09AC\u09C8\u09A7 \u09AE\u09BF\u09A1\u09BF\u09AF\u09BC\u09BE \u0986\u0987\u09A1\u09BF\u0964" });
        return;
      }
      const row = await db.get(
        `SELECT mimeType, dataBase64 FROM media WHERE id = ? LIMIT 1`,
        id
      );
      if (!row) {
        res.status(404).json({ error: "\u099B\u09AC\u09BF \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      const buf = Buffer.from(row.dataBase64, "base64");
      res.setHeader("Content-Type", row.mimeType || "image/jpeg");
      res.setHeader("Content-Length", String(buf.length));
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(buf);
    })
  );
  app2.post(
    "/api/auth/register",
    asyncHandler(async (req, res) => {
      const { role, fullName, shopName, username, emailOrPhone, password, confirmPassword } = req.body || {};
      if (role !== "buyer" && role !== "seller") {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09C7\u09B0 \u09A7\u09B0\u09A8 (Buyer \u09AC\u09BE Seller) \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09A8 \u0995\u09B0\u09C1\u09A8\u0964" });
        return;
      }
      if (!fullName || typeof fullName !== "string" || fullName.trim().length < 2) {
        res.status(400).json({ error: "\u09AA\u09C2\u09B0\u09CD\u09A3 \u09A8\u09BE\u09AE \u09B2\u09BF\u0996\u09C1\u09A8\u0964" });
        return;
      }
      if (role === "seller" && (!shopName || typeof shopName !== "string" || shopName.trim().length < 2)) {
        res.status(400).json({ error: "\u0986\u09AA\u09A8\u09BE\u09B0 \u09B6\u09AA\u09C7\u09B0 \u09A8\u09BE\u09AE \u09B2\u09BF\u0996\u09C1\u09A8\u0964" });
        return;
      }
      if (!username || typeof username !== "string" || !/^[a-zA-Z0-9_.-]{3,30}$/.test(username.trim())) {
        res.status(400).json({ error: "\u0987\u0989\u099C\u09BE\u09B0\u09A8\u09C7\u09AE \u09E9 \u09A5\u09C7\u0995\u09C7 \u09E9\u09E6 \u0985\u0995\u09CD\u09B7\u09B0\u09C7\u09B0 \u09AE\u09A7\u09CD\u09AF\u09C7 \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7 (\u09B6\u09C1\u09A7\u09C1\u09AE\u09BE\u09A4\u09CD\u09B0 \u0985\u0995\u09CD\u09B7\u09B0, \u09B8\u0982\u0996\u09CD\u09AF\u09BE, _ . -)\u0964" });
        return;
      }
      if (!emailOrPhone || typeof emailOrPhone !== "string" || emailOrPhone.trim().length < 5) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u0987\u09AE\u09C7\u0987\u09B2 \u09AC\u09BE \u09AE\u09CB\u09AC\u09BE\u0987\u09B2 \u09A8\u09AE\u09CD\u09AC\u09B0 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      if (!password || typeof password !== "string" || password.length < 6) {
        res.status(400).json({ error: "\u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u0995\u09AE\u09AA\u0995\u09CD\u09B7\u09C7 \u09EC \u0985\u0995\u09CD\u09B7\u09B0\u09C7\u09B0 \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7\u0964" });
        return;
      }
      if (password !== confirmPassword) {
        res.status(400).json({ error: "\u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u098F\u09AC\u0982 \u0995\u09A8\u09AB\u09BE\u09B0\u09CD\u09AE \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09AE\u09BF\u09B2\u099B\u09C7 \u09A8\u09BE\u0964" });
        return;
      }
      const cleanUsername = username.trim().toLowerCase();
      const rawContact = emailOrPhone.trim();
      const cleanContact = isLikelyPhone(rawContact) ? normalizeBdPhone(rawContact) : rawContact.toLowerCase();
      let dup = await db.get(
        `SELECT id FROM users WHERE LOWER(username) = ? OR LOWER(emailOrPhone) = ?`,
        cleanUsername,
        cleanContact
      );
      if (!dup && isLikelyPhone(rawContact)) {
        const phoneCandidates = await db.all(
          `SELECT id, emailOrPhone FROM users WHERE emailOrPhone NOT LIKE '%@%'`
        );
        dup = phoneCandidates.find((u) => normalizeBdPhone(u.emailOrPhone) === cleanContact);
      }
      if (dup) {
        res.status(409).json({ error: "\u098F\u0987 \u0987\u0989\u099C\u09BE\u09B0\u09A8\u09C7\u09AE \u0985\u09A5\u09AC\u09BE \u0987\u09AE\u09C7\u0987\u09B2/\u09AE\u09CB\u09AC\u09BE\u0987\u09B2 \u09A8\u09AE\u09CD\u09AC\u09B0 \u09A6\u09BF\u09AF\u09BC\u09C7 \u0986\u0997\u09C7\u0987 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F \u0996\u09CB\u09B2\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
        return;
      }
      const id = `usr-${crypto5.randomUUID()}`;
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
        role === "seller" ? shopName.trim() : null,
        now
      );
      await createNotification(
        id,
        "account",
        "Orvexa-\u09A4\u09C7 \u09B8\u09CD\u09AC\u09BE\u0997\u09A4\u09AE!",
        role === "seller" ? "\u0986\u09AA\u09A8\u09BE\u09B0 \u09B8\u09C7\u09B2\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F \u09A4\u09C8\u09B0\u09BF \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u098F\u0996\u09A8\u0987 \u09AA\u09A3\u09CD\u09AF \u09AF\u09CB\u0997 \u0995\u09B0\u09C7 \u09AC\u09BF\u0995\u09CD\u09B0\u09BF \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09C1\u09A8\u0964" : "\u0986\u09AA\u09A8\u09BE\u09B0 \u0995\u09CD\u09B0\u09C7\u09A4\u09BE \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09A4\u09C8\u09B0\u09BF \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
        role === "seller" ? "/seller" : "/profile"
      );
      const user = await getUserById(id);
      const sessionToken = await createPersistentSession(id);
      setSessionCookie(res, sessionToken, req);
      const token = signToken(id);
      res.status(201).json({ token, user });
    })
  );
  app2.post(
    "/api/auth/login",
    asyncHandler(async (req, res) => {
      const { identifier, password } = req.body || {};
      if (!identifier || typeof identifier !== "string" || !password || typeof password !== "string") {
        res.status(400).json({ error: "\u0987\u0989\u099C\u09BE\u09B0\u09A8\u09C7\u09AE/\u0987\u09AE\u09C7\u0987\u09B2/\u09AB\u09CB\u09A8 \u098F\u09AC\u0982 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      const cleanId = identifier.trim().toLowerCase();
      const normPhone = isLikelyPhone(cleanId) ? normalizeBdPhone(cleanId) : "";
      let row = await db.get(
        `SELECT id, passwordHash, status FROM users WHERE LOWER(username) = ? OR LOWER(emailOrPhone) = ? LIMIT 1`,
        cleanId,
        cleanId
      );
      if (!row && normPhone) {
        const phoneCandidates = await db.all(
          `SELECT id, emailOrPhone, passwordHash, status FROM users WHERE emailOrPhone NOT LIKE '%@%'`
        );
        row = phoneCandidates.find((u) => normalizeBdPhone(u.emailOrPhone) === normPhone);
      }
      if (!row || !verifyPassword(password, row.passwordHash)) {
        res.status(401).json({ error: "\u0987\u0989\u099C\u09BE\u09B0\u09A8\u09C7\u09AE/\u0987\u09AE\u09C7\u0987\u09B2 \u0985\u09A5\u09AC\u09BE \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09B8\u09A0\u09BF\u0995 \u09A8\u09AF\u09BC\u0964" });
        return;
      }
      if (row.status === "blocked") {
        res.status(403).json({ error: "\u0986\u09AA\u09A8\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u099F\u09BF \u09AC\u09CD\u09B2\u0995 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u09B8\u09B9\u09BE\u09AF\u09BC\u09A4\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8\u09C7\u09B0 \u09B8\u09BE\u09A5\u09C7 \u09AF\u09CB\u0997\u09BE\u09AF\u09CB\u0997 \u0995\u09B0\u09C1\u09A8\u0964" });
        return;
      }
      if (row.status === "suspended") {
        res.status(403).json({ error: "\u0986\u09AA\u09A8\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u099F\u09BF \u09B8\u09BE\u09AE\u09AF\u09BC\u09BF\u0995\u09AD\u09BE\u09AC\u09C7 \u09B8\u09CD\u09A5\u0997\u09BF\u09A4 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
        return;
      }
      const user = await getUserById(row.id);
      const sessionToken = await createPersistentSession(row.id);
      setSessionCookie(res, sessionToken, req);
      const token = signToken(row.id);
      res.json({ token, user });
    })
  );
  app2.post(
    "/api/auth/logout",
    asyncHandler(async (req, res) => {
      const rawToken = parseCookieValue(req, SESSION_COOKIE_NAME);
      if (rawToken) {
        await revokePersistentSession(rawToken);
      }
      clearSessionCookie(res, req);
      res.json({ ok: true });
    })
  );
  app2.get("/api/auth/me", requireAuth, (req, res) => {
    const token = signToken(req.user.id);
    res.json({ user: req.user, token });
  });
  app2.get(
    "/api/auth/session",
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
  app2.put(
    "/api/auth/profile",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = req.user;
      const { fullName, shopName, shopDescription, avatarUrl, emailOrPhone } = req.body || {};
      const nextFullName = typeof fullName === "string" && fullName.trim().length >= 2 ? fullName.trim() : user.fullName;
      const nextShopName = user.role === "seller" && typeof shopName === "string" && shopName.trim().length >= 2 ? shopName.trim() : user.shopName;
      const nextShopDesc = typeof shopDescription === "string" ? shopDescription.trim().slice(0, 600) : user.shopDescription;
      const nextAvatar = avatarUrl === null ? null : safeUrl(avatarUrl) || user.avatarUrl;
      let nextContact = user.emailOrPhone;
      if (typeof emailOrPhone === "string" && emailOrPhone.trim().length >= 5) {
        const clean = emailOrPhone.trim().toLowerCase();
        const conflict = await db.get(
          `SELECT id FROM users WHERE LOWER(emailOrPhone) = ? AND id != ?`,
          clean,
          user.id
        );
        if (conflict) {
          res.status(409).json({ error: "\u098F\u0987 \u0987\u09AE\u09C7\u0987\u09B2 \u09AC\u09BE \u09AB\u09CB\u09A8 \u09A8\u09AE\u09CD\u09AC\u09B0 \u0985\u09A8\u09CD\u09AF \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09C7 \u09AC\u09CD\u09AF\u09AC\u09B9\u09C3\u09A4 \u09B9\u099A\u09CD\u099B\u09C7\u0964" });
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
      if (user.role === "seller" && nextShopName && nextShopName !== user.shopName) {
        await db.run(`UPDATE products SET shopName = ? WHERE sellerId = ?`, nextShopName, user.id);
      }
      res.json({ user: await getUserById(user.id) });
    })
  );
  app2.post(
    "/api/auth/change-password",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = req.user;
      const { currentPassword, newPassword, confirmNewPassword } = req.body || {};
      if (!currentPassword || !newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
        res.status(400).json({ error: "\u09A8\u09A4\u09C1\u09A8 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u0995\u09AE\u09AA\u0995\u09CD\u09B7\u09C7 \u09EC \u0985\u0995\u09CD\u09B7\u09B0\u09C7\u09B0 \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7\u0964" });
        return;
      }
      if (newPassword !== confirmNewPassword) {
        res.status(400).json({ error: "\u09A8\u09A4\u09C1\u09A8 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u098F\u09AC\u0982 \u0995\u09A8\u09AB\u09BE\u09B0\u09CD\u09AE \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09AE\u09BF\u09B2\u099B\u09C7 \u09A8\u09BE\u0964" });
        return;
      }
      const row = await db.get(
        `SELECT passwordHash FROM users WHERE id = ?`,
        user.id
      );
      if (!row || !verifyPassword(currentPassword, row.passwordHash)) {
        res.status(400).json({ error: "\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09B8\u09A0\u09BF\u0995 \u09A8\u09AF\u09BC\u0964" });
        return;
      }
      await db.run(`UPDATE users SET passwordHash = ? WHERE id = ?`, hashPassword(newPassword), user.id);
      await createNotification(
        user.id,
        "account",
        "\u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09BF\u09A4 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7",
        "\u0986\u09AA\u09A8\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09C7\u09B0 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u0986\u09AA\u09A1\u09C7\u099F \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
        "/profile"
      );
      res.json({ message: "\u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.post(
    "/api/auth/forgot-password",
    asyncHandler(async (req, res) => {
      const { identifier } = req.body || {};
      if (!identifier || typeof identifier !== "string") {
        res.status(400).json({ error: "\u0986\u09AA\u09A8\u09BE\u09B0 \u0987\u0989\u099C\u09BE\u09B0\u09A8\u09C7\u09AE, \u0987\u09AE\u09C7\u0987\u09B2 \u0985\u09A5\u09AC\u09BE \u09AE\u09CB\u09AC\u09BE\u0987\u09B2 \u09A8\u09AE\u09CD\u09AC\u09B0 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      const cleanId = identifier.trim().toLowerCase();
      const normPhone = isLikelyPhone(cleanId) ? normalizeBdPhone(cleanId) : "";
      const row = await db.get(
        `SELECT id, fullName, emailOrPhone, role
         FROM users
         WHERE LOWER(username) = ? OR LOWER(emailOrPhone) = ?
         LIMIT 1`,
        cleanId,
        cleanId
      );
      let matchedRow = row;
      if (!matchedRow && normPhone) {
        const candidates = await db.all(
          `SELECT id, fullName, emailOrPhone, role FROM users WHERE emailOrPhone NOT LIKE '%@%'`
        );
        matchedRow = candidates.find((u) => normalizeBdPhone(u.emailOrPhone) === normPhone);
      }
      if (!matchedRow) {
        res.status(404).json({ error: "\u098F\u0987 \u09A4\u09A5\u09CD\u09AF\u09C7\u09B0 \u09B8\u09BE\u09A5\u09C7 \u0995\u09CB\u09A8\u09CB \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      if (matchedRow.role === "admin") {
        res.status(400).json({
          error: "\u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09C7\u09B0 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u09B2\u0997\u0987\u09A8 \u0995\u09B0\u09C7 \u09AA\u09CD\u09B0\u09CB\u09AB\u09BE\u0987\u09B2 \u2192 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8 \u0985\u09AA\u09B6\u09A8 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964"
        });
        return;
      }
      const phoneRecipient = isLikelyPhone(matchedRow.emailOrPhone) ? normalizeBdPhone(matchedRow.emailOrPhone) : normPhone;
      if (!phoneRecipient) {
        res.status(400).json({
          error: "\u098F\u0987 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F\u09C7 \u0995\u09CB\u09A8\u09CB \u09AC\u09C8\u09A7 \u09AE\u09CB\u09AC\u09BE\u0987\u09B2 \u09A8\u09AE\u09CD\u09AC\u09B0 \u09AF\u09C1\u0995\u09CD\u09A4 \u09A8\u09C7\u0987\u0964 SMS OTP \u09AA\u09C7\u09A4\u09C7 \u0986\u09AA\u09A8\u09BE\u09B0 \u09AE\u09CB\u09AC\u09BE\u0987\u09B2 \u09A8\u09AE\u09CD\u09AC\u09B0 \u09AC\u09BE \u09B8\u09A0\u09BF\u0995 \u0987\u0989\u099C\u09BE\u09B0\u09A8\u09C7\u09AE \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964"
        });
        return;
      }
      const resetCode = String(crypto5.randomInt(1e5, 1e6));
      const codeHash = crypto5.createHash("sha256").update(resetCode).digest("hex");
      const expires = Date.now() + 10 * 60 * 1e3;
      await db.run(
        `UPDATE users SET resetTokenHash = ?, resetTokenExpires = ?, resetAttempts = 0 WHERE id = ?`,
        codeHash,
        expires,
        matchedRow.id
      );
      const generalCfg = await getSetting("generalSettings", { siteName: "Orvexa" });
      const brandName = generalCfg?.siteName || "Orvexa";
      const otpMessage = `${brandName} OTP: \u0986\u09AA\u09A8\u09BE\u09B0 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09B0\u09BF\u09B8\u09C7\u099F \u0995\u09CB\u09A1 \u09B9\u09B2\u09CB ${resetCode}\u0964 \u09AE\u09C7\u09AF\u09BC\u09BE\u09A6 \u09E7\u09E6 \u09AE\u09BF\u09A8\u09BF\u099F\u0964 \u0995\u09BE\u0989\u0995\u09C7 \u098F\u0987 \u0995\u09CB\u09A1 \u09A6\u09C7\u09AC\u09C7\u09A8 \u09A8\u09BE\u0964`;
      const maskedLogMessage = `${brandName} OTP: \u0986\u09AA\u09A8\u09BE\u09B0 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09B0\u09BF\u09B8\u09C7\u099F \u0995\u09CB\u09A1 \u09B9\u09B2\u09CB ******\u0964 \u09AE\u09C7\u09AF\u09BC\u09BE\u09A6 \u09E7\u09E6 \u09AE\u09BF\u09A8\u09BF\u099F\u0964 \u0995\u09BE\u0989\u0995\u09C7 \u098F\u0987 \u0995\u09CB\u09A1 \u09A6\u09C7\u09AC\u09C7\u09A8 \u09A8\u09BE\u0964`;
      const smsRes = await dispatchSms({
        recipientPhone: phoneRecipient,
        messageType: "otp_reset",
        messageBody: otpMessage,
        logBodyOverride: maskedLogMessage,
        referenceId: matchedRow.id
      });
      if (!smsRes.deliveredViaCarrier) {
        await db.run(
          `UPDATE users SET resetTokenHash = NULL, resetTokenExpires = NULL, resetAttempts = 0 WHERE id = ?`,
          matchedRow.id
        );
        res.status(503).json({
          error: smsRes.provider === "built_in" ? "SMS OTP \u09AA\u09BE\u09A0\u09BE\u09A8\u09CB\u09B0 \u099C\u09A8\u09CD\u09AF \u09B2\u09BE\u0987\u09AD SMS \u0997\u09C7\u099F\u0993\u09AF\u09BC\u09C7 \u098F\u0996\u09A8\u09CB \u09AF\u09C1\u0995\u09CD\u09A4 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF\u0964 \u09B8\u09BE\u0987\u099F \u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8\u0995\u09C7 Admin \u2192 SMS \u0993 OTP \u0997\u09C7\u099F\u0993\u09AF\u09BC\u09C7 \u09A5\u09C7\u0995\u09C7 BulkSMSBD / GreenWeb / Twilio API \u09AF\u09C1\u0995\u09CD\u09A4 \u0995\u09B0\u09A4\u09C7 \u09AC\u09B2\u09C1\u09A8\u0964 (\u09A8\u09BF\u09B0\u09BE\u09AA\u09A4\u09CD\u09A4\u09BE\u09B0 \u0995\u09BE\u09B0\u09A3\u09C7 OTP \u09B8\u09CD\u0995\u09CD\u09B0\u09BF\u09A8\u09C7 \u09A6\u09C7\u0996\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC \u09A8\u09BE\u0964)" : "\u0986\u09AA\u09A8\u09BE\u09B0 \u09A8\u09AE\u09CD\u09AC\u09B0\u09C7 SMS OTP \u09AA\u09BE\u09A0\u09BE\u09A8\u09CB \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u0995\u09BF\u099B\u09C1\u0995\u09CD\u09B7\u09A3 \u09AA\u09B0 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8 \u0985\u09A5\u09AC\u09BE \u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8\u0995\u09C7 SMS \u0997\u09C7\u099F\u0993\u09AF\u09BC\u09C7 \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09A4\u09C7 \u09AC\u09B2\u09C1\u09A8\u0964"
        });
        return;
      }
      const maskedContact = `${phoneRecipient.slice(0, 3)}\u2022\u2022\u2022\u2022${phoneRecipient.slice(-2)}`;
      res.json({
        message: `\u0986\u09AA\u09A8\u09BE\u09B0 \u09A8\u09AE\u09CD\u09AC\u09B0\u09C7 (${maskedContact}) \u09EC \u09A1\u09BF\u099C\u09BF\u099F\u09C7\u09B0 OTP \u09AA\u09BE\u09A0\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u09E7\u09E6 \u09AE\u09BF\u09A8\u09BF\u099F\u09C7\u09B0 \u09AE\u09A7\u09CD\u09AF\u09C7 \u0995\u09CB\u09A1\u099F\u09BF \u09B2\u09BF\u0996\u09C7 \u09A8\u09A4\u09C1\u09A8 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09B8\u09C7\u099F \u0995\u09B0\u09C1\u09A8\u0964`,
        otpSentTo: maskedContact,
        provider: smsRes.provider,
        deliveredViaCarrier: true
      });
    })
  );
  app2.post(
    "/api/auth/reset-password",
    asyncHandler(async (req, res) => {
      const { identifier, code, newPassword, confirmPassword } = req.body || {};
      if (!identifier || !code || !newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09EC \u09A1\u09BF\u099C\u09BF\u099F\u09C7\u09B0 OTP \u098F\u09AC\u0982 \u0995\u09AE\u09AA\u0995\u09CD\u09B7\u09C7 \u09EC \u0985\u0995\u09CD\u09B7\u09B0\u09C7\u09B0 \u09A8\u09A4\u09C1\u09A8 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      if (newPassword !== confirmPassword) {
        res.status(400).json({ error: "\u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u098F\u09AC\u0982 \u0995\u09A8\u09AB\u09BE\u09B0\u09CD\u09AE \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09AE\u09BF\u09B2\u099B\u09C7 \u09A8\u09BE\u0964" });
        return;
      }
      const cleanId = String(identifier).trim().toLowerCase();
      const normPhone = isLikelyPhone(cleanId) ? normalizeBdPhone(cleanId) : "";
      let row = await db.get(
        `SELECT id, resetTokenHash, resetTokenExpires, resetAttempts
         FROM users
         WHERE LOWER(username) = ? OR LOWER(emailOrPhone) = ?
         LIMIT 1`,
        cleanId,
        cleanId
      );
      if (!row && normPhone) {
        const candidates = await db.all(
          `SELECT id, emailOrPhone, resetTokenHash, resetTokenExpires, resetAttempts FROM users WHERE emailOrPhone NOT LIKE '%@%'`
        );
        const found = candidates.find((u) => normalizeBdPhone(u.emailOrPhone) === normPhone);
        if (found) row = found;
      }
      if (!row || !row.resetTokenHash || !row.resetTokenExpires || row.resetTokenExpires < Date.now()) {
        res.status(400).json({ error: "OTP \u0995\u09CB\u09A1\u099F\u09BF \u09B8\u09A0\u09BF\u0995 \u09A8\u09AF\u09BC \u09AC\u09BE \u09AE\u09C7\u09AF\u09BC\u09BE\u09A6 \u09B6\u09C7\u09B7 \u09B9\u09AF\u09BC\u09C7 \u0997\u09C7\u099B\u09C7\u0964" });
        return;
      }
      const attempts = Number(row.resetAttempts || 0);
      if (attempts >= 5) {
        res.status(429).json({ error: "\u0985\u09A8\u09C7\u0995\u09AC\u09BE\u09B0 \u09AD\u09C1\u09B2 OTP \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u09AA\u09C1\u09A8\u09B0\u09BE\u09AF\u09BC \u09A8\u09A4\u09C1\u09A8 OTP \u09A8\u09BF\u09A8\u0964" });
        return;
      }
      const codeHash = crypto5.createHash("sha256").update(String(code).trim()).digest("hex");
      const expectedBuf = Buffer.from(row.resetTokenHash, "hex");
      const providedBuf = Buffer.from(codeHash, "hex");
      const isMatch = expectedBuf.length === providedBuf.length && crypto5.timingSafeEqual(expectedBuf, providedBuf);
      if (!isMatch) {
        await db.run(`UPDATE users SET resetAttempts = COALESCE(resetAttempts, 0) + 1 WHERE id = ?`, row.id);
        res.status(400).json({ error: "\u09AA\u09CD\u09B0\u09A6\u09A4\u09CD\u09A4 OTP \u0995\u09CB\u09A1\u099F\u09BF \u09B8\u09A0\u09BF\u0995 \u09A8\u09AF\u09BC\u0964 \u0986\u09AC\u09BE\u09B0 \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09C1\u09A8\u0964" });
        return;
      }
      await db.run(
        `UPDATE users SET passwordHash = ?, resetTokenHash = NULL, resetTokenExpires = NULL, resetAttempts = 0 WHERE id = ?`,
        hashPassword(newPassword),
        row.id
      );
      await db.run(`DELETE FROM sessions WHERE userId = ?`, row.id);
      res.json({ message: "OTP \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09C7 \u09AA\u09BE\u09B8\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09B0\u09BF\u09B8\u09C7\u099F \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u098F\u0996\u09A8 \u09B2\u0997\u0987\u09A8 \u0995\u09B0\u09C1\u09A8\u0964" });
    })
  );
  app2.get(
    "/api/storefront",
    asyncHandler(async (_req, res) => {
      const rawCategories = await db.all(`SELECT * FROM categories ORDER BY sortOrder ASC, nameEn ASC`);
      const categories = rawCategories.map((c) => ({
        ...c,
        subcategories: (() => {
          try {
            return JSON.parse(c.subcategories || "[]");
          } catch {
            return [];
          }
        })()
      }));
      const now = Date.now();
      const rawProductAds = await db.all(
        `SELECT a.id as adId, a.promoText, a.customImageUrl, a.sortOrder, a.isActive, a.expiresAt,
                p.*, u.username as sellerUsername, u.fullName as sellerFullName, u.avatarUrl as sellerAvatarUrl
         FROM homepage_product_ads a
         JOIN products p ON p.id = a.productId
         LEFT JOIN users u ON u.id = p.sellerId
         WHERE a.isActive = 1 AND p.isHidden = 0 AND (a.expiresAt IS NULL OR a.expiresAt > ?)
         ORDER BY a.sortOrder ASC, a.createdAt DESC`,
        now
      );
      const homepageProductAds = rawProductAds.map((row) => ({
        adId: row.adId,
        promoText: row.promoText,
        customImageUrl: row.customImageUrl,
        sortOrder: row.sortOrder,
        expiresAt: row.expiresAt,
        product: parseProductRow(row)
      }));
      const ads = await db.all(`SELECT * FROM advertisements WHERE isActive = 1 ORDER BY createdAt DESC`);
      const [
        heroBanners,
        productAdsSection,
        sellerProductAdsPage,
        rawPay,
        contactInfo,
        footerSettings,
        generalSettings,
        customCode,
        customPages,
        customBlocks
      ] = await Promise.all([
        getSetting("heroBanners", []),
        getSetting("productAdsSection", {
          enabled: true,
          heading: "\u09B8\u09CD\u09AA\u09A8\u09CD\u09B8\u09B0\u09A1 \u0993 \u09AC\u09BF\u09B6\u09C7\u09B7 \u09AA\u09CD\u09B0\u099A\u09BE\u09B0\u09AE\u09C2\u09B2\u0995 \u09AA\u09A3\u09CD\u09AF",
          subheading: "\u09B9\u09CB\u09AE\u09AA\u09C7\u099C\u09C7\u09B0 \u09B6\u09C0\u09B0\u09CD\u09B7\u09C7 \u09AA\u09CD\u09B0\u09A6\u09B0\u09CD\u09B6\u09BF\u09A4 \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09BF\u09A4 \u09B8\u09C7\u09B2\u09BE\u09B0\u09A6\u09C7\u09B0 \u09AA\u09A3\u09CD\u09AF\u09B8\u09AE\u09C2\u09B9"
        }),
        getSetting("sellerProductAdsPage", {}),
        getSetting("paymentOptions", {
          cashOnDelivery: true,
          bkashEnabled: false,
          nagadEnabled: false,
          deliveryFee: 70,
          dhakaDeliveryFee: 70,
          outsideDhakaDeliveryFee: 120,
          freeDeliveryThreshold: 0
        }),
        getSetting("contactInfo", {}),
        getSetting("footerSettings", {}),
        getSetting("generalSettings", {}),
        getSetting("customCode", {
          enabled: true,
          customCss: "",
          customBannerHtml: "",
          headScripts: "",
          customJs: ""
        }),
        getSetting("customPages", []),
        getSetting("customBlocks", [])
      ]);
      res.json({
        wsEnabled: Boolean(options.wsEnabled),
        categories,
        homepageProductAds,
        advertisements: ads,
        settings: {
          heroBanners,
          productAdsSection,
          sellerProductAdsPage,
          paymentOptions: {
            ...rawPay,
            deliveryFee: Number(rawPay.dhakaDeliveryFee ?? 70),
            dhakaDeliveryFee: Number(rawPay.dhakaDeliveryFee ?? 70),
            outsideDhakaDeliveryFee: Number(rawPay.outsideDhakaDeliveryFee ?? 120),
            freeDeliveryThreshold: 0,
            cashOnDelivery: true,
            bkashEnabled: false,
            nagadEnabled: false
          },
          contactInfo,
          footerSettings,
          generalSettings,
          customCode,
          customPages: Array.isArray(customPages) ? customPages : [],
          customBlocks: Array.isArray(customBlocks) ? customBlocks : []
        }
      });
    })
  );
  app2.get(
    "/api/categories",
    asyncHandler(async (_req, res) => {
      const rawCategories = await db.all(`SELECT * FROM categories ORDER BY sortOrder ASC, nameEn ASC`);
      const categories = rawCategories.map((c) => ({
        ...c,
        subcategories: (() => {
          try {
            return JSON.parse(c.subcategories || "[]");
          } catch {
            return [];
          }
        })()
      }));
      res.json({ categories });
    })
  );
  app2.get(
    "/api/products",
    asyncHandler(async (req, res) => {
      const { search, category, subcategory, sellerId, minPrice, maxPrice, sort, tab } = req.query;
      const where = ["p.isHidden = 0"];
      const params = [];
      if (typeof search === "string" && search.trim()) {
        const q = `%${search.trim().toLowerCase()}%`;
        where.push(
          `(LOWER(p.name) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(p.shopName) LIKE ? OR LOWER(p.subcategory) LIKE ? OR LOWER(c.nameEn) LIKE ? OR LOWER(c.nameBn) LIKE ?)`
        );
        params.push(q, q, q, q, q, q);
      }
      if (typeof category === "string" && category.trim() && category !== "all") {
        where.push(`(p.categoryId = ? OR c.slug = ?)`);
        params.push(category.trim(), category.trim());
      }
      if (typeof subcategory === "string" && subcategory.trim() && subcategory !== "all") {
        where.push(`LOWER(p.subcategory) = ?`);
        params.push(subcategory.trim().toLowerCase());
      }
      if (typeof sellerId === "string" && sellerId.trim()) {
        where.push(`p.sellerId = ?`);
        params.push(sellerId.trim());
      }
      if (minPrice !== void 0 && !Number.isNaN(Number(minPrice)) && String(minPrice).trim() !== "") {
        where.push(`p.currentPrice >= ?`);
        params.push(Number(minPrice));
      }
      if (maxPrice !== void 0 && !Number.isNaN(Number(maxPrice)) && String(maxPrice).trim() !== "") {
        where.push(`p.currentPrice <= ?`);
        params.push(Number(maxPrice));
      }
      if (tab === "featured") where.push("p.isFeatured = 1");
      else if (tab === "trending") where.push("p.isTrending = 1");
      else if (tab === "recommended") where.push("p.isRecommended = 1");
      else if (tab === "discounted") where.push("p.previousPrice IS NOT NULL AND p.previousPrice > p.currentPrice");
      let orderBy = "p.createdAt DESC";
      if (sort === "price_asc") orderBy = "p.currentPrice ASC";
      else if (sort === "price_desc") orderBy = "p.currentPrice DESC";
      else if (sort === "popular" || tab === "popular") orderBy = "p.views DESC, p.ratingAvg DESC";
      const rows = await db.all(
        `SELECT p.*, c.nameEn as categoryNameEn, c.nameBn as categoryNameBn,
                u.username as sellerUsername, u.fullName as sellerFullName, u.avatarUrl as sellerAvatarUrl
         FROM products p
         LEFT JOIN categories c ON c.id = p.categoryId
         LEFT JOIN users u ON u.id = p.sellerId
         WHERE ${where.join(" AND ")}
         ORDER BY ${orderBy}`,
        ...params
      );
      res.json({ products: rows.map((r) => parseProductRow(r)) });
    })
  );
  app2.get(
    "/api/products/:id",
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const row = await db.get(
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
        res.status(404).json({ error: "\u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u0996\u09C1\u0981\u099C\u09C7 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      await db.run(`UPDATE products SET views = views + 1 WHERE id = ?`, row.id);
      const reviews = await db.all(
        `SELECT * FROM reviews WHERE productId = ? ORDER BY createdAt DESC`,
        row.id
      );
      res.json({
        product: parseProductRow({ ...row, views: Number(row.views || 0) + 1 }),
        reviews
      });
    })
  );
  app2.get(
    "/api/sellers/:identifier",
    asyncHandler(async (req, res) => {
      const rawIdentifier = String(req.params.identifier || "").trim().replace(/^@+/, "");
      if (!rawIdentifier || rawIdentifier.length > 100) {
        res.status(400).json({ error: "\u09B8\u09C7\u09B2\u09BE\u09B0\u09C7\u09B0 \u09B8\u09A0\u09BF\u0995 \u09A4\u09A5\u09CD\u09AF \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      const sellerRow = await db.get(
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
        res.status(404).json({ error: "\u09A6\u09C1\u0983\u0996\u09BF\u09A4, \u098F\u0987 \u09B8\u09C7\u09B2\u09BE\u09B0\u09C7\u09B0 \u09AA\u09CD\u09B0\u09CB\u09AB\u09BE\u0987\u09B2 \u0996\u09C1\u0981\u099C\u09C7 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      const [productRows, deliveredRow] = await Promise.all([
        db.all(
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
        db.get(
          `SELECT COUNT(DISTINCT o.id) as cnt
           FROM orders o
           JOIN order_items oi ON oi.orderId = o.id
           WHERE oi.sellerId = ? AND o.status = 'Delivered'`,
          sellerRow.id
        )
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
            deliveredOrders: Number(deliveredRow?.cnt || 0)
          }
        },
        products
      });
    })
  );
  app2.post(
    "/api/products/:id/verify-promo",
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const rawCode = typeof req.body?.promoCode === "string" ? req.body.promoCode.trim() : "";
      if (!rawCode || rawCode.length > 20) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09ED \u0985\u0995\u09CD\u09B7\u09B0\u09C7\u09B0 \u09AA\u09CD\u09B0\u09CB\u09AE\u09CB \u0995\u09CB\u09A1 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.socket.remoteAddress || "unknown").trim();
      if (!checkPromoVerifyRateLimit(`${ip}:${id}`)) {
        res.status(429).json({ error: "\u0985\u09A8\u09C7\u0995\u09AC\u09BE\u09B0 \u09AD\u09C1\u09B2 \u09AA\u09CD\u09B0\u09CB\u09AE\u09CB \u0995\u09CB\u09A1 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u09E7\u09E6 \u09AE\u09BF\u09A8\u09BF\u099F \u09AA\u09B0 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964" });
        return;
      }
      const prod = await db.get(
        `SELECT id, currentPrice, promoCode, promoDiscount FROM products WHERE (id = ? OR slug = ?) AND isHidden = 0 LIMIT 1`,
        id,
        id
      );
      if (!prod) {
        res.status(404).json({ error: "\u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u0996\u09C1\u0981\u099C\u09C7 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      if (!prod.promoCode || Number(prod.promoDiscount || 0) <= 0) {
        res.status(400).json({ error: "\u098F\u0987 \u09AA\u09A3\u09CD\u09AF\u099F\u09BF\u09B0 \u099C\u09A8\u09CD\u09AF \u0995\u09CB\u09A8\u09CB \u09B8\u0995\u09CD\u09B0\u09BF\u09AF\u09BC \u09AA\u09CD\u09B0\u09CB\u09AE\u09CB \u0995\u09CB\u09A1 \u09A8\u09C7\u0987\u0964" });
        return;
      }
      const expected = Buffer.from(String(prod.promoCode));
      const provided = Buffer.from(rawCode);
      const matched = expected.length === provided.length && crypto5.timingSafeEqual(expected, provided);
      if (!matched) {
        res.status(400).json({ error: "\u09AA\u09CD\u09B0\u09CB\u09AE\u09CB \u0995\u09CB\u09A1\u099F\u09BF \u09B8\u09A0\u09BF\u0995 \u09A8\u09AF\u09BC\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09C7 \u0986\u09AC\u09BE\u09B0 \u09A6\u09BF\u09A8\u0964" });
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
        message: `\u0985\u09AD\u09BF\u09A8\u09A8\u09CD\u09A6\u09A8! \u09AA\u09CD\u09B0\u09CB\u09AE\u09CB \u0995\u09CB\u09A1 \u09AF\u09BE\u099A\u09BE\u0987 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7 (\u09F3${promoDiscount} \u099B\u09BE\u09A1\u09BC \u09AA\u09CD\u09B0\u09AF\u09CB\u099C\u09CD\u09AF)\u0964`
      });
    })
  );
  app2.post(
    "/api/products/:id/reviews",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { rating, comment } = req.body || {};
      const numRating = Number(rating);
      if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
        res.status(400).json({ error: "\u09E7 \u09A5\u09C7\u0995\u09C7 \u09EB \u098F\u09B0 \u09AE\u09A7\u09CD\u09AF\u09C7 \u09B0\u09C7\u099F\u09BF\u0982 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      if (!comment || typeof comment !== "string" || comment.trim().length < 2) {
        res.status(400).json({ error: "\u09AE\u09A4\u09BE\u09AE\u09A4 \u09B2\u09BF\u0996\u09C1\u09A8\u0964" });
        return;
      }
      const product = await db.get(`SELECT id FROM products WHERE id = ?`, id);
      if (!product) {
        res.status(404).json({ error: "\u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      const revId = `rev-${crypto5.randomUUID()}`;
      const now = Date.now();
      await db.run(
        `INSERT INTO reviews (id, productId, userId, userName, rating, comment, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        revId,
        id,
        req.user.id,
        req.user.fullName,
        numRating,
        comment.trim().slice(0, 1e3),
        now
      );
      const stats = await db.get(
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
          userId: req.user.id,
          userName: req.user.fullName,
          rating: numRating,
          comment: comment.trim().slice(0, 1e3),
          createdAt: now
        }
      });
    })
  );
  app2.post(
    "/api/reports",
    asyncHandler(async (req, res) => {
      const user = await extractBearerUser(req);
      const { reporterName, reportType, targetId, targetName, subject, message } = req.body || {};
      const validTypes = /* @__PURE__ */ new Set(["customer_message", "seller_report", "product_report"]);
      if (!validTypes.has(reportType)) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09B0\u09BF\u09AA\u09CB\u09B0\u09CD\u099F\u09C7\u09B0 \u09A7\u09B0\u09A8 \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09A8 \u0995\u09B0\u09C1\u09A8\u0964" });
        return;
      }
      if (!subject || typeof subject !== "string" || !message || typeof message !== "string") {
        res.status(400).json({ error: "\u09AC\u09BF\u09B7\u09AF\u09BC \u098F\u09AC\u0982 \u09AC\u09BF\u09B8\u09CD\u09A4\u09BE\u09B0\u09BF\u09A4 \u09AC\u09BE\u09B0\u09CD\u09A4\u09BE \u09B2\u09BF\u0996\u09C1\u09A8\u0964" });
        return;
      }
      const id = `rep-${crypto5.randomUUID()}`;
      const now = Date.now();
      await db.run(
        `INSERT INTO reports (id, reporterId, reporterName, reportType, targetId, targetName, subject, message, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?)`,
        id,
        user?.id || null,
        user?.fullName || (typeof reporterName === "string" && reporterName.trim() ? reporterName.trim() : "\u09AD\u09BF\u099C\u09BF\u099F\u09B0"),
        reportType,
        typeof targetId === "string" ? targetId : null,
        typeof targetName === "string" ? targetName : null,
        subject.trim().slice(0, 200),
        message.trim().slice(0, 2e3),
        now
      );
      res.status(201).json({ message: "\u0986\u09AA\u09A8\u09BE\u09B0 \u09AC\u09BE\u09B0\u09CD\u09A4\u09BE/\u09B0\u09BF\u09AA\u09CB\u09B0\u09CD\u099F \u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8\u09C7\u09B0 \u0995\u09BE\u099B\u09C7 \u09AA\u09BE\u09A0\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.get(
    "/api/cart",
    requireAuth,
    asyncHandler(async (req, res) => {
      const rows = await db.all(
        `SELECT c.id, c.productId, c.quantity, c.selectedVariation, c.appliedPromoCode, c.createdAt,
                p.name, p.currentPrice, p.previousPrice, p.stock, p.images, p.shopName, p.sellerId, p.isHidden,
                p.promoCode, p.promoDiscount
         FROM cart_items c
         JOIN products p ON p.id = c.productId
         WHERE c.userId = ?
         ORDER BY c.createdAt DESC`,
        req.user.id
      );
      res.json({
        items: rows.map((r) => {
          const hasPromoCode = Boolean(r.promoCode && Number(r.promoDiscount || 0) > 0);
          const codeMatches = hasPromoCode && typeof r.appliedPromoCode === "string" && r.appliedPromoCode.trim() === String(r.promoCode);
          const promoDiscount = codeMatches ? Math.min(Math.max(0, Number(r.promoDiscount || 0)), Math.max(0, Number(r.currentPrice) - 1)) : 0;
          const effectivePrice = Math.max(1, Number(r.currentPrice) - promoDiscount);
          const { promoCode: _secret, ...safeRow } = r;
          return {
            ...safeRow,
            images: JSON.parse(r.images || "[]"),
            isHidden: Boolean(r.isHidden),
            hasPromoCode,
            appliedPromoCode: codeMatches ? r.appliedPromoCode : null,
            promoDiscount,
            effectivePrice
          };
        })
      });
    })
  );
  app2.post(
    "/api/cart",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { productId, quantity, selectedVariation, promoCode } = req.body || {};
      const qty = Math.max(1, Math.min(99, Number(quantity) || 1));
      const product = await db.get(`SELECT id, stock, isHidden, promoCode, promoDiscount FROM products WHERE id = ?`, productId);
      if (!product || product.isHidden) {
        res.status(404).json({ error: "\u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      if (product.stock < 1) {
        res.status(400).json({ error: "\u09A6\u09C1\u0983\u0996\u09BF\u09A4, \u098F\u0987 \u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8\u09C7 \u09B8\u09CD\u099F\u0995\u09C7 \u09A8\u09C7\u0987\u0964" });
        return;
      }
      const cleanPromo = typeof promoCode === "string" ? promoCode.trim() : "";
      const validPromoToApply = cleanPromo && product.promoCode && Number(product.promoDiscount || 0) > 0 && cleanPromo === product.promoCode ? cleanPromo : null;
      const varText = typeof selectedVariation === "string" ? selectedVariation.trim() : "";
      const existing = await db.get(
        `SELECT id, quantity, appliedPromoCode FROM cart_items WHERE userId = ? AND productId = ? AND COALESCE(selectedVariation, '') = ?`,
        req.user.id,
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
          `cart-${crypto5.randomUUID()}`,
          req.user.id,
          productId,
          Math.min(product.stock, qty),
          varText || null,
          validPromoToApply,
          Date.now()
        );
      }
      res.status(201).json({ message: "\u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u0995\u09BE\u09B0\u09CD\u099F\u09C7 \u09AF\u09CB\u0997 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.patch(
    "/api/cart/:id/promo",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const remove = Boolean(req.body?.remove);
      const rawCode = typeof req.body?.promoCode === "string" ? req.body.promoCode.trim() : "";
      const item = await db.get(
        `SELECT c.id, c.productId, p.currentPrice, p.promoCode, p.promoDiscount
         FROM cart_items c
         JOIN products p ON p.id = c.productId
         WHERE c.id = ? AND c.userId = ?`,
        id,
        req.user.id
      );
      if (!item) {
        res.status(404).json({ error: "\u0995\u09BE\u09B0\u09CD\u099F \u0986\u0987\u099F\u09C7\u09AE \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      if (remove || !rawCode) {
        await db.run(`UPDATE cart_items SET appliedPromoCode = NULL WHERE id = ?`, id);
        res.json({ message: "\u09AA\u09CD\u09B0\u09CB\u09AE\u09CB \u0995\u09CB\u09A1 \u09B8\u09B0\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964", promoDiscount: 0, effectivePrice: Number(item.currentPrice) });
        return;
      }
      if (!item.promoCode || Number(item.promoDiscount || 0) <= 0) {
        res.status(400).json({ error: "\u098F\u0987 \u09AA\u09A3\u09CD\u09AF\u099F\u09BF\u09B0 \u099C\u09A8\u09CD\u09AF \u0995\u09CB\u09A8\u09CB \u09B8\u0995\u09CD\u09B0\u09BF\u09AF\u09BC \u09AA\u09CD\u09B0\u09CB\u09AE\u09CB \u0995\u09CB\u09A1 \u09A8\u09C7\u0987\u0964" });
        return;
      }
      const expected = Buffer.from(String(item.promoCode));
      const provided = Buffer.from(rawCode);
      const matched = expected.length === provided.length && crypto5.timingSafeEqual(expected, provided);
      if (!matched) {
        res.status(400).json({ error: "\u098F\u0987 \u09AA\u09CD\u09B0\u09CB\u09AE\u09CB \u0995\u09CB\u09A1\u099F\u09BF \u098F\u0987 \u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u09B8\u09A0\u09BF\u0995 \u09A8\u09AF\u09BC\u0964" });
        return;
      }
      await db.run(`UPDATE cart_items SET appliedPromoCode = ? WHERE id = ?`, item.promoCode, id);
      const discount = Math.min(Math.max(0, Number(item.promoDiscount || 0)), Math.max(0, Number(item.currentPrice) - 1));
      res.json({
        message: `\u09AA\u09CD\u09B0\u09CB\u09AE\u09CB \u0995\u09CB\u09A1 \u09AF\u09C1\u0995\u09CD\u09A4 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7! \u09F3${discount} \u099B\u09BE\u09DC \u09AA\u09CD\u09B0\u09AF\u09CB\u099C\u09CD\u09AF\u0964`,
        appliedPromoCode: item.promoCode,
        promoDiscount: discount,
        effectivePrice: Math.max(1, Number(item.currentPrice) - discount)
      });
    })
  );
  app2.patch(
    "/api/cart/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const qty = Number(req.body?.quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09AA\u09B0\u09BF\u09AE\u09BE\u09A3 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      const item = await db.get(
        `SELECT c.id, p.stock FROM cart_items c JOIN products p ON p.id = c.productId WHERE c.id = ? AND c.userId = ?`,
        id,
        req.user.id
      );
      if (!item) {
        res.status(404).json({ error: "\u0995\u09BE\u09B0\u09CD\u099F \u0986\u0987\u099F\u09C7\u09AE \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      await db.run(`UPDATE cart_items SET quantity = ? WHERE id = ?`, Math.min(item.stock, qty), id);
      res.json({ message: "\u0995\u09BE\u09B0\u09CD\u099F \u0986\u09AA\u09A1\u09C7\u099F \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.delete(
    "/api/cart/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      await db.run(`DELETE FROM cart_items WHERE id = ? AND userId = ?`, req.params.id, req.user.id);
      res.json({ message: "\u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u0995\u09BE\u09B0\u09CD\u099F \u09A5\u09C7\u0995\u09C7 \u09B8\u09B0\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.get(
    "/api/favorites",
    requireAuth,
    asyncHandler(async (req, res) => {
      const rows = await db.all(
        `SELECT p.*, c.nameEn as categoryNameEn, c.nameBn as categoryNameBn
         FROM favorites f
         JOIN products p ON p.id = f.productId
         LEFT JOIN categories c ON c.id = p.categoryId
         WHERE f.userId = ? AND p.isHidden = 0
         ORDER BY f.createdAt DESC`,
        req.user.id
      );
      res.json({ favorites: rows.map((r) => parseProductRow(r)) });
    })
  );
  app2.post(
    "/api/favorites/toggle",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { productId } = req.body || {};
      const exists = await db.get(
        `SELECT id FROM favorites WHERE userId = ? AND productId = ?`,
        req.user.id,
        productId
      );
      if (exists) {
        await db.run(`DELETE FROM favorites WHERE id = ?`, exists.id);
        res.json({ favorited: false, message: "\u09AA\u099B\u09A8\u09CD\u09A6\u09C7\u09B0 \u09A4\u09BE\u09B2\u09BF\u0995\u09BE \u09A5\u09C7\u0995\u09C7 \u09B8\u09B0\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
      } else {
        const product = await db.get(`SELECT id FROM products WHERE id = ?`, productId);
        if (!product) {
          res.status(404).json({ error: "\u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
          return;
        }
        await db.run(
          `INSERT INTO favorites (id, userId, productId, createdAt) VALUES (?, ?, ?, ?)`,
          `fav-${crypto5.randomUUID()}`,
          req.user.id,
          productId,
          Date.now()
        );
        res.json({ favorited: true, message: "\u09AA\u099B\u09A8\u09CD\u09A6\u09C7\u09B0 \u09A4\u09BE\u09B2\u09BF\u0995\u09BE\u09AF\u09BC \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
      }
    })
  );
  app2.post(
    "/api/orders",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = req.user;
      const {
        customerName,
        customerPhone,
        backupPhone,
        district,
        thana,
        deliveryAddress,
        directItems,
        fromCart
      } = req.body || {};
      if (!customerName || typeof customerName !== "string" || customerName.trim().length < 2) {
        res.status(400).json({ error: "\u0986\u09AA\u09A8\u09BE\u09B0 \u09AA\u09C2\u09B0\u09CD\u09A3 \u09A8\u09BE\u09AE \u09B2\u09BF\u0996\u09C1\u09A8\u0964" });
        return;
      }
      const cleanPhone = typeof customerPhone === "string" ? customerPhone.trim() : "";
      if (!cleanPhone || cleanPhone.includes("@") || !/^[0-9+\-\s]{10,16}$/.test(cleanPhone)) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09AE\u09CB\u09AC\u09BE\u0987\u09B2 \u09A8\u09AE\u09CD\u09AC\u09B0 \u09A6\u09BF\u09A8 (\u09AF\u09C7\u09AE\u09A8: 01XXXXXXXXX)\u0964 \u0987\u09AE\u09C7\u0987\u09B2 \u0997\u09CD\u09B0\u09B9\u09A3\u09AF\u09CB\u0997\u09CD\u09AF \u09A8\u09AF\u09BC\u0964" });
        return;
      }
      const cleanBackupPhone = typeof backupPhone === "string" ? backupPhone.trim() : "";
      if (cleanBackupPhone && (cleanBackupPhone.includes("@") || !/^[0-9+\-\s]{10,16}$/.test(cleanBackupPhone))) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09AC\u09BF\u0995\u09B2\u09CD\u09AA / \u09A6\u09CD\u09AC\u09BF\u09A4\u09C0\u09AF\u09BC \u09AE\u09CB\u09AC\u09BE\u0987\u09B2 \u09A8\u09AE\u09CD\u09AC\u09B0 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      if (!district || typeof district !== "string" || !district.trim()) {
        res.status(400).json({ error: "\u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u0986\u09AA\u09A8\u09BE\u09B0 \u099C\u09C7\u09B2\u09BE \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09A8 \u0995\u09B0\u09C1\u09A8\u0964" });
        return;
      }
      if (!thana || typeof thana !== "string" || !thana.trim()) {
        res.status(400).json({ error: "\u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u0986\u09AA\u09A8\u09BE\u09B0 \u09A5\u09BE\u09A8\u09BE/\u0989\u09AA\u099C\u09C7\u09B2\u09BE \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09A8 \u0995\u09B0\u09C1\u09A8\u0964" });
        return;
      }
      if (!deliveryAddress || typeof deliveryAddress !== "string" || deliveryAddress.trim().length < 4) {
        res.status(400).json({ error: "\u09A1\u09C7\u09B2\u09BF\u09AD\u09BE\u09B0\u09BF\u09B0 \u09A0\u09BF\u0995\u09BE\u09A8\u09BE \u09B2\u09BF\u0996\u09C1\u09A8\u0964" });
        return;
      }
      const paymentCfg = await getSetting("paymentOptions", {
        cashOnDelivery: true,
        bkashEnabled: false,
        nagadEnabled: false,
        deliveryFee: 70,
        dhakaDeliveryFee: 70,
        outsideDhakaDeliveryFee: 120,
        freeDeliveryThreshold: 0
      });
      const chosenMethod = "Cash on Delivery";
      try {
        const result = await db.transaction(async (tx) => {
          let requestedItems = [];
          if (fromCart) {
            const cartRows = await tx.all(
              `SELECT productId, quantity, selectedVariation, appliedPromoCode FROM cart_items WHERE userId = ?`,
              user.id
            );
            requestedItems = cartRows.map((c) => ({
              productId: c.productId,
              quantity: c.quantity,
              variation: c.selectedVariation,
              promoCode: c.appliedPromoCode
            }));
          } else if (Array.isArray(directItems)) {
            requestedItems = directItems.map((i) => ({
              productId: String(i.productId),
              quantity: Math.max(1, Number(i.quantity) || 1),
              variation: i.variation ? String(i.variation) : null,
              promoCode: i.promoCode ? String(i.promoCode).trim() : null
            }));
          }
          if (requestedItems.length === 0) {
            throw new Error("\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u0995\u09B0\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u0995\u09AE\u09AA\u0995\u09CD\u09B7\u09C7 \u098F\u0995\u099F\u09BF \u09AA\u09A3\u09CD\u09AF \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09A8 \u0995\u09B0\u09C1\u09A8\u0964");
          }
          let subtotal = 0;
          const lineItems = [];
          for (const reqItem of requestedItems) {
            const prod = await tx.get(
              `SELECT * FROM products WHERE id = ? AND isHidden = 0`,
              reqItem.productId
            );
            if (!prod) {
              throw new Error("\u098F\u0995\u099F\u09BF \u09AA\u09A3\u09CD\u09AF \u0986\u09B0 \u0989\u09AA\u09B2\u09AC\u09CD\u09A7 \u09A8\u09C7\u0987\u0964");
            }
            if (prod.stock < reqItem.quantity) {
              throw new Error(`"${prod.name}" \u09AA\u09A3\u09CD\u09AF\u099F\u09BF\u09B0 \u09AA\u09B0\u09CD\u09AF\u09BE\u09AA\u09CD\u09A4 \u09B8\u09CD\u099F\u0995 \u09A8\u09C7\u0987 (\u0989\u09AA\u09B2\u09AC\u09CD\u09A7: ${prod.stock})\u0964`);
            }
            const imgs = JSON.parse(prod.images || "[]");
            const basePrice = Number(prod.currentPrice);
            const hasActivePromo = Boolean(prod.promoCode && Number(prod.promoDiscount || 0) > 0);
            const isPromoMatched = hasActivePromo && typeof reqItem.promoCode === "string" && reqItem.promoCode.trim() === String(prod.promoCode);
            const unitPromoDiscount = isPromoMatched ? Math.min(Math.max(0, Number(prod.promoDiscount || 0)), Math.max(0, basePrice - 1)) : 0;
            const unitFinalPrice = Math.max(1, basePrice - unitPromoDiscount);
            subtotal += unitFinalPrice * reqItem.quantity;
            lineItems.push({
              productId: prod.id,
              sellerId: prod.sellerId,
              productName: prod.name,
              productImage: imgs[0] || "",
              shopName: prod.shopName,
              price: unitFinalPrice,
              quantity: reqItem.quantity,
              variation: reqItem.variation || null,
              appliedPromoCode: isPromoMatched ? prod.promoCode : null,
              promoDiscount: unitPromoDiscount
            });
            await tx.run(`UPDATE products SET stock = stock - ? WHERE id = ?`, reqItem.quantity, prod.id);
          }
          const fee = calculateDeliveryFeeForDistrict(district, paymentCfg);
          const totalAmount = subtotal + fee;
          const orderId = `ord-${crypto5.randomUUID()}`;
          const orderNumber = `ORV-${Math.floor(1e5 + Math.random() * 9e5)}`;
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
          const sellerMap = /* @__PURE__ */ new Map();
          for (const li of lineItems) {
            const oiId = `oi-${crypto5.randomUUID()}`;
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
                sellerItemCount: 0
              });
            }
            const entry = sellerMap.get(li.sellerId);
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
              itemStatus: "Pending",
              appliedPromoCode: li.appliedPromoCode,
              promoDiscount: li.promoDiscount
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
            sellerPayloads: Array.from(sellerMap.values())
          };
        });
        const [phoneStatsMap, smsCfg, generalCfg] = await Promise.all([
          computePhoneOrderStatsMap([{ id: result.orderId, customerPhone: cleanPhone }]),
          getSmsGatewayConfig(),
          getSetting("generalSettings", { siteName: "Orvexa" })
        ]);
        const phoneStats = phoneStatsMap.get(result.orderId);
        let smsNotification = null;
        if (smsCfg.autoOrderSmsEnabled) {
          const siteBrand = generalCfg?.siteName || smsCfg.senderName || "Orvexa";
          const smsBody = buildOrderConfirmSmsBody(siteBrand, result.orderNumber);
          try {
            const smsRes = await dispatchSms({
              recipientPhone: cleanPhone,
              messageType: "order_confirmation",
              messageBody: smsBody,
              referenceId: result.orderNumber
            });
            smsNotification = {
              sent: true,
              senderName: smsRes.senderName,
              phone: cleanPhone,
              messageBody: smsBody,
              provider: smsRes.provider,
              status: smsRes.status
            };
          } catch {
          }
        }
        await createNotification(
          user.id,
          "order",
          "\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u0997\u09C3\u09B9\u09C0\u09A4 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7",
          `\u0986\u09AA\u09A8\u09BE\u09B0 \u0985\u09B0\u09CD\u09A1\u09BE\u09B0 #${result.orderNumber} \u09A8\u09BF\u09B6\u09CD\u099A\u09BF\u09A4\u0995\u09B0\u09A3\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u09AA\u09CD\u09B0\u0995\u09CD\u09B0\u09BF\u09AF\u09BC\u09BE\u09A7\u09C0\u09A8 \u09B0\u09AF\u09BC\u09C7\u099B\u09C7\u0964`,
          "/profile"
        );
        const isMultiVendorOrder = result.sellerPayloads.length > 1;
        for (const sp of result.sellerPayloads) {
          const productPreview = sp.items.slice(0, 2).map((it) => `${it.productName} \xD7${it.quantity}`).join(", ");
          const extraMore = sp.items.length > 2 ? ` +\u0986\u09B0\u0993 ${sp.items.length - 2}\u099F\u09BF` : "";
          const phoneLabel = cleanBackupPhone ? `${cleanPhone} / ${cleanBackupPhone}` : cleanPhone;
          await createNotification(
            sp.sellerId,
            "order",
            `\u09A8\u09A4\u09C1\u09A8 \u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u098F\u09B8\u09C7\u099B\u09C7! #${result.orderNumber}`,
            `\u0995\u09CD\u09B0\u09C7\u09A4\u09BE: ${customerName.trim()} (${phoneLabel}) \xB7 ${thana.trim()}, ${district.trim()} \xB7 ${productPreview}${extraMore} \xB7 \u09AE\u09CB\u099F \u09F3${Math.round(sp.sellerSubtotal).toLocaleString("en-US")}`,
            `/seller/orders/${result.orderId}`
          );
          pushToUser(sp.sellerId, {
            type: "order:new",
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
              status: "Pending",
              createdAt: result.createdAt,
              updatedAt: result.createdAt,
              items: sp.items,
              phoneStats
            }
          });
        }
        res.status(201).json({
          orderId: result.orderId,
          orderNumber: result.orderNumber,
          subtotal: result.subtotal,
          deliveryFee: result.deliveryFee,
          totalAmount: result.totalAmount,
          smsNotification
        });
      } catch (err) {
        res.status(400).json({ error: err.message || "\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u0995\u09B0\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
      }
    })
  );
  app2.get(
    "/api/orders",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = req.user;
      const orders = await db.all(
        `SELECT * FROM orders WHERE buyerId = ? ORDER BY createdAt DESC`,
        user.id
      );
      const hydrated = await Promise.all(
        orders.map(async (o) => ({
          ...o,
          items: await db.all(`SELECT * FROM order_items WHERE orderId = ?`, o.id)
        }))
      );
      res.json({ orders: hydrated });
    })
  );
  app2.get(
    "/api/seller/overview",
    requireSeller,
    asyncHandler(async (req, res) => {
      const sellerId = req.user.id;
      const [prodStats, orderStats, unreadInbox] = await Promise.all([
        db.get(
          `SELECT COUNT(*) as totalProducts, COALESCE(SUM(views), 0) as totalViews FROM products WHERE sellerId = ?`,
          sellerId
        ),
        db.get(
          `SELECT COUNT(DISTINCT oi.orderId) as totalOrders,
                  COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN oi.price * oi.quantity ELSE 0 END), 0) as totalRevenue
           FROM order_items oi
           JOIN orders o ON o.id = oi.orderId
           WHERE oi.sellerId = ?`,
          sellerId
        ),
        db.get(
          `SELECT COALESCE(SUM(sellerUnread), 0) as cnt FROM conversations WHERE sellerId = ?`,
          sellerId
        )
      ]);
      res.json({
        totalProducts: Number(prodStats?.totalProducts || 0),
        totalViews: Number(prodStats?.totalViews || 0),
        totalOrders: Number(orderStats?.totalOrders || 0),
        totalRevenue: Number(orderStats?.totalRevenue || 0),
        unreadMessages: Number(unreadInbox?.cnt || 0)
      });
    })
  );
  app2.get(
    "/api/seller/products",
    requireSeller,
    asyncHandler(async (req, res) => {
      const rows = await db.all(
        `SELECT p.*, c.nameEn as categoryNameEn, c.nameBn as categoryNameBn
         FROM products p LEFT JOIN categories c ON c.id = p.categoryId
         WHERE p.sellerId = ?
         ORDER BY p.createdAt DESC`,
        req.user.id
      );
      res.json({ products: rows.map((r) => parseProductRow(r, { includePromoSecret: true })) });
    })
  );
  app2.post(
    "/api/seller/products",
    requireSeller,
    asyncHandler(async (req, res) => {
      const user = req.user;
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
        promoFontStyle
      } = req.body || {};
      if (!name || typeof name !== "string" || name.trim().length < 2) {
        res.status(400).json({ error: "\u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u09A8\u09BE\u09AE \u09B2\u09BF\u0996\u09C1\u09A8\u0964" });
        return;
      }
      const priceNum = Number(currentPrice);
      if (Number.isNaN(priceNum) || priceNum <= 0) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09AC\u09BF\u0995\u09CD\u09B0\u09AF\u09BC \u09AE\u09C2\u09B2\u09CD\u09AF \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      const prevNum = previousPrice !== void 0 && previousPrice !== null && previousPrice !== "" ? Number(previousPrice) : null;
      const stockNum = Math.max(0, parseInt(String(stock ?? 0), 10) || 0);
      const imgArray = Array.isArray(images) ? images.filter((u) => typeof u === "string" && u.trim()) : [];
      if (imgArray.length === 0) {
        res.status(400).json({ error: "\u0995\u09AE\u09AA\u0995\u09CD\u09B7\u09C7 \u098F\u0995\u099F\u09BF \u09AA\u09A3\u09CD\u09AF\u09C7\u09B0 \u099B\u09AC\u09BF \u09AF\u09CB\u0997 \u0995\u09B0\u09C1\u09A8\u0964" });
        return;
      }
      let finalPromoCode = null;
      let finalPromoDiscount = 0;
      let finalPromoFont = null;
      if (promoEnabled) {
        const disc = Number(promoDiscount);
        if (Number.isNaN(disc) || disc <= 0 || disc >= priceNum) {
          res.status(400).json({ error: "\u09AA\u09CD\u09B0\u09CB\u09AE\u09CB \u099B\u09BE\u09DC\u09C7\u09B0 \u09AA\u09B0\u09BF\u09AE\u09BE\u09A3 \u09E7 \u099F\u09BE\u0995\u09BE \u09A5\u09C7\u0995\u09C7 \u09AC\u09BF\u0995\u09CD\u09B0\u09AF\u09BC \u09AE\u09C2\u09B2\u09CD\u09AF\u09C7\u09B0 \u0995\u09AE \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7\u0964" });
          return;
        }
        finalPromoDiscount = Math.round(disc);
        const reqCode = typeof promoCode === "string" ? promoCode.trim() : "";
        finalPromoCode = /^[A-Za-z0-9]{7}$/.test(reqCode) ? reqCode : generatePromoCode7();
        finalPromoFont = typeof promoFontStyle === "string" && PROMO_FONT_STYLES.includes(promoFontStyle) ? promoFontStyle : PROMO_FONT_STYLES[crypto5.randomInt(0, PROMO_FONT_STYLES.length)];
      }
      const id = `prod-${crypto5.randomUUID()}`;
      const slugBase = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product";
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
        typeof shopName === "string" && shopName.trim() || user.shopName || user.fullName,
        name.trim(),
        typeof description === "string" ? description.trim() : "",
        String(categoryId || "cat-other"),
        String(subcategory || "Other Products"),
        prevNum,
        priceNum,
        stockNum,
        JSON.stringify(imgArray),
        JSON.stringify(variations && typeof variations === "object" ? variations : {}),
        finalPromoCode,
        finalPromoDiscount,
        finalPromoFont,
        now
      );
      const created = await db.get(`SELECT * FROM products WHERE id = ?`, id);
      res.status(201).json({ product: parseProductRow(created, { includePromoSecret: true }) });
    })
  );
  app2.put(
    "/api/seller/products/:id",
    requireSeller,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const existing = await db.get(`SELECT * FROM products WHERE id = ?`, id);
      if (!existing) {
        res.status(404).json({ error: "\u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      if (existing.sellerId !== req.user.id && req.user.role !== "admin") {
        res.status(403).json({ error: "\u0986\u09AA\u09A8\u09BF \u098F\u0987 \u09AA\u09A3\u09CD\u09AF \u09B8\u09AE\u09CD\u09AA\u09BE\u09A6\u09A8\u09BE \u0995\u09B0\u09A4\u09C7 \u09AA\u09BE\u09B0\u09AC\u09C7\u09A8 \u09A8\u09BE\u0964" });
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
        promoFontStyle
      } = req.body || {};
      const nextName = typeof name === "string" && name.trim() ? name.trim() : existing.name;
      const nextShopName = typeof shopName === "string" && shopName.trim() ? shopName.trim() : existing.shopName;
      const nextDesc = typeof description === "string" ? description.trim() : existing.description;
      const nextCat = typeof categoryId === "string" ? categoryId : existing.categoryId;
      const nextSub = typeof subcategory === "string" ? subcategory : existing.subcategory;
      const nextPrice = currentPrice !== void 0 ? Number(currentPrice) : existing.currentPrice;
      const nextPrev = previousPrice === "" || previousPrice === null ? null : previousPrice !== void 0 ? Number(previousPrice) : existing.previousPrice;
      const nextStock = stock !== void 0 ? Math.max(0, parseInt(String(stock), 10) || 0) : existing.stock;
      const nextImages = Array.isArray(images) && images.length > 0 ? JSON.stringify(images) : existing.images;
      const nextVars = variations ? JSON.stringify(variations) : existing.variations;
      let nextPromoCode = existing.promoCode || null;
      let nextPromoDiscount = Number(existing.promoDiscount || 0);
      let nextPromoFont = existing.promoFontStyle || null;
      if (promoEnabled === false) {
        nextPromoCode = null;
        nextPromoDiscount = 0;
        nextPromoFont = null;
      } else if (promoEnabled === true) {
        const disc = Number(promoDiscount);
        if (Number.isNaN(disc) || disc <= 0 || disc >= nextPrice) {
          res.status(400).json({ error: "\u09AA\u09CD\u09B0\u09CB\u09AE\u09CB \u099B\u09BE\u09DC\u09C7\u09B0 \u09AA\u09B0\u09BF\u09AE\u09BE\u09A3 \u09E7 \u099F\u09BE\u0995\u09BE \u09A5\u09C7\u0995\u09C7 \u09AC\u09BF\u0995\u09CD\u09B0\u09AF\u09BC \u09AE\u09C2\u09B2\u09CD\u09AF\u09C7\u09B0 \u0995\u09AE \u09B9\u09A4\u09C7 \u09B9\u09AC\u09C7\u0964" });
          return;
        }
        nextPromoDiscount = Math.round(disc);
        const reqCode = typeof promoCode === "string" ? promoCode.trim() : "";
        nextPromoCode = /^[A-Za-z0-9]{7}$/.test(reqCode) ? reqCode : existing.promoCode && /^[A-Za-z0-9]{7}$/.test(String(existing.promoCode)) ? existing.promoCode : generatePromoCode7();
        nextPromoFont = typeof promoFontStyle === "string" && PROMO_FONT_STYLES.includes(promoFontStyle) ? promoFontStyle : existing.promoFontStyle || PROMO_FONT_STYLES[crypto5.randomInt(0, PROMO_FONT_STYLES.length)];
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
          const oldImages = JSON.parse(existing.images || "[]");
          const nextSet = new Set(images);
          const removed = oldImages.filter((u) => !nextSet.has(u));
          if (removed.length > 0) await cleanupOrphanedMedia(removed);
        } catch {
        }
      }
      const updated = await db.get(`SELECT * FROM products WHERE id = ?`, id);
      res.json({ product: parseProductRow(updated, { includePromoSecret: true }) });
    })
  );
  app2.delete(
    "/api/seller/products/:id",
    requireSeller,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const existing = await db.get(
        `SELECT sellerId, images FROM products WHERE id = ?`,
        id
      );
      if (!existing) {
        res.status(404).json({ error: "\u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      if (existing.sellerId !== req.user.id && req.user.role !== "admin") {
        res.status(403).json({ error: "\u0986\u09AA\u09A8\u09BF \u098F\u0987 \u09AA\u09A3\u09CD\u09AF \u09AE\u09C1\u099B\u09A4\u09C7 \u09AA\u09BE\u09B0\u09AC\u09C7\u09A8 \u09A8\u09BE\u0964" });
        return;
      }
      await db.run(`DELETE FROM products WHERE id = ?`, id);
      try {
        await cleanupOrphanedMedia(JSON.parse(existing.images || "[]"));
      } catch {
      }
      res.json({ message: "\u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.get(
    "/api/seller/orders",
    requireSeller,
    asyncHandler(async (req, res) => {
      const sellerId = req.user.id;
      const orders = await db.all(
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
            db.all(`SELECT * FROM order_items WHERE orderId = ? AND sellerId = ?`, o.id, sellerId),
            db.get(`SELECT COUNT(*) as cnt FROM order_items WHERE orderId = ?`, o.id)
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
            phoneStats: phoneStatsMap.get(o.id)
          };
        })
      );
      res.json({ orders: hydrated });
    })
  );
  app2.post(
    "/api/seller/orders/:orderId/conversation",
    requireSeller,
    asyncHandler(async (req, res) => {
      const { orderId } = req.params;
      const sellerId = req.user.id;
      const ownedItem = await db.get(
        `SELECT * FROM order_items WHERE orderId = ? AND sellerId = ? LIMIT 1`,
        orderId,
        sellerId
      );
      if (!ownedItem) {
        res.status(403).json({ error: "\u098F\u0987 \u0985\u09B0\u09CD\u09A1\u09BE\u09B0\u09C7\u09B0 \u0995\u09CD\u09B0\u09C7\u09A4\u09BE\u09B0 \u09B8\u09BE\u09A5\u09C7 \u099A\u09CD\u09AF\u09BE\u099F \u0995\u09B0\u09BE\u09B0 \u0985\u09A8\u09C1\u09AE\u09A4\u09BF \u09A8\u09C7\u0987\u0964" });
        return;
      }
      const order = await db.get(
        `SELECT id, buyerId, orderNumber FROM orders WHERE id = ?`,
        orderId
      );
      if (!order) {
        res.status(404).json({ error: "\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      if (order.buyerId === sellerId) {
        res.status(400).json({ error: "\u09A8\u09BF\u099C\u09C7\u09B0 \u09B8\u09BE\u09A5\u09C7 \u099A\u09CD\u09AF\u09BE\u099F \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09BE \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE\u0964" });
        return;
      }
      const existing = await db.get(
        `SELECT * FROM conversations WHERE buyerId = ? AND sellerId = ? AND COALESCE(productId, '') = ? LIMIT 1`,
        order.buyerId,
        sellerId,
        ownedItem.productId || ""
      );
      if (existing) {
        res.json({ conversation: existing });
        return;
      }
      const anyConv = await db.get(
        `SELECT * FROM conversations WHERE buyerId = ? AND sellerId = ? ORDER BY lastMessageAt DESC LIMIT 1`,
        order.buyerId,
        sellerId
      );
      if (anyConv) {
        res.json({ conversation: anyConv });
        return;
      }
      const id = `conv-${crypto5.randomUUID()}`;
      const now = Date.now();
      await db.run(
        `INSERT INTO conversations (id, buyerId, sellerId, productId, productName, productImage, productPrice, lastMessage, lastMessageAt, buyerUnread, sellerUnread)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        id,
        order.buyerId,
        sellerId,
        ownedItem.productId || null,
        ownedItem.productName || `\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 #${order.orderNumber}`,
        ownedItem.productImage || null,
        ownedItem.price || null,
        `\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 #${order.orderNumber} \u09B8\u0982\u0995\u09CD\u09B0\u09BE\u09A8\u09CD\u09A4 \u09AF\u09CB\u0997\u09BE\u09AF\u09CB\u0997`,
        now
      );
      const created = await db.get(`SELECT * FROM conversations WHERE id = ?`, id);
      res.status(201).json({ conversation: created });
    })
  );
  app2.patch(
    "/api/seller/orders/:orderId/status",
    requireSeller,
    asyncHandler(async (req, res) => {
      const { orderId } = req.params;
      const { status } = req.body || {};
      const validStatuses = /* @__PURE__ */ new Set(["Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled"]);
      if (!validStatuses.has(status)) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u099F\u09BE\u09B8 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      const ownsItem = await db.get(
        `SELECT id FROM order_items WHERE orderId = ? AND sellerId = ? LIMIT 1`,
        orderId,
        req.user.id
      );
      if (!ownsItem && req.user.role !== "admin") {
        res.status(403).json({ error: "\u098F\u0987 \u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8 \u0995\u09B0\u09BE\u09B0 \u0985\u09A8\u09C1\u09AE\u09A4\u09BF \u09A8\u09C7\u0987\u0964" });
        return;
      }
      const order = await db.get(`SELECT * FROM orders WHERE id = ?`, orderId);
      if (!order) {
        res.status(404).json({ error: "\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      await db.transaction(async (tx) => {
        if (order.status !== "Cancelled" && status === "Cancelled") {
          const sellerItems = await tx.all(
            `SELECT productId, quantity FROM order_items WHERE orderId = ? AND sellerId = ? AND itemStatus != 'Cancelled'`,
            orderId,
            req.user.id
          );
          for (const it of sellerItems) {
            await tx.run(`UPDATE products SET stock = stock + ? WHERE id = ?`, Number(it.quantity || 0), it.productId);
          }
        }
        await tx.run(
          `UPDATE order_items SET itemStatus = ? WHERE orderId = ? AND sellerId = ?`,
          status,
          orderId,
          req.user.id
        );
        await tx.run(`UPDATE orders SET status = ?, updatedAt = ? WHERE id = ?`, status, Date.now(), orderId);
      });
      await createNotification(
        order.buyerId,
        "order",
        "\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u099F\u09BE\u09B8 \u0986\u09AA\u09A1\u09C7\u099F",
        `\u0986\u09AA\u09A8\u09BE\u09B0 \u0985\u09B0\u09CD\u09A1\u09BE\u09B0 #${order.orderNumber} \u098F\u09B0 \u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u0985\u09AC\u09B8\u09CD\u09A5\u09BE: ${status}`,
        "/profile"
      );
      pushToUser(order.buyerId, { type: "order:updated", orderId, status });
      pushToUser(req.user.id, { type: "order:updated", orderId, status });
      res.json({ message: "\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u099F\u09BE\u09B8 \u0986\u09AA\u09A1\u09C7\u099F \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.get(
    "/api/conversations",
    requireAuth,
    asyncHandler(async (req, res) => {
      const uid = req.user.id;
      const rows = await db.all(
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
  app2.post(
    "/api/conversations",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = req.user;
      const { sellerId, productId } = req.body || {};
      if (!sellerId || typeof sellerId !== "string") {
        res.status(400).json({ error: "\u09B8\u09C7\u09B2\u09BE\u09B0 \u09A4\u09A5\u09CD\u09AF \u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u099C\u09A8\u0964" });
        return;
      }
      if (sellerId === user.id) {
        res.status(400).json({ error: "\u09A8\u09BF\u099C\u09C7\u09B0 \u09B8\u09BE\u09A5\u09C7 \u099A\u09CD\u09AF\u09BE\u099F \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09BE \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE\u0964" });
        return;
      }
      const seller = await db.get(
        `SELECT id, role FROM users WHERE id = ?`,
        sellerId
      );
      if (!seller) {
        res.status(404).json({ error: "\u09B8\u09C7\u09B2\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      const existing = await db.get(
        `SELECT * FROM conversations WHERE buyerId = ? AND sellerId = ? AND COALESCE(productId, '') = ? LIMIT 1`,
        user.id,
        sellerId,
        productId || ""
      );
      if (existing) {
        res.json({ conversation: existing });
        return;
      }
      let prodName = null;
      let prodImg = null;
      let prodPrice = null;
      if (productId) {
        const prod = await db.get(`SELECT name, images, currentPrice FROM products WHERE id = ?`, productId);
        if (prod) {
          prodName = prod.name;
          const imgs = JSON.parse(prod.images || "[]");
          prodImg = imgs[0] || null;
          prodPrice = prod.currentPrice;
        }
      }
      const id = `conv-${crypto5.randomUUID()}`;
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
  app2.get(
    "/api/conversations/:id/messages",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const user = req.user;
      const conv = await db.get(`SELECT * FROM conversations WHERE id = ?`, id);
      if (!conv) {
        res.status(404).json({ error: "\u0995\u09A5\u09CB\u09AA\u0995\u09A5\u09A8 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      if (conv.buyerId !== user.id && conv.sellerId !== user.id && user.role !== "admin") {
        res.status(403).json({ error: "\u098F\u0987 \u09AE\u09C7\u09B8\u09C7\u099C \u09A6\u09C7\u0996\u09BE\u09B0 \u0985\u09A8\u09C1\u09AE\u09A4\u09BF \u09A8\u09C7\u0987\u0964" });
        return;
      }
      if (conv.buyerId === user.id) {
        await db.run(`UPDATE conversations SET buyerUnread = 0 WHERE id = ?`, id);
      } else if (conv.sellerId === user.id) {
        await db.run(`UPDATE conversations SET sellerUnread = 0 WHERE id = ?`, id);
      }
      const messages = await db.all(
        `SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC`,
        id
      );
      res.json({ conversation: conv, messages });
    })
  );
  app2.post(
    "/api/conversations/:id/messages",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const user = req.user;
      const { text } = req.body || {};
      if (!text || typeof text !== "string" || !text.trim()) {
        res.status(400).json({ error: "\u09AC\u09BE\u09B0\u09CD\u09A4\u09BE \u09B2\u09BF\u0996\u09C1\u09A8\u0964" });
        return;
      }
      const conv = await db.get(`SELECT * FROM conversations WHERE id = ?`, id);
      if (!conv) {
        res.status(404).json({ error: "\u0995\u09A5\u09CB\u09AA\u0995\u09A5\u09A8 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      if (conv.buyerId !== user.id && conv.sellerId !== user.id) {
        res.status(403).json({ error: "\u09AE\u09C7\u09B8\u09C7\u099C \u09AA\u09BE\u09A0\u09BE\u09A8\u09CB\u09B0 \u0985\u09A8\u09C1\u09AE\u09A4\u09BF \u09A8\u09C7\u0987\u0964" });
        return;
      }
      const cleanText = text.trim().slice(0, 2e3);
      const msgId = `msg-${crypto5.randomUUID()}`;
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
      pushToUser(recipientId, { type: "message:new", conversationId: id, message });
      pushToUser(user.id, { type: "message:new", conversationId: id, message });
      await createNotification(
        recipientId,
        "message",
        `${user.shopName || user.fullName} \u09A5\u09C7\u0995\u09C7 \u09A8\u09A4\u09C1\u09A8 \u09AE\u09C7\u09B8\u09C7\u099C`,
        cleanText.slice(0, 80),
        "/inbox"
      );
      res.status(201).json({ message });
    })
  );
  app2.get(
    "/api/notifications",
    requireAuth,
    asyncHandler(async (req, res) => {
      const rows = await db.all(
        `SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 50`,
        req.user.id
      );
      res.json({ notifications: rows });
    })
  );
  app2.post(
    "/api/notifications/read-all",
    requireAuth,
    asyncHandler(async (req, res) => {
      await db.run(`UPDATE notifications SET isRead = 1 WHERE userId = ?`, req.user.id);
      res.json({ ok: true });
    })
  );
  app2.patch(
    "/api/notifications/:id/read",
    requireAuth,
    asyncHandler(async (req, res) => {
      await db.run(
        `UPDATE notifications SET isRead = 1 WHERE id = ? AND userId = ?`,
        req.params.id,
        req.user.id
      );
      res.json({ ok: true });
    })
  );
  async function fetchAdminOverview() {
    const [uRow, bRow, sRow, pRow, oRow, mRow, rRow, revRow] = await Promise.all([
      db.get(`SELECT COUNT(*) as c FROM users WHERE role != 'admin'`),
      db.get(`SELECT COUNT(*) as c FROM users WHERE role = 'buyer'`),
      db.get(`SELECT COUNT(*) as c FROM users WHERE role = 'seller'`),
      db.get(`SELECT COUNT(*) as c FROM products`),
      db.get(`SELECT COUNT(*) as c FROM orders`),
      db.get(`SELECT COUNT(*) as c FROM messages`),
      db.get(`SELECT COUNT(*) as c FROM reports WHERE status = 'Open'`),
      db.get(`SELECT COALESCE(SUM(totalAmount), 0) as s FROM orders WHERE status != 'Cancelled'`)
    ]);
    return {
      totalUsers: Number(uRow?.c || 0),
      totalBuyers: Number(bRow?.c || 0),
      totalSellers: Number(sRow?.c || 0),
      totalProducts: Number(pRow?.c || 0),
      totalOrders: Number(oRow?.c || 0),
      totalMessages: Number(mRow?.c || 0),
      openReports: Number(rRow?.c || 0),
      totalRevenue: Number(revRow?.s || 0)
    };
  }
  app2.get(
    "/api/admin/bootstrap",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const [overview, users, prodRows, rawOrders, rawProductAds, ads, reports, conversations] = await Promise.all([
        fetchAdminOverview(),
        db.all(
          `SELECT id, fullName, username, emailOrPhone, role, shopName, shopDescription, avatarUrl, status, createdAt
           FROM users ORDER BY createdAt DESC`
        ),
        db.all(
          `SELECT p.*, c.nameEn as categoryNameEn, c.nameBn as categoryNameBn
           FROM products p LEFT JOIN categories c ON c.id = p.categoryId
           ORDER BY p.createdAt DESC`
        ),
        db.all(`SELECT * FROM orders ORDER BY createdAt DESC`),
        db.all(
          `SELECT a.*, p.name as productName, p.currentPrice, p.images, p.shopName
           FROM homepage_product_ads a
           JOIN products p ON p.id = a.productId
           ORDER BY a.sortOrder ASC, a.createdAt DESC`
        ),
        db.all(`SELECT * FROM advertisements ORDER BY createdAt DESC`),
        db.all(`SELECT * FROM reports ORDER BY createdAt DESC`),
        db.all(
          `SELECT c.*, b.fullName as buyerName, s.shopName as sellerShopName, s.fullName as sellerName
           FROM conversations c
           JOIN users b ON b.id = c.buyerId
           JOIN users s ON s.id = c.sellerId
           ORDER BY c.lastMessageAt DESC LIMIT 100`
        )
      ]);
      const phoneStatsMap = await computePhoneOrderStatsMap(rawOrders);
      const orders = await Promise.all(
        rawOrders.map(async (o) => ({
          ...o,
          items: await db.all(`SELECT * FROM order_items WHERE orderId = ?`, o.id),
          phoneStats: phoneStatsMap.get(o.id)
        }))
      );
      res.json({
        overview,
        users,
        products: prodRows.map((r) => parseProductRow(r, { includePromoSecret: true })),
        orders,
        productAds: rawProductAds.map((r) => ({ ...r, images: JSON.parse(r.images || "[]"), isActive: Boolean(r.isActive) })),
        ads,
        reports,
        conversations,
        storageStatus: {
          isRemote: db.isRemote,
          isServerless: isServerlessEnv,
          dbMode: db.mode
        }
      });
    })
  );
  app2.get(
    "/api/admin/overview",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      res.json(await fetchAdminOverview());
    })
  );
  app2.get(
    "/api/admin/users",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const users = await db.all(
        `SELECT id, fullName, username, emailOrPhone, role, shopName, shopDescription, avatarUrl, status, createdAt
         FROM users ORDER BY createdAt DESC`
      );
      res.json({ users });
    })
  );
  app2.patch(
    "/api/admin/users/:id/status",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { status } = req.body || {};
      if (!["active", "blocked", "suspended"].includes(status)) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u099F\u09BE\u09B8 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      if (id === req.user.id) {
        res.status(400).json({ error: "\u09A8\u09BF\u099C\u09C7\u09B0 \u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F \u09AC\u09CD\u09B2\u0995 \u0995\u09B0\u09BE \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE\u0964" });
        return;
      }
      await db.run(`UPDATE users SET status = ? WHERE id = ?`, status, id);
      res.json({ message: "\u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0\u0995\u09BE\u09B0\u09C0\u09B0 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u099F\u09BE\u09B8 \u0986\u09AA\u09A1\u09C7\u099F \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.delete(
    "/api/admin/users/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      if (id === req.user.id) {
        res.status(400).json({ error: "\u09A8\u09BF\u099C\u09C7\u09B0 \u0985\u09CD\u09AF\u09BE\u09A1\u09AE\u09BF\u09A8 \u0985\u09CD\u09AF\u09BE\u0995\u09BE\u0989\u09A8\u09CD\u099F \u09AE\u09C1\u099B\u09BE \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE\u0964" });
        return;
      }
      await db.run(`DELETE FROM users WHERE id = ?`, id);
      res.json({ message: "\u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0\u0995\u09BE\u09B0\u09C0 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.get(
    "/api/admin/products",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const rows = await db.all(
        `SELECT p.*, c.nameEn as categoryNameEn, c.nameBn as categoryNameBn
         FROM products p LEFT JOIN categories c ON c.id = p.categoryId
         ORDER BY p.createdAt DESC`
      );
      res.json({ products: rows.map((r) => parseProductRow(r, { includePromoSecret: true })) });
    })
  );
  app2.patch(
    "/api/admin/products/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const existing = await db.get(`SELECT * FROM products WHERE id = ?`, id);
      if (!existing) {
        res.status(404).json({ error: "\u09AA\u09A3\u09CD\u09AF \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      const { isHidden, isFeatured, isTrending, isRecommended, name, currentPrice, previousPrice, stock, categoryId, subcategory } = req.body || {};
      await db.run(
        `UPDATE products
         SET isHidden = ?, isFeatured = ?, isTrending = ?, isRecommended = ?,
             name = ?, currentPrice = ?, previousPrice = ?, stock = ?, categoryId = ?, subcategory = ?
         WHERE id = ?`,
        isHidden !== void 0 ? isHidden ? 1 : 0 : existing.isHidden,
        isFeatured !== void 0 ? isFeatured ? 1 : 0 : existing.isFeatured,
        isTrending !== void 0 ? isTrending ? 1 : 0 : existing.isTrending,
        isRecommended !== void 0 ? isRecommended ? 1 : 0 : existing.isRecommended,
        typeof name === "string" && name.trim() ? name.trim() : existing.name,
        currentPrice !== void 0 ? Number(currentPrice) : existing.currentPrice,
        previousPrice !== void 0 ? previousPrice === null || previousPrice === "" ? null : Number(previousPrice) : existing.previousPrice,
        stock !== void 0 ? Number(stock) : existing.stock,
        typeof categoryId === "string" ? categoryId : existing.categoryId,
        typeof subcategory === "string" ? subcategory : existing.subcategory,
        id
      );
      res.json({ product: parseProductRow(await db.get(`SELECT * FROM products WHERE id = ?`, id), { includePromoSecret: true }) });
    })
  );
  app2.delete(
    "/api/admin/products/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const existing = await db.get(`SELECT images FROM products WHERE id = ?`, req.params.id);
      await db.run(`DELETE FROM products WHERE id = ?`, req.params.id);
      if (existing?.images) {
        try {
          await cleanupOrphanedMedia(JSON.parse(existing.images || "[]"));
        } catch {
        }
      }
      res.json({ message: "\u09AA\u09A3\u09CD\u09AF\u099F\u09BF \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.post(
    "/api/admin/categories",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { nameEn, nameBn, imageUrl, subcategories, sortOrder } = req.body || {};
      if (!nameEn || !nameBn) {
        res.status(400).json({ error: "\u0995\u09CD\u09AF\u09BE\u099F\u09BE\u0997\u09B0\u09BF\u09B0 \u09A8\u09BE\u09AE \u09B2\u09BF\u0996\u09C1\u09A8\u0964" });
        return;
      }
      const id = `cat-${crypto5.randomUUID().slice(0, 8)}`;
      const slug = String(nameEn).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + id.slice(-4);
      await db.run(
        `INSERT INTO categories (id, nameEn, nameBn, slug, imageUrl, subcategories, sortOrder)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        String(nameEn).trim(),
        String(nameBn).trim(),
        slug,
        String(imageUrl || "/src/assets/images/cat_baby_gifts_1795274484045.jpg"),
        JSON.stringify(Array.isArray(subcategories) ? subcategories : []),
        Number(sortOrder) || 99
      );
      res.status(201).json({ message: "\u0995\u09CD\u09AF\u09BE\u099F\u09BE\u0997\u09B0\u09BF \u09AF\u09CB\u0997 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.put(
    "/api/admin/categories/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { nameEn, nameBn, imageUrl, subcategories, sortOrder } = req.body || {};
      const existing = await db.get(`SELECT * FROM categories WHERE id = ?`, id);
      if (!existing) {
        res.status(404).json({ error: "\u0995\u09CD\u09AF\u09BE\u099F\u09BE\u0997\u09B0\u09BF \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      const nextImg = imageUrl ? String(imageUrl).trim() : existing.imageUrl;
      await db.run(
        `UPDATE categories SET nameEn = ?, nameBn = ?, imageUrl = ?, subcategories = ?, sortOrder = ? WHERE id = ?`,
        nameEn ? String(nameEn).trim() : existing.nameEn,
        nameBn ? String(nameBn).trim() : existing.nameBn,
        nextImg,
        Array.isArray(subcategories) ? JSON.stringify(subcategories) : existing.subcategories,
        sortOrder !== void 0 ? Number(sortOrder) : existing.sortOrder,
        id
      );
      if (existing.imageUrl && existing.imageUrl !== nextImg) {
        try {
          await cleanupOrphanedMedia([existing.imageUrl]);
        } catch {
        }
      }
      res.json({ message: "\u0995\u09CD\u09AF\u09BE\u099F\u09BE\u0997\u09B0\u09BF \u0986\u09AA\u09A1\u09C7\u099F \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.delete(
    "/api/admin/categories/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const existing = await db.get(`SELECT imageUrl FROM categories WHERE id = ?`, req.params.id);
      await db.run(`DELETE FROM categories WHERE id = ?`, req.params.id);
      if (existing?.imageUrl) {
        try {
          await cleanupOrphanedMedia([existing.imageUrl]);
        } catch {
        }
      }
      res.json({ message: "\u0995\u09CD\u09AF\u09BE\u099F\u09BE\u0997\u09B0\u09BF \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.get(
    "/api/admin/orders",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const orders = await db.all(`SELECT * FROM orders ORDER BY createdAt DESC`);
      const phoneStatsMap = await computePhoneOrderStatsMap(orders);
      const hydrated = await Promise.all(
        orders.map(async (o) => ({
          ...o,
          items: await db.all(`SELECT * FROM order_items WHERE orderId = ?`, o.id),
          phoneStats: phoneStatsMap.get(o.id)
        }))
      );
      res.json({ orders: hydrated });
    })
  );
  app2.patch(
    "/api/admin/orders/:id/status",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { status } = req.body || {};
      if (!["Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled"].includes(status)) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u099F\u09BE\u09B8 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      const order = await db.get(`SELECT * FROM orders WHERE id = ?`, id);
      if (!order) {
        res.status(404).json({ error: "\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      await db.transaction(async (tx) => {
        if (order.status !== "Cancelled" && status === "Cancelled") {
          const items = await tx.all(
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
        "order",
        "\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u099F\u09BE\u09B8 \u0986\u09AA\u09A1\u09C7\u099F (Admin)",
        `\u0986\u09AA\u09A8\u09BE\u09B0 \u0985\u09B0\u09CD\u09A1\u09BE\u09B0 #${order.orderNumber} \u098F\u09B0 \u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u0985\u09AC\u09B8\u09CD\u09A5\u09BE: ${status}`,
        "/profile"
      );
      pushToUser(order.buyerId, { type: "order:updated", orderId: id, status });
      res.json({ message: "\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u099F\u09BE\u09B8 \u0986\u09AA\u09A1\u09C7\u099F \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.get(
    "/api/admin/product-ads",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const rows = await db.all(
        `SELECT a.*, p.name as productName, p.currentPrice, p.images, p.shopName
         FROM homepage_product_ads a
         JOIN products p ON p.id = a.productId
         ORDER BY a.sortOrder ASC, a.createdAt DESC`
      );
      res.json({
        productAds: rows.map((r) => ({ ...r, images: JSON.parse(r.images || "[]"), isActive: Boolean(r.isActive) }))
      });
    })
  );
  app2.post(
    "/api/admin/product-ads",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { productId, promoText, customImageUrl, sortOrder, durationDays } = req.body || {};
      const prod = await db.get(`SELECT id FROM products WHERE id = ?`, productId);
      if (!prod) {
        res.status(404).json({ error: "\u09AA\u09A3\u09CD\u09AF \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      const id = `hpad-${crypto5.randomUUID().slice(0, 8)}`;
      const expiresAt = durationDays && Number(durationDays) > 0 ? Date.now() + Number(durationDays) * 864e5 : null;
      await db.run(
        `INSERT INTO homepage_product_ads (id, productId, promoText, customImageUrl, sortOrder, isActive, expiresAt, createdAt)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        id,
        productId,
        typeof promoText === "string" ? promoText.trim() : null,
        typeof customImageUrl === "string" && customImageUrl.trim() ? customImageUrl.trim() : null,
        Number(sortOrder) || 1,
        expiresAt,
        Date.now()
      );
      res.status(201).json({ message: "\u09B9\u09CB\u09AE\u09AA\u09C7\u099C Product Ad \u09AF\u09C1\u0995\u09CD\u09A4 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.put(
    "/api/admin/product-ads/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const existing = await db.get(`SELECT * FROM homepage_product_ads WHERE id = ?`, id);
      if (!existing) {
        res.status(404).json({ error: "Product Ad \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      const { promoText, customImageUrl, sortOrder, isActive, durationDays } = req.body || {};
      const expiresAt = durationDays === 0 ? null : durationDays && Number(durationDays) > 0 ? Date.now() + Number(durationDays) * 864e5 : existing.expiresAt;
      await db.run(
        `UPDATE homepage_product_ads
         SET promoText = ?, customImageUrl = ?, sortOrder = ?, isActive = ?, expiresAt = ?
         WHERE id = ?`,
        promoText !== void 0 ? promoText ? String(promoText).trim() : null : existing.promoText,
        customImageUrl !== void 0 ? customImageUrl ? String(customImageUrl).trim() : null : existing.customImageUrl,
        sortOrder !== void 0 ? Number(sortOrder) : existing.sortOrder,
        isActive !== void 0 ? isActive ? 1 : 0 : existing.isActive,
        expiresAt,
        id
      );
      res.json({ message: "Product Ad \u0986\u09AA\u09A1\u09C7\u099F \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.delete(
    "/api/admin/product-ads/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      await db.run(`DELETE FROM homepage_product_ads WHERE id = ?`, req.params.id);
      res.json({ message: "Product Ad \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.get(
    "/api/admin/ads",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const ads = await db.all(`SELECT * FROM advertisements ORDER BY createdAt DESC`);
      res.json({ ads });
    })
  );
  app2.post(
    "/api/admin/ads",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { title, placement, adType, imageUrl, targetUrl, htmlCode, jsCode } = req.body || {};
      if (!title || !placement || !adType) {
        res.status(400).json({ error: "\u09AC\u09BF\u099C\u09CD\u099E\u09BE\u09AA\u09A8\u09C7\u09B0 \u09B6\u09BF\u09B0\u09CB\u09A8\u09BE\u09AE, \u09B8\u09CD\u09A5\u09BE\u09A8 \u0993 \u09A7\u09B0\u09A8 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      const id = `ad-${crypto5.randomUUID().slice(0, 8)}`;
      await db.run(
        `INSERT INTO advertisements (id, title, placement, adType, imageUrl, targetUrl, htmlCode, jsCode, isActive, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        id,
        String(title).trim(),
        placement,
        adType,
        typeof imageUrl === "string" && imageUrl.trim() ? imageUrl.trim() : null,
        safeUrl(targetUrl),
        typeof htmlCode === "string" ? htmlCode : null,
        typeof jsCode === "string" ? jsCode : null,
        Date.now()
      );
      res.status(201).json({ message: "\u09AC\u09BF\u099C\u09CD\u099E\u09BE\u09AA\u09A8 \u09A4\u09C8\u09B0\u09BF \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.put(
    "/api/admin/ads/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const existing = await db.get(`SELECT * FROM advertisements WHERE id = ?`, id);
      if (!existing) {
        res.status(404).json({ error: "\u09AC\u09BF\u099C\u09CD\u099E\u09BE\u09AA\u09A8 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964" });
        return;
      }
      const { title, placement, adType, imageUrl, targetUrl, htmlCode, jsCode, isActive } = req.body || {};
      const nextImg = imageUrl !== void 0 ? imageUrl ? String(imageUrl).trim() : null : existing.imageUrl;
      await db.run(
        `UPDATE advertisements
         SET title = ?, placement = ?, adType = ?, imageUrl = ?, targetUrl = ?, htmlCode = ?, jsCode = ?, isActive = ?
         WHERE id = ?`,
        title !== void 0 ? String(title).trim() : existing.title,
        placement || existing.placement,
        adType || existing.adType,
        nextImg,
        targetUrl !== void 0 ? safeUrl(targetUrl) : existing.targetUrl,
        htmlCode !== void 0 ? htmlCode : existing.htmlCode,
        jsCode !== void 0 ? jsCode : existing.jsCode,
        isActive !== void 0 ? isActive ? 1 : 0 : existing.isActive,
        id
      );
      if (existing.imageUrl && existing.imageUrl !== nextImg) {
        try {
          await cleanupOrphanedMedia([existing.imageUrl]);
        } catch {
        }
      }
      res.json({ message: "\u09AC\u09BF\u099C\u09CD\u099E\u09BE\u09AA\u09A8 \u0986\u09AA\u09A1\u09C7\u099F \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.delete(
    "/api/admin/ads/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const existing = await db.get(`SELECT imageUrl FROM advertisements WHERE id = ?`, req.params.id);
      await db.run(`DELETE FROM advertisements WHERE id = ?`, req.params.id);
      if (existing?.imageUrl) {
        try {
          await cleanupOrphanedMedia([existing.imageUrl]);
        } catch {
        }
      }
      res.json({ message: "\u09AC\u09BF\u099C\u09CD\u099E\u09BE\u09AA\u09A8 \u09AE\u09C1\u099B\u09C7 \u09AB\u09C7\u09B2\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.get(
    "/api/admin/reports",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const reports = await db.all(`SELECT * FROM reports ORDER BY createdAt DESC`);
      res.json({ reports });
    })
  );
  app2.patch(
    "/api/admin/reports/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { status } = req.body || {};
      if (!["Open", "Resolved", "Dismissed"].includes(status)) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u099F\u09BE\u09B8 \u09A6\u09BF\u09A8\u0964" });
        return;
      }
      await db.run(`UPDATE reports SET status = ? WHERE id = ?`, status, req.params.id);
      res.json({ message: "\u09B0\u09BF\u09AA\u09CB\u09B0\u09CD\u099F \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u099F\u09BE\u09B8 \u0986\u09AA\u09A1\u09C7\u099F \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.get(
    "/api/admin/messages",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const conversations = await db.all(
        `SELECT c.*, b.fullName as buyerName, s.shopName as sellerShopName, s.fullName as sellerName
         FROM conversations c
         JOIN users b ON b.id = c.buyerId
         JOIN users s ON s.id = c.sellerId
         ORDER BY c.lastMessageAt DESC LIMIT 100`
      );
      res.json({ conversations });
    })
  );
  app2.get(
    "/api/admin/sms-settings",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const cfg = await getSmsGatewayConfig();
      const maskSecret = (val) => val ? `${val.slice(0, 3)}\u2022\u2022\u2022\u2022${val.slice(-3)}` : "";
      res.json({
        provider: cfg.provider,
        senderName: cfg.senderName || "Orvexa",
        autoOrderSmsEnabled: cfg.autoOrderSmsEnabled,
        hasApiKey: Boolean(cfg.apiKey),
        maskedApiKey: maskSecret(cfg.apiKey),
        hasApiSecret: Boolean(cfg.apiSecret),
        maskedApiSecret: maskSecret(cfg.apiSecret),
        webhookUrl: cfg.webhookUrl || "",
        fromNumber: cfg.fromNumber || ""
      });
    })
  );
  app2.put(
    "/api/admin/sms-settings",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const existing = await getSmsGatewayConfig();
      const { provider, senderName, autoOrderSmsEnabled, apiKey, apiSecret, webhookUrl, fromNumber } = req.body || {};
      const validProviders = /* @__PURE__ */ new Set(["built_in", "bulksmsbd", "greenweb", "twilio", "webhook"]);
      const nextProvider = validProviders.has(provider) ? provider : existing.provider;
      const cleanWebhook = typeof webhookUrl === "string" ? webhookUrl.trim() : existing.webhookUrl || "";
      if (nextProvider === "webhook" && cleanWebhook) {
        try {
          await validateSafeHttpsWebhook(cleanWebhook);
        } catch (err) {
          res.status(400).json({ error: err?.message || "\u0985\u09AC\u09C8\u09A7 SMS Webhook URL\u0964" });
          return;
        }
      }
      const nextCfg = {
        provider: nextProvider,
        senderName: typeof senderName === "string" && senderName.trim() ? senderName.trim().slice(0, 20) : existing.senderName || "Orvexa",
        autoOrderSmsEnabled: autoOrderSmsEnabled !== void 0 ? Boolean(autoOrderSmsEnabled) : existing.autoOrderSmsEnabled,
        apiKey: typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : existing.apiKey || "",
        apiSecret: typeof apiSecret === "string" && apiSecret.trim() ? apiSecret.trim() : existing.apiSecret || "",
        webhookUrl: cleanWebhook,
        fromNumber: typeof fromNumber === "string" ? fromNumber.trim() : existing.fromNumber || ""
      };
      await db.run(
        `INSERT OR REPLACE INTO site_settings (key, value) VALUES ('smsGateway', ?)`,
        JSON.stringify(nextCfg)
      );
      res.json({ message: "SMS \u0997\u09C7\u099F\u0993\u09AF\u09BC\u09C7 \u09B8\u09C7\u099F\u09BF\u0982\u09B8 \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6\u09AD\u09BE\u09AC\u09C7 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09BF\u09A4 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.get(
    "/api/admin/sms-logs",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const logs = await db.all(`SELECT * FROM sms_logs ORDER BY createdAt DESC LIMIT 100`);
      res.json({ logs });
    })
  );
  app2.post(
    "/api/admin/sms-test",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { phone } = req.body || {};
      const cleanPhone = typeof phone === "string" ? phone.trim() : "";
      if (!isLikelyPhone(cleanPhone)) {
        res.status(400).json({ error: "\u09B8\u09A0\u09BF\u0995 \u09AE\u09CB\u09AC\u09BE\u0987\u09B2 \u09A8\u09AE\u09CD\u09AC\u09B0 \u09A6\u09BF\u09A8 (\u09AF\u09C7\u09AE\u09A8: 01XXXXXXXXX)\u0964" });
        return;
      }
      const cfg = await getSmsGatewayConfig();
      const smsRes = await dispatchSms({
        recipientPhone: cleanPhone,
        messageType: "test",
        messageBody: buildOrderConfirmSmsBody(cfg.senderName || "Orvexa", "TEST-101"),
        referenceId: "admin-test"
      });
      res.json({
        message: "\u099F\u09C7\u09B8\u09CD\u099F SMS \u09AA\u09CD\u09B0\u0995\u09CD\u09B0\u09BF\u09AF\u09BC\u09BE \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u09A8\u09BF\u099A\u09C7 SMS \u09B2\u0997\u09C7 \u09AB\u09B2\u09BE\u09AB\u09B2 \u09A6\u09C7\u0996\u09C1\u09A8\u0964",
        result: smsRes
      });
    })
  );
  app2.put(
    "/api/admin/settings/:key",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const allowedKeys = /* @__PURE__ */ new Set([
        "heroBanners",
        "productAdsSection",
        "sellerProductAdsPage",
        "paymentOptions",
        "contactInfo",
        "footerSettings",
        "generalSettings",
        "customCode",
        "customPages",
        "customBlocks"
      ]);
      const { key } = req.params;
      if (!allowedKeys.has(key)) {
        res.status(400).json({ error: "\u0985\u09AC\u09C8\u09A7 \u09B8\u09C7\u099F\u09BF\u0982\u09B8 \u0995\u09C0\u0964" });
        return;
      }
      await db.run(
        `INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)`,
        key,
        JSON.stringify(req.body ?? {})
      );
      res.json({ message: "\u09B8\u09C7\u099F\u09BF\u0982\u09B8 \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" });
    })
  );
  app2.post(
    "/api/admin/import-package",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const payload = req.body || {};
      const allowedSettingsKeys = /* @__PURE__ */ new Set([
        "heroBanners",
        "productAdsSection",
        "sellerProductAdsPage",
        "paymentOptions",
        "contactInfo",
        "footerSettings",
        "generalSettings",
        "customCode",
        "customPages",
        "customBlocks"
      ]);
      const validPlacements = /* @__PURE__ */ new Set([
        "homepage_top",
        "homepage_middle",
        "homepage_bottom",
        "category_page",
        "product_page",
        "sidebar",
        "other"
      ]);
      const validAdTypes = /* @__PURE__ */ new Set(["image", "banner", "html", "js"]);
      let settingsUpdated = 0;
      let categoriesImported = 0;
      let adsImported = 0;
      let productAdsImported = 0;
      await db.transaction(async (tx) => {
        if (payload.settings && typeof payload.settings === "object") {
          for (const [key, val] of Object.entries(payload.settings)) {
            if (!allowedSettingsKeys.has(key) || val === void 0) continue;
            await tx.run(`INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)`, key, JSON.stringify(val));
            settingsUpdated++;
          }
        }
        if (Array.isArray(payload.categories)) {
          for (const c of payload.categories) {
            if (!c || !c.nameEn || !c.nameBn) continue;
            const id = typeof c.id === "string" && c.id.trim() ? c.id.trim() : `cat-${crypto5.randomUUID().slice(0, 8)}`;
            const slug = typeof c.slug === "string" && c.slug.trim() ? c.slug.trim() : `${String(c.nameEn).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${id.slice(-4)}`;
            await tx.run(
              `INSERT OR REPLACE INTO categories (id, nameEn, nameBn, slug, imageUrl, subcategories, sortOrder)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              id,
              String(c.nameEn).trim(),
              String(c.nameBn).trim(),
              slug,
              String(c.imageUrl || "/src/assets/images/cat_baby_gifts_1795274484045.jpg"),
              JSON.stringify(Array.isArray(c.subcategories) ? c.subcategories : []),
              Number(c.sortOrder ?? 99)
            );
            categoriesImported++;
          }
        }
        if (Array.isArray(payload.advertisements)) {
          for (const ad of payload.advertisements) {
            if (!ad || !ad.title || !validPlacements.has(ad.placement) || !validAdTypes.has(ad.adType)) continue;
            const id = typeof ad.id === "string" && ad.id.trim() ? ad.id.trim() : `ad-${crypto5.randomUUID().slice(0, 8)}`;
            await tx.run(
              `INSERT OR REPLACE INTO advertisements (id, title, placement, adType, imageUrl, targetUrl, htmlCode, jsCode, isActive, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              id,
              String(ad.title).trim(),
              ad.placement,
              ad.adType,
              typeof ad.imageUrl === "string" && ad.imageUrl.trim() ? ad.imageUrl.trim() : null,
              safeUrl(ad.targetUrl),
              typeof ad.htmlCode === "string" ? ad.htmlCode : null,
              typeof ad.jsCode === "string" ? ad.jsCode : null,
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
            const id = typeof pad.id === "string" && pad.id.trim() ? pad.id.trim() : typeof pad.adId === "string" && pad.adId.trim() ? pad.adId.trim() : `hpad-${crypto5.randomUUID().slice(0, 8)}`;
            await tx.run(
              `INSERT OR REPLACE INTO homepage_product_ads (id, productId, promoText, customImageUrl, sortOrder, isActive, expiresAt, createdAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              id,
              prodId,
              typeof pad.promoText === "string" ? pad.promoText.trim() : null,
              typeof pad.customImageUrl === "string" && pad.customImageUrl.trim() ? pad.customImageUrl.trim() : null,
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
        message: "\u09AA\u09CD\u09AF\u09BE\u0995\u09C7\u099C \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u0987\u09AE\u09AA\u09CB\u09B0\u09CD\u099F \u0993 \u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u0997 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7!",
        summary: { settingsUpdated, categoriesImported, adsImported, productAdsImported }
      });
    })
  );
  app2.get(
    "/api/admin/deploy-hook",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const cfg = await getSetting("deployHook", {});
      res.json({
        configured: Boolean(cfg.url),
        maskedUrl: cfg.url ? maskDeployHookUrl(cfg.url) : "",
        providerHint: cfg.providerHint || "Vercel / Netlify / Render",
        lastTriggeredAt: cfg.lastTriggeredAt || null,
        lastStatus: cfg.lastStatus || null
      });
    })
  );
  app2.put(
    "/api/admin/deploy-hook",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const { url, providerHint } = req.body || {};
      const existing = await getSetting("deployHook", {});
      const cleanUrl = typeof url === "string" ? url.trim() : "";
      if (!cleanUrl) {
        await db.run(`DELETE FROM site_settings WHERE key = 'deployHook'`);
        res.json({
          configured: false,
          maskedUrl: "",
          providerHint: "Vercel / Netlify / Render",
          lastTriggeredAt: null,
          lastStatus: null,
          message: "Deploy Hook \u09B8\u0982\u09AF\u09CB\u0997 \u09B8\u09B0\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964"
        });
        return;
      }
      let validated;
      try {
        validated = await validateDeployHookUrl(cleanUrl);
      } catch (err) {
        res.status(400).json({ error: err?.message || "\u0985\u09AC\u09C8\u09A7 Deploy Hook URL\u0964" });
        return;
      }
      const nextCfg = {
        url: validated.toString(),
        providerHint: typeof providerHint === "string" && providerHint.trim() ? providerHint.trim().slice(0, 60) : existing.providerHint || "Vercel / Netlify / Render",
        lastTriggeredAt: existing.lastTriggeredAt || null,
        lastStatus: existing.lastStatus || null
      };
      await db.run(`INSERT OR REPLACE INTO site_settings (key, value) VALUES ('deployHook', ?)`, JSON.stringify(nextCfg));
      res.json({
        configured: true,
        maskedUrl: maskDeployHookUrl(nextCfg.url),
        providerHint: nextCfg.providerHint,
        lastTriggeredAt: nextCfg.lastTriggeredAt,
        lastStatus: nextCfg.lastStatus,
        message: "Deploy Hook \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6\u09AD\u09BE\u09AC\u09C7 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09BF\u09A4 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7!"
      });
    })
  );
  app2.post(
    "/api/admin/deploy-hook/trigger",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const cfg = await getSetting("deployHook", {});
      if (!cfg.url) {
        res.status(400).json({ error: "\u09AA\u09CD\u09B0\u09A5\u09AE\u09C7 \u098F\u0995\u099F\u09BF Deploy Hook URL \u09B8\u09C7\u099F \u0995\u09B0\u09C7 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u0995\u09B0\u09C1\u09A8\u0964" });
        return;
      }
      let validated;
      try {
        validated = await validateDeployHookUrl(cfg.url);
      } catch (err) {
        res.status(400).json({ error: err?.message || "\u0985\u09AC\u09C8\u09A7 Deploy Hook URL\u0964" });
        return;
      }
      let statusMsg = "";
      let ok = false;
      try {
        const hookRes = await fetch(validated.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ triggeredBy: "orvexa-admin", timestamp: Date.now() }),
          signal: AbortSignal.timeout(12e3)
        });
        ok = hookRes.ok;
        statusMsg = hookRes.ok ? `Success (HTTP ${hookRes.status})` : `Failed (HTTP ${hookRes.status})`;
      } catch (err) {
        statusMsg = `Network error: ${err?.message || "Timeout"}`;
      }
      const now = Date.now();
      const updatedCfg = { ...cfg, lastTriggeredAt: now, lastStatus: statusMsg };
      await db.run(
        `INSERT OR REPLACE INTO site_settings (key, value) VALUES ('deployHook', ?)`,
        JSON.stringify(updatedCfg)
      );
      if (!ok) {
        res.status(502).json({ error: `Deploy Hook \u0995\u09B2 \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7: ${statusMsg}`, lastTriggeredAt: now, lastStatus: statusMsg });
        return;
      }
      res.json({
        message: "\u09B0\u09BF-\u09A1\u09C7\u09AA\u09CD\u09B2\u09AF\u09BC\u09AE\u09C7\u09A8\u09CD\u099F \u099F\u09CD\u09B0\u09BF\u0997\u09BE\u09B0 \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09AA\u09BE\u09A0\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7!",
        lastTriggeredAt: now,
        lastStatus: statusMsg
      });
    })
  );
  app2.get(
    "/api/admin/storage/stats",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const now = Date.now();
      const sessionCutoff = now - 180 * 864e5;
      const notifCutoff = now - 90 * 864e5;
      const [
        mediaStats,
        usersCount,
        productsCount,
        ordersCount,
        messagesCount,
        notifStats,
        sessionStats,
        mediaIds
      ] = await Promise.all([
        db.get(
          `SELECT COUNT(*) as count, COALESCE(SUM(sizeBytes), 0) as totalBytes FROM media`
        ),
        db.get(`SELECT COUNT(*) as c FROM users`),
        db.get(`SELECT COUNT(*) as c FROM products`),
        db.get(`SELECT COUNT(*) as c FROM orders`),
        db.get(`SELECT COUNT(*) as c FROM messages`),
        db.get(
          `SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN isRead = 1 AND createdAt < ? THEN 1 ELSE 0 END), 0) as stale FROM notifications`,
          notifCutoff
        ),
        db.get(
          `SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN lastUsedAt < ? THEN 1 ELSE 0 END), 0) as stale FROM sessions`,
          sessionCutoff
        ),
        db.all(`SELECT id, sizeBytes FROM media`)
      ]);
      let orphanMediaCount = 0;
      let orphanMediaBytes = 0;
      for (const m of mediaIds) {
        if (!await isMediaReferenced(m.id)) {
          orphanMediaCount++;
          orphanMediaBytes += Number(m.sizeBytes || 0);
        }
      }
      res.json({
        isRemote: db.isRemote,
        isServerless: isServerlessEnv,
        dbMode: db.mode,
        dbEngine: db.mode === "turso" ? "Turso Cloud (LibSQL)" : db.mode === "sqlite-memory" ? "In-Memory SQLite (Temporary)" : "Local SQLite (WAL)",
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
          sessions: Number(sessionStats?.total || 0)
        }
      });
    })
  );
  app2.post(
    "/api/admin/storage/cleanup",
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const now = Date.now();
      const sessionCutoff = now - 180 * 864e5;
      const notifCutoff = now - 90 * 864e5;
      const [sessRes, notifRes, mediaIds] = await Promise.all([
        db.run(`DELETE FROM sessions WHERE lastUsedAt < ?`, sessionCutoff),
        db.run(`DELETE FROM notifications WHERE isRead = 1 AND createdAt < ?`, notifCutoff),
        db.all(`SELECT id, sizeBytes FROM media`)
      ]);
      let deletedOrphanMedia = 0;
      let freedMediaBytes = 0;
      for (const m of mediaIds) {
        if (!await isMediaReferenced(m.id)) {
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
        message: "\u09A1\u09BE\u099F\u09BE\u09AC\u09C7\u09B8 \u0993 \u09B8\u09CD\u099F\u09CB\u09B0\u09C7\u099C \u0985\u09AA\u099F\u09BF\u09AE\u09BE\u0987\u099C\u09C7\u09B6\u09A8 \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7!"
      });
    })
  );
  app2.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
  });
  app2.use((err, req, res, _next) => {
    console.error("[Orvexa API Error]", req.method, req.originalUrl, err?.message || err);
    if (res.headersSent) return;
    if (err?.type === "entity.too.large") {
      res.status(413).json({ error: "\u09AA\u09BE\u09A0\u09BE\u09A8\u09CB \u09A4\u09A5\u09CD\u09AF\u09C7\u09B0 \u0986\u0995\u09BE\u09B0 \u0985\u09A8\u09C7\u0995 \u09AC\u09A1\u09BC \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u099B\u09CB\u099F \u09AB\u09BE\u0987\u09B2 \u09AC\u09BE \u09A4\u09A5\u09CD\u09AF \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964" });
      return;
    }
    const status = typeof err?.status === "number" && err.status >= 400 ? err.status : 500;
    res.status(status).json({
      error: status >= 500 ? "\u09B8\u09BE\u09B0\u09CD\u09AD\u09BE\u09B0\u09C7 \u098F\u0995\u099F\u09BF \u0985\u09B8\u09CD\u09A5\u09BE\u09AF\u09BC\u09C0 \u09B8\u09AE\u09B8\u09CD\u09AF\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964" : err?.message || "\u0985\u09A8\u09C1\u09B0\u09CB\u09A7\u099F\u09BF \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u0995\u09B0\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964"
    });
  });
  return app2;
}

// server/vercelEntry.ts
var app = createApp({ wsEnabled: false });
async function handler(req, res) {
  const origHeader = req.headers["x-vercel-original-uri"] || req.headers["x-matched-path"];
  if ((!req.url || req.url === "/" || req.url === "/api/index" || req.url === "/api/index.mjs") && origHeader && origHeader.startsWith("/api") && !origHeader.startsWith("/api/index")) {
    req.url = origHeader;
  }
  if (!req.url || req.url === "/") {
    req.url = "/api";
  } else if (!req.url.startsWith("/api")) {
    req.url = req.url.startsWith("/") ? `/api${req.url}` : `/api/${req.url}`;
  }
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  try {
    if (!contentType.includes("multipart/form-data")) {
      await ensureReady();
    }
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      res.once("finish", done);
      res.once("close", done);
      res.once("error", done);
      try {
        app(req, res);
      } catch (err) {
        console.error("[Orvexa Vercel Handler Error]", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "\u09B8\u09BE\u09B0\u09CD\u09AD\u09BE\u09B0\u09C7 \u098F\u0995\u099F\u09BF \u0985\u09B8\u09CD\u09A5\u09BE\u09AF\u09BC\u09C0 \u09B8\u09AE\u09B8\u09CD\u09AF\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964" });
        }
        done();
      }
    });
  } catch (err) {
    console.error("[Orvexa Vercel Cold Start Error]", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "\u09B8\u09BE\u09B0\u09CD\u09AD\u09BE\u09B0 \u099A\u09BE\u09B2\u09C1 \u09B9\u09A4\u09C7 \u09B8\u09AE\u09B8\u09CD\u09AF\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u0995\u09BF\u099B\u09C1\u0995\u09CD\u09B7\u09A3 \u09AA\u09B0 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964" });
    }
  }
}
export {
  handler as default
};
