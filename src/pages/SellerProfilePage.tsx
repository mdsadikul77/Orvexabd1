import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  Inbox,
  MessageCircle,
  Package,
  Search,
  Share2,
  ShieldCheck,
  Star,
  Store,
  X,
} from 'lucide-react';
import { ProductCard } from '../components/ProductCard';
import { SafeImage } from '../components/SafeImage';
import { useAuth } from '../context/AuthContext';
import { orvexaFetch, safeParseJson } from '../lib/apiConfig';
import type { Product, PublicSellerProfile } from '../types';
import { formatDateTime, toBnDigits } from '../utils/format';

interface SellerProfilePageProps {
  sellerIdentifier: string;
  onBack: () => void;
  onOpenProduct: (product: Product) => void;
  onShareProduct: (product: Product) => void;
  onOpenInboxConversation: (conversationId: string) => void;
  onNavigateSellerDashboard?: () => void;
}

const sellerProfileCache = new Map<string, { seller: PublicSellerProfile; products: Product[] }>();

export function SellerProfilePage({
  sellerIdentifier,
  onBack,
  onOpenProduct,
  onShareProduct,
  onOpenInboxConversation,
  onNavigateSellerDashboard,
}: SellerProfilePageProps) {
  const cachedInitial = sellerProfileCache.get(sellerIdentifier.trim().toLowerCase());
  const { user, token, apiFetch, openAuthModal, showToast } = useAuth();
  const [seller, setSeller] = useState<PublicSellerProfile | null>(cachedInitial?.seller ?? null);
  const [products, setProducts] = useState<Product[]>(cachedInitial?.products ?? []);
  const [loading, setLoading] = useState(!cachedInitial);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCatId, setSelectedCatId] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc' | 'popular'>('newest');
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const cacheKey = sellerIdentifier.trim().toLowerCase();
    const cached = sellerProfileCache.get(cacheKey);
    const loadSellerProfile = async () => {
      if (cached) {
        setSeller(cached.seller);
        setProducts(cached.products);
        setLoading(false);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await orvexaFetch(`/api/sellers/${encodeURIComponent(sellerIdentifier)}`);
        const data = await safeParseJson<{
          seller?: PublicSellerProfile;
          products?: Product[];
          error?: string;
        }>(res);
        if (!res.ok || !data.seller) {
          throw new Error(data.error || 'সেলারের প্রোফাইল খুঁজে পাওয়া যায়নি।');
        }
        if (active) {
          const nextProducts = data.products || [];
          sellerProfileCache.set(cacheKey, { seller: data.seller, products: nextProducts });
          setSeller(data.seller);
          setProducts(nextProducts);
          if (!cached) {
            setSelectedCatId('all');
            setSearchQuery('');
          }
        }
      } catch (err: any) {
        if (active && !cached) {
          setSeller(null);
          setProducts([]);
          setError(err?.message || 'সেলারের প্রোফাইল লোড করা যায়নি।');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    loadSellerProfile();
    return () => {
      active = false;
    };
  }, [sellerIdentifier]);

  const sellerProfileUrl = seller
    ? `${window.location.origin}/seller/${encodeURIComponent(seller.username || seller.id)}`
    : `${window.location.origin}/seller/${encodeURIComponent(sellerIdentifier)}`;

  const handleCopyProfileLink = async () => {
    try {
      await navigator.clipboard.writeText(sellerProfileUrl);
      setCopiedLink(true);
      showToast('সেলারের প্রোফাইল লিংক কপি করা হয়েছে!', 'success');
      setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      showToast('লিংক কপি করা যায়নি। অনুগ্রহ করে ম্যানুয়ালি কপি করুন।', 'error');
    }
  };

  const handleInboxSeller = async () => {
    if (!seller) return;
    if (!token || !user) {
      openAuthModal('সেলারকে মেসেজ পাঠাতে অনুগ্রহ করে সাইন ইন বা সাইন আপ করুন।');
      return;
    }
    if (user.id === seller.id) {
      if (onNavigateSellerDashboard) {
        onNavigateSellerDashboard();
      } else {
        showToast('এটি আপনার নিজের সেলার প্রোফাইল।', 'info');
      }
      return;
    }
    try {
      const data = await apiFetch<{ conversation: { id: string } }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ sellerId: seller.id }),
      });
      onOpenInboxConversation(data.conversation.id);
    } catch (err: any) {
      showToast(err?.message || 'ইনবক্স খোলা যায়নি।', 'error');
    }
  };

  const handleNativeShare = async () => {
    if (!seller) return;
    const shareText = `${seller.shopName} (@${seller.username}) — Orvexa-তে বিশ্বস্ত সেলারের সকল পণ্য দেখুন`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: seller.shopName,
          text: shareText,
          url: sellerProfileUrl,
        });
        return;
      } catch {
        // cancelled or fallback
      }
    }
    setShareOpen(true);
  };

  const sellerCategories = useMemo(() => {
    const map = new Map<string, { id: string; label: string; count: number }>();
    for (const p of products) {
      const key = p.categoryId || 'other';
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          id: key,
          label: p.categoryNameBn || p.subcategory || 'অন্যান্য',
          count: 1,
        });
      }
    }
    return Array.from(map.values());
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = products.filter((p) => {
      if (selectedCatId !== 'all' && p.categoryId !== selectedCatId) return false;
      if (!q) return true;
      return (
        (p.name || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.subcategory || '').toLowerCase().includes(q) ||
        (p.categoryNameBn || '').toLowerCase().includes(q)
      );
    });
    if (sortBy === 'price_asc') {
      return [...list].sort((a, b) => a.currentPrice - b.currentPrice);
    }
    if (sortBy === 'price_desc') {
      return [...list].sort((a, b) => b.currentPrice - a.currentPrice);
    }
    if (sortBy === 'popular') {
      return [...list].sort((a, b) => b.views - a.views || b.ratingAvg - a.ratingAvg);
    }
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
  }, [products, searchQuery, selectedCatId, sortBy]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="glass-card rounded-3xl p-6 sm:p-8 animate-pulse space-y-5">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-white/10" />
            <div className="space-y-2.5 flex-1">
              <div className="h-6 bg-white/10 rounded w-1/3" />
              <div className="h-4 bg-white/10 rounded w-1/2" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-2xl bg-white/5" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!seller || error) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-5">
        <div className="w-16 h-16 mx-auto rounded-full bg-purple-500/15 border border-purple-400/30 flex items-center justify-center">
          <Store className="w-8 h-8 text-purple-300" />
        </div>
        <h2 className="text-xl font-bold text-white">{error || 'সেলারের প্রোফাইল খুঁজে পাওয়া যায়নি'}</h2>
        <p className="text-sm text-slate-400">
          প্রোফাইল লিংকটি সঠিক কিনা যাচাই করুন অথবা হোমপেজ থেকে অন্য সেলারের পণ্য দেখুন।
        </p>
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2.5 rounded-full glow-lime-btn text-sm font-bold"
        >
          হোমপেজে ফিরে যান
        </button>
      </div>
    );
  }

  const isOwnProfile = Boolean(user && user.id === seller.id);
  const shareText = `${seller.shopName} (@${seller.username}) — Orvexa-তে বিশ্বস্ত সেলারের সকল পণ্য দেখুন`;
  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${sellerProfileUrl}`)}`;
  const facebookShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(sellerProfileUrl)}`;

  return (
    <div className="max-w-7xl mx-auto px-3.5 sm:px-6 py-6 sm:py-8 space-y-7">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-[#C8FA50] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          ফিরে যান
        </button>

        <button
          type="button"
          onClick={handleCopyProfileLink}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-200 hover:border-[#C8FA50]/50 hover:text-[#C8FA50] transition-colors"
        >
          {copiedLink ? <Check className="w-3.5 h-3.5 text-[#C8FA50]" /> : <Copy className="w-3.5 h-3.5 text-[#C8FA50]" />}
          <span>{copiedLink ? 'লিংক কপি হয়েছে' : 'প্রোফাইল লিংক কপি'}</span>
        </button>
      </div>

      {/* Facebook / Instagram Style Seller Profile Cover & Header */}
      <section className="relative rounded-3xl overflow-hidden glass-card border border-purple-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
        {/* Ambient Cover Banner */}
        <div className="h-28 sm:h-36 bg-gradient-to-r from-purple-900/50 via-[#151829] to-[#C8FA50]/20 relative overflow-hidden border-b border-white/10">
          <div className="absolute -top-12 -right-12 w-60 h-60 rounded-full bg-purple-600/25 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-12 left-10 w-56 h-56 rounded-full bg-[#C8FA50]/15 blur-3xl pointer-events-none" />
          <div className="absolute top-3.5 right-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#090B12]/80 border border-[#C8FA50]/35 text-[11px] font-bold text-[#C8FA50] backdrop-blur-md">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>যাচাইকৃত সেলার শপ</span>
          </div>
        </div>

        <div className="px-5 sm:px-8 pb-6 sm:pb-8">
          {/* Avatar + Identity + Primary Actions */}
          <div className="-mt-11 sm:-mt-14 flex flex-col lg:flex-row lg:items-end justify-between gap-5">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 min-w-0">
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full neon-ring-purple p-[3px] bg-[#06070B] shrink-0 shadow-2xl">
                <div className="w-full h-full rounded-full overflow-hidden bg-[#0D101B] flex items-center justify-center">
                  {seller.avatarUrl ? (
                    <SafeImage
                      src={seller.avatarUrl}
                      alt={seller.shopName}
                      fallbackLabel={seller.shopName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Store className="w-10 h-10 text-[#C8FA50]" />
                  )}
                </div>
              </div>

              <div className="space-y-1.5 min-w-0 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight truncate">
                    {seller.shopName}
                  </h1>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#C8FA50]/15 border border-[#C8FA50]/40 text-[11px] font-bold text-[#C8FA50]">
                    <CheckCircle2 className="w-3 h-3" />
                    Verified
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                  <span className="font-mono text-purple-300 font-semibold">@{seller.username}</span>
                  <span aria-hidden="true">·</span>
                  <span>সেলার: <strong className="text-slate-200">{seller.fullName}</strong></span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    সদস্য: {formatDateTime(seller.createdAt)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {isOwnProfile ? (
                onNavigateSellerDashboard && (
                  <button
                    type="button"
                    onClick={onNavigateSellerDashboard}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full glow-lime-btn text-xs sm:text-sm font-bold"
                  >
                    <Store className="w-4 h-4" />
                    <span>সেলার ড্যাশবোর্ডে যান</span>
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={handleInboxSeller}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full glow-lime-btn text-xs sm:text-sm font-bold"
                >
                  <Inbox className="w-4 h-4" />
                  <span>মেসেজ করুন (Inbox)</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCopyProfileLink}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full glow-purple-btn text-xs font-bold"
              >
                {copiedLink ? <Check className="w-4 h-4 text-[#C8FA50]" /> : <Copy className="w-4 h-4" />}
                <span>{copiedLink ? 'কপি হয়েছে!' : 'প্রোফাইল লিংক কপি'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShareOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white/5 border border-white/15 hover:border-[#C8FA50]/50 text-xs font-semibold text-slate-200 transition-colors"
              >
                <Share2 className="w-4 h-4 text-[#C8FA50]" />
                <span>শেয়ার</span>
              </button>
            </div>
          </div>

          {/* Shop Description */}
          {seller.shopDescription && (
            <p className="mt-4 text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl bg-[#080B13]/80 border border-white/10 rounded-2xl p-4 whitespace-pre-line">
              {seller.shopDescription}
            </p>
          )}

          {/* Shareable Profile Link Bar (Easy copy for FB / IG / WhatsApp) */}
          <div className="mt-4 p-3.5 rounded-2xl bg-[#080A11] border border-white/10 flex flex-col sm:flex-row sm:items-center gap-2.5">
            <span className="text-[11px] font-semibold text-purple-300 whitespace-nowrap">
              সেলারের স্থায়ী প্রোফাইল লিংক:
            </span>
            <input
              type="text"
              readOnly
              value={sellerProfileUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="flex-1 min-w-0 text-xs font-mono bg-[#0D101B] border border-white/10 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-[#C8FA50]"
            />
            <button
              type="button"
              onClick={handleCopyProfileLink}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#C8FA50]/15 border border-[#C8FA50]/40 text-[#C8FA50] hover:bg-[#C8FA50]/25 text-xs font-bold shrink-0 transition-colors"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedLink ? 'কপি হয়েছে' : 'লিংক কপি করুন'}
            </button>
          </div>

          {shareOpen && (
            <div className="mt-3 p-4 rounded-2xl bg-[#0B0E17] border border-purple-400/35 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-300">
                এই লিংকটি Facebook, Instagram বা WhatsApp-এ শেয়ার করলে ক্রেতা সরাসরি{' '}
                <strong className="text-[#C8FA50]">{seller.shopName}</strong>-এর প্রোফাইলে চলে আসবেন।
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={whatsappShareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-400/40 bg-emerald-500/10 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/20"
                >
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </a>
                <a
                  href={facebookShareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-blue-400/40 bg-blue-500/10 text-blue-300 text-xs font-semibold hover:bg-blue-500/20"
                >
                  <Share2 className="w-3.5 h-3.5" /> Facebook
                </a>
                <button
                  type="button"
                  onClick={handleNativeShare}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-purple-400/40 bg-purple-500/15 text-purple-200 text-xs font-semibold hover:bg-purple-500/25"
                >
                  <Share2 className="w-3.5 h-3.5" /> শেয়ার অপশন
                </button>
                <button
                  type="button"
                  onClick={() => setShareOpen(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white"
                  aria-label="বন্ধ করুন"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Trust Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
            <div className="rounded-2xl bg-[#080B13] border border-white/10 p-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#C8FA50]/15 border border-[#C8FA50]/30 flex items-center justify-center shrink-0">
                <Package className="w-4 h-4 text-[#C8FA50]" />
              </div>
              <div>
                <div className="text-[11px] text-slate-400">আপলোডকৃত পণ্য</div>
                <div className="text-base sm:text-lg font-extrabold text-white tabular-nums">
                  {toBnDigits(seller.stats?.totalProducts ?? products.length)}টি
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-[#080B13] border border-white/10 p-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="text-[11px] text-slate-400">সফল ডেলিভারি</div>
                <div className="text-base sm:text-lg font-extrabold text-emerald-300 tabular-nums">
                  {toBnDigits(seller.stats?.deliveredOrders ?? 0)}টি
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-[#080B13] border border-white/10 p-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center shrink-0">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              </div>
              <div>
                <div className="text-[11px] text-slate-400">ক্রেতা রেটিং</div>
                <div className="text-base sm:text-lg font-extrabold text-amber-300 tabular-nums">
                  {(seller.stats?.totalReviews ?? 0) > 0
                    ? `${seller.stats?.avgRating ?? 0} (${toBnDigits(seller.stats?.totalReviews ?? 0)})`
                    : 'নতুন শপ'}
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-[#080B13] border border-white/10 p-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-400/30 flex items-center justify-center shrink-0">
                <Eye className="w-4 h-4 text-purple-300" />
              </div>
              <div>
                <div className="text-[11px] text-slate-400">মোট পণ্যের ভিউ</div>
                <div className="text-base sm:text-lg font-extrabold text-white tabular-nums">
                  {toBnDigits(seller.stats?.totalViews ?? 0)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Seller Uploaded Products Feed */}
      <section className="space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Store className="w-5 h-5 text-[#C8FA50]" />
              <span>{seller.shopName}-এর সকল পণ্য ({toBnDigits(products.length)}টি)</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              এই সেলারের আপলোড করা যেকোনো পণ্য এখান থেকেই বিস্তারিত দেখে অর্ডার বা কার্টে যোগ করতে পারবেন
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="শপের ভেতরে পণ্য খুঁজুন..."
                className="w-full pl-9 pr-3.5 py-2 text-xs sm:text-sm bg-[#0D101A] border border-white/15 rounded-full text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
              />
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3.5 py-2 rounded-full border border-white/15 bg-[#0D101A] text-xs font-medium text-slate-200 focus:outline-none focus:border-[#C8FA50]"
              aria-label="পণ্য সাজান"
            >
              <option value="newest">সর্বশেষ আপলোড</option>
              <option value="popular">সবচেয়ে জনপ্রিয়</option>
              <option value="price_asc">দাম: কম থেকে বেশি</option>
              <option value="price_desc">দাম: বেশি থেকে কম</option>
            </select>
          </div>
        </div>

        {sellerCategories.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
            <button
              type="button"
              onClick={() => setSelectedCatId('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                selectedCatId === 'all'
                  ? 'bg-[#C8FA50] text-slate-950'
                  : 'bg-white/5 border border-white/10 text-slate-300 hover:text-white'
              }`}
            >
              সব পণ্য ({toBnDigits(products.length)})
            </button>
            {sellerCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCatId(cat.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  selectedCatId === cat.id
                    ? 'bg-[#C8FA50] text-slate-950'
                    : 'bg-white/5 border border-white/10 text-slate-300 hover:text-white'
                }`}
              >
                {cat.label} ({toBnDigits(cat.count)})
              </button>
            ))}
          </div>
        )}

        {filteredProducts.length === 0 ? (
          <div className="glass-card rounded-2xl p-12 text-center space-y-3">
            <Package className="w-10 h-10 text-slate-600 mx-auto" />
            <h3 className="text-base font-semibold text-white">
              {products.length === 0 ? 'এই সেলার এখনো কোনো পণ্য আপলোড করেননি' : 'আপনার সার্চ অনুযায়ী কোনো পণ্য মেলেনি'}
            </h3>
            {products.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCatId('all');
                }}
                className="px-5 py-2 rounded-full glow-lime-btn text-xs font-bold"
              >
                শপের সব পণ্য দেখুন
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5">
            {filteredProducts.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onOpenProduct={onOpenProduct}
                onShareProduct={onShareProduct}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
