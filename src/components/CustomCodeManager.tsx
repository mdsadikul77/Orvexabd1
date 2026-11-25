import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

export function CustomCodeManager() {
  const { storefront } = useAuth();
  const lastScriptSigRef = useRef<string>('');

  const customCode = storefront?.settings?.customCode;
  const enabled = customCode?.enabled !== false;
  const customCss = enabled ? customCode?.customCss || '' : '';
  const headScripts = enabled ? customCode?.headScripts || '' : '';
  const customJs = enabled ? customCode?.customJs || '' : '';

  // Apply live Custom CSS
  useEffect(() => {
    const styleId = 'orvexa-admin-custom-css';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!customCss.trim()) {
      if (styleEl) styleEl.remove();
      return;
    }
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = customCss;
    return () => {
      // Keep style intact across non-CSS re-renders; only remove when empty or disabled
    };
  }, [customCss]);

  // Apply live Global Ad Network Scripts (Adsterra Social Bar/Popunder, Google Ad Manager GPT, Analytics) & Custom JS
  useEffect(() => {
    const sig = `${enabled ? '1' : '0'}::${headScripts}::${customJs}`;
    if (sig === lastScriptSigRef.current) return;
    lastScriptSigRef.current = sig;

    document.querySelectorAll('[data-orvexa-custom-script="true"]').forEach((el) => el.remove());
    if (!enabled) return;

    const appendScriptBlock = (raw: string, target: HTMLElement) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      if (/<script[\s>]/i.test(trimmed)) {
        try {
          const doc = new DOMParser().parseFromString(trimmed, 'text/html');
          const scripts = Array.from(doc.querySelectorAll('script'));
          for (const s of scripts) {
            const newScript = document.createElement('script');
            newScript.setAttribute('data-orvexa-custom-script', 'true');
            for (const attr of Array.from(s.attributes)) {
              newScript.setAttribute(attr.name, attr.value);
            }
            if (s.src) {
              newScript.src = s.src;
            } else if (s.textContent) {
              newScript.textContent = `(function(){try{${s.textContent}\n}catch(e){}})();`;
            }
            target.appendChild(newScript);
          }
        } catch {
          // ignore malformed script snippet
        }
      } else {
        const newScript = document.createElement('script');
        newScript.setAttribute('data-orvexa-custom-script', 'true');
        newScript.textContent = `(function(){try{${trimmed}\n}catch(e){}})();`;
        target.appendChild(newScript);
      }
    };

    if (headScripts.trim()) appendScriptBlock(headScripts, document.head);
    if (customJs.trim()) appendScriptBlock(customJs, document.body);
  }, [enabled, headScripts, customJs]);

  return null;
}
