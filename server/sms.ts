import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { db } from './db.ts';

export type SmsProviderType = 'built_in' | 'bulksmsbd' | 'greenweb' | 'twilio' | 'webhook';

export interface SmsGatewayConfig {
  provider: SmsProviderType;
  senderName: string;
  autoOrderSmsEnabled: boolean;
  apiKey?: string;
  apiSecret?: string;
  webhookUrl?: string;
  fromNumber?: string;
}

export function normalizeBdPhone(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+880')) {
    digits = `0${digits.slice(4)}`;
  } else if (digits.startsWith('880') && digits.length >= 13) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }
  return digits.trim();
}

export function isLikelyPhone(raw?: string | null): boolean {
  if (!raw || typeof raw !== 'string' || raw.includes('@')) return false;
  const cleaned = normalizeBdPhone(raw);
  return /^[0-9]{10,15}$/.test(cleaned);
}

function formatToIntlBdPhone(raw: string): string {
  const norm = normalizeBdPhone(raw);
  if (/^01[0-9]{9}$/.test(norm)) {
    return `88${norm}`;
  }
  return norm;
}

function isPrivateIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }
  if (lower.startsWith('::ffff:')) {
    return isPrivateIp(lower.slice(7));
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

export async function validateSafeHttpsWebhook(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl.trim());
  if (parsed.protocol !== 'https:') {
    throw new Error('নিরাপত্তার জন্য শুধুমাত্র HTTPS Webhook URL অনুমোদিত।');
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('লোকাল বা প্রাইভেট হোস্ট অনুমোদিত নয়।');
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error('প্রাইভেট IP অনুমোদিত নয়।');
  }
  try {
    const records = await dns.lookup(host, { all: true });
    for (const r of records) {
      if (isPrivateIp(r.address)) {
        throw new Error('প্রাইভেট নেটওয়ার্ক টার্গেট অনুমোদিত নয়।');
      }
    }
  } catch (err: any) {
    if (err?.message?.includes('অনুমোদিত নয়')) throw err;
  }
  return parsed;
}

