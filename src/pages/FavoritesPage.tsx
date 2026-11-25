import React from 'react';
import { Heart } from 'lucide-react';
import { ProductCard } from '../components/ProductCard';
import { useAuth } from '../context/AuthContext';
import type { Product } from '../types';

interface FavoritesPageProps {
  onOpenProduct: (product: Product) => void;
  onShareProduct: (product: Product) => void;
  onOpenSeller?: (sellerIdentifier: string) => void;
  onBrowseProducts: () => void;
}

export function FavoritesPage({ onOpenProduct, onShareProduct, onOpenSeller, onBrowseProducts }: FavoritesPageProps) {
  const { user, favorites, openAuthModal } = useAuth();

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
        <Heart className="w-12 h-12 mx-auto text-slate-600" />
        <h2 className="text-xl font-bold text-white">পছন্দের তালিকা দেখতে সাইন ইন করুন</h2>
        <button
          type="button"
          onClick={() => openAuthModal('পছন্দের পণ্য দেখতে সাইন ইন করুন।')}
          className="px-6 py-2.5 rounded-full glow-lime-btn text-sm font-bold"
        >
          সাইন ইন / সাইন আপ
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold hero-gradient-text">পছন্দের তালিকা (Favorites)</h1>
        <p className="text-sm text-slate-400 mt-0.5">আপনার সংরক্ষিত পছন্দের পণ্যসমূহ ({favorites.length}টি)</p>
      </div>

      {favorites.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center space-y-4">
          <Heart className="w-12 h-12 text-slate-600 mx-auto" />
          <h2 className="text-lg font-semibold text-white">এখনো কোনো পণ্য সংরক্ষণ করা হয়নি</h2>
          <p className="text-sm text-slate-400">পছন্দের পণ্যগুলোতে হার্ট আইকনে ক্লিক করে এখানে সংরক্ষণ করুন।</p>
          <button
            type="button"
            onClick={onBrowseProducts}
            className="px-6 py-2.5 rounded-full glow-lime-btn text-sm font-bold"
          >
            পণ্য দেখুন
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-5">
          {favorites.map((p) => (
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
  );
}
