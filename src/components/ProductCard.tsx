import React from 'react';
import { Eye, Heart, Share2, ShoppingCart, Store, User as UserIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { Product } from '../types';
import { formatPrice, getDiscountPercent } from '../utils/format';
import { SafeImage } from './SafeImage';

interface ProductCardProps {
  product: Product;
  onOpenProduct: (product: Product) => void;
  onShareProduct: (product: Product) => void;
  onOpenSeller?: (sellerIdentifier: string) => void;
}

export function ProductCard({ product, onOpenProduct, onShareProduct, onOpenSeller }: ProductCardProps) {
  const { addToCart, toggleFavorite, favoriteIds } = useAuth();
  const isFav = favoriteIds.has(product.id);
  const discount = getDiscountPercent(product.previousPrice, product.currentPrice);
  const primaryImage = Array.isArray(product.images) ? product.images[0] || '' : '';
  const productName = product.name || 'Orvexa পণ্য';
  const shopLabel = product.shopName || 'Orvexa শপ';
  const stockCount = Number(product.stock ?? 0);
  const sellerTarget = product.sellerUsername || product.sellerId;

  return (
    <article className="group relative glass-card rounded-2xl overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:border-purple-400/40 hover:shadow-[0_12px_32px_-12px_rgba(168,85,247,0.35)]">
      <div className="relative aspect-square sm:aspect-[4/3] bg-[#0B0D14] overflow-hidden">
        <button
          type="button"
          onClick={() => onOpenProduct(product)}
          className="w-full h-full block text-left focus-visible:outline-none"
          aria-label={productName}
        >
          <SafeImage
            src={primaryImage}
            alt={productName}
            fallbackLabel={productName}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
          <div className="absolute inset-x-0 bottom-0 h-12 sm:h-14 bg-gradient-to-t from-[#0C0E16] via-[#0C0E16]/35 to-transparent pointer-events-none" />
        </button>

        {discount !== null && (
          <span className="absolute top-2 left-2 sm:top-2.5 sm:left-2.5 bg-purple-600/90 backdrop-blur-xs text-white text-[10px] sm:text-[11px] font-semibold px-2 sm:px-2.5 py-0.5 rounded-full tabular-nums border border-purple-400/40">
            -{discount}%
          </span>
        )}

        <button
          type="button"
          onClick={() => toggleFavorite(product.id)}
          className={`absolute top-2 right-2 sm:top-2.5 sm:right-2.5 w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center border backdrop-blur-md transition-colors ${
            isFav
              ? 'bg-rose-500/20 border-rose-400/50 text-rose-400'
              : 'bg-[#090B10]/70 border-white/15 text-slate-300 hover:text-rose-400 hover:border-rose-400/40'
          }`}
          aria-label={isFav ? 'পছন্দের তালিকা থেকে সরান' : 'পছন্দের তালিকায় যোগ করুন'}
        >
          <Heart className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isFav ? 'fill-rose-400 text-rose-400' : ''}`} />
        </button>
      </div>

      <div className="p-2.5 sm:p-4 flex-1 flex flex-col justify-between gap-2 sm:gap-3">
        <div className="space-y-1 sm:space-y-1.5">
          <div className="flex items-center gap-1 text-[10px] sm:text-xs text-slate-400 truncate">
            {onOpenSeller ? (
              <button
                type="button"
                onClick={() => onOpenSeller(sellerTarget)}
                className="inline-flex items-center gap-1 truncate font-medium text-slate-300 hover:text-[#C8FA50] transition-colors focus-visible:outline-none"
                title={`${shopLabel} প্রোফাইল দেখুন`}
              >
                <Store className="w-3 h-3 text-purple-300 shrink-0" />
                <span className="truncate">{shopLabel}</span>
              </button>
            ) : (
              <span className="truncate font-medium text-slate-300">{shopLabel}</span>
            )}
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="hidden sm:inline truncate text-purple-300/90">
              {product.categoryNameBn || product.subcategory}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onOpenProduct(product)}
            className="text-left block w-full focus-visible:outline-none"
          >
            <h3 className="text-xs sm:text-[15px] font-semibold text-white leading-snug line-clamp-2 min-h-[2rem] sm:min-h-[2.6rem] group-hover:text-[#D9FF5B] transition-colors">
              {productName}
            </h3>
          </button>
        </div>

        <div className="space-y-2 sm:space-y-3">
          <div className="flex items-baseline gap-1.5 sm:gap-2 flex-wrap">
            <span className="text-sm sm:text-lg font-bold text-[#D9FF5B] tabular-nums">
              {formatPrice(product.currentPrice)}
            </span>
            {product.previousPrice && product.previousPrice > product.currentPrice && (
              <span className="text-[10px] sm:text-xs text-slate-500 line-through tabular-nums">
                {formatPrice(product.previousPrice)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={stockCount < 1}
              onClick={() => addToCart(product.id, 1)}
              className="flex-1 min-w-0 inline-flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 rounded-full glow-lime-btn disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none text-[11px] sm:text-xs font-bold transition-all whitespace-nowrap"
            >
              <ShoppingCart className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
              {stockCount < 1 ? (
                <span>স্টক নেই</span>
              ) : (
                <>
                  <span className="sm:hidden">কার্ট</span>
                  <span className="hidden sm:inline">কার্টে যোগ করুন</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => onOpenProduct(product)}
              className="p-1.5 sm:p-2 rounded-full border border-white/15 bg-white/5 text-slate-300 hover:text-white hover:border-purple-400/50 transition-colors shrink-0"
              title="বিস্তারিত দেখুন"
              aria-label="বিস্তারিত দেখুন"
            >
              <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>

            {onOpenSeller && (
              <button
                type="button"
                onClick={() => onOpenSeller(sellerTarget)}
                className="p-1.5 sm:p-2 rounded-full border border-purple-400/30 bg-purple-500/10 text-purple-200 hover:text-[#C8FA50] hover:border-[#C8FA50]/50 transition-colors shrink-0"
                title="সেলার প্রোফাইল দেখুন"
                aria-label="সেলার প্রোফাইল দেখুন"
              >
                <UserIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => onShareProduct(product)}
              className="p-1.5 sm:p-2 rounded-full border border-white/15 bg-white/5 text-slate-300 hover:text-white hover:border-[#C8FA50]/50 transition-colors shrink-0"
              title="শেয়ার করুন"
              aria-label="শেয়ার করুন"
            >
              <Share2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
