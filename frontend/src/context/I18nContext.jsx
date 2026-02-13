import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

const I18nContext = createContext({
  language: 'en',
  setLanguage: () => {},
  translateEnabled: true,
  setTranslateEnabled: () => {},
});

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);

const isSkippableText = (text) => {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^[\d\s.,:/-]+$/.test(t)) return true;
  return false;
};

async function translateBatch(texts, target) {
  const res = await fetch('/api/settings/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts, target }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || 'Translate failed');
  return data.translations || texts;
}

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(() => localStorage.getItem('language') || 'en');
  const [translateEnabled, setTranslateEnabledState] = useState(() => localStorage.getItem('translate_enabled') !== '0');
  const cacheRef = useRef(new Map());

  const setLanguage = (lang) => {
    const next = lang || 'en';
    localStorage.setItem('language', next);
    setLanguageState(next);
  };

  const setTranslateEnabled = (enabled) => {
    const next = enabled ? '1' : '0';
    localStorage.setItem('translate_enabled', next);
    setTranslateEnabledState(enabled);
  };

  useEffect(() => {
    document.documentElement.lang = language || 'en';
  }, [language]);

  useEffect(() => {
    let cancelled = false;
    let busy = false;

    const translateDom = async (root) => {
      if (cancelled) return;
      if (!root || typeof NodeFilter === 'undefined') return;
      const target = language || 'en';
      if (!translateEnabled && target !== 'en') return;
      const textNodes = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!node?.parentElement) return NodeFilter.FILTER_REJECT;
          const tag = node.parentElement.tagName;
          if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
          if (node.parentElement.closest('[data-no-translate]')) return NodeFilter.FILTER_REJECT;
          if (isSkippableText(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }

      const originals = textNodes.map((node) => {
        if (!node.__i18nOriginal) node.__i18nOriginal = node.nodeValue;
        return node.__i18nOriginal;
      });

      if (target === 'en' || !translateEnabled) {
        textNodes.forEach((node) => { node.nodeValue = node.__i18nOriginal; });
        return;
      }

      const unique = Array.from(new Set(originals));
      const toTranslate = unique.filter((t) => !cacheRef.current.has(`${target}::${t}`));

      if (toTranslate.length) {
        for (let i = 0; i < toTranslate.length; i += 50) {
          const batch = toTranslate.slice(i, i + 50);
          try {
            const translated = await translateBatch(batch, target);
            batch.forEach((t, idx) => cacheRef.current.set(`${target}::${t}`, translated[idx] || t));
          } catch {
            batch.forEach((t) => cacheRef.current.set(`${target}::${t}`, t));
          }
        }
      }

      originals.forEach((orig, idx) => {
        const translated = cacheRef.current.get(`${target}::${orig}`) || orig;
        textNodes[idx].nodeValue = translated;
      });

      const elements = root.querySelectorAll('[placeholder], [title], [aria-label]');
      elements.forEach((el) => {
        if (el.closest('[data-no-translate]')) return;
        ['placeholder', 'title', 'aria-label'].forEach((attr) => {
          const val = el.getAttribute(attr);
          if (!val || isSkippableText(val)) return;
          const dataKey = `data-i18n-${attr}`;
          if (!el.getAttribute(dataKey)) el.setAttribute(dataKey, val);
          const orig = el.getAttribute(dataKey);
          if (target === 'en') {
            el.setAttribute(attr, orig);
            return;
          }
          const translated = cacheRef.current.get(`${target}::${orig}`);
          if (translated) el.setAttribute(attr, translated);
        });
      });
    };

    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        await translateDom(document.body);
      } finally {
        busy = false;
      }
    };

    const target = language || 'en';
    // Avoid continuous mutations when translation is effectively disabled.
    if (target === 'en' || !translateEnabled) {
      run();
      return () => {
        cancelled = true;
      };
    }

    const obs = new MutationObserver(() => run());
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    run();

    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, [language, translateEnabled]);

  const value = useMemo(() => ({ language, setLanguage, translateEnabled, setTranslateEnabled }), [language, translateEnabled]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
