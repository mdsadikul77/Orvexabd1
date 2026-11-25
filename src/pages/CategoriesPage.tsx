import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { AdSlot } from '../components/AdSlot';
import { ProductCard } from '../components/ProductCard';
import { SafeImage } from '../components/SafeImage';
import { useAuth } from '../context/AuthContext';
import { orvexaFetch, safeParseJson } from '../lib/apiConfig';
import type { Category, Product } from '../types';

interface CategoriesPageProps {
  initialCategory?: Category | null;
  onOpenProduct: (product: Product) => void;
  onShareProduct: (product: Product) => void;
  onOpenSeller?: (sellerIdentifier: string) => void;
}

export function CategoriesPage({ initialCategory = null, onOpenProduct, onShareProduct, onOpenSeller }: CategoriesPageProps) {
  const { storefront } = useAuth();
  const categories = storefront?.categories || [];
  const [selectedCat, setSelectedCat] = useState<Category | null>(initialCategory);
  const [selectedSub, setSelectedSub] = useState<string>('all');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialCategory) {
      setSelectedCat(initialCategory);
      setSelectedSub('all');
    }
  }, [initialCategory]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (selectedCat) params.set('category', selectedCat.id);
        if (selectedSub !== 'all') params.set('subcategory', selectedSub);
        const res = await orvexaFetch(`/api/products?${params.toString()}`);
        const data = await safeParseJson(res);
        if (active) setProducts(data.products || []);
      } catch {
        if (active) setProducts([]);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [selectedCat, selectedSub]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <AdSlot placement="category_page" advertisements={storefront?.advertisements || []} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold hero-gradient-text">সকল ক্যাটাগরি ও সাব-ক্যাটাগরি</h1>
          <p className="text-sm text-slate-400 mt-0.5">আপনার প্রয়োজনীয় ক্যাটাগরি বেছে নিয়ে পণ্য ব্রাউজ করুন</p>
        </div>
        {selectedCat && (
          <button
            type="button"
            onClick={() => {
              setSelectedCat(null);
              setSelectedSub('all');
            }}
            className="self-start px-4 py-2 rounded-full border border-white/15 bg-white/5 text-xs font-medium text-slate-200 hover:border-[#C8FA50]"
          >
            ← সব ক্যাটাগরি দেখুন
          </button>
        )}
      </div>

      {/* Category Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {categories.map((cat) => {
          const isActive = selectedCat?.id === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                setSelectedCat(isActive ? null : cat);
                setSelectedSub('all');
              }}
              className={`group rounded-2xl border p-3 text-left transition-all glass-card ${
                isActive
                  ? 'border-[#C8FA50] ring-1 ring-[#C8FA50]/40'
                  : 'border-white/10 hover:border-purple-400/40'
              }`}
            >
              <div className="aspect-[4/3] rounded-xl overflow-hidden bg-[#0B0D14] mb-3">
                <SafeImage
                  src={cat.imageUrl}
                  alt={cat.nameBn}
                  fallbackLabel={cat.nameEn}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
              <div className="text-sm font-semibold text-white truncate">{cat.nameBn}</div>
              <div className="text-xs text-slate-400 flex items-center justify-between mt-0.5">
                <span className="truncate">{cat.nameEn}</span>
                <ChevronRight className="w-3.5 h-3.5 shrink-0 text-[#C8FA50]" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Subcategories Bar */}
      {selectedCat && Array.isArray(selectedCat.subcategories) && selectedCat.subcategories.length > 0 && (
        <div className="glass-panel rounded-2xl p-4 space-y-3">
          <div className="text-sm font-semibold text-white">
            {selectedCat.nameBn} ({selectedCat.nameEn}) — সাব-ক্যাটাগরি সমূহ
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedSub('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                selectedSub === 'all' ? 'bg-[#C8FA50] text-slate-950' : 'bg-white/5 border border-white/10 text-slate-300 hover:text-white'
              }`}
            >
              সবগুলো
            </button>
            {selectedCat.subcategories.map((sub) => (
              <button
                key={sub.nameEn}
                type="button"
                onClick={() => setSelectedSub(sub.nameEn)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  selectedSub === sub.nameEn
                    ? 'bg-[#C8FA50] text-slate-950'
                    : 'bg-white/5 border border-white/10 text-slate-300 hover:text-white'
                }`}
              >
                {sub.nameBn} ({sub.nameEn})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filtered Products */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-white">
          {selectedCat ? `${selectedCat.nameBn} ক্যাটাগরির পণ্যসমূহ` : 'সকল ক্যাটাগরির পণ্যসমূহ'}
        </h2>
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">পণ্য লোড হচ্ছে...</div>
        ) : products.length === 0 ? (
          <div className="glass-card rounded-2xl p-10 text-center text-sm text-slate-400">
            এই ক্যাটাগরি বা সাব-ক্যাটাগরিতে এখনো কোনো পণ্য নেই।
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
      </div>
    </div>
  );
}
