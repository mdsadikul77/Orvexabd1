let preferSameOriginFallback = false;

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h === '0.0.0.0';
}

function cleanEnvBase(raw: unknown, isWs = false): string {
  if (typeof raw !== 'string') return '';
  let cleaned = raw.trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');
  if (!cleaned || /MY_APP_URL|YOUR_BACKEND_URL/i.test(cleaned)) {
    return '';
  }
  if (!isWs) {
    cleaned = cleaned.replace(/\/api$/i, '');
  }
  if (typeof window !== 'undefined') {
    try {
      const parsed = new URL(cleaned);
      const targetLocal = isLoopbackHost(parsed.hostname);
      const pageLocal = isLoopbackHost(window.location.hostname);

      // Never let container-injected localhost/127.0.0.1 break remote/cloud previews or deployed apps
      if (targetLocal && !pageLocal) {
        return '';
      }
      // Never downgrade HTTPS pages to insecure http:// or ws://
      if (window.location.protocol === 'https:' && (parsed.protocol === 'http:' || parsed.protocol === 'ws:')) {
        return '';
      }
      // Keep same-origin calls relative
      if (!isWs && parsed.origin === window.location.origin) {
        return '';
      }
    } catch {
      return '';
    }
  }
  return cleaned;
}

const rawApiBase = cleanEnvBase(import.meta.env.VITE_API_BASE_URL, false);
const rawWsBase = cleanEnvBase(import.meta.env.VITE_WS_BASE_URL, true);

/**
 * Resolves relative `/api/...` paths against `VITE_API_BASE_URL` when frontend is
 * hosted separately (e.g. Firebase Hosting + external Node backend),
 * or keeps them relative on single-origin deployments (Vercel / Netlify / Render / Railway).
 */
export function apiUrl(path: string): string {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  if (!rawApiBase || preferSameOriginFallback) return path;
  return path.startsWith('/') ? `${rawApiBase}${path}` : `${rawApiBase}/${path}`;
}

/**
 * Resolves uploaded media paths (`/api/media/...` and `/uploads/...`) against `VITE_API_BASE_URL` when split-hosted.
 */
export function resolveAssetUrl(src?: string | null): string | undefined {
  if (!src) return undefined;
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  if (rawApiBase && !preferSameOriginFallback && (src.startsWith('/uploads/') || src.startsWith('/api/media/'))) {
    return `${rawApiBase}${src}`;
  }
  return src;
}

/**
 * Safely parses a fetch Response as JSON, giving a clear Bangla error message
 * instead of `Unexpected token ... is not valid JSON` if a host returns HTML/text.
 */
export async function safeParseJson<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text || !text.trim()) {
    return {} as T;
  }
  const trimmed = text.trim();
  if (trimmed.includes('__cookie_check')) {
    throw new Error(
      'প্রিভিউ সেশন মেয়াদোত্তীর্ণ হয়েছে বা ব্রাউজার কুকি ব্লক করছে। অনুগ্রহ করে পেজটি রিলোড (Refresh) করে আবার চেষ্টা করুন।'
    );
  }
  if (trimmed.startsWith('<')) {
    throw new Error(
      'সার্ভার API থেকে সঠিক JSON ডেটা আসেনি (HTML পাওয়া গেছে)। হোস্টিংয়ে /api ফাংশন এবং Environment Variables ঠিকভাবে সেটআপ করা আছে কিনা যাচাই করে পেজটি রিলোড করুন।'
    );
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || parsed === undefined) {
      return {} as T;
    }
    return parsed as T;
  } catch {
    throw new Error(
      `সার্ভার থেকে সঠিক তথ্য পাওয়া যায়নি (HTTP ${res.status})। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।`
    );
  }
}

export function isNetworkFetchError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = String((err as Error).message || '');
  if (
    /failed to fetch|networkerror|network request failed|load failed|the internet connection appears to be offline|err_connection|err_network|fetch/i.test(
      msg
    )
  ) {
    return true;
  }
  return err instanceof TypeError && !msg;
}

/**
 * Diagnoses network fetch errors (offline, preview cookie interstitial, or unreachable backend)
 * and returns a clear, actionable Bangla message.
 */
