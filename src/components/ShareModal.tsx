import React, { useState } from 'react';
import { Check, Copy, MessageCircle, Share2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { Product } from '../types';
import { formatPrice } from '../utils/format';

interface ShareModalProps {
  product: Product | null;
  onClose: () => void;
}

export function ShareModal({ product, onClose }: ShareModalProps) {
  const { showToast } = useAuth();
  const [copied, setCopied] = useState(false);

  if (!product) return null;

  const safeName = product.name || 'Orvexa পণ্য';
  const productUrl = `${window.location.origin}/product/${product.id}`;
  const shareText = `${safeName} — মাত্র ${formatPrice(product.currentPrice)} (Orvexa)`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(productUrl);
      setCopied(true);
      showToast('পণ্যের লিংক কপি করা হয়েছে!', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('লিংক কপি করা যায়নি।', 'error');
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: safeName,
          text: shareText,
          url: productUrl,
        });
      } catch {
        // cancelled
      }
    } else {
      handleCopy();
    }
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${productUrl}`)}`;
  const messengerUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(productUrl)}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md glass-panel rounded-2xl shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">পণ্যটি শেয়ার করুন</h3>
            <p className="text-sm text-slate-400 mt-0.5 line-clamp-1">{product.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="বন্ধ করুন"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-300">স্থায়ী পণ্যের লিংক (Product URL)</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={productUrl}
              className="flex-1 text-xs font-mono bg-[#080A11] border border-white/15 rounded-xl px-3 py-2.5 text-slate-200 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl glow-lime-btn text-xs font-bold transition-colors whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'কপি হয়েছে' : 'কপি লিংক'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-1">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border border-white/10 bg-white/5 hover:border-emerald-400/50 text-slate-200 transition-colors"
          >
            <MessageCircle className="w-5 h-5 text-emerald-400" />
            <span className="text-xs font-medium">WhatsApp</span>
          </a>

          <a
            href={messengerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border border-white/10 bg-white/5 hover:border-blue-400/50 text-slate-200 transition-colors"
          >
            <Share2 className="w-5 h-5 text-blue-400" />
            <span className="text-xs font-medium">Messenger / FB</span>
          </a>

          <button
            type="button"
            onClick={handleNativeShare}
            className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border border-white/10 bg-white/5 hover:border-purple-400/50 text-slate-200 transition-colors"
          >
            <Share2 className="w-5 h-5 text-[#C084FC]" />
            <span className="text-xs font-medium">অন্যান্য</span>
          </button>
        </div>
      </div>
    </div>
  );
}
