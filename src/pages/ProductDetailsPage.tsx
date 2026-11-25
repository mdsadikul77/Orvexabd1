import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Flag,
  Heart,
  Inbox,
  Minus,
  Plus,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Star,
  Store,
  Ticket,
  User as UserIcon,
  X,
} from 'lucide-react';
import { AdSlot } from '../components/AdSlot';
import { SafeImage } from '../components/SafeImage';
import { useAuth } from '../context/AuthContext';
import { orvexaFetch, safeParseJson, toFriendlyFetchError } from '../lib/apiConfig';
import type { Product, Review } from '../types';
import { formatDateTime, formatPrice, getDiscountPercent } from '../utils/format';

interface ProductDetailsPageProps {
  productId: string;
  onBack: () => void;
  onShareProduct: (product: Product) => void;
  onOpenSeller?: (sellerIdentifier: string) => void;
  onOpenInboxConversation: (conversationId: string) => void;
  onGoToCartCheckout: () => void;
}

export function ProductDetailsPage({
  productId,
  onBack,
  onShareProduct,
  onOpenSeller,
  onOpenInboxConversation,
  onGoToCartCheckout,
}: ProductDetailsPageProps) {
  const { user, token, apiFetch, addToCart, toggleFavorite, favoriteIds, openAuthModal, showToast, storefront } =
    useAuth();

  const [product, setProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [selectedSize, setSelectedSize] = useState<string>('');
  const [selectedColor, setSelectedColor] = useState<string>('');

  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportType, setReportType] = useState<'product_report' | 'seller_report'>('product_report');
  const [reportText, setReportText] = useState('');

  const [promoOpen, setPromoOpen] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discount: number;
    finalPrice: number;
  } | null>(null);
  const [copiedSellerLink, setCopiedSellerLink] = useState(false);

  useEffect(() => {
    let active = true;
    setAppliedPromo(null);
    setPromoOpen(false);
    setPromoInput('');
    setPromoError(null);
    const load = async () => {
      setLoading(true);
      try {
        const res = await orvexaFetch(`/api/products/${encodeURIComponent(productId)}`);
        if (!res.ok) throw new Error('পণ্যটি পাওয়া যায়নি।');
        const data = await safeParseJson(res);
        if (active) {
          setProduct(data.product);
          setReviews(data.reviews || []);
          setActiveImageIdx(0);
          setQuantity(1);
          setSelectedSize(data.product?.variations?.sizes?.[0] || '');
          setSelectedColor(data.product?.variations?.colors?.[0] || '');
        }
      } catch {
        if (active) setProduct(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [productId]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="animate-pulse grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="aspect-[4/3] bg-white/5 rounded-2xl" />
          <div className="space-y-4">
            <div className="h-6 bg-white/10 rounded w-3/4" />
            <div className="h-8 bg-white/10 rounded w-1/3" />
            <div className="h-24 bg-white/10 rounded w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
        <h2 className="text-xl font-bold text-white">দুঃখিত, পণ্যটি খুঁজে পাওয়া যায়নি</h2>
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

  const discount = getDiscountPercent(product.previousPrice, product.currentPrice);
  const isFav = favoriteIds.has(product.id);
  const variationString = [selectedSize, selectedColor].filter(Boolean).join(' · ') || undefined;
  const sellerTarget = product.sellerUsername || product.sellerId;
  const sellerProfileUrl = `${window.location.origin}/seller/${encodeURIComponent(sellerTarget)}`;

  const handleCopySellerLink = async () => {
    try {
      await navigator.clipboard.writeText(sellerProfileUrl);
      setCopiedSellerLink(true);
      showToast('সেলারের প্রোফাইল লিংক কপি করা হয়েছে!', 'success');
      setTimeout(() => setCopiedSellerLink(false), 2000);
    } catch {
      showToast('লিংক কপি করা যায়নি।', 'error');
    }
  };

  const handleInboxSeller = async () => {
    if (!token || !user) {
      openAuthModal('সেলারকে মেসেজ পাঠাতে অনুগ্রহ করে সাইন ইন বা সাইন আপ করুন।');
      return;
    }
    if (user.id === product.sellerId) {
      showToast('এটি আপনার নিজের আপলোড করা পণ্য।', 'info');
      return;
    }
    try {
      const data = await apiFetch<{ conversation: { id: string } }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ sellerId: product.sellerId, productId: product.id }),
      });
      onOpenInboxConversation(data.conversation.id);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleVerifyPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = promoInput.trim();
    if (!clean) {
      setPromoError('অনুগ্রহ করে ৭ অক্ষরের প্রোমো কোড লিখুন।');
      return;
    }
    setPromoChecking(true);
    setPromoError(null);
    try {
      const res = await orvexaFetch(`/api/products/${encodeURIComponent(product.id)}/verify-promo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promoCode: clean }),
      });
      const data = await safeParseJson<{
        promoCode?: string;
        promoDiscount?: number;
        finalPrice?: number;
        message?: string;
        error?: string;
      }>(res);
      if (!res.ok || !data.promoCode || !data.promoDiscount) {
        throw new Error(data.error || 'প্রোমো কোডটি সঠিক নয়।');
      }
      setAppliedPromo({
        code: data.promoCode,
        discount: data.promoDiscount,
        finalPrice: data.finalPrice ?? Math.max(1, product.currentPrice - data.promoDiscount),
      });
      setPromoOpen(false);
      showToast(data.message || 'প্রোমো কোড সফলভাবে প্রয়োগ হয়েছে!', 'success');
    } catch (err: any) {
      setPromoError(err.message || 'প্রোমো কোড যাচাই করা যায়নি।');
    } finally {
      setPromoChecking(false);
    }
  };

  const handleBuyNow = async () => {
    if (!token || !user) {
      openAuthModal('অর্ডার সম্পন্ন করতে অনুগ্রহ করে সাইন ইন বা সাইন আপ করুন।');
      return;
    }
    const ok = await addToCart(product.id, quantity, variationString, appliedPromo?.code);
    if (ok) onGoToCartCheckout();
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !user) {
      openAuthModal('রিভিউ দিতে অনুগ্রহ করে সাইন ইন করুন।');
      return;
    }
    setReviewSubmitting(true);
    try {
      const data = await apiFetch<{ review: Review; ratingAvg?: number; ratingCount?: number }>(
        `/api/products/${product.id}/reviews`,
        {
          method: 'POST',
          body: JSON.stringify({ rating: reviewRating, comment: reviewComment }),
        }
      );
      setReviews((prev) => [data.review, ...prev]);
      setProduct((prev) =>
        prev
          ? {
              ...prev,
              ratingAvg: data.ratingAvg ?? prev.ratingAvg,
              ratingCount: data.ratingCount ?? prev.ratingCount + 1,
            }
          : prev
      );
      setReviewComment('');
      showToast('আপনার রিভিউ যুক্ত হয়েছে!', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await orvexaFetch(
        '/api/reports',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            reporterName: user?.fullName || 'ভিজিটর',
            reportType,
            targetId: reportType === 'product_report' ? product.id : product.sellerId,
            targetName: reportType === 'product_report' ? product.name : product.shopName,
            subject: `${reportType === 'product_report' ? 'পণ্য' : 'সেলার'} রিপোর্ট`,
            message: reportText,
          }),
        },
        { retryOnNetworkError: true }
      );
      const data = await safeParseJson(res);
      if (!res.ok) throw new Error(data.error || 'রিপোর্ট পাঠানো যায়নি।');
      showToast('রিপোর্ট অ্যাডমিনের কাছে পাঠানো হয়েছে।', 'success');
      setReportText('');
      setReportOpen(false);
    } catch (err: any) {
      showToast(await toFriendlyFetchError(err, 'রিপোর্ট পাঠানো যায়নি।'), 'error');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-10">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-[#C8FA50]"
        >
          <ArrowLeft className="w-4 h-4" />
          ফিরে যান
        </button>

        <button
          type="button"
          onClick={() => setReportOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-rose-400"
        >
          <Flag className="w-3.5 h-3.5" />
          রিপোর্ট করুন
        </button>
      </div>

      {reportOpen && (
        <form onSubmit={handleReportSubmit} className="glass-card rounded-2xl p-5 space-y-3">
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <h3 className="text-sm font-semibold text-white">পণ্য বা সেলার সম্পর্কে অভিযোগ জানান</h3>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as any)}
              className="px-3 py-1.5 text-xs bg-[#080A11] border border-white/15 rounded-lg text-white"
            >
              <option value="product_report">পণ্য রিপোর্ট</option>
              <option value="seller_report">সেলার রিপোর্ট</option>
            </select>
          </div>
          <textarea
            required
            rows={2}
            value={reportText}
            onChange={(e) => setReportText(e.target.value)}
            placeholder="সমস্যার বিস্তারিত বিবরণ লিখুন..."
            className="w-full px-3 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-full bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500"
          >
            অভিযোগ জমা দিন
          </button>
        </form>
      )}

      {/* Main Contiguous Product Showcase + Purchase Module */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-6 space-y-3">
          <div className="aspect-[4/3] rounded-2xl overflow-hidden glass-card relative">
            <SafeImage
              src={product.images?.[activeImageIdx] || product.images?.[0]}
              alt={product.name}
              fallbackLabel={product.name}
              className="w-full h-full object-cover"
            />
            {discount !== null && (
              <span className="absolute top-3 left-3 bg-purple-600/90 text-white text-xs font-bold px-3 py-1 rounded-full tabular-nums">
                {discount}% ছাড়
              </span>
            )}
          </div>

          {product.images && product.images.length > 1 && (
            <div className="flex items-center gap-3 overflow-x-auto pb-1">
              {product.images.map((img, idx) => (
                <button
                  key={`${img}-${idx}`}
                  type="button"
                  onClick={() => setActiveImageIdx(idx)}
                  className={`w-20 h-16 rounded-xl overflow-hidden border-2 shrink-0 transition-all ${
                    idx === activeImageIdx ? 'border-[#C8FA50]' : 'border-white/10 opacity-70 hover:opacity-100'
                  }`}
                >
                  <SafeImage src={img} alt={`${product.name} ${idx + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-6 glass-card rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="text-purple-300">{product.categoryNameBn || product.categoryId}</span>
              <span aria-hidden="true">·</span>
              <span>{product.subcategory}</span>
              <span aria-hidden="true">·</span>
              <span className={product.stock > 0 ? 'text-[#C8FA50] font-medium' : 'text-rose-400 font-medium'}>
                {product.stock > 0 ? `স্টকে আছে (${product.stock}টি)` : 'স্টক শেষ'}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">{product.name}</h1>

            <div className="flex items-center gap-3 pt-1">
              <div className="inline-flex items-center gap-1 text-sm font-medium text-amber-400">
                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                <span className="tabular-nums">{product.ratingAvg}</span>
              </div>
              <span className="text-xs text-slate-400">({product.ratingCount} টি রিভিউ · {product.views} বার দেখা হয়েছে)</span>
            </div>
          </div>

          <div className="py-3 border-y border-white/10 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-3xl font-bold text-[#D9FF5B] tabular-nums">
                  {formatPrice(appliedPromo ? appliedPromo.finalPrice : product.currentPrice)}
                </span>
                {appliedPromo ? (
                  <>
                    <span className="text-base text-slate-500 line-through tabular-nums">
                      {formatPrice(product.currentPrice)}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-[#C8FA50] bg-[#C8FA50]/15 border border-[#C8FA50]/35 px-2.5 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      প্রোমো ছাড় -{formatPrice(appliedPromo.discount)}
                    </span>
                  </>
                ) : (
                  product.previousPrice &&
                  product.previousPrice > product.currentPrice && (
                    <>
                      <span className="text-base text-slate-500 line-through tabular-nums">
                        {formatPrice(product.previousPrice)}
                      </span>
                      {discount !== null && (
                        <span className="text-xs font-semibold text-[#C084FC]">সাশ্রয় {discount}%</span>
                      )}
                    </>
                  )
                )}
              </div>

              {product.hasPromoCode && !appliedPromo && (
                <button
                  type="button"
                  onClick={() => {
                    setPromoOpen((v) => !v);
                    setPromoError(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-purple-500/15 border border-purple-400/35 text-xs font-bold text-[#C084FC] hover:border-[#C8FA50]/60 hover:text-[#C8FA50] transition-colors"
                >
                  <Ticket className="w-3.5 h-3.5" />
                  প্রোমো কোড
                </button>
              )}
            </div>

            {product.hasPromoCode && promoOpen && !appliedPromo && (
              <form
                onSubmit={handleVerifyPromo}
                className="p-3.5 rounded-2xl bg-[#080A11] border border-purple-400/35 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-purple-200">
                    এই পণ্যটির ৭ অক্ষরের প্রোমো কোড দিন
                  </span>
                  <button
                    type="button"
                    onClick={() => setPromoOpen(false)}
                    className="p-1 text-slate-400 hover:text-white"
                    aria-label="বন্ধ করুন"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={12}
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value)}
                    placeholder="যেমন: Ab3xK9p"
                    className="flex-1 px-3 py-2 text-xs font-mono bg-[#121625] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
                  />
                  <button
                    type="submit"
                    disabled={promoChecking}
                    className="px-4 py-2 rounded-xl glow-lime-btn text-xs font-bold whitespace-nowrap disabled:opacity-55"
                  >
                    {promoChecking ? 'যাচাই হচ্ছে...' : 'যাচাই করুন'}
                  </button>
                </div>
                {promoError && <p className="text-[11px] font-medium text-rose-400">{promoError}</p>}
              </form>
            )}

            {appliedPromo && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#C8FA50]/10 border border-[#C8FA50]/35 text-xs">
                <span className="text-slate-200">
                  কোড <strong className="font-mono text-[#C8FA50]">{appliedPromo.code}</strong> প্রয়োগ হয়েছে — এই পণ্যে{' '}
                  <strong className="text-[#C8FA50]">{formatPrice(appliedPromo.discount)}</strong> ছাড় পাচ্ছেন!
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAppliedPromo(null);
                    setPromoInput('');
                  }}
                  className="text-[11px] font-semibold text-rose-300 hover:underline shrink-0"
                >
                  সরান
                </button>
              </div>
            )}
          </div>

          {product.variations?.sizes && product.variations.sizes.length > 0 && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-300">সাইজ / ভ্যারিয়েন্ট নির্বাচন করুন</label>
              <div className="flex flex-wrap gap-2">
                {product.variations.sizes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSelectedSize(s)}
                    className={`px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-colors ${
                      selectedSize === s
                        ? 'border-[#C8FA50] bg-[#C8FA50]/15 text-[#C8FA50]'
                        : 'border-white/15 text-slate-300 hover:border-white/30'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {product.variations?.colors && product.variations.colors.length > 0 && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-300">রঙ (Color)</label>
              <div className="flex flex-wrap gap-2">
                {product.variations.colors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSelectedColor(c)}
                    className={`px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-colors ${
                      selectedColor === c
                        ? 'border-[#A855F7] bg-purple-500/20 text-[#C084FC]'
                        : 'border-white/15 text-slate-300 hover:border-white/30'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold text-slate-300">পরিমাণ:</span>
            <div className="inline-flex items-center border border-white/15 rounded-full bg-[#080A11]">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="p-2.5 text-slate-300 hover:text-white"
                aria-label="কমান"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-10 text-center text-sm font-semibold text-white tabular-nums">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(Math.max(1, product.stock), q + 1))}
                className="p-2.5 text-slate-300 hover:text-white"
                aria-label="বাড়ান"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={product.stock < 1}
              onClick={() => addToCart(product.id, quantity, variationString, appliedPromo?.code)}
              className="inline-flex items-center justify-center gap-2 py-3 px-4 rounded-full glow-purple-btn disabled:opacity-50 text-sm font-semibold transition-all"
            >
              <ShoppingCart className="w-4 h-4" />
              কার্টে যোগ করুন
            </button>

            <button
              type="button"
              disabled={product.stock < 1}
              onClick={handleBuyNow}
              className="inline-flex items-center justify-center gap-2 py-3 px-4 rounded-full glow-lime-btn disabled:opacity-50 text-sm font-bold transition-all"
            >
              <ShoppingBag className="w-4 h-4" />
              এখনই কিনুন (Buy Now)
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleInboxSeller}
              className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-full bg-white/10 border border-white/15 hover:border-[#C8FA50]/50 text-white text-sm font-semibold transition-colors"
            >
              <Inbox className="w-4 h-4 text-[#C8FA50]" />
              <span>Inbox Seller</span>
            </button>

            {onOpenSeller && (
              <button
                type="button"
                onClick={() => onOpenSeller(sellerTarget)}
                className="inline-flex items-center gap-1.5 py-2.5 px-4 rounded-full bg-purple-500/15 border border-purple-400/40 text-purple-200 hover:border-[#C8FA50]/50 hover:text-[#C8FA50] text-xs font-bold transition-colors"
              >
                <UserIcon className="w-4 h-4 text-[#C8FA50]" />
                <span>সেলার প্রোফাইল</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => toggleFavorite(product.id)}
              className={`inline-flex items-center gap-1.5 py-2.5 px-4 rounded-full border text-xs font-semibold transition-colors ${
                isFav
                  ? 'border-rose-400/50 bg-rose-500/15 text-rose-400'
                  : 'border-white/15 text-slate-300 hover:text-white'
              }`}
            >
              <Heart className={`w-4 h-4 ${isFav ? 'fill-rose-400 text-rose-400' : ''}`} />
              <span>{isFav ? 'সংরক্ষিত' : 'পছন্দ'}</span>
            </button>

            <button
              type="button"
              onClick={() => onShareProduct(product)}
              className="inline-flex items-center gap-1.5 py-2.5 px-4 rounded-full border border-white/15 text-slate-300 hover:text-white text-xs font-semibold transition-colors"
            >
              <Share2 className="w-4 h-4" />
              <span>শেয়ার</span>
            </button>
          </div>

          <div className="p-4 rounded-2xl bg-[#080A11]/90 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => onOpenSeller?.(sellerTarget)}
              className="flex items-center gap-3 min-w-0 text-left group focus-visible:outline-none"
            >
              <div className="w-12 h-12 rounded-full neon-ring-purple p-[2px] shrink-0">
                <div className="w-full h-full rounded-full overflow-hidden bg-[#0D101B] flex items-center justify-center">
                  {product.sellerAvatarUrl ? (
                    <SafeImage
                      src={product.sellerAvatarUrl}
                      alt={product.shopName}
                      fallbackLabel={product.shopName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Store className="w-5 h-5 text-[#C084FC]" />
                  )}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-white group-hover:text-[#C8FA50] transition-colors truncate">
                  {product.shopName}
                </div>
                <div className="text-xs text-slate-400 truncate">
                  বিক্রেতা: {product.sellerFullName || product.sellerUsername || 'যাচাইকৃত সেলার'}
                  {product.sellerUsername ? ` (@${product.sellerUsername})` : ''}
                </div>
                {product.sellerShopDescription && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{product.sellerShopDescription}</p>
                )}
              </div>
            </button>

            <div className="flex items-center gap-2 shrink-0">
              {onOpenSeller && (
                <button
                  type="button"
                  onClick={() => onOpenSeller(sellerTarget)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full glow-purple-btn text-xs font-bold whitespace-nowrap"
                >
                  <UserIcon className="w-3.5 h-3.5 text-[#C8FA50]" />
                  প্রোফাইল দেখুন
                </button>
              )}
              <button
                type="button"
                onClick={handleCopySellerLink}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-full bg-white/5 border border-white/15 hover:border-[#C8FA50]/50 text-xs font-semibold text-slate-200 whitespace-nowrap transition-colors"
                title="সেলারের প্রোফাইল লিংক কপি করুন"
              >
                {copiedSellerLink ? <Check className="w-3.5 h-3.5 text-[#C8FA50]" /> : <Copy className="w-3.5 h-3.5 text-[#C8FA50]" />}
                <span>{copiedSellerLink ? 'কপি হয়েছে' : 'প্রোফাইল লিংক'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Product Description & Reviews */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 glass-card rounded-2xl p-6 sm:p-8 space-y-3">
          <h2 className="text-lg font-bold text-white">পণ্যের বিস্তারিত বিবরণ</h2>
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{product.description}</p>
        </div>

        <div className="lg:col-span-5 glass-card rounded-2xl p-6 sm:p-8 space-y-5">
          <h2 className="text-lg font-bold text-white">ক্রেতাদের রিভিউ ({reviews.length})</h2>

          <form onSubmit={handleSubmitReview} className="space-y-3 pb-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-400">রেটিং:</span>
              {[1, 2, 3, 4, 5].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReviewRating(r)}
                  className="p-0.5"
                  aria-label={`${r} স্টার`}
                >
                  <Star
                    className={`w-4 h-4 ${r <= reviewRating ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`}
                  />
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="পণ্য সম্পর্কে আপনার মতামত লিখুন..."
                className="flex-1 px-3 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white"
              />
              <button
                type="submit"
                disabled={reviewSubmitting}
                className="px-4 py-2 rounded-xl glow-lime-btn text-xs font-bold whitespace-nowrap"
              >
                জমা দিন
              </button>
            </div>
          </form>

          <div className="space-y-4 max-h-80 overflow-y-auto">
            {reviews.length === 0 ? (
              <p className="text-xs text-slate-400">এখনো কোনো রিভিউ দেওয়া হয়নি।</p>
            ) : (
              reviews.map((rev) => (
                <div key={rev.id} className="space-y-1 pb-3 border-b border-white/10 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">{rev.userName}</span>
                    <span className="text-[11px] text-slate-500">{formatDateTime(rev.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: rev.rating }).map((_, idx) => (
                      <Star key={idx} className="w-3 h-3 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-xs text-slate-300">{rev.comment}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <AdSlot placement="product_page" advertisements={storefront?.advertisements || []} />
    </div>
  );
}