export async function toFriendlyFetchError(err: unknown, fallback = 'অনুরোধটি সম্পন্ন করা যায়নি।'): Promise<string> {
  if (err && (err as Error).name === 'AbortError') {
    return 'সার্ভার থেকে সাড়া পেতে বেশি সময় লাগছে। অনুগ্রহ করে একটু পর আবার চেষ্টা করুন।';
  }
  if (!isNetworkFetchError(err)) {
    return (err as Error)?.message || fallback;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'আপনার ইন্টারনেট সংযোগ বিচ্ছিন্ন রয়েছে। নেটওয়ার্ক চালু করে আবার চেষ্টা করুন।';
  }

  // Probe /api/health without auto-following redirects to detect preview cookie interstitials
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const probeUrl = preferSameOriginFallback ? '/api/health' : apiUrl('/api/health');
    const probe = await fetch(probeUrl, {
      method: 'GET',
      credentials: 'include',
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timer);

    const contentType = (probe.headers.get('content-type') || '').toLowerCase();
    if (
      probe.type === 'opaqueredirect' ||
      probe.status === 0 ||
      (probe.status >= 300 && probe.status < 400) ||
      probe.url.includes('__cookie_check') ||
      (probe.ok && contentType && !contentType.includes('application/json'))
    ) {
      return 'প্রিভিউ সেশন মেয়াদোত্তীর্ণ হয়েছে বা ব্রাউজার কুকি ব্লক করছে। অনুগ্রহ করে পেজটি রিলোড (Refresh) করুন অথবা নতুন ট্যাবে খুলে আবার চেষ্টা করুন।';
    }
  } catch {
    // Health probe itself unreachable
  }

  return 'সার্ভারের সাথে সংযোগ করা যায়নি। পেজটি রিলোড (Refresh) করে অথবা কিছুক্ষণ পর আবার চেষ্টা করুন।';
}

export interface OrvexaFetchOptions {
  timeoutMs?: number;
  retryOnNetworkError?: boolean;
}

/**
 * Unified fetch wrapper for all Orvexa API calls:
 * - Applies timeout protection so hung sockets recover cleanly
 * - Falls back automatically to same-origin `/api/*` if `VITE_API_BASE_URL` fails while same-origin hosts Orvexa
 * - Retries once on transient network drops / serverless cold-start connection resets when safe
 */
export async function orvexaFetch(
  path: string,
  init: RequestInit = {},
  options: OrvexaFetchOptions = {}
): Promise<Response> {
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const timeoutMs = options.timeoutMs ?? (isFormData ? 45000 : 25000);
  const method = (init.method || 'GET').toUpperCase();
  const canRetry =
    options.retryOnNetworkError ?? (method === 'GET' || method === 'HEAD' || path.startsWith('/api/upload'));

  const attemptFetch = async (targetUrl: string): Promise<Response> => {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(targetUrl, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  };

  try {
    return await attemptFetch(apiUrl(path));
  } catch (primaryErr) {
    // Do not retry if caller explicitly aborted
    if (init.signal?.aborted) {
      throw primaryErr;
    }

    // 1. If split-host VITE_API_BASE_URL fails due to network/CORS, check whether same-origin hosts Orvexa API
    if (rawApiBase && !preferSameOriginFallback && !/^https?:\/\//i.test(path) && isNetworkFetchError(primaryErr)) {
      const sameOriginPath = path.startsWith('/') ? path : `/${path}`;
      const healthRes = await fetch('/api/health', { credentials: 'include' }).catch(() => null);
      const healthData = healthRes && healthRes.ok ? await healthRes.json().catch(() => null) : null;
      if (healthData?.service === 'orvexa') {
        preferSameOriginFallback = true;
        return await attemptFetch(sameOriginPath);
      }
    }

    // 2. Retry once after a brief pause on transient network/cold-start connection drops
    if (canRetry && isNetworkFetchError(primaryErr)) {
      await new Promise((r) => setTimeout(r, 380));
      return await attemptFetch(apiUrl(path));
    }

    throw primaryErr;
  }
}

/**
 * Executes an auth JSON POST request with consistent credentials, CSRF header, timeout,
 * fallback to same-origin Orvexa API if `VITE_API_BASE_URL` is unreachable, and friendly Bangla errors.
 */
export async function authPostJson<T = any>(
  path: string,
  payload: unknown,
  fallbackError = 'অনুরোধটি সম্পন্ন করা যায়নি।'
): Promise<T> {
  try {
    const res = await orvexaFetch(
      path,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(payload),
      },
      { timeoutMs: 20000, retryOnNetworkError: false }
    );

    const data = await safeParseJson<T & { error?: string }>(res);
    if (!res.ok) {
      throw new Error(data.error || fallbackError);
    }
    return data as T;
  } catch (err) {
    const friendly = await toFriendlyFetchError(err, fallbackError);
    throw new Error(friendly);
  }
}

/**
 * Resolves the real-time WebSocket endpoint (`/ws`).
 */
export function getWsUrl(): string {
  if (rawWsBase) {
    return rawWsBase.endsWith('/ws') ? rawWsBase : `${rawWsBase}/ws`;
  }
  if (rawApiBase && !preferSameOriginFallback) {
    const wsOrigin = rawApiBase.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
    return `${wsOrigin}/ws`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}
