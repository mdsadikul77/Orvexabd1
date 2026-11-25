import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Search, SlidersHorizontal, Sparkles, User as UserIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AdSlot } from '../components/AdSlot';
import { CustomBlocksSection } from '../components/CustomBlocksSection';
import { ProductCard } from '../components/ProductCard';
import { SafeImage } from '../components/SafeImage';
import { useAuth } from '../context/AuthContext';
import { orvexaFetch, safeParseJson } from '../lib/apiConfig';
import type { Category, Product } from '../types';
import { formatPrice } from '../utils/format';

interface HomePageProps {
  initialSearch?: string;
  searchFocusCount?: number;
  isActive?: boolean;
  onOpenProduct: (product: Product) => void;
  onShareProduct: (product: Product) => void;
  onOpenSeller?: (sellerIdentifier: string) => void;
  onSelectCategory: (category: Category) => void;
  onGoCategories: () => void;
  onOpenCustomPage?: (slug: string) => void;
}

type ProductTab = 'all' | 'featured' | 'trending' | 'latest' | 'popular' | 'recommended' | 'discounted';

export function HomePage({
  initialSearch = '',
  searchFocusCount = 0,
  isActive = true,
  onOpenProduct,
  onShareProduct,
  onOpenSeller,
  onSelectCategory,
  onGoCategories,
  onOpenCustomPage,
}: HomePageProps) {
  const { storefront } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProductTab>('all');
  const [selectedCatId, setSelectedCatId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc' | 'popular'>('newest');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Auto-sliding Product Ads carousel state
  const [adSlideIdx, setAdSlideIdx] = useState(0);
  const [adPaused, setAdPaused] = useState(false);

  const catScrollRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const catalogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (searchFocusCount > 0) {
      searchInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => searchInputRef.current?.focus(), 200);
    }
  }, [searchFocusCount]);

  useEffect(() => {
    let active = true;
    const fetchProducts = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set('search', searchQuery.trim());
        if (selectedCatId !== 'all') params.set('category', selectedCatId);
        if (activeTab !== 'all' && activeTab !== 'latest') params.set('tab', activeTab);
        if (minPrice.trim()) params.set('minPrice', minPrice.trim());
        if (maxPrice.trim()) params.set('maxPrice', maxPrice.trim());
        params.set('sort', activeTab === 'popular' ? 'popular' : sortBy);

        const res = await orvexaFetch(`/api/products?${params.toString()}`);
        const data = await safeParseJson(res);
        if (active) setProducts(data.products || []);
      } catch {
        if (active) setProducts([]);
      } finally {
        if (active) setLoading(false);
      }
    };
    const timer = setTimeout(fetchProducts, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, selectedCatId, activeTab, sortBy, minPrice, maxPrice]);

  const categories = storefront?.categories || [];
  const heroBanners = (storefront?.settings?.heroBanners || []).filter((b) => b.isActive);
  const activeHero = heroBanners[0];
  const productAds = (storefront?.homepageProductAds || []).filter((ad) => Boolean(ad && ad.product && ad.product.id));
  const productAdsCfg = storefront?.settings?.productAdsSection;
  const advertisements = storefront?.advertisements || [];

  // Keep slide index valid if ads list changes
  useEffect(() => {
    if (productAds.length === 0) {
      setAdSlideIdx(0);
    } else if (adSlideIdx >= productAds.length) {
      setAdSlideIdx(0);
    }
  }, [productAds.length, adSlideIdx]);

  // Auto-advance Product Ads every 5.5 seconds (slides current post left ←, next slides in from right ←)
  useEffect(() => {
    if (!isActive || productAds.length <= 1 || adPaused) return;
    const timer = setInterval(() => {
      setAdSlideIdx((prev) => (prev + 1) % productAds.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [isActive, productAds.length, adPaused]);

  const scrollCategories = (dir: 'left' | 'right') => {
    if (!catScrollRef.current) return;
    catScrollRef.current.scrollBy({ left: dir === 'left' ? -280 : 280, behavior: 'smooth' });
  };

  const tabs: Array<{ id: ProductTab; label: string }> = [
    { id: 'all', label: 'সব পণ্য' },
    { id: 'featured', label: 'নির্বাচিত (Featured)' },
    { id: 'trending', label: 'ট্রেন্ডিং' },
    { id: 'latest', label: 'সর্বশেষ' },
    { id: 'popular', label: 'জনপ্রিয়' },
    { id: 'recommended', label: 'সুপারিশকৃত' },
    { id: 'discounted', label: 'বিশেষ ছাড়' },
  ];

  const currentProductAd = productAds.length > 0 ? productAds[adSlideIdx % productAds.length] : null;

  return (
    <div className="max-w-7xl mx-auto px-3.5 sm:px-6 py-5 sm:py-7 space-y-7 sm:space-y-10">
      {/* Top Ad Placement */}
      <AdSlot placement="homepage_top" advertisements={advertisements} />

      {/* Main Hero Showcase */}
      <section className="relative rounded-3xl overflow-hidden border border-white/10 bg-[#090B12]">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-purple-600/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-16 w-72 h-72 rounded-full bg-[#C8FA50]/10 blur-3xl pointer-events-none" />

        <div className="relative grid grid-cols-1 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-7 p-6 sm:p-10 lg:p-12 flex flex-col justify-center space-y-5 sm:space-y-6">
            <div className="space-y-3">
              <h1 className="text-3xl sm:text-5xl lg:text-[54px] font-extrabold leading-[1.08] tracking-tight hero-gradient-text text-balance">
                {activeHero?.title || 'Bazaar Reimagined'}
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-xl">
                {activeHero?.subtitle ||
                  'বাংলাদেশের সেরা মাল্টি-ভেন্ডর মার্কেটপ্লেস · ঢাকা থেকে সারাদেশে ডেলিভারি · ক্যাশ অন ডেলিভারি সুবিধা'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => catalogRef.current?.scrollIntoView({ behavior: 'smooth' })}
                className="inline-flex items-center gap-2 px-6 py-2.5 sm:py-3 rounded-full glow-lime-btn text-xs sm:text-sm font-bold transition-all whitespace-nowrap shrink-0"
              >
                <span>{activeHero?.ctaLabel || 'শপিং শুরু করুন'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onGoCategories}
                className="inline-flex items-center gap-2 px-6 py-2.5 sm:py-3 rounded-full glow-purple-btn text-xs sm:text-sm font-semibold transition-all whitespace-nowrap shrink-0"
              >
                <span>ক্যাটাগরি দেখুন</span>
              </button>
            </div>

            <div className="relative max-w-lg">
              <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="পণ্যের নাম, ক্যাটাগরি বা শপ খুঁজুন..."
                className="w-full pl-11 pr-4 py-3 text-sm bg-[#0D101A]/90 border border-white/15 rounded-full text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]/70"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs text-slate-400 pt-1">
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">• ৳ BDT মূল্য</span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">• যাচাইকৃত সেলার</span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">• নিরাপদ পেমেন্ট</span>
            </div>
          </div>

          <div className="lg:col-span-5 relative min-h-[210px] sm:min-h-[280px] lg:min-h-[380px] bg-[#0B0D16] overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-[#090B12] via-transparent to-transparent z-10 hidden lg:block pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#090B12] via-transparent to-transparent z-10 pointer-events-none" />
            <SafeImage
              src={activeHero?.imageUrl || '/src/assets/images/banner_seller_ads_1795274485740.jpg'}
              alt="Orvexa Featured Showcase"
              fallbackLabel="Orvexa Marketplace"
              className="w-full h-full lg:absolute lg:inset-0 object-cover opacity-90"
            />
          </div>
        </div>
      </section>

      {/* Custom Hero Banner HTML & Feature Blocks (after_hero) */}
      <CustomBlocksSection placement="after_hero" onOpenCustomPage={onOpenCustomPage} />

      {/* Circular Glowing Category Dock */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm sm:text-base font-bold text-white">ক্যাটাগরি</h2>
            <span className="text-xs text-slate-400">· ডানে-বামে সোয়াইপ করুন</span>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <button
              type="button"
              onClick={() => scrollCategories('left')}
              className="p-1.5 rounded-full border border-white/15 bg-white/5 text-slate-300 hover:text-white"
              aria-label="বামে সরান"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollCategories('right')}
              className="p-1.5 rounded-full border border-white/15 bg-white/5 text-slate-300 hover:text-white"
              aria-label="ডানে সরান"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="glass-panel rounded-2xl px-3 sm:px-5 py-4">
          <div
            ref={catScrollRef}
            className="flex items-start gap-4 sm:gap-5 overflow-x-auto no-scrollbar snap-x snap-mandatory"
          >
            <button
              type="button"
              onClick={() => setSelectedCatId('all')}
              className="snap-start shrink-0 flex flex-col items-center gap-2 w-20 sm:w-24 group focus-visible:outline-none"
            >
              <div
                className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full p-[2px] transition-transform group-hover:scale-105 ${
                  selectedCatId === 'all' ? 'neon-ring-lime shadow-[0_0_16px_rgba(200,250,80,0.4)]' : 'bg-white/20'
                }`}
              >
                <div className="w-full h-full rounded-full bg-[#0C0F18] flex items-center justify-center text-xs font-bold text-[#D9FF5B]">
                  ALL
                </div>
              </div>
              <div className="text-center">
                <div className={`text-xs font-semibold truncate w-20 ${selectedCatId === 'all' ? 'text-[#C8FA50]' : 'text-slate-200'}`}>
                  সব পণ্য
                </div>
                <div className="text-[10px] text-slate-500 truncate w-20">All Drops</div>
              </div>
            </button>

            {categories.map((cat, idx) => {
              const isSelected = selectedCatId === cat.id;
              return (
                <div key={cat.id} className="snap-start shrink-0 flex flex-col items-center gap-1.5 w-20 sm:w-24">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCatId(cat.id);
                      catalogRef.current?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="flex flex-col items-center gap-2 group focus-visible:outline-none"
                  >
                    <div
                      className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full p-[2px] transition-transform group-hover:scale-105 ${
                        idx % 2 === 0 ? 'neon-ring-purple' : 'neon-ring-lime'
                      } ${isSelected ? 'scale-105 shadow-[0_0_20px_rgba(168,85,247,0.5)]' : ''}`}
                    >
                      <div className="w-full h-full rounded-full overflow-hidden bg-[#0C0F18] p-[2px]">
                        <SafeImage
                          src={cat.imageUrl}
                          alt={cat.nameBn}
                          fallbackLabel={cat.nameEn}
                          className="w-full h-full rounded-full object-cover"
                        />
                      </div>
                    </div>
                    <div className="text-center">
                      <div className={`text-xs font-semibold truncate w-20 sm:w-24 ${isSelected ? 'text-[#C8FA50]' : 'text-slate-200'}`}>
                        {cat.nameBn}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate w-20 sm:w-24">{cat.nameEn}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectCategory(cat)}
                    className="text-[10px] text-purple-300 hover:text-[#C8FA50] transition-colors"
                  >
                    সাব-ক্যাটাগরি
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Custom Feature Blocks (after_categories) */}
      <CustomBlocksSection placement="after_categories" onOpenCustomPage={onOpenCustomPage} />

      {/* Auto-Sliding Product Ads Spotlight (Slides left ← every 5.5 seconds; completely hidden if 0 ads) */}
      {productAdsCfg?.enabled !== false && currentProductAd && currentProductAd.product && (
        <section
          className="space-y-3"
          onMouseEnter={() => setAdPaused(true)}
          onMouseLeave={() => setAdPaused(false)}
          onTouchStart={() => setAdPaused(true)}
          onTouchEnd={() => setAdPaused(false)}
        >
          <div className="flex items-center justify-between gap-2 px-1">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[#C8FA50]">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{productAdsCfg?.heading || 'স্পন্সরড ও বিশেষ প্রচারমূলক পণ্য'}</span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                {productAdsCfg?.subheading || 'হোমপেজের শীর্ষে প্রদর্শিত নির্বাচিত সেলারদের পণ্যসমূহ'}
              </p>
            </div>

            {productAds.length > 1 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setAdSlideIdx((prev) => (prev - 1 + productAds.length) % productAds.length)}
                  className="p-1.5 rounded-full border border-white/15 bg-white/5 text-slate-300 hover:text-white hover:border-[#C8FA50]/50 transition-colors"
                  aria-label="পূর্ববর্তী বিজ্ঞাপন"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setAdSlideIdx((prev) => (prev + 1) % productAds.length)}
                  className="p-1.5 rounded-full border border-white/15 bg-white/5 text-slate-300 hover:text-white hover:border-[#C8FA50]/50 transition-colors"
                  aria-label="পরবর্তী বিজ্ঞাপন"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="relative rounded-3xl overflow-hidden glass-card border border-purple-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
            <div className="absolute -bottom-12 -right-12 w-56 h-56 rounded-full bg-purple-600/20 blur-3xl pointer-events-none" />
            <div className="absolute -top-12 -left-12 w-56 h-56 rounded-full bg-[#C8FA50]/10 blur-3xl pointer-events-none" />

            <div className="relative overflow-hidden min-h-[210px] sm:min-h-[240px]">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={currentProductAd.adId}
                  initial={{ x: '100%', opacity: 0.45 }}
                  animate={{ x: '0%', opacity: 1 }}
                  exit={{ x: '-100%', opacity: 0.45 }}
                  transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  className="p-4 sm:p-7 grid grid-cols-12 items-center gap-4 sm:gap-8"
                >
                  {/* Left: Ad Promo Text, Product Info & View CTA */}
                  <div className="col-span-7 sm:col-span-7 space-y-2.5 sm:space-y-3.5 min-w-0">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-600/25 border border-purple-400/40 text-[10px] sm:text-xs font-bold text-[#C084FC]">
                      <span>{currentProductAd.promoText || 'স্পন্সরড প্রোডাক্ট'}</span>
                    </div>

                    <h3 className="text-base sm:text-2xl font-extrabold text-white leading-snug line-clamp-2">
                      {currentProductAd.product.name || ''}
                    </h3>

                    <div className="text-[11px] sm:text-xs text-slate-400 truncate">
                      শপ: <span className="text-slate-200 font-medium">{currentProductAd.product.shopName || 'Orvexa'}</span>
                    </div>

                    <div className="flex items-baseline gap-2.5 flex-wrap">
                      <span className="text-lg sm:text-2xl font-extrabold text-[#D9FF5B] tabular-nums">
                        {formatPrice(currentProductAd.product.currentPrice)}
                      </span>
                      {currentProductAd.product.previousPrice &&
                        currentProductAd.product.previousPrice > currentProductAd.product.currentPrice && (
                          <span className="text-xs sm:text-sm text-slate-500 line-through tabular-nums">
                            {formatPrice(currentProductAd.product.previousPrice)}
                          </span>
                        )}
                    </div>

                    <div className="pt-1 flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => onOpenProduct(currentProductAd.product)}
                        className="inline-flex items-center gap-1.5 px-5 sm:px-7 py-2 sm:py-2.5 rounded-full glow-lime-btn text-xs sm:text-sm font-extrabold transition-all"
                      >
                        <span>View</span>
                        <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </button>
                      {onOpenSeller && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenSeller(currentProductAd.product.sellerUsername || currentProductAd.product.sellerId)
                          }
                          className="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-full bg-white/5 border border-white/15 hover:border-[#C8FA50]/50 text-xs font-semibold text-slate-200 hover:text-[#C8FA50] transition-colors"
                        >
                          <UserIcon className="w-3.5 h-3.5 text-[#C8FA50]" />
                          <span>সেলার প্রোফাইল</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Right: Product Photo */}
                  <div className="col-span-5 sm:col-span-5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onOpenProduct(currentProductAd.product)}
                      className="w-full max-w-[260px] aspect-square sm:aspect-[4/3] rounded-2xl overflow-hidden border border-white/15 bg-[#0B0D14] shadow-xl group focus-visible:outline-none"
                      aria-label={currentProductAd.product.name || 'Product'}
                    >
                      <SafeImage
                        src={currentProductAd.customImageUrl || currentProductAd.product.images?.[0]}
                        alt={currentProductAd.product.name || 'Product'}
                        fallbackLabel={currentProductAd.product.name || 'Orvexa'}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </button>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Slide Progress Dots */}
            {productAds.length > 1 && (
              <div className="px-5 pb-3.5 flex items-center justify-center gap-2">
                {productAds.map((ad, idx) => (
                  <button
                    key={ad.adId}
                    type="button"
                    onClick={() => setAdSlideIdx(idx)}
                    aria-label={`বিজ্ঞাপন ${idx + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      idx === adSlideIdx % productAds.length
                        ? 'w-7 bg-[#C8FA50]'
                        : 'w-2 bg-white/20 hover:bg-white/40'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Trust Bar */}
      <div className="glass-panel rounded-full px-5 py-2.5 flex items-center justify-between gap-3 text-[11px] sm:text-xs text-slate-300">
        <span className="hidden sm:flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-[#C8FA50]" />
          <span className="w-2 h-2 rounded-full bg-purple-400" />
        </span>
        <p className="text-center flex-1 truncate">
          ডেলিভারি: ঢাকা · চট্টগ্রাম · সিলেট · সারাদেশে ক্যাশ অন ডেলিভারি সুবিধা
        </p>
        <span className="hidden sm:flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-purple-400" />
          <span className="w-2 h-2 rounded-full bg-[#C8FA50]" />
        </span>
      </div>

      {/* Homepage Middle Ad Placement */}
      <AdSlot placement="homepage_middle" advertisements={advertisements} />

      {/* Main Product Grid & Filtering (2-column side-by-side on mobile phones) */}
      <section ref={catalogRef} id="products" className="space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[#C8FA50] text-slate-950'
                    : 'bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:border-white/25'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-white/15 bg-white/5 text-xs font-medium text-slate-200 hover:border-purple-400/50"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#C8FA50]" />
              মূল্য ফিল্টার
            </button>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3.5 py-2 rounded-full border border-white/15 bg-[#0D101A] text-xs font-medium text-slate-200 focus:outline-none focus:border-[#C8FA50]"
              aria-label="সাজানোর ধরন"
            >
              <option value="newest">সর্বশেষ পণ্য</option>
              <option value="price_asc">দাম: কম থেকে বেশি</option>
              <option value="price_desc">দাম: বেশি থেকে কম</option>
              <option value="popular">সবচেয়ে জনপ্রিয়</option>
            </select>
          </div>
        </div>

        {filtersOpen && (
          <div className="p-4 rounded-2xl glass-panel flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">সর্বনিম্ন মূল্য (৳)</label>
              <input
                type="number"
                min={0}
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="যেমন: 500"
                className="w-36 px-3 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">সর্বোচ্চ মূল্য (৳)</label>
              <input
                type="number"
                min={0}
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="যেমন: 5000"
                className="w-36 px-3 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setMinPrice('');
                setMaxPrice('');
                setSelectedCatId('all');
                setSearchQuery('');
                setActiveTab('all');
              }}
              className="px-4 py-2 rounded-xl border border-white/15 bg-white/5 text-xs font-medium text-slate-200 hover:bg-white/10"
            >
              ফিল্টার রিসেট করুন
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="glass-card rounded-2xl overflow-hidden animate-pulse">
                <div className="aspect-square sm:aspect-[4/3] bg-white/5" />
                <div className="p-3 sm:p-4 space-y-2.5">
                  <div className="h-3 bg-white/10 rounded w-1/2" />
                  <div className="h-4 bg-white/10 rounded w-5/6" />
                  <div className="h-5 bg-white/10 rounded w-1/3" />
                  <div className="h-8 bg-white/10 rounded-full w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-2xl glass-card p-12 text-center space-y-3">
            <h3 className="text-base font-semibold text-white">কোনো পণ্য পাওয়া যায়নি</h3>
            <p className="text-sm text-slate-400">অন্য ক্যাটাগরি অথবা ভিন্ন কিওয়ার্ড দিয়ে খুঁজে দেখুন।</p>
            <button
              type="button"
              onClick={() => {
                setSelectedCatId('all');
                setSearchQuery('');
                setActiveTab('all');
                setMinPrice('');
                setMaxPrice('');
              }}
              className="px-5 py-2 rounded-full glow-lime-btn text-xs font-bold"
            >
              সব পণ্য দেখুন
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5">
            {products.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onOpenProduct={onOpenProduct}
                onShareProduct={onShareProduct}
                onOpenSeller={onOpenSeller}
              />
            ))}
          </div>
        )}
      </section>

      {/* Custom Feature Blocks (after_products) */}
      <CustomBlocksSection placement="after_products" onOpenCustomPage={onOpenCustomPage} />

      {/* Bottom & Sidebar Ad Placements */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <AdSlot placement="homepage_bottom" advertisements={advertisements} />
        </div>
        <div>
          <AdSlot placement="sidebar" advertisements={advertisements} />
        </div>
      </div>
      <AdSlot placement="other" advertisements={advertisements} />

      {/* Custom Feature Blocks (before_footer) */}
      <CustomBlocksSection placement="before_footer" onOpenCustomPage={onOpenCustomPage} />
    </div>
  );
}
