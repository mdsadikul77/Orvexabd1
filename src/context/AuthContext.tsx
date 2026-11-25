import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getWsUrl, orvexaFetch, safeParseJson, toFriendlyFetchError } from '../lib/apiConfig';
import { compressImageFile } from '../lib/imageCompression';
import type {
  Advertisement,
  CartItem,
  Category,
  ChatMessage,
  Conversation,
  HomepageProductAd,
  NotificationItem,
  Order,
  Product,
  SiteSettings,
  User,
} from '../types';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  text: string;
}

interface StorefrontData {
  wsEnabled?: boolean;
  categories: Category[];
  homepageProductAds: HomepageProductAd[];
  advertisements: Advertisement[];
  settings: SiteSettings;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  storefront: StorefrontData | null;
  storefrontLoading: boolean;
  cart: CartItem[];
  favorites: Product[];
  favoriteIds: Set<string>;
  notifications: NotificationItem[];
  conversations: Conversation[];
  unreadNotifCount: number;
  unreadInboxCount: number;
  toasts: ToastMessage[];
  authModalOpen: boolean;
  authPromptReason: string | null;
  openAuthModal: (reason?: string, onAfterLogin?: () => void) => void;
  closeAuthModal: () => void;
  showToast: (text: string, type?: 'success' | 'error' | 'info') => void;
  apiFetch: <T = any>(url: string, options?: RequestInit) => Promise<T>;
  setSession: (token: string, user: User) => void;
  updateUser: (user: User) => void;
  logout: () => void;
  refreshStorefront: () => Promise<void>;
  refreshUserData: () => Promise<void>;
  addToCart: (productId: string, quantity?: number, selectedVariation?: string, promoCode?: string) => Promise<boolean>;
  applyCartPromo: (cartItemId: string, promoCode: string, remove?: boolean) => Promise<boolean>;
  updateCartQty: (cartItemId: string, quantity: number) => Promise<void>;
  removeCartItem: (cartItemId: string) => Promise<void>;
  toggleFavorite: (productId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  uploadImage: (file: File) => Promise<string>;
  subscribeWsMessage: (
    handler: (event: {
      type: string;
      conversationId?: string;
      message?: ChatMessage;
      orderId?: string;
      order?: Order;
      status?: string;
    }) => void
  ) => () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_TOKEN_KEY = 'orvexa_auth_token';
const STORAGE_USER_KEY = 'orvexa_auth_user';

function readStoredToken(): string | null {
  try {
    const val = window.localStorage.getItem(STORAGE_TOKEN_KEY);
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

function normalizeAuthUser(raw: any): User | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.role !== 'string') {
    return null;
  }
  return {
    ...raw,
    fullName: typeof raw.fullName === 'string' ? raw.fullName : '',
    username: typeof raw.username === 'string' ? raw.username : '',
    emailOrPhone: typeof raw.emailOrPhone === 'string' ? raw.emailOrPhone : '',
    status: typeof raw.status === 'string' ? raw.status : 'active',
  } as User;
}

function readStoredUser(): User | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_USER_KEY);
    if (!raw) return null;
    return normalizeAuthUser(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStoredSession(token: string | null, user: User | null): void {
  try {
    if (token && user) {
      window.localStorage.setItem(STORAGE_TOKEN_KEY, token);
      window.localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(STORAGE_TOKEN_KEY);
      window.localStorage.removeItem(STORAGE_USER_KEY);
    }
  } catch {
    // Ignore storage quota/privacy mode failures
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [user, setUser] = useState<User | null>(() => (readStoredToken() ? readStoredUser() : null));
  const [sessionChecked, setSessionChecked] = useState<boolean>(() => !readStoredToken());
  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;
  const [storefront, setStorefront] = useState<StorefrontData | null>(null);
  const [storefrontLoading, setStorefrontLoading] = useState(true);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [favorites, setFavorites] = useState<Product[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authPromptReason, setAuthPromptReason] = useState<string | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const wsListenersRef = useRef<Set<(event: any) => void>>(new Set());

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  const openAuthModal = useCallback((reason?: string, onAfterLogin?: () => void) => {
    setAuthPromptReason(reason || null);
    pendingActionRef.current = onAfterLogin || null;
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
    setAuthPromptReason(null);
    pendingActionRef.current = null;
  }, []);

  const apiFetch = useCallback(
    async <T = any>(url: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers || {});
      if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      headers.set('X-Requested-With', 'XMLHttpRequest');
      const activeToken = token || tokenRef.current || readStoredToken();
      if (activeToken) {
        headers.set('Authorization', `Bearer ${activeToken}`);
      }
      let res: Response;
      try {
        res = await orvexaFetch(url, { ...options, credentials: 'include', headers });
      } catch (err) {
        throw new Error(await toFriendlyFetchError(err, 'অনুরোধটি সম্পন্ন করা যায়নি।'));
      }
      const data = await safeParseJson<T & { error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || 'অনুরোধটি সম্পন্ন করা যায়নি।');
      }
      return data as T;
    },
    [token]
  );

  const refreshStorefront = useCallback(async () => {
    try {
      setStorefrontLoading(true);
      const res = await orvexaFetch('/api/storefront');
      if (res.ok) {
        const data = await safeParseJson<StorefrontData>(res);
        if (data && typeof data === 'object' && Array.isArray(data.categories) && data.settings) {
          setStorefront({
            ...data,
            categories: data.categories,
            homepageProductAds: Array.isArray(data.homepageProductAds) ? data.homepageProductAds : [],
            advertisements: Array.isArray(data.advertisements) ? data.advertisements : [],
          });
        }
      }
    } catch {
      // ignore transient network errors
    } finally {
      setStorefrontLoading(false);
    }
  }, []);

  const refreshUserData = useCallback(async () => {
    if (!sessionChecked) return;
    if (!token) {
      setCart([]);
      setFavorites([]);
      setNotifications([]);
      setConversations([]);
      return;
    }
    try {
      const [cartRes, favRes, notifRes, convRes] = await Promise.all([
        apiFetch<{ items: CartItem[] }>('/api/cart'),
        apiFetch<{ favorites: Product[] }>('/api/favorites'),
        apiFetch<{ notifications: NotificationItem[] }>('/api/notifications'),
        apiFetch<{ conversations: Conversation[] }>('/api/conversations'),
      ]);
      setCart(cartRes.items || []);
      setFavorites(favRes.favorites || []);
      setNotifications(notifRes.notifications || []);
      setConversations(convRes.conversations || []);
    } catch {
      // ignore
    }
  }, [sessionChecked, token, apiFetch]);

  useEffect(() => {
    refreshStorefront();
  }, [refreshStorefront]);

  // Restore & verify lifetime login session automatically on mount (supports both HttpOnly cookie & saved Bearer token)
  useEffect(() => {
    let active = true;
    const savedToken = readStoredToken();
    const reqHeaders: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
    if (savedToken) {
      reqHeaders.Authorization = `Bearer ${savedToken}`;
    }
    orvexaFetch('/api/auth/session', {
      credentials: 'include',
      headers: reqHeaders,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await safeParseJson<{ authenticated?: boolean; user?: User | null; token?: string | null }>(res);
        if (!active) return;
        const safeUser = normalizeAuthUser(data?.user);
        if (safeUser && typeof data?.token === 'string' && data.token) {
          tokenRef.current = data.token;
          setToken(data.token);
          setUser(safeUser);
          writeStoredSession(data.token, safeUser);
        } else if (data?.authenticated === false) {
          tokenRef.current = null;
          setToken(null);
          setUser(null);
          writeStoredSession(null, null);
        }
      })
      .catch(() => {
        // Keep cached session on transient network drops
      })
      .finally(() => {
        if (active) setSessionChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    refreshUserData();
  }, [refreshUserData]);

  const userId = user?.id || null;
  const userRole = user?.role || null;

  useEffect(() => {
    if (!sessionChecked || !token || !userId) {
      if (wsRef.current) {
        const prev = wsRef.current;
        wsRef.current = null;
        if (prev.readyState === WebSocket.OPEN) {
          prev.close();
        } else if (prev.readyState === WebSocket.CONNECTING) {
          prev.onerror = null;
          prev.onmessage = null;
          prev.onopen = () => prev.close();
        }
      }
      return;
    }

    const isAiStudioPreview =
      typeof window !== 'undefined' && /^ais-(dev|pre)-/i.test(window.location.hostname);
    const canUseWs = storefront?.wsEnabled === true && !isAiStudioPreview;
    let ws: WebSocket | null = null;
    let disposed = false;

    if (canUseWs) {
      try {
        ws = new WebSocket(getWsUrl());
        wsRef.current = ws;

        ws.onopen = () => {
          if (disposed) {
            ws?.close();
            return;
          }
          ws?.send(JSON.stringify({ type: 'auth', token }));
        };

        ws.onerror = () => {
          // Ignore transient WS errors; fallback poll keeps data synced
        };

        ws.onmessage = (evt) => {
          if (disposed) return;
          try {
            const data = JSON.parse(evt.data);
            if (data.type === 'notification:new' && data.notification) {
              setNotifications((prev) => [data.notification, ...prev]);
            } else if (data.type === 'message:new') {
              apiFetch<{ conversations: Conversation[] }>('/api/conversations')
                .then((r) => setConversations(r.conversations || []))
                .catch(() => {});
            } else if (data.type === 'order:new' && data.order && userRole === 'seller') {
              const o = data.order as Order;
              const loc = [o.thana, o.district].filter(Boolean).join(', ');
              showToast(
                `নতুন অর্ডার এসেছে! #${o.orderNumber} · ${o.customerName}${loc ? ` (${loc})` : ''}`,
                'success'
              );
            }
            wsListenersRef.current.forEach((cb) => cb(data));
          } catch {
            // ignore
          }
        };
      } catch {
        ws = null;
      }
    }

    // Fallback polling when WebSocket is unavailable (e.g. serverless/proxy hosts)
    const fallbackTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        Promise.all([
          apiFetch<{ notifications: NotificationItem[] }>('/api/notifications'),
          apiFetch<{ conversations: Conversation[] }>('/api/conversations'),
        ])
          .then(([nRes, cRes]) => {
            setNotifications(nRes.notifications || []);
            setConversations(cRes.conversations || []);
          })
          .catch(() => {});
      }
    }, 15000);

    return () => {
      disposed = true;
      clearInterval(fallbackTimer);
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.onerror = null;
          ws.onmessage = null;
          ws.onopen = () => ws?.close();
        }
      }
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [sessionChecked, token, userId, userRole, storefront?.wsEnabled, apiFetch, showToast]);

