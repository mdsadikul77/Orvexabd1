import React, { useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { ArrowRight, ChevronDown, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { CustomBlock } from '../types';

interface CustomBlocksSectionProps {
  placement: CustomBlock['placement'];
  onOpenCustomPage?: (slug: string) => void;
}

function safeHref(url?: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed;
    return null;
  } catch {
    return null;
  }
}

export function CustomBlocksSection({ placement, onOpenCustomPage }: CustomBlocksSectionProps) {
  const { storefront } = useAuth();
  const [openFaqKey, setOpenFaqKey] = useState<string | null>(null);

  const customCode = storefront?.settings?.customCode;
  const bannerHtml = useMemo(() => {
    if (placement !== 'after_hero' || customCode?.enabled === false) return '';
    const raw = (customCode?.customBannerHtml || '').trim();
    if (!raw) return '';
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [placement, customCode]);

  const blocks = useMemo(() => {
    const all = storefront?.settings?.customBlocks || [];
    return all
      .filter((b) => b.isActive && b.placement === placement)
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }, [storefront?.settings?.customBlocks, placement]);

  if (!bannerHtml && blocks.length === 0) return null;

  const renderCta = (label?: string, url?: string) => {
    const href = safeHref(url);
    if (!label || !href) return null;

    if (href.startsWith('/page/') && onOpenCustomPage) {
      const slug = href.replace(/^\/page\//, '').trim();
      return (
        <button
          type="button"
          onClick={() => onOpenCustomPage(slug)}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full glow-lime-btn text-xs sm:text-sm font-bold shrink-0"
        >
          <span>{label}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      );
    }

    return (
      <a
        href={href}
        target={href.startsWith('http') ? '_blank' : undefined}
        rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
        className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full glow-lime-btn text-xs sm:text-sm font-bold shrink-0"
      >
        <span>{label}</span>
        <ArrowRight className="w-4 h-4" />
      </a>
    );
  };

  return (
    <div className="space-y-6">
      {bannerHtml && (
        <div
          className="glass-card rounded-3xl p-5 sm:p-6 overflow-hidden"
          dangerouslySetInnerHTML={{ __html: bannerHtml }}
        />
      )}

      {blocks.map((block) => {
        if (block.blockType === 'promo_banner') {
          return (
            <section
              key={block.id}
              className="glass-card rounded-3xl p-6 sm:p-8 border border-purple-500/30 bg-gradient-to-br from-[#131729] via-[#0D101B] to-[#1A1026] flex flex-col md:flex-row md:items-center justify-between gap-5"
            >
              <div className="space-y-2 max-w-2xl">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#C8FA50]">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{block.subtitle || 'বিশেষ ফিচার'}</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-white">{block.title}</h2>
                {block.content && (
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                    {block.content}
                  </p>
                )}
              </div>
              {renderCta(block.ctaLabel, block.ctaUrl)}
            </section>
          );
        }

        if (block.blockType === 'feature_cards') {
          const items = block.items || [];
          return (
            <section key={block.id} className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3 px-1">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-white">{block.title}</h2>
                  {block.subtitle && <p className="text-xs sm:text-sm text-slate-400 mt-0.5">{block.subtitle}</p>}
                </div>
                {renderCta(block.ctaLabel, block.ctaUrl)}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((item, idx) => (
                  <div key={idx} className="glass-card rounded-2xl p-5 space-y-2 hover:border-purple-400/40 transition-colors">
                    {item.badge && (
                      <span className="inline-block px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-400/35 text-[10px] font-bold text-purple-200">
                        {item.badge}
                      </span>
                    )}
                    <h3 className="text-sm sm:text-base font-bold text-white">{item.title}</h3>
                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">{item.description}</p>
                  </div>
                ))}
              </div>
            </section>
          );
        }

        if (block.blockType === 'faq') {
          const items = block.items || [];
          return (
            <section key={block.id} className="glass-card rounded-3xl p-6 space-y-4">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-white">{block.title}</h2>
                {block.subtitle && <p className="text-xs sm:text-sm text-slate-400 mt-0.5">{block.subtitle}</p>}
              </div>
              <div className="divide-y divide-white/10">
                {items.map((item, idx) => {
                  const key = `${block.id}-${idx}`;
                  const isOpen = openFaqKey === key;
                  return (
                    <div key={key} className="py-3 first:pt-0 last:pb-0">
                      <button
                        type="button"
                        onClick={() => setOpenFaqKey(isOpen ? null : key)}
                        className="w-full flex items-center justify-between gap-3 text-left text-sm font-semibold text-white hover:text-[#C8FA50]"
                      >
                        <span>{item.title}</span>
                        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? 'rotate-180 text-[#C8FA50]' : ''}`} />
                      </button>
                      {isOpen && (
                        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mt-2">{item.description}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        }

        const sanitizedBlockHtml = DOMPurify.sanitize(block.content || '', { USE_PROFILES: { html: true } });
        return (
          <section key={block.id} className="glass-card rounded-3xl p-5 sm:p-6 space-y-3 overflow-hidden">
            {block.title && <h2 className="text-lg font-bold text-white">{block.title}</h2>}
            <div dangerouslySetInnerHTML={{ __html: sanitizedBlockHtml }} />
          </section>
        );
      })}
    </div>
  );
}
