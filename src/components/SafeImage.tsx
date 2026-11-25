import React, { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { resolveAssetUrl } from '../lib/apiConfig';

interface SafeImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}

export function SafeImage({ src, alt, className = '', fallbackLabel }: SafeImageProps) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = resolveAssetUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (!resolvedSrc || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#131624] to-[#0B0D14] text-slate-500 select-none ${className}`}
        role="img"
        aria-label={alt}
      >
        <Package className="w-8 h-8 mb-1.5 text-purple-400/60" strokeWidth={1.5} />
        {fallbackLabel && (
          <span className="text-xs font-medium text-slate-400 px-3 text-center line-clamp-1">
            {fallbackLabel}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
