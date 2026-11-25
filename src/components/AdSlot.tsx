import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Sparkles } from 'lucide-react';
import type { Advertisement } from '../types';
import { SafeImage } from './SafeImage';

interface AdSlotProps {
  placement: Advertisement['placement'];
  advertisements: Advertisement[];
  className?: string;
}

function isSafeTargetUrl(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed;
    return null;
  } catch {
    return null;
  }
}

function formatAdCodeForIframe(htmlCode?: string | null, jsCode?: string | null): string {
  const rawHtml = (htmlCode || '').trim();
  const rawJs = (jsCode || '').trim();

  // If Admin pasted full <script src="..."> or <script>...</script> tags inside jsCode (standard for Adsterra / Google Ad Manager / AdSense),
  // keep those tags intact instead of double-wrapping them in another <script> tag.
  let jsBlock = '';
  if (rawJs) {
    if (/<script[\s>]/i.test(rawJs)) {
      jsBlock = rawJs;
    } else {
      jsBlock = `<script>${rawJs.replace(/<\/script/gi, '<\\/script')}</script>`;
    }
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <base target="_blank" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        background: transparent;
        color: #f8fafc;
        font-family: system-ui, -apple-system, sans-serif;
        overflow-x: hidden;
      }
      #orvexa-ad-root {
        min-height: 90px;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 6px;
        box-sizing: border-box;
      }
      img, iframe, ins { max-width: 100%; border-radius: 8px; }
    </style>
  </head>
  <body>
    <div id="orvexa-ad-root">
      ${rawHtml}
      ${jsBlock}
    </div>
    <script>
      (function() {
        function reportHeight() {
          try {
            var root = document.getElementById('orvexa-ad-root');
            var h = Math.max(96, Math.min(680, (root ? root.scrollHeight : document.body.scrollHeight) + 8));
            window.parent.postMessage({ type: 'orvexa-ad-resize', height: h }, '*');
          } catch (e) {}
        }
        window.addEventListener('load', reportHeight);
        setTimeout(reportHeight, 400);
        setTimeout(reportHeight, 1500);
        if (typeof ResizeObserver !== 'undefined') {
          try {
            new ResizeObserver(reportHeight).observe(document.body);
          } catch (e) {}
        }
      })();
    </script>
  </body>
</html>`;
}

function SandboxedAdFrame({ ad }: { ad: Advertisement }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameHeight, setFrameHeight] = useState(120);

  const srcDoc = useMemo(() => formatAdCodeForIframe(ad.htmlCode, ad.jsCode), [ad.htmlCode, ad.jsCode]);

  useEffect(() => {
    const onMessage = (evt: MessageEvent) => {
      if (!iframeRef.current || evt.source !== iframeRef.current.contentWindow) return;
      if (evt.data && evt.data.type === 'orvexa-ad-resize' && typeof evt.data.height === 'number') {
        const clamped = Math.max(96, Math.min(680, Math.round(evt.data.height)));
        setFrameHeight(clamped);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="rounded-2xl glass-card overflow-hidden" aria-label={ad.title}>
      <div className="px-3.5 py-1.5 border-b border-white/10 flex items-center justify-between text-[11px] text-slate-400">
        <span>স্পন্সরড বিজ্ঞাপন · {ad.title}</span>
        {ad.targetUrl && isSafeTargetUrl(ad.targetUrl) && (
          <a
            href={isSafeTargetUrl(ad.targetUrl)!}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="inline-flex items-center gap-1 text-[#C8FA50] hover:underline font-semibold"
          >
            ভিজিট করুন <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      {/*
        Strictly isolated sandbox (NO allow-same-origin) so third-party Adsterra / Google Ad Manager / AdSense scripts
        execute inside an opaque origin without accessing parent Orvexa cookies, tokens, or DOM.
      */}
      <iframe
        ref={iframeRef}
        title={ad.title}
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-top-navigation-by-user-activation"
        style={{ height: `${frameHeight}px` }}
        className="w-full border-0 bg-transparent transition-[height] duration-200"
        loading="lazy"
      />
    </div>
  );
}

export function AdSlot({ placement, advertisements, className = '' }: AdSlotProps) {
  const activeAds = useMemo(
    () => advertisements.filter((a) => a.placement === placement && Boolean(a.isActive)),
    [advertisements, placement]
  );

  if (activeAds.length === 0) return null;

  return (
    <div className={`space-y-4 ${className}`}>
      {activeAds.map((ad) => {
        const href = isSafeTargetUrl(ad.targetUrl);

        if (ad.adType === 'html' || ad.adType === 'js') {
          return <SandboxedAdFrame key={ad.id} ad={ad} />;
        }

        const hasImage = Boolean(ad.imageUrl && ad.imageUrl.trim());

        // Direct Link / Smartlink CTA Card (e.g. Adsterra Direct Link without banner image)
        if (!hasImage && href) {
          return (
            <a
              key={ad.id}
              href={href}
              target={href.startsWith('http') ? '_blank' : undefined}
              rel={href.startsWith('http') ? 'noopener noreferrer sponsored' : undefined}
              className="group block rounded-2xl glass-card border border-purple-500/30 hover:border-[#C8FA50]/50 p-4 sm:p-5 transition-all"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-400/35 flex items-center justify-center shrink-0">
                    <Sparkles className="w-5 h-5 text-[#C8FA50]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-300">
                      স্পন্সরড পার্টনার অফার
                    </div>
                    <div className="text-sm sm:text-base font-bold text-white truncate group-hover:text-[#C8FA50] transition-colors">
                      {ad.title}
                    </div>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full glow-lime-btn text-xs font-extrabold shrink-0">
                  অফার দেখুন <ExternalLink className="w-3.5 h-3.5" />
                </span>
              </div>
            </a>
          );
        }

        const content = (
          <div className="group relative rounded-2xl overflow-hidden glass-card hover:border-purple-400/40 transition-colors">
            <div className="aspect-[16/5] sm:aspect-[21/6] max-h-56 w-full overflow-hidden bg-[#0B0D14]">
              <SafeImage
                src={ad.imageUrl}
                alt={ad.title}
                fallbackLabel={ad.title}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
            </div>
            <div className="px-4 py-2.5 flex items-center justify-between bg-[#0E111B]/90 border-t border-white/10">
              <span className="text-xs text-slate-400">স্পন্সরড · {ad.title}</span>
              {href && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#C8FA50]">
                  ভিজিট করুন <ExternalLink className="w-3.5 h-3.5" />
                </span>
              )}
            </div>
          </div>
        );

        return href ? (
          <a
            key={ad.id}
            href={href}
            target={href.startsWith('http') ? '_blank' : undefined}
            rel={href.startsWith('http') ? 'noopener noreferrer sponsored' : undefined}
            className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8FA50] rounded-2xl"
          >
            {content}
          </a>
        ) : (
          <div key={ad.id}>{content}</div>
        );
      })}
    </div>
  );
}
