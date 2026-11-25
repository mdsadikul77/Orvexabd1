import 'dotenv/config';
import { createClient as createWebClient, type Client, type InStatement, type InValue } from '@libsql/client/web';
import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);

function isWritableDir(dirPath: string): boolean {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const probe = path.join(dirPath, `.probe-${process.pid}`);
    fs.writeFileSync(probe, '1');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export const isServerlessEnv = Boolean(
  process.env.VERCEL ||
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
);

function resolveStorageDir(envValue: string | undefined, folderName: string): string {
  if (envValue && envValue.trim()) {
    const custom = path.resolve(envValue.trim());
    try {
      fs.mkdirSync(custom, { recursive: true });
      return custom;
    } catch {
      // fall through
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
    // ignore read-only FS
  }
  return tmpDir;
}

export const dataDir = resolveStorageDir(process.env.DATA_DIR, 'data');
export const uploadsDir = resolveStorageDir(process.env.UPLOADS_DIR, 'uploads');
export const dbPath = path.join(dataDir, 'orvexa.db');

export interface DbTx {
  get<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = any>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
}

export interface DbAdapter extends DbTx {
  isRemote: boolean;
  mode: 'turso' | 'sqlite-file' | 'sqlite-memory';
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
}

function normalizeArgs(params: unknown[]): InValue[] {
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v as InValue;
  });
}

function normalizeRow<T = any>(row: any): T {
  if (!row || typeof row !== 'object') return row;
  const out: Record<string, any> = {};
  for (const key of Object.keys(row)) {
    const val = row[key];
    out[key] = typeof val === 'bigint' ? Number(val) : val;
  }
  return out as T;
}

function cleanEnvVal(raw: string | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
}

function resolveRemoteDbUrl(): { url: string; authToken?: string } | null {
  const candidates = [
    cleanEnvVal(process.env.TURSO_DATABASE_URL),
    cleanEnvVal(process.env.LIBSQL_URL),
    cleanEnvVal(process.env.DATABASE_URL),
  ];
  const url = candidates.find((u) => /^(libsql|https?):\/\//i.test(u)) || '';
  if (!url) {
    if (candidates[0]) {
      console.warn('[Orvexa DB] Ignoring invalid TURSO_DATABASE_URL (must start with libsql:// or https://).');
    }
    return null;
  }
  const rawToken =
    cleanEnvVal(process.env.TURSO_AUTH_TOKEN) ||
    cleanEnvVal(process.env.LIBSQL_AUTH_TOKEN) ||
    '';
  if (rawToken && /^(libsql|https?):\/\//i.test(rawToken)) {
    console.warn(
      '[Orvexa DB] Warning: TURSO_AUTH_TOKEN looks like a URL instead of a JWT token. Please paste the Turso JWT token (eyJ...).'
    );
  }
  return { url, authToken: rawToken || undefined };
}

function createLibsqlAdapter(
  url: string,
  authToken: string | undefined,
  mode: 'turso' | 'sqlite-file' | 'sqlite-memory'
): DbAdapter {
  let client: Client;
  if (mode === 'turso') {
    client = createWebClient(authToken ? { url, authToken } : { url });
  } else {
    const { createClient: createNodeClient } = require('@libsql/client') as typeof import('@libsql/client');
    client = createNodeClient(authToken ? { url, authToken } : { url });
  }

  const wrapExecutor = (execTarget: Pick<Client, 'execute'>): DbTx => ({
    async get<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      const rs = await execTarget.execute({ sql, args: normalizeArgs(params) } as InStatement);
      return rs.rows[0] ? normalizeRow<T>(rs.rows[0]) : undefined;
    },
    async all<T = any>(sql: string, ...params: unknown[]): Promise<T[]> {
      const rs = await execTarget.execute({ sql, args: normalizeArgs(params) } as InStatement);
      return rs.rows.map((r) => normalizeRow<T>(r));
    },
    async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
      const rs = await execTarget.execute({ sql, args: normalizeArgs(params) } as InStatement);
      return { changes: rs.rowsAffected };
    },
  });

  const base = wrapExecutor(client);

  return {
    isRemote: mode === 'turso',
    mode,
    ...base,
    async exec(sql: string): Promise<void> {
      await client.executeMultiple(sql);
    },
    async transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
      const tx = await client.transaction('write');
      try {
        const result = await fn(wrapExecutor(tx));
        await tx.commit();
        return result;
      } catch (err) {
        try {
          await tx.rollback();
        } catch {
          // ignore rollback failure
        }
        throw err;
      }
    },
  };
}

