import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { ArrowLeft, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface CustomPageViewProps {
  slug: string;
  onBack: () => void;
}

export function CustomPageView({ slug, onBack }: CustomPageViewProps) {
  const { storefront } = useAuth();
  const pages = storefront?.settings?.customPages || [];
  const page = useMemo(
    () => pages.find((p) => p.isActive && p.slug.toLowerCase() === slug.toLowerCase()),
    [pages, slug]
  );

  if (!page) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <FileText className="w-12 h-12 text-slate-600 mx-auto" />
        <h2 className="text-xl font-bold text-white">পেজটি খুঁজে পাওয়া যায়নি</h2>
        <p className="text-sm text-slate-400">এই পেজটি মুছে ফেলা হয়েছে বা বর্তমানে নিষ্ক্রিয় রয়েছে।</p>
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

  const sanitizedHtml = page.htmlContent
    ? DOMPurify.sanitize(page.htmlContent, { USE_PROFILES: { html: true } })
    : '';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-[#C8FA50]"
      >
        <ArrowLeft className="w-4 h-4" />
        হোমপেজে ফিরুন
      </button>

      <article className="glass-card rounded-3xl p-6 sm:p-10 space-y-6">
        <div className="space-y-2 border-b border-white/10 pb-5">
          <h1 className="text-2xl sm:text-4xl font-extrabold hero-gradient-text">{page.title}</h1>
          {page.subtitle && <p className="text-sm sm:text-base text-slate-300">{page.subtitle}</p>}
        </div>

        {page.content && (
          <div className="text-sm sm:text-base text-slate-200 leading-relaxed whitespace-pre-line">
            {page.content}
          </div>
        )}

        {sanitizedHtml && (
          <div
            className="prose prose-invert max-w-none text-slate-200"
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        )}
      </article>
    </div>
  );
}
