import React, { useEffect, useState } from 'react';
import JSZip from 'jszip';
import {
  CheckCircle2,
  Download,
  Edit3,
  FileArchive,
  FileText,
  Layers,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { Advertisement, CustomBlock, CustomPage } from '../../types';

const INPUT_CLASS =
  'w-full px-3.5 py-2 text-xs sm:text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]';

function slugifyTitle(text: string): string {
  const ascii = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return ascii || `page-${Date.now().toString(36)}`;
}

interface AdminPagesZipTabProps {
  adsList: Advertisement[];
  productAdsList: any[];
  onAfterImport: () => Promise<void>;
}

export function AdminPagesZipTab({ adsList, productAdsList, onAfterImport }: AdminPagesZipTabProps) {
  const { storefront, apiFetch, refreshStorefront, showToast } = useAuth();

  // Custom Pages state
  const [pages, setPages] = useState<CustomPage[]>([]);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState('');
  const [pageSlug, setPageSlug] = useState('');
  const [pageSubtitle, setPageSubtitle] = useState('');
  const [pageContent, setPageContent] = useState('');
  const [pageHtml, setPageHtml] = useState('');
  const [pageNav, setPageNav] = useState(false);
  const [pageFooter, setPageFooter] = useState(true);
  const [pageActive, setPageActive] = useState(true);

  // Custom Feature Blocks state
  const [blocks, setBlocks] = useState<CustomBlock[]>([]);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [blockTitle, setBlockTitle] = useState('');
  const [blockSubtitle, setBlockSubtitle] = useState('');
  const [blockType, setBlockType] = useState<CustomBlock['blockType']>('promo_banner');
  const [blockPlacement, setBlockPlacement] = useState<CustomBlock['placement']>('after_categories');
  const [blockContent, setBlockContent] = useState('');
  const [blockCtaLabel, setBlockCtaLabel] = useState('');
  const [blockCtaUrl, setBlockCtaUrl] = useState('');
  const [blockItemsText, setBlockItemsText] = useState('');
  const [blockOrder, setBlockOrder] = useState('1');
  const [blockActive, setBlockActive] = useState(true);

  // ZIP / JSON Import preview state
  const [pendingPackage, setPendingPackage] = useState<{
    fileName: string;
    data: any;
    summaryText: string;
  } | null>(null);
  const [exportingZip, setExportingZip] = useState(false);
  const [importingZip, setImportingZip] = useState(false);

  useEffect(() => {
    setPages(storefront?.settings?.customPages || []);
    setBlocks(storefront?.settings?.customBlocks || []);
  }, [storefront?.settings?.customPages, storefront?.settings?.customBlocks]);

  const persistPages = async (nextPages: CustomPage[], msg: string) => {
    await apiFetch('/api/admin/settings/customPages', {
      method: 'PUT',
      body: JSON.stringify(nextPages),
    });
    setPages(nextPages);
    await refreshStorefront();
    showToast(msg, 'success');
  };

  const persistBlocks = async (nextBlocks: CustomBlock[], msg: string) => {
    await apiFetch('/api/admin/settings/customBlocks', {
      method: 'PUT',
      body: JSON.stringify(nextBlocks),
    });
    setBlocks(nextBlocks);
    await refreshStorefront();
    showToast(msg, 'success');
  };

  const resetPageForm = () => {
    setEditingPageId(null);
    setPageTitle('');
    setPageSlug('');
    setPageSubtitle('');
    setPageContent('');
    setPageHtml('');
    setPageNav(false);
    setPageFooter(true);
    setPageActive(true);
  };

  const handleSavePage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pageTitle.trim()) return;
    const cleanSlug = (pageSlug.trim() || slugifyTitle(pageTitle)).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const item: CustomPage = {
      id: editingPageId || `pg-${Date.now()}`,
      slug: cleanSlug,
      title: pageTitle.trim(),
      subtitle: pageSubtitle.trim() || undefined,
      content: pageContent,
      htmlContent: pageHtml.trim() || undefined,
      showInNavbar: pageNav,
      showInFooter: pageFooter,
      isActive: pageActive,
      createdAt: editingPageId
        ? pages.find((p) => p.id === editingPageId)?.createdAt || Date.now()
        : Date.now(),
    };

    const next = editingPageId ? pages.map((p) => (p.id === editingPageId ? item : p)) : [...pages, item];
    try {
      await persistPages(next, editingPageId ? 'কাস্টম পেজ আপডেট হয়েছে!' : 'নতুন কাস্টম পেজ তৈরি হয়েছে!');
      resetPageForm();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const resetBlockForm = () => {
    setEditingBlockId(null);
    setBlockTitle('');
    setBlockSubtitle('');
    setBlockType('promo_banner');
    setBlockPlacement('after_categories');
    setBlockContent('');
    setBlockCtaLabel('');
    setBlockCtaUrl('');
    setBlockItemsText('');
    setBlockOrder('1');
    setBlockActive(true);
  };

  const handleSaveBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockTitle.trim()) return;

    const parsedItems = blockItemsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('|').map((s) => s.trim());
        return {
          title: parts[0] || '',
          description: parts[1] || '',
          badge: parts[2] || undefined,
        };
      });

    const item: CustomBlock = {
      id: editingBlockId || `blk-${Date.now()}`,
      title: blockTitle.trim(),
      subtitle: blockSubtitle.trim() || undefined,
      blockType,
      placement: blockPlacement,
      content: blockContent,
      ctaLabel: blockCtaLabel.trim() || undefined,
      ctaUrl: blockCtaUrl.trim() || undefined,
      items: parsedItems.length > 0 ? parsedItems : undefined,
      isActive: blockActive,
      sortOrder: Number(blockOrder) || 1,
    };

    const next = editingBlockId ? blocks.map((b) => (b.id === editingBlockId ? item : b)) : [...blocks, item];
    try {
      await persistBlocks(next, editingBlockId ? 'ফিচার ব্লক আপডেট হয়েছে!' : 'নতুন ফিচার ব্লক যুক্ত হয়েছে!');
      resetBlockForm();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Option 2: Export full site customization package as .ZIP
  const handleExportZip = async () => {
    if (!storefront) return;
    setExportingZip(true);
    try {
      const zip = new JSZip();
      const stamp = new Date().toISOString().slice(0, 10);

      const bundle = {
        format: 'orvexa-site-bundle-v1',
        exportedAt: new Date().toISOString(),
        settings: storefront.settings,
        categories: storefront.categories,
        advertisements: adsList,
        homepageProductAds: productAdsList,
      };

      zip.file('orvexa-bundle.json', JSON.stringify(bundle, null, 2));
      zip.file('settings/all-settings.json', JSON.stringify(storefront.settings, null, 2));
      zip.file('catalog/categories.json', JSON.stringify(storefront.categories, null, 2));
      zip.file('ads/advertisements.json', JSON.stringify(adsList, null, 2));
      zip.file('ads/product-ads.json', JSON.stringify(productAdsList, null, 2));

      const cc = storefront.settings?.customCode || {
        enabled: true,
        customCss: '',
        customBannerHtml: '',
        headScripts: '',
        customJs: '',
      };
      zip.file('custom-code/custom.css', cc.customCss || '');
      zip.file('custom-code/banner.html', cc.customBannerHtml || '');
      zip.file('custom-code/head-scripts.html', cc.headScripts || '');
      zip.file('custom-code/custom.js', cc.customJs || '');

      for (const p of storefront.settings?.customPages || []) {
        zip.file(`custom-pages/${p.slug || p.id || 'page'}.json`, JSON.stringify(p, null, 2));
      }
      zip.file(
        'README.txt',
        'Orvexa Full Site Customization Bundle\n\nআপনি এই .zip ফাইলটি আনজিপ করে custom-code/ বা custom-pages/ বা settings/ পরিবর্তন করে আবার .zip বানিয়ে Admin Panel থেকে আপলোড করতে পারবেন।'
      );

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orvexa-site-bundle-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('সম্পূর্ণ সাইট .ZIP প্যাকেজ ডাউনলোড হয়েছে!', 'success');
    } catch (err: any) {
      showToast(err.message || '.ZIP তৈরি করা যায়নি।', 'error');
    } finally {
      setExportingZip(false);
    }
  };

  // Upload & Parse .ZIP or .JSON site package
  const handleSelectPackageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      let parsed: any = null;

      if (file.name.toLowerCase().endsWith('.json')) {
        parsed = JSON.parse(await file.text());
      } else if (file.name.toLowerCase().endsWith('.zip')) {
        const zip = await JSZip.loadAsync(file);
        const mainBundleFile = zip.file('orvexa-bundle.json');
        if (mainBundleFile) {
          parsed = JSON.parse(await mainBundleFile.async('string'));
        } else {
          parsed = { settings: {} };
        }

        // Allow direct overrides from edited files inside custom-code/ or settings/
        const allSettingsFile = zip.file('settings/all-settings.json');
        if (allSettingsFile) {
          parsed.settings = { ...(parsed.settings || {}), ...JSON.parse(await allSettingsFile.async('string')) };
        }
        const cssFile = zip.file('custom-code/custom.css');
        const bannerFile = zip.file('custom-code/banner.html');
        const headFile = zip.file('custom-code/head-scripts.html');
        const jsFile = zip.file('custom-code/custom.js');
        if (cssFile || bannerFile || headFile || jsFile) {
          const prevCc = parsed.settings?.customCode || storefront?.settings?.customCode || { enabled: true };
          parsed.settings = {
            ...(parsed.settings || {}),
            customCode: {
              enabled: prevCc.enabled !== false,
              customCss: cssFile ? await cssFile.async('string') : prevCc.customCss || '',
              customBannerHtml: bannerFile ? await bannerFile.async('string') : prevCc.customBannerHtml || '',
              headScripts: headFile ? await headFile.async('string') : prevCc.headScripts || '',
              customJs: jsFile ? await jsFile.async('string') : prevCc.customJs || '',
            },
          };
        }
        const catsFile = zip.file('catalog/categories.json');
        if (catsFile) parsed.categories = JSON.parse(await catsFile.async('string'));
        const adsFile = zip.file('ads/advertisements.json');
        if (adsFile) parsed.advertisements = JSON.parse(await adsFile.async('string'));
        const padFile = zip.file('ads/product-ads.json');
        if (padFile) parsed.homepageProductAds = JSON.parse(await padFile.async('string'));
      } else {
        throw new Error('শুধুমাত্র .zip অথবা .json ফাইল আপলোড করুন।');
      }

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('ফাইলের ভেতরে সঠিক সাইট কনফিগারেশন পাওয়া যায়নি।');
      }

      const summaryParts = [
        parsed.settings ? `${Object.keys(parsed.settings).length}টি সেটিংস গ্রুপ` : null,
        Array.isArray(parsed.categories) ? `${parsed.categories.length}টি ক্যাটাগরি` : null,
        Array.isArray(parsed.advertisements) ? `${parsed.advertisements.length}টি বিজ্ঞাপন` : null,
        Array.isArray(parsed.homepageProductAds) ? `${parsed.homepageProductAds.length}টি Product Ads` : null,
      ].filter(Boolean);

      setPendingPackage({
        fileName: file.name,
        data: parsed,
        summaryText: summaryParts.length > 0 ? summaryParts.join(' · ') : 'কনফিগারেশন ফাইল প্রস্তুত',
      });
    } catch (err: any) {
      showToast(err.message || 'প্যাকেজ ফাইল পড়া যায়নি।', 'error');
    }
  };

  const handleConfirmImportPackage = async () => {
    if (!pendingPackage) return;
    setImportingZip(true);
    try {
      const res = await apiFetch<{ message: string; summary: any }>('/api/admin/import-package', {
        method: 'POST',
        body: JSON.stringify(pendingPackage.data),
      });
      setPendingPackage(null);
      await onAfterImport();
      showToast(
        `${res?.message || 'প্যাকেজ ইমপোর্ট সম্পন্ন হয়েছে!'} (সেটিংস: ${res?.summary?.settingsUpdated ?? 0}, ক্যাটাগরি: ${res?.summary?.categoriesImported ?? 0}, বিজ্ঞাপন: ${res?.summary?.adsImported ?? 0})`,
        'success'
      );
    } catch (err: any) {
      showToast(err.message || 'প্যাকেজ ইমপোর্ট ব্যর্থ হয়েছে।', 'error');
    } finally {
      setImportingZip(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Option 2A: Full Site .ZIP / .JSON Export & Import */}
      <div className="glass-card rounded-3xl p-6 space-y-4 border border-purple-500/30">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#C8FA50]">
              <FileArchive className="w-4 h-4" />
              <span>Site Bundle (.ZIP / .JSON) Export & Import</span>
            </div>
            <h2 className="text-lg font-bold text-white mt-0.5">
              সম্পূর্ণ ওয়েবসাইট প্যাকেজ .ZIP ডাউনলোড এবং আপলোড করে পরিবর্তন করুন
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              সম্পূর্ণ সাইটের সেটিংস, কাস্টম কোড (CSS/HTML/JS), কাস্টম পেজ, ক্যাটাগরি ও বিজ্ঞাপন .ZIP আকারে ডাউনলোড বা আপলোড করুন।
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5 shrink-0">
            <button
              type="button"
              disabled={exportingZip}
              onClick={handleExportZip}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full glow-lime-btn text-xs font-extrabold disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              {exportingZip ? 'তৈরি হচ্ছে...' : 'Export Site Bundle (.zip)'}
            </button>

            <label className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full glow-purple-btn text-xs font-bold cursor-pointer">
              <Upload className="w-4 h-4 text-[#C8FA50]" />
              <span>Import .ZIP / .JSON</span>
              <input type="file" accept=".zip,.json" onChange={handleSelectPackageFile} className="hidden" />
            </label>
          </div>
        </div>

        {pendingPackage && (
          <div className="rounded-2xl bg-[#0B0E18] border border-[#C8FA50]/45 p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold text-[#C8FA50] flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>ইমপোর্টের জন্য প্রস্তুত: {pendingPackage.fileName}</span>
              </div>
              <div className="text-xs text-slate-300">অন্তর্ভুক্ত ডেটা: {pendingPackage.summaryText}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={importingZip}
                onClick={handleConfirmImportPackage}
                className="px-4 py-2 rounded-full glow-lime-btn text-xs font-extrabold disabled:opacity-60"
              >
                {importingZip ? 'প্রয়োগ হচ্ছে...' : 'এখনই প্রয়োগ করুন (Apply)'}
              </button>
              <button
                type="button"
                onClick={() => setPendingPackage(null)}
                className="px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs text-slate-300"
              >
                বাতিল
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Option 2B: Custom Pages Builder */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleSavePage} className="lg:col-span-7 glass-card rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#C8FA50]" />
              {editingPageId ? 'কাস্টম পেজ সম্পাদনা' : 'নতুন কাস্টম পেজ তৈরি করুন'}
            </h3>
            {editingPageId && (
              <button
                type="button"
                onClick={resetPageForm}
                className="px-3 py-1 rounded-full bg-white/5 border border-white/15 text-xs text-slate-300"
              >
                বাতিল
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={pageTitle}
              onChange={(e) => setPageTitle(e.target.value)}
              placeholder="পেজের শিরোনাম (যেমন: আমাদের সম্পর্কে / শর্তাবলী)"
              className={INPUT_CLASS}
            />
            <input
              type="text"
              value={pageSlug}
              onChange={(e) => setPageSlug(e.target.value)}
              placeholder="URL Slug (যেমন: about-us, offers)"
              className={INPUT_CLASS}
            />
          </div>

          <input
            type="text"
            value={pageSubtitle}
            onChange={(e) => setPageSubtitle(e.target.value)}
            placeholder="উপ-শিরোনাম (ঐচ্ছিক)"
            className={INPUT_CLASS}
          />

          <textarea
            rows={4}
            value={pageContent}
            onChange={(e) => setPageContent(e.target.value)}
            placeholder="পেজের মূল টেক্সট লিখুন..."
            className={INPUT_CLASS}
          />

          <textarea
            rows={3}
            value={pageHtml}
            onChange={(e) => setPageHtml(e.target.value)}
            placeholder="ঐচ্ছিক HTML কনটেন্ট (কার্ড, বাটন বা টেবিল)..."
            className={`font-mono ${INPUT_CLASS}`}
          />

          <div className="flex flex-wrap gap-4 text-xs text-slate-200">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-[#C8FA50]" checked={pageNav} onChange={(e) => setPageNav(e.target.checked)} />
              নেভবারে দেখান (Navbar)
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-[#C8FA50]"
                checked={pageFooter}
                onChange={(e) => setPageFooter(e.target.checked)}
              />
              ফুটারে দেখান (Footer)
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-[#C8FA50]"
                checked={pageActive}
                onChange={(e) => setPageActive(e.target.checked)}
              />
              সক্রিয় (Active)
            </label>
          </div>

          <button type="submit" className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full glow-lime-btn text-xs font-bold">
            <Plus className="w-4 h-4" />
            {editingPageId ? 'পেজ আপডেট করুন' : 'পেজ সংরক্ষণ ও প্রকাশ করুন'}
          </button>
        </form>

        <div className="lg:col-span-5 glass-card rounded-3xl p-6 space-y-4">
          <h3 className="text-base font-bold text-white">তৈরিকৃত কাস্টম পেজসমূহ ({pages.length})</h3>
          {pages.length === 0 ? (
            <p className="text-xs text-slate-400 leading-relaxed">
              এখনো কোনো কাস্টম পেজ তৈরি করা হয়নি। বাম পাশ থেকে About Us, Offers বা Return Policy পেজ তৈরি করুন।
            </p>
          ) : (
            <div className="divide-y divide-white/10 max-h-[420px] overflow-y-auto">
              {pages.map((p) => (
                <div key={p.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{p.title}</div>
                    <div className="text-[11px] text-slate-400 font-mono truncate">/page/{p.slug}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPageId(p.id);
                        setPageTitle(p.title);
                        setPageSlug(p.slug);
                        setPageSubtitle(p.subtitle || '');
                        setPageContent(p.content || '');
                        setPageHtml(p.htmlContent || '');
                        setPageNav(p.showInNavbar);
                        setPageFooter(p.showInFooter);
                        setPageActive(p.isActive);
                      }}
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:border-[#C8FA50]/50"
                      title="এডিট"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const next = pages.filter((x) => x.id !== p.id);
                        await persistPages(next, 'কাস্টম পেজ মুছে ফেলা হয়েছে।');
                      }}
                      className="p-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                      title="মুছুন"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Option 2C: HomePage Feature Blocks Builder */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleSaveBlock} className="lg:col-span-7 glass-card rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#C8FA50]" />
              {editingBlockId ? 'ফিচার ব্লক সম্পাদনা' : 'হোমপেজ নতুন ফিচার ব্লক যুক্ত করুন'}
            </h3>
            {editingBlockId && (
              <button
                type="button"
                onClick={resetBlockForm}
                className="px-3 py-1 rounded-full bg-white/5 border border-white/15 text-xs text-slate-300"
              >
                বাতিল
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              value={blockTitle}
              onChange={(e) => setBlockTitle(e.target.value)}
              placeholder="ব্লকের শিরোনাম (যেমন: কেন Orvexa সেরা?)"
              className={INPUT_CLASS}
            />
            <input
              type="text"
              value={blockSubtitle}
              onChange={(e) => setBlockSubtitle(e.target.value)}
              placeholder="উপ-শিরোনাম (ঐচ্ছিক)"
              className={INPUT_CLASS}
            />
            <select
              value={blockType}
              onChange={(e) => setBlockType(e.target.value as any)}
              className={INPUT_CLASS}
            >
              <option value="promo_banner" className="bg-[#0B0E17]">প্রোমো ব্যানার কার্ড (Promo Banner)</option>
              <option value="feature_cards" className="bg-[#0B0E17]">ফিচার কার্ড গ্রিড (Feature Cards)</option>
              <option value="faq" className="bg-[#0B0E17]">প্রশ্ন-উত্তর (FAQ Accordion)</option>
              <option value="custom_html" className="bg-[#0B0E17]">কাস্টম HTML ব্লক</option>
            </select>
            <select
              value={blockPlacement}
              onChange={(e) => setBlockPlacement(e.target.value as any)}
              className={INPUT_CLASS}
            >
              <option value="after_hero" className="bg-[#0B0E17]">হিরোর পরে (After Hero)</option>
              <option value="after_categories" className="bg-[#0B0E17]">ক্যাটাগরির পরে (After Categories)</option>
              <option value="after_products" className="bg-[#0B0E17]">পণ্যের গ্রিডের পরে (After Products)</option>
              <option value="before_footer" className="bg-[#0B0E17]">ফুটারের আগে (Before Footer)</option>
            </select>
          </div>

          {(blockType === 'promo_banner' || blockType === 'custom_html') && (
            <textarea
              rows={3}
              value={blockContent}
              onChange={(e) => setBlockContent(e.target.value)}
              placeholder={blockType === 'custom_html' ? 'কাস্টম HTML কোড লিখুন...' : 'ব্যানারের বিস্তারিত বিবরণ লিখুন...'}
              className={INPUT_CLASS}
            />
          )}

          {(blockType === 'feature_cards' || blockType === 'faq') && (
            <textarea
              rows={4}
              value={blockItemsText}
              onChange={(e) => setBlockItemsText(e.target.value)}
              placeholder={`প্রতি লাইনে একটি আইটেম লিখুন:\nশিরোনাম | বিস্তারিত বিবরণ | ব্যাজ (ঐচ্ছিক)\n২৪ ঘন্টা ডেলিভারি | ঢাকা শহরে দ্রুত ডেলিভারি | দ্রুত`}
              className={INPUT_CLASS}
            />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              value={blockCtaLabel}
              onChange={(e) => setBlockCtaLabel(e.target.value)}
              placeholder="CTA বাটন লেখা (ঐচ্ছিক)"
              className={INPUT_CLASS}
            />
            <input
              type="text"
              value={blockCtaUrl}
              onChange={(e) => setBlockCtaUrl(e.target.value)}
              placeholder="লিংক (/page/offers বা #products)"
              className={INPUT_CLASS}
            />
            <input
              type="number"
              value={blockOrder}
              onChange={(e) => setBlockOrder(e.target.value)}
              placeholder="ক্রম (Order)"
              className={INPUT_CLASS}
            />
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
            <input type="checkbox" className="accent-[#C8FA50]" checked={blockActive} onChange={(e) => setBlockActive(e.target.checked)} />
            ব্লকটি হোমপেজে সক্রিয় রাখুন
          </label>

          <div>
            <button type="submit" className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full glow-purple-btn text-xs font-bold">
              <Plus className="w-4 h-4 text-[#C8FA50]" />
              {editingBlockId ? 'ফিচার ব্লক আপডেট করুন' : 'ফিচার ব্লক সংরক্ষণ করুন'}
            </button>
          </div>
        </form>

        <div className="lg:col-span-5 glass-card rounded-3xl p-6 space-y-4">
          <h3 className="text-base font-bold text-white">হোমপেজ ফিচার ব্লকস ({blocks.length})</h3>
          {blocks.length === 0 ? (
            <p className="text-xs text-slate-400 leading-relaxed">
              এখনো কোনো কাস্টম ফিচার ব্লক যুক্ত করা হয়নি। প্রোমো ব্যানার, সার্ভিস কার্ড বা FAQ যুক্ত করুন।
            </p>
          ) : (
            <div className="divide-y divide-white/10 max-h-[420px] overflow-y-auto">
              {blocks.map((b) => (
                <div key={b.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{b.title}</div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {b.blockType} · <span className="text-purple-300">{b.placement}</span> · ক্রম: {b.sortOrder}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBlockId(b.id);
                        setBlockTitle(b.title);
                        setBlockSubtitle(b.subtitle || '');
                        setBlockType(b.blockType);
                        setBlockPlacement(b.placement);
                        setBlockContent(b.content || '');
                        setBlockCtaLabel(b.ctaLabel || '');
                        setBlockCtaUrl(b.ctaUrl || '');
                        setBlockOrder(String(b.sortOrder || 1));
                        setBlockActive(b.isActive);
                        setBlockItemsText(
                          (b.items || [])
                            .map((it) => [it.title, it.description, it.badge].filter(Boolean).join(' | '))
                            .join('\n')
                        );
                      }}
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:border-[#C8FA50]/50"
                      title="এডিট"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const next = blocks.filter((x) => x.id !== b.id);
                        await persistBlocks(next, 'ফিচার ব্লক মুছে ফেলা হয়েছে।');
                      }}
                      className="p-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                      title="মুছুন"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