function createNativeSqliteAdapter(): DbAdapter {
  const Database = require('better-sqlite3');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  let txQueue = Promise.resolve();

  const adapter: DbAdapter = {
    isRemote: false,
    mode: 'sqlite-file',
    async get<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      const row = sqlite.prepare(sql).get(...normalizeArgs(params));
      return row ? normalizeRow<T>(row) : undefined;
    },
    async all<T = any>(sql: string, ...params: unknown[]): Promise<T[]> {
      const rows = sqlite.prepare(sql).all(...normalizeArgs(params));
      return rows.map((r: any) => normalizeRow<T>(r));
    },
    async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
      const info = sqlite.prepare(sql).run(...normalizeArgs(params));
      return { changes: info.changes };
    },
    async exec(sql: string): Promise<void> {
      sqlite.exec(sql);
    },
    async transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
      const prev = txQueue;
      let release!: () => void;
      txQueue = new Promise<void>((res) => {
        release = res;
      });
      await prev;
      try {
        sqlite.exec('BEGIN IMMEDIATE');
        const result = await fn(adapter);
        sqlite.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          sqlite.exec('ROLLBACK');
        } catch {
          // ignore
        }
        throw err;
      } finally {
        release();
      }
    },
  };

  return adapter;
}

function initDbAdapter(): DbAdapter {
  const remoteCfg = resolveRemoteDbUrl();
  if (remoteCfg) {
    return createLibsqlAdapter(remoteCfg.url, remoteCfg.authToken, 'turso');
  }
  if (!isServerlessEnv) {
    try {
      return createNativeSqliteAdapter();
    } catch (err) {
      console.warn('[Orvexa DB] better-sqlite3 unavailable, falling back to libsql local file:', (err as Error)?.message);
    }
  }
  try {
    return createLibsqlAdapter(`file:${dbPath}`, undefined, 'sqlite-file');
  } catch (fileErr) {
    console.warn('[Orvexa DB] local file SQLite unavailable, falling back to :memory:', (fileErr as Error)?.message);
    return createLibsqlAdapter(':memory:', undefined, 'sqlite-memory');
  }
}

export const db: DbAdapter = initDbAdapter();

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export async function initDatabase() {
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

  // Safe migrations for existing databases
  const orderCols = await db.all<{ name: string }>(`PRAGMA table_info(orders)`);
  const existingOrderColNames = new Set(orderCols.map((c) => c.name));
  if (!existingOrderColNames.has('backupPhone')) {
    await db.exec(`ALTER TABLE orders ADD COLUMN backupPhone TEXT;`);
  }
  if (!existingOrderColNames.has('district')) {
    await db.exec(`ALTER TABLE orders ADD COLUMN district TEXT;`);
  }
  if (!existingOrderColNames.has('thana')) {
    await db.exec(`ALTER TABLE orders ADD COLUMN thana TEXT;`);
  }

  const userCols = await db.all<{ name: string }>(`PRAGMA table_info(users)`);
  const existingUserColNames = new Set(userCols.map((c) => c.name));
  if (!existingUserColNames.has('resetAttempts')) {
    await db.exec(`ALTER TABLE users ADD COLUMN resetAttempts INTEGER NOT NULL DEFAULT 0;`);
  }

  const prodCols = await db.all<{ name: string }>(`PRAGMA table_info(products)`);
  const existingProdColNames = new Set(prodCols.map((c) => c.name));
  if (!existingProdColNames.has('promoCode')) {
    await db.exec(`ALTER TABLE products ADD COLUMN promoCode TEXT;`);
  }
  if (!existingProdColNames.has('promoDiscount')) {
    await db.exec(`ALTER TABLE products ADD COLUMN promoDiscount REAL NOT NULL DEFAULT 0;`);
  }
  if (!existingProdColNames.has('promoFontStyle')) {
    await db.exec(`ALTER TABLE products ADD COLUMN promoFontStyle TEXT;`);
  }

  const cartCols = await db.all<{ name: string }>(`PRAGMA table_info(cart_items)`);
  const existingCartColNames = new Set(cartCols.map((c) => c.name));
  if (!existingCartColNames.has('appliedPromoCode')) {
    await db.exec(`ALTER TABLE cart_items ADD COLUMN appliedPromoCode TEXT;`);
  }

  const orderItemCols = await db.all<{ name: string }>(`PRAGMA table_info(order_items)`);
  const existingOrderItemColNames = new Set(orderItemCols.map((c) => c.name));
  if (!existingOrderItemColNames.has('appliedPromoCode')) {
    await db.exec(`ALTER TABLE order_items ADD COLUMN appliedPromoCode TEXT;`);
  }
  if (!existingOrderItemColNames.has('promoDiscount')) {
    await db.exec(`ALTER TABLE order_items ADD COLUMN promoDiscount REAL NOT NULL DEFAULT 0;`);
  }

  // Long-term performance indexes for 10-20 year scale across SQLite & Turso
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
