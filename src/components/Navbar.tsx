import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Grid,
  Heart,
  Home,
  MessageSquare,
  Search,
  ShoppingBag,
  Store,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatTimeAgo } from '../utils/format';

export type AppView =
  | 'home'
  | 'search'
  | 'categories'
  | 'product'
  | 'page'
  | 'inbox'
  | 'cart'
  | 'favorites'
  | 'profile'
  | 'seller'
  | 'seller-profile'
  | 'seller-ads'
  | 'admin';

interface NavbarProps {
  activeView: AppView;
  activeCustomSlug?: string | null;
  onNavigate: (view: AppView) => void;
  onOpenCustomPage?: (slug: string) => void;
  onOpenSellerOrders?: (orderId?: string) => void;
}

export function Navbar({
  activeView,
  activeCustomSlug = null,
  onNavigate,
  onOpenCustomPage,
  onOpenSellerOrders,
}: NavbarProps) {
  const {
    user,
    cart,
    favorites,
    notifications,
    unreadNotifCount,
    unreadInboxCount,
    markAllNotificationsRead,
    openAuthModal,
    storefront,
  } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!notifOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (notifBoxRef.current && !notifBoxRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [notifOpen]);

  const cartCount = (cart || []).reduce((sum, item) => sum + Number(item?.quantity || 0), 0);
  const announcement = storefront?.settings?.generalSettings;

  const handleProtectedNav = (view: AppView, reason: string) => {
    if (!user && (view === 'inbox' || view === 'cart' || view === 'favorites')) {
      openAuthModal(reason, () => onNavigate(view));
      return;
    }
    onNavigate(view);
  };

  return (
    <>
      {announcement?.announcementActive && announcement.announcementText && (
        <div className="bg-[#0B0D14] border-b border-white/10 text-slate-300 text-[11px] py-1.5 px-4 text-center truncate">
          <span className="text-[#C8FA50] font-medium mr-1.5">•</span>
          {announcement.announcementText}
        </div>
      )}

      <header className="sticky top-0 z-40 bg-[#07090F]/85 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4 lg:gap-8">
          {/* Zone 1: Orvexa Brand Logo & Wordmark */}
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="flex items-center gap-2.5 text-lg sm:text-xl font-bold tracking-tight whitespace-nowrap shrink-0 focus-visible:outline-none"
          >
            <img
              src="/assets/aistudio/file_000000006e008208abb53399401b7236_1c57ca49.png"
              alt="Orvexa Logo"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover ring-1 ring-purple-400/50 shadow-[0_0_14px_rgba(168,85,247,0.45)] shrink-0"
            />
            <span className="text-[#D9FF5B] tracking-tight">Orvexa</span>
          </button>

          {/* Zone 2: Desktop Single-line Nav Links */}
          <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-slate-400">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeView === 'home'
                  ? 'border-[#C8FA50] text-white font-semibold'
                  : 'border-transparent hover:text-white'
              }`}
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => onNavigate('categories')}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeView === 'categories'
                  ? 'border-[#C8FA50] text-white font-semibold'
                  : 'border-transparent hover:text-white'
              }`}
            >
              Categories
            </button>
            <button
              type="button"
              onClick={() => handleProtectedNav('inbox', 'সেলার বা ক্রেতার সাথে মেসেজ দেখতে অনুগ্রহ করে সাইন ইন করুন।')}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                activeView === 'inbox'
                  ? 'border-[#C8FA50] text-white font-semibold'
                  : 'border-transparent hover:text-white'
              }`}
            >
              <span>Inbox</span>
              {unreadInboxCount > 0 && (
                <span className="text-[11px] font-bold bg-[#C8FA50] text-slate-950 px-1.5 py-0.2 rounded-md tabular-nums">
                  {unreadInboxCount}
                </span>
              )}
            </button>
            {user?.role === 'seller' && (
              <button
                type="button"
                onClick={() => onNavigate('seller')}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  activeView === 'seller' || activeView === 'seller-ads'
                    ? 'border-[#C8FA50] text-[#C8FA50] font-semibold'
                    : 'border-transparent hover:text-white'
                }`}
              >
                <Store className="w-3.5 h-3.5" />
                <span>Seller</span>
              </button>
            )}
            {user?.role === 'admin' && (
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  activeView === 'admin'
                    ? 'border-[#A855F7] text-[#C084FC] font-semibold'
                    : 'border-transparent hover:text-white'
                }`}
              >
                Admin
              </button>
            )}
            {onOpenCustomPage &&
              (storefront?.settings?.customPages || [])
                .filter((p) => p.isActive && p.showInNavbar)
                .slice(0, 3)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onOpenCustomPage(p.slug)}
                    className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors max-w-[120px] truncate ${
                      activeView === 'page' && activeCustomSlug === p.slug
                        ? 'border-[#C8FA50] text-white font-semibold'
                        : 'border-transparent hover:text-white'
                    }`}
                  >
                    {p.title}
                  </button>
                ))}
          </nav>

          {/* Zone 3: Reference-matched Icon Action Cluster + Profile */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {user?.role === 'seller' && (
              <button
                type="button"
                onClick={() => onNavigate('seller')}
                className={`lg:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 ${
                  activeView === 'seller' || activeView === 'seller-ads'
                    ? 'border-[#C8FA50] bg-[#C8FA50]/15 text-[#C8FA50]'
                    : 'border-purple-400/35 bg-purple-500/10 text-purple-200 hover:border-[#C8FA50]/50'
                }`}
              >
                <Store className="w-3.5 h-3.5 text-[#C8FA50]" />
                <span>Seller</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('search')}
              className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
              aria-label="Search"
              title="Search"
            >
              <Search className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => handleProtectedNav('favorites', 'পছন্দের পণ্য দেখতে অনুগ্রহ করে সাইন ইন করুন।')}
              className="relative p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
              aria-label="Favorites"
              title="Favorites"
            >
              <Heart className={`w-5 h-5 ${activeView === 'favorites' ? 'text-[#C8FA50]' : ''}`} />
              {favorites.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#A855F7]" />
              )}
            </button>

            <button
              type="button"
              onClick={() => handleProtectedNav('cart', 'আপনার কার্ট দেখতে অনুগ্রহ করে সাইন ইন করুন।')}
              className="relative p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
              aria-label="Cart"
              title="Cart"
            >
              <ShoppingBag className={`w-5 h-5 ${activeView === 'cart' ? 'text-[#C8FA50]' : ''}`} />
              {cartCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#C8FA50] text-slate-950 text-[10px] font-extrabold flex items-center justify-center tabular-nums">
                  {cartCount}
                </span>
              )}
            </button>

            {user && (
              <div ref={notifBoxRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    const next = !notifOpen;
                    setNotifOpen(next);
                    if (next && unreadNotifCount > 0) markAllNotificationsRead();
                  }}
                  className="relative p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                  aria-label="নোটিফিকেশন"
                >
                  <Bell className="w-5 h-5" />
                  {unreadNotifCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#A855F7] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {unreadNotifCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 max-w-[90vw] glass-panel rounded-xl shadow-2xl overflow-hidden z-50">
                    <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">নোটিফিকেশন</span>
                      <button
                        type="button"
                        onClick={() => setNotifOpen(false)}
                        className="text-xs text-slate-400 hover:text-white"
                      >
                        বন্ধ করুন
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-white/10">
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-400">কোনো নতুন নোটিফিকেশন নেই।</div>
                      ) : (
                        notifications.slice(0, 12).map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => {
                              setNotifOpen(false);
                              if (n.link === '/inbox') {
                                onNavigate('inbox');
                              } else if (n.link?.startsWith('/seller/orders')) {
                                const orderId = n.link.replace('/seller/orders/', '').replace('/seller/orders', '').trim();
                                if (onOpenSellerOrders) {
                                  onOpenSellerOrders(orderId || undefined);
                                } else {
                                  onNavigate('seller');
                                }
                              } else if (n.link === '/seller') {
                                onNavigate('seller');
                              } else {
                                onNavigate('profile');
                              }
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors"
                          >
                            <div className="text-xs font-semibold text-white">{n.title}</div>
                            <div className="text-xs text-slate-400 mt-0.5 line-clamp-2">{n.body}</div>
                            <div className="text-[11px] text-slate-500 mt-1">{formatTimeAgo(n.createdAt)}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeView === 'profile'
                  ? 'border-[#C8FA50] bg-[#C8FA50]/10 text-[#C8FA50]'
                  : 'border-white/15 bg-white/5 text-slate-200 hover:border-purple-400/50 hover:text-white'
              }`}
              aria-label="Profile"
            >
              <UserIcon className="w-4 h-4" />
              <span className="hidden sm:inline max-w-[100px] truncate">
                {user ? (user.role === 'admin' ? 'Admin' : (user.fullName || user.username || 'Account').split(' ')[0]) : 'Account'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#080A11]/95 backdrop-blur-xl border-t border-white/10 px-2 h-14 flex items-center justify-around"
      >
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className={`flex flex-col items-center justify-center gap-0.5 min-w-[54px] py-1 text-[11px] font-medium transition-colors ${
            activeView === 'home' ? 'text-[#C8FA50]' : 'text-slate-400'
          }`}
        >
          <Home className="w-5 h-5" />
          <span>Home</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('categories')}
          className={`flex flex-col items-center justify-center gap-0.5 min-w-[54px] py-1 text-[11px] font-medium transition-colors ${
            activeView === 'categories' ? 'text-[#C8FA50]' : 'text-slate-400'
          }`}
        >
          <Grid className="w-5 h-5" />
          <span>Categories</span>
        </button>

        <button
          type="button"
          onClick={() => handleProtectedNav('inbox', 'ইনবক্স ব্যবহার করতে অনুগ্রহ করে সাইন ইন করুন।')}
          className={`relative flex flex-col items-center justify-center gap-0.5 min-w-[54px] py-1 text-[11px] font-medium transition-colors ${
            activeView === 'inbox' ? 'text-[#C8FA50]' : 'text-slate-400'
          }`}
        >
          <MessageSquare className="w-5 h-5" />
          <span>Inbox</span>
          {unreadInboxCount > 0 && (
            <span className="absolute top-0.5 right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[#C8FA50] text-slate-950 text-[10px] font-bold flex items-center justify-center tabular-nums">
              {unreadInboxCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => handleProtectedNav('cart', 'আপনার কার্ট দেখতে অনুগ্রহ করে সাইন ইন করুন।')}
          className={`relative flex flex-col items-center justify-center gap-0.5 min-w-[54px] py-1 text-[11px] font-medium transition-colors ${
            activeView === 'cart' ? 'text-[#C8FA50]' : 'text-slate-400'
          }`}
        >
          <ShoppingBag className="w-5 h-5" />
          <span>Cart</span>
          {cartCount > 0 && (
            <span className="absolute top-0.5 right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-[#A855F7] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
              {cartCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onNavigate('profile')}
          className={`flex flex-col items-center justify-center gap-0.5 min-w-[54px] py-1 text-[11px] font-medium transition-colors ${
            activeView === 'profile' || activeView === 'seller' || activeView === 'admin'
              ? 'text-[#C8FA50]'
              : 'text-slate-400'
          }`}
        >
          <UserIcon className="w-5 h-5" />
          <span>Profile</span>
        </button>
      </nav>
    </>
  );
}