  const subscribeWsMessage = useCallback((handler: (event: any) => void) => {
    wsListenersRef.current.add(handler);
    return () => {
      wsListenersRef.current.delete(handler);
    };
  }, []);

  const setSession = useCallback((newToken: string, newUser: User) => {
    const safeUser = normalizeAuthUser(newUser);
    if (!newToken || !safeUser) return;
    tokenRef.current = newToken;
    writeStoredSession(newToken, safeUser);
    setSessionChecked(true);
    setToken(newToken);
    setUser(safeUser);
    setAuthModalOpen(false);
    setAuthPromptReason(null);
    const cb = pendingActionRef.current;
    pendingActionRef.current = null;
    if (cb) setTimeout(cb, 50);
  }, []);

  const updateUser = useCallback((updated: User) => {
    const safeUser = normalizeAuthUser(updated);
    if (!safeUser) return;
    setUser(safeUser);
    const activeToken = tokenRef.current || readStoredToken();
    if (activeToken) {
      writeStoredSession(activeToken, safeUser);
    }
  }, []);

  const logout = useCallback(() => {
    const activeToken = token || tokenRef.current || readStoredToken();
    orvexaFetch(
      '/api/auth/logout',
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
        },
      },
      { retryOnNetworkError: false }
    ).catch(() => {});
    tokenRef.current = null;
    writeStoredSession(null, null);
    setToken(null);
    setUser(null);
    setCart([]);
    setFavorites([]);
    setNotifications([]);
    setConversations([]);
    showToast('সফলভাবে লগআউট হয়েছে।', 'info');
  }, [showToast, token]);

  const addToCart = useCallback(
    async (productId: string, quantity = 1, selectedVariation?: string, promoCode?: string): Promise<boolean> => {
      if (!token || !user) {
        openAuthModal('কার্টে পণ্য যোগ করতে অনুগ্রহ করে সাইন ইন বা সাইন আপ করুন।');
        return false;
      }
      try {
        await apiFetch('/api/cart', {
          method: 'POST',
          body: JSON.stringify({ productId, quantity, selectedVariation, promoCode }),
        });
        const cartRes = await apiFetch<{ items: CartItem[] }>('/api/cart');
        setCart(cartRes.items || []);
        showToast('পণ্যটি কার্টে যোগ করা হয়েছে।', 'success');
        return true;
      } catch (err: any) {
        showToast(err.message || 'কার্টে যোগ করা যায়নি।', 'error');
        return false;
      }
    },
    [token, user, openAuthModal, apiFetch, showToast]
  );

  const applyCartPromo = useCallback(
    async (cartItemId: string, promoCode: string, remove = false): Promise<boolean> => {
      try {
        const res = await apiFetch<{ message: string }>(`/api/cart/${cartItemId}/promo`, {
          method: 'PATCH',
          body: JSON.stringify({ promoCode, remove }),
        });
        const cartRes = await apiFetch<{ items: CartItem[] }>('/api/cart');
        setCart(cartRes.items || []);
        showToast(res.message || 'প্রোমো কোড আপডেট হয়েছে।', remove ? 'info' : 'success');
        return true;
      } catch (err: any) {
        showToast(err.message || 'প্রোমো কোড সঠিক নয়।', 'error');
        return false;
      }
    },
    [apiFetch, showToast]
  );

  const updateCartQty = useCallback(
    async (cartItemId: string, quantity: number) => {
      try {
        await apiFetch(`/api/cart/${cartItemId}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity }),
        });
        const cartRes = await apiFetch<{ items: CartItem[] }>('/api/cart');
        setCart(cartRes.items || []);
      } catch (err: any) {
        showToast(err.message, 'error');
      }
    },
    [apiFetch, showToast]
  );

  const removeCartItem = useCallback(
    async (cartItemId: string) => {
      try {
        await apiFetch(`/api/cart/${cartItemId}`, { method: 'DELETE' });
        setCart((prev) => prev.filter((c) => c.id !== cartItemId));
        showToast('পণ্যটি কার্ট থেকে সরানো হয়েছে।', 'info');
      } catch (err: any) {
        showToast(err.message, 'error');
      }
    },
    [apiFetch, showToast]
  );

  const toggleFavorite = useCallback(
    async (productId: string) => {
      if (!token || !user) {
        openAuthModal('পছন্দের তালিকায় সংরক্ষণ করতে অনুগ্রহ করে সাইন ইন বা সাইন আপ করুন।');
        return;
      }
      try {
        const res = await apiFetch<{ favorited: boolean; message: string }>('/api/favorites/toggle', {
          method: 'POST',
          body: JSON.stringify({ productId }),
        });
        const favRes = await apiFetch<{ favorites: Product[] }>('/api/favorites');
        setFavorites(favRes.favorites || []);
        showToast(res.message, res.favorited ? 'success' : 'info');
      } catch (err: any) {
        showToast(err.message, 'error');
      }
    },
    [token, user, openAuthModal, apiFetch, showToast]
  );

  const markAllNotificationsRead = useCallback(async () => {
    if (!token) return;
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: 1 })));
    } catch {
      // ignore
    }
  }, [token, apiFetch]);

  const uploadImage = useCallback(
    async (file: File): Promise<string> => {
      const optimizedFile = await compressImageFile(file);
      const formData = new FormData();
      formData.append('image', optimizedFile);
      const res = await apiFetch<{ url: string }>('/api/upload', {
        method: 'POST',
        body: formData,
      });
      return res.url;
    },
    [apiFetch]
  );

  const favoriteIds = new Set(favorites.map((f) => f.id));
  const unreadNotifCount = notifications.filter((n) => !n.isRead).length;
  const unreadInboxCount = user
    ? conversations.reduce(
        (sum, c) => sum + (c.buyerId === user.id ? c.buyerUnread : c.sellerId === user.id ? c.sellerUnread : 0),
        0
      )
    : 0;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        storefront,
        storefrontLoading,
        cart,
        favorites,
        favoriteIds,
        notifications,
        conversations,
        unreadNotifCount,
        unreadInboxCount,
        toasts,
        authModalOpen,
        authPromptReason,
        openAuthModal,
        closeAuthModal,
        showToast,
        apiFetch,
        setSession,
        updateUser,
        logout,
        refreshStorefront,
        refreshUserData,
        addToCart,
        applyCartPromo,
        updateCartQty,
        removeCartItem,
        toggleFavorite,
        markAllNotificationsRead,
        uploadImage,
        subscribeWsMessage,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
