import React from 'react';
import { ArrowLeft, CheckCircle2, Megaphone, MessageCircle, Sparkles } from 'lucide-react';
import { SafeImage } from '../components/SafeImage';
import { useAuth } from '../context/AuthContext';

interface SellerProductAdsPageProps {
  onBack: () => void;
}

function formatWhatsAppHref(num: string): string {
  const digits = num.replace(/\D/g, '');
  if (digits.startsWith('0')) return `https://wa.me/88${digits}`;
  return `https://wa.me/${digits}`;
}

export function SellerProductAdsPage({ onBack }: SellerProductAdsPageProps) {
  const { user, storefront } = useAuth();

  if (!user || (user.role !== 'seller' && user.role !== 'admin')) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-5">
        <div className="w-16 h-16 mx-auto rounded-full bg-purple-500/15 border border-purple-400/30 flex items-center justify-center">
          <Megaphone className="w-8 h-8 text-[#C8FA50]" />
        </div>
        <h2 className="text-xl font-bold text-white">শুধুমাত্র সেলার অ্যাকাউন্টের জন্য</h2>
        <p className="text-sm text-slate-400">Product Ads পেজটি শুধুমাত্র নিবন্ধিত সেলারদের জন্য সংরক্ষিত।</p>
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2.5 rounded-full glow-lime-btn text-sm font-bold"
        >
          ফিরে যান
        </button>
      </div>
    );
  }

  const cfg = storefront?.settings?.sellerProductAdsPage || {
    bannerTitle: 'আপনার পণ্যকে আরও বেশি ক্রেতার সামনে তুলে ধরুন!',
    bannerSubtitle: 'Orvexa-তে স্পন্সরড বিজ্ঞাপনের মাধ্যমে আপনার শপের বিক্রি ও পরিচিতি বহুগুণ বাড়িয়ে তুলুন।',
    bannerImageUrl: '/src/assets/images/banner_seller_ads_1795274485740.jpg',
    description:
      'আপনার পণ্যের বিজ্ঞাপন হোমপেজের বিশেষ প্রচারমূলক অংশে প্রকাশ করার মাধ্যমে আরও বেশি ক্রেতার নজরে আসার সুযোগ তৈরি করুন। বিজ্ঞাপিত পণ্যটি হোমপেজের উপরের অংশে আকর্ষণীয়ভাবে প্রদর্শিত হবে এবং ক্রেতারা View বাটনে ক্লিক করে সরাসরি আপনার পণ্যের বিস্তারিত পেজে যেতে পারবেন।\n\nআপনার পণ্যের প্রচার বৃদ্ধি করুন, আরও বেশি মানুষের কাছে পৌঁছান এবং বিক্রির সম্ভাবনা বাড়িয়ে তুলুন।',
    benefits: [
      'হোমপেজের একদম উপরের প্রাইম সেকশনে পণ্যের বিশেষ প্রদর্শনী',
      'সরাসরি View বাটনের মাধ্যমে ক্রেতাদের পণ্যের বিস্তারিত পেজে প্রবেশ',
      'সেলার ইনবক্সে ক্রেতাদের সরাসরি জিজ্ঞাসা ও দ্রুত অর্ডার বৃদ্ধির সুযোগ',
      'নির্ধারিত সময়সীমা অনুযায়ী Admin দ্বারা পরিচালিত নিরাপদ ও কার্যকর প্রচারণা',
    ],
    howItWorks: [
      'আপনার সেলার অ্যাকাউন্টে আগে পণ্যটি প্রকাশ করুন এবং পণ্যের লিংক কপি করুন।',
      'নিচের WhatsApp নম্বরে Admin-এর সাথে যোগাযোগ করে আপনার পণ্যের লিংক ও শপের নাম পাঠান।',
      'বিজ্ঞাপনের সময়কাল ও বিবরণ নিশ্চিত হলে Admin আপনার পণ্যটি হোমপেজের Product Ads সেকশনে যুক্ত করে দেবেন।',
    ],
    contactHeading: 'আপনার পণ্যের বিজ্ঞাপন প্রকাশ করতে Admin-এর সাথে যোগাযোগ করুন',
    whatsappNumbers: ['01622922252', '01329205761'],
    ctaText: 'WhatsApp-এ মেসেজ দিন',
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs sm:text-sm font-medium text-slate-200 hover:border-[#C8FA50]/40 hover:text-[#C8FA50] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        সেলার ড্যাশবোর্ডে ফিরুন
      </button>

      {/* Promotional Hero Banner */}
      <section className="glass-card rounded-3xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 relative shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
        <div
          className="pointer-events-none absolute -top-24 -left-16 w-72 h-72 rounded-full bg-purple-600/20 blur-3xl"
          aria-hidden="true"
        />
        <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-center space-y-4 relative z-10">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#C8FA50]">
            <Sparkles className="w-4 h-4" />
            <span>Orvexa Seller Product Ads</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold leading-tight hero-gradient-text text-balance">
            {cfg.bannerTitle}
          </h1>
          <p className="text-sm text-purple-200 leading-relaxed">{cfg.bannerSubtitle}</p>
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{cfg.description}</p>
        </div>
        <div className="lg:col-span-5 relative min-h-[240px] bg-[#0B0E17]">
          <SafeImage
            src={cfg.bannerImageUrl}
            alt={cfg.bannerTitle}
            className="w-full h-full lg:absolute lg:inset-0 object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t lg:bg-gradient-to-r from-[#0C0E16] via-transparent to-transparent opacity-60" />
        </div>
      </section>

      {/* Benefits & How it works */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="glass-card rounded-3xl p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">Product Ads-এর সুবিধাসমূহ</h2>
          <ul className="space-y-3">
            {(cfg.benefits || []).map((b, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-slate-300">
                <CheckCircle2 className="w-5 h-5 text-[#C8FA50] shrink-0 mt-0.5" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="glass-card rounded-3xl p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">বিজ্ঞাপন যেভাবে কাজ করে</h2>
          <ol className="space-y-3">
            {(cfg.howItWorks || []).map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-slate-300">
                <span className="w-6 h-6 rounded-full bg-purple-600/30 border border-purple-400/50 text-[#C8FA50] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* Contact Admin WhatsApp CTA Section */}
      <section className="glass-card rounded-3xl p-6 sm:p-8 border border-[#C8FA50]/30 bg-gradient-to-br from-[#111524] via-[#0F131D] to-[#1A1228] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-xl">
          <h2 className="text-xl font-bold text-white">{cfg.contactHeading}</h2>
          <p className="text-sm text-slate-300">
            সরাসরি নিচের WhatsApp নম্বরে মেসেজ পাঠিয়ে আপনার পণ্যের বিজ্ঞাপন সক্রিয় করুন।
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {(cfg.whatsappNumbers || ['01622922252', '01329205761']).map((num) => (
            <a
              key={num}
              href={formatWhatsAppHref(num)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-full glow-lime-btn text-sm font-extrabold transition-all tabular-nums"
            >
              <MessageCircle className="w-4 h-4" />
              <span>
                {cfg.ctaText}: {num}
              </span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