export async function getSmsGatewayConfig(): Promise<SmsGatewayConfig> {
  let dbCfg: Partial<SmsGatewayConfig> = {};
  try {
    const row = await db.get<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'smsGateway' LIMIT 1`);
    if (row?.value) {
      dbCfg = JSON.parse(row.value);
    }
  } catch {
    // ignore invalid stored config
  }

  let siteName = 'Orvexa';
  try {
    const genRow = await db.get<{ value: string }>(`SELECT value FROM site_settings WHERE key = 'generalSettings' LIMIT 1`);
    if (genRow?.value) {
      const gen = JSON.parse(genRow.value);
      if (gen?.siteName && typeof gen.siteName === 'string' && gen.siteName.trim()) {
        siteName = gen.siteName.trim();
      }
    }
  } catch {
    // ignore
  }

  const envProvider = (process.env.SMS_PROVIDER || '').trim().toLowerCase() as SmsProviderType;
  const provider: SmsProviderType =
    dbCfg.provider && ['built_in', 'bulksmsbd', 'greenweb', 'twilio', 'webhook'].includes(dbCfg.provider)
      ? dbCfg.provider
      : envProvider && ['built_in', 'bulksmsbd', 'greenweb', 'twilio', 'webhook'].includes(envProvider)
        ? envProvider
        : 'built_in';

  return {
    provider,
    senderName: (dbCfg.senderName || process.env.SMS_SENDER_ID || siteName || 'Orvexa').trim(),
    autoOrderSmsEnabled: dbCfg.autoOrderSmsEnabled !== undefined ? Boolean(dbCfg.autoOrderSmsEnabled) : true,
    apiKey: (
      dbCfg.apiKey ||
      process.env.SMS_API_KEY ||
      process.env.BULKSMSBD_API_KEY ||
      process.env.GREENWEB_TOKEN ||
      process.env.TWILIO_ACCOUNT_SID ||
      ''
    ).trim(),
    apiSecret: (dbCfg.apiSecret || process.env.SMS_API_SECRET || process.env.TWILIO_AUTH_TOKEN || '').trim(),
    webhookUrl: (dbCfg.webhookUrl || process.env.SMS_WEBHOOK_URL || '').trim(),
    fromNumber: (dbCfg.fromNumber || process.env.TWILIO_FROM_NUMBER || '').trim(),
  };
}

export async function dispatchSms(params: {
  recipientPhone: string;
  messageType: 'otp_reset' | 'order_confirmation' | 'test';
  messageBody: string;
  logBodyOverride?: string;
  referenceId?: string | null;
}): Promise<{
  id: string;
  status: string;
  provider: string;
  senderName: string;
  deliveredViaCarrier: boolean;
  errorDetail: string | null;
}> {
  const cfg = await getSmsGatewayConfig();
  const senderName = cfg.senderName || 'Orvexa';
  const cleanPhone = normalizeBdPhone(params.recipientPhone) || params.recipientPhone.trim();
  const id = `sms-${crypto.randomUUID().slice(0, 12)}`;
  const now = Date.now();

  let status = 'logged';
  let deliveredViaCarrier = false;
  let errorDetail: string | null = null;

  try {
    if (cfg.provider === 'bulksmsbd') {
      if (!cfg.apiKey) {
        status = 'failed';
        errorDetail = 'BulkSMSBD API Key সেট করা হয়নি।';
      } else {
        const form = new URLSearchParams({
          api_key: cfg.apiKey,
          type: 'text',
          number: formatToIntlBdPhone(cleanPhone),
          senderid: senderName,
          message: params.messageBody,
        });
        const resp = await fetch('https://bulksmsbd.net/api/smsapi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          signal: AbortSignal.timeout(15000),
        });
        const rawText = await resp.text().catch(() => '');
        let parsed: any = null;
        try {
          parsed = rawText ? JSON.parse(rawText) : null;
        } catch {
          parsed = null;
        }
        const respCode = parsed?.response_code !== undefined ? Number(parsed.response_code) : null;
        if (resp.ok && (respCode === 202 || (respCode === null && /success|submitted/i.test(rawText)))) {
          status = 'sent';
          deliveredViaCarrier = true;
        } else {
          status = 'failed';
          errorDetail =
            parsed?.error_message ||
            (respCode ? `BulkSMSBD code ${respCode}` : rawText.slice(0, 180) || `HTTP ${resp.status}`);
        }
      }
    } else if (cfg.provider === 'greenweb') {
      if (!cfg.apiKey) {
        status = 'failed';
        errorDetail = 'GreenWeb API Token সেট করা হয়নি।';
      } else {
        const form = new URLSearchParams({
          token: cfg.apiKey,
          to: formatToIntlBdPhone(cleanPhone),
          message: params.messageBody,
        });
        const resp = await fetch('https://api.greenweb.com.bd/api.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          signal: AbortSignal.timeout(15000),
        });
        const rawText = (await resp.text().catch(() => '')).trim();
        const isOk = resp.ok && /^ok\b/i.test(rawText) && !/^error\b/i.test(rawText);
        if (isOk) {
          status = 'sent';
          deliveredViaCarrier = true;
        } else {
          status = 'failed';
          errorDetail = rawText.slice(0, 180) || `HTTP ${resp.status}`;
        }
      }
    } else if (cfg.provider === 'twilio') {
      if (!cfg.apiKey || !cfg.apiSecret || !cfg.fromNumber) {
        status = 'failed';
        errorDetail = 'Twilio SID, Auth Token অথবা From Number অসম্পূর্ণ।';
      } else {
        const toIntl = cleanPhone.startsWith('01')
          ? `+88${cleanPhone}`
          : cleanPhone.startsWith('+')
            ? cleanPhone
            : `+${cleanPhone}`;
        const form = new URLSearchParams({
          To: toIntl,
          From: cfg.fromNumber,
          Body: params.messageBody,
        });
        const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64');
        const resp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.apiKey)}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${auth}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.toString(),
            signal: AbortSignal.timeout(15000),
          }
        );
        if (resp.ok) {
          status = 'sent';
          deliveredViaCarrier = true;
        } else {
          const errJson: any = await resp.json().catch(() => null);
          status = 'failed';
          errorDetail = errJson?.message || `HTTP ${resp.status}`;
        }
      }
    } else if (cfg.provider === 'webhook') {
      if (!cfg.webhookUrl) {
        status = 'failed';
        errorDetail = 'Custom HTTPS Webhook URL সেট করা হয়নি।';
      } else {
        const safeUrl = await validateSafeHttpsWebhook(cfg.webhookUrl);
        const resp = await fetch(safeUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          body: JSON.stringify({
            sender: senderName,
            to: cleanPhone,
            message: params.messageBody,
            type: params.messageType,
            referenceId: params.referenceId || null,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (resp.ok) {
          status = 'sent';
          deliveredViaCarrier = true;
        } else {
          const rawErr = await resp.text().catch(() => '');
          status = 'failed';
          errorDetail = rawErr.slice(0, 180) || `HTTP ${resp.status}`;
        }
      }
    } else {
      status = 'logged';
      deliveredViaCarrier = false;
      errorDetail = 'Built-in প্রিভিউ মোড সক্রিয় — লাইভ মোবাইলে SMS পাঠাতে BulkSMSBD / GreenWeb / Twilio যুক্ত করুন।';
    }
  } catch (err: any) {
    status = 'failed';
    errorDetail = err?.message || 'SMS gateway error';
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

export function buildOrderConfirmSmsBody(siteName: string, orderNumber: string): string {
  const brand = siteName || 'Orvexa';
  return `${brand}: আপনার অর্ডারটি (#${orderNumber}) সফলভাবে কনফার্ম করা হয়েছে। আগামী ৩ দিনের মধ্যে প্রোডাক্টটি হাতে পেয়ে যাবেন। অনুরোধ রইল—কোনো কারণে অর্ডারটি বাতিল করলে বা রিসিভ না করলে আমাদের ৭০-১২০ টাকা ডেলিভারি চার্জ লোকসান হয়ে যাবে, তাই আমাদের লোকসানের কথা ভেবে অর্ডারটি রিসিভ করার জন্য আন্তরিকভাবে অনুরোধ রইল। ধন্যবাদ! - ${brand}`;
}
