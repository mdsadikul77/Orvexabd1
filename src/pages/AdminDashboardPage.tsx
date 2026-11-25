import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  Megaphone,
  MessageSquare,
  Package,
  Plus,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { GoogleDriveManager } from '../components/GoogleDriveManager';
import { SafeImage } from '../components/SafeImage';
import { AdminCodeThemeTab } from '../components/admin/AdminCodeThemeTab';
import { AdminPagesZipTab } from '../components/admin/AdminPagesZipTab';
import { AdminSmsTab } from '../components/admin/AdminSmsTab';
import { AdminStorageDeployTab } from '../components/admin/AdminStorageDeployTab';
import { useAuth } from '../context/AuthContext';
import type {
  Advertisement,
  Category,
  Order,
  Product,
  ReportItem,
  SiteSettings,
  User,
} from '../types';
import { ORDER_STATUS_BN, formatDateTime, formatPrice, toBnDigits } from '../utils/format';

type AdminTab =
  | 'overview'
  | 'product-ads'
  | 'ads'
  | 'categories'
  | 'products'
  | 'orders'
  | 'users'
  | 'reports'
  | 'sms'
  | 'settings'
  | 'code-theme'
  | 'pages-zip'
  | 'storage-deploy';

function normalizeSettingsDraft(raw?: Partial<SiteSettings> | null): SiteSettings {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const clone = JSON.parse(JSON.stringify(safe)) as Partial<SiteSettings>;
  const heroBanners =
    Array.isArray(clone.heroBanners) && clone.heroBanners.length > 0
      ? clone.heroBanners
      : [
          {
            id: 'banner-1',
            title: 'বাংলাদেশের নির্ভরযোগ্য মাল্টি-ভেন্ডর মার্কেটপ্লেস',
            subtitle: '',
            ctaLabel: 'শপিং শুরু করুন',
            ctaTarget: 'products',
            imageUrl: '/src/assets/images/banner_seller_ads_1795274485740.jpg',
            isActive: true,
          },
        ];
  const sellerAds =
    clone.sellerProductAdsPage && typeof clone.sellerProductAdsPage === 'object'
      ? clone.sellerProductAdsPage
      : ({} as Partial<SiteSettings['sellerProductAdsPage']>);
  return {
    heroBanners,
    productAdsSection: {
      enabled: clone.productAdsSection?.enabled ?? true,
      heading: clone.productAdsSection?.heading ?? 'স্পন্সরড ও বিশেষ প্রচারমূলক পণ্য',
      subheading: clone.productAdsSection?.subheading ?? 'হোমপেজের শীর্ষে প্রদর্শিত নির্বাচিত সেলারদের পণ্যসমূহ',
    },
    sellerProductAdsPage: {
      bannerTitle: sellerAds.bannerTitle ?? '',
      bannerSubtitle: sellerAds.bannerSubtitle ?? '',
      bannerImageUrl: sellerAds.bannerImageUrl ?? '',
      description: sellerAds.description ?? '',
      benefits: Array.isArray(sellerAds.benefits) ? sellerAds.benefits : [],
      howItWorks: Array.isArray(sellerAds.howItWorks) ? sellerAds.howItWorks : [],
      contactHeading: sellerAds.contactHeading ?? '',
      whatsappNumbers: Array.isArray(sellerAds.whatsappNumbers) ? sellerAds.whatsappNumbers : [],
      ctaText: sellerAds.ctaText ?? 'WhatsApp-এ মেসেজ দিন',
    },
    paymentOptions: {
      cashOnDelivery: true,
      bkashEnabled: false,
      nagadEnabled: false,
      deliveryFee: Number(clone.paymentOptions?.dhakaDeliveryFee ?? clone.paymentOptions?.deliveryFee ?? 70),
      dhakaDeliveryFee: Number(clone.paymentOptions?.dhakaDeliveryFee ?? 70),
      outsideDhakaDeliveryFee: Number(clone.paymentOptions?.outsideDhakaDeliveryFee ?? 120),
      freeDeliveryThreshold: 0,
    },
    contactInfo: {
      email: clone.contactInfo?.email ?? '',
      phone: clone.contactInfo?.phone ?? '',
      whatsapp: clone.contactInfo?.whatsapp ?? '',
      address: clone.contactInfo?.address ?? '',
    },
    footerSettings: {
      aboutText: clone.footerSettings?.aboutText ?? '',
      copyrightText: clone.footerSettings?.copyrightText ?? '© ২০২৬ Orvexa. সর্বস্বত্ব সংরক্ষিত।',
    },
    generalSettings: {
      siteName: clone.generalSettings?.siteName ?? 'Orvexa',
      announcementText: clone.generalSettings?.announcementText ?? '',
      announcementActive: clone.generalSettings?.announcementActive ?? true,
    },
    customCode: clone.customCode ?? {
      enabled: true,
      customCss: '',
      customBannerHtml: '',
      headScripts: '',
      customJs: '',
    },
    customPages: Array.isArray(clone.customPages) ? clone.customPages : [],
    customBlocks: Array.isArray(clone.customBlocks) ? clone.customBlocks : [],
  };
}

export function AdminDashboardPage({ onBack }: { onBack: () => void }) {
  const { user, storefront, apiFetch, refreshStorefront, showToast, uploadImage } = useAuth();
  const [tab, setTab] = useState<AdminTab>('overview');

  const [overview, setOverview] = useState({
    totalUsers: 0,
    totalBuyers: 0,
    totalSellers: 0,
    totalProducts: 0,
    totalOrders: 0,
    totalMessages: 0,
    openReports: 0,
    totalRevenue: 0,
  });
  const [usersList, setUsersList] = useState<User[]>([]);
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [ordersList, setOrdersList] = useState<Order[]>([]);
  const [productAdsList, setProductAdsList] = useState<any[]>([]);
  const [adsList, setAdsList] = useState<Advertisement[]>([]);
  const [reportsList, setReportsList] = useState<ReportItem[]>([]);
  const [conversationsList, setConversationsList] = useState<any[]>([]);
  const [ephemeralWarning, setEphemeralWarning] = useState(false);

  // Filters
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'buyer' | 'seller'>('all');
  const [prodSearch, setProdSearch] = useState('');

  // New / Edit Homepage Product Ad form
  const [newPadProductId, setNewPadProductId] = useState('');
  const [newPadPromoText, setNewPadPromoText] = useState('');
  const [newPadImageUrl, setNewPadImageUrl] = useState('');
  const [newPadOrder, setNewPadOrder] = useState('1');
  const [newPadDays, setNewPadDays] = useState('0');
  const [editingPad, setEditingPad] = useState<any | null>(null);

  // New / Edit Ad form
  const [adTitle, setAdTitle] = useState('');
  const [adPlacement, setAdPlacement] = useState<Advertisement['placement']>('homepage_top');
  const [adType, setAdType] = useState<Advertisement['adType']>('banner');
  const [adImageUrl, setAdImageUrl] = useState('');
  const [adTargetUrl, setAdTargetUrl] = useState('');
  const [adHtmlCode, setAdHtmlCode] = useState('');
  const [adJsCode, setAdJsCode] = useState('');
  const [editingAdId, setEditingAdId] = useState<string | null>(null);

  // New / Edit Category form
  const [catNameEn, setCatNameEn] = useState('');
  const [catNameBn, setCatNameBn] = useState('');
  const [catImageUrl, setCatImageUrl] = useState('');
  const [catOrder, setCatOrder] = useState('11');
  const [catSubsInput, setCatSubsInput] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);

  // Editing Product inline
  const [editProd, setEditProd] = useState<Product | null>(null);

  // Settings local editable copies
  const [settingsDraft, setSettingsDraft] = useState<SiteSettings | null>(null);

  const loadAllAdmin = useCallback(async () => {
    try {
      try {
        const boot = await apiFetch<{
          overview: any;
          users: User[];
          products: Product[];
          orders: Order[];
          productAds: any[];
          ads: Advertisement[];
          reports: ReportItem[];
          conversations: any[];
          storageStatus?: { isRemote: boolean; isServerless: boolean; dbMode: string };
        }>('/api/admin/bootstrap');

        if (!boot || typeof boot !== 'object' || !boot.overview) {
          throw new Error('অ্যাডমিন বুটস্ট্র্যাপ তথ্য সম্পূর্ণ পাওয়া যায়নি।');
        }
        setOverview(boot.overview);
        setUsersList(Array.isArray(boot.users) ? boot.users : []);
        const prods = Array.isArray(boot.products) ? boot.products : [];
        setProductsList(prods);
        if (prods.length > 0 && prods[0]?.id) {
          setNewPadProductId((prev) => prev || prods[0].id);
        }
        setOrdersList(Array.isArray(boot.orders) ? boot.orders : []);
        setProductAdsList(Array.isArray(boot.productAds) ? boot.productAds : []);
        setAdsList(Array.isArray(boot.ads) ? boot.ads : []);
        setReportsList(Array.isArray(boot.reports) ? boot.reports : []);
        setConversationsList(Array.isArray(boot.conversations) ? boot.conversations : []);
        if (boot.storageStatus) {
          setEphemeralWarning(Boolean(boot.storageStatus.isServerless && !boot.storageStatus.isRemote));
        }
        return;
      } catch {
        // Fallback to batched endpoints if single bootstrap fails
      }

      // Load in two batches so browser socket limits (6/host) & serverless cold starts stay fast and resilient
      const batch1 = await Promise.allSettled([
        apiFetch('/api/admin/overview'),
        apiFetch<{ users: User[] }>('/api/admin/users'),
        apiFetch<{ products: Product[] }>('/api/admin/products'),
        apiFetch<{ orders: Order[] }>('/api/admin/orders'),
      ]);
      const batch2 = await Promise.allSettled([
        apiFetch<{ productAds: any[] }>('/api/admin/product-ads'),
        apiFetch<{ ads: Advertisement[] }>('/api/admin/ads'),
        apiFetch<{ reports: ReportItem[] }>('/api/admin/reports'),
        apiFetch<{ conversations: any[] }>('/api/admin/messages'),
      ]);

      const [ovRes, usRes, prRes, ordsRes] = batch1;
      const [padsRes, adsRes, repsRes, convsRes] = batch2;

      if (ovRes.status === 'fulfilled' && ovRes.value && typeof ovRes.value === 'object') {
        setOverview((prev) => ({ ...prev, ...ovRes.value }));
      }
      if (usRes.status === 'fulfilled') setUsersList(Array.isArray(usRes.value?.users) ? usRes.value.users : []);
      if (prRes.status === 'fulfilled') {
        const prods = Array.isArray(prRes.value?.products) ? prRes.value.products : [];
        setProductsList(prods);
        if (prods.length > 0 && prods[0]?.id) {
          setNewPadProductId((prev) => prev || prods[0].id);
        }
      }
      if (ordsRes.status === 'fulfilled') setOrdersList(Array.isArray(ordsRes.value?.orders) ? ordsRes.value.orders : []);
      if (padsRes.status === 'fulfilled') setProductAdsList(Array.isArray(padsRes.value?.productAds) ? padsRes.value.productAds : []);
      if (adsRes.status === 'fulfilled') setAdsList(Array.isArray(adsRes.value?.ads) ? adsRes.value.ads : []);
      if (repsRes.status === 'fulfilled') setReportsList(Array.isArray(repsRes.value?.reports) ? repsRes.value.reports : []);
      if (convsRes.status === 'fulfilled') {
        setConversationsList(Array.isArray(convsRes.value?.conversations) ? convsRes.value.conversations : []);
      }

      const rejected = [...batch1, ...batch2].filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );
      if (rejected.length === 8) {
        showToast(rejected[0]?.reason?.message || 'অ্যাডমিন তথ্য লোড করা যায়নি।', 'error');
      } else if (rejected.length > 0) {
        showToast(rejected[0]?.reason?.message || 'কিছু অ্যাডমিন তথ্য লোড করতে সমস্যা হয়েছে।', 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'অ্যাডমিন তথ্য লোড করা যায়নি।', 'error');
    }
  }, [apiFetch, showToast]);

  useEffect(() => {
    if (user?.role === 'admin') {
      loadAllAdmin();
    }
  }, [user, loadAllAdmin]);

  useEffect(() => {
    setSettingsDraft(normalizeSettingsDraft(storefront?.settings));
  }, [storefront?.settings]);

  if (!user || user.role !== 'admin') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-5">
        <div className="w-16 h-16 mx-auto rounded-full bg-purple-500/15 border border-purple-400/30 flex items-center justify-center">
          <ShieldCheck className="w-8 h-8 text-[#C8FA50]" />
        </div>
        <h2 className="text-xl font-bold text-white">অ্যাডমিন অনুমোদন প্রয়োজন</h2>
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

  const saveSettingKey = async (key: keyof SiteSettings, value: unknown) => {
    try {
      await apiFetch(`/api/admin/settings/${key}`, {
        method: 'PUT',
        body: JSON.stringify(value),
      });
      await refreshStorefront();
      showToast('ওয়েবসাইট সেটিংস সংরক্ষিত হয়েছে!', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleAddProductAd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/product-ads', {
        method: 'POST',
        body: JSON.stringify({
          productId: newPadProductId,
          promoText: newPadPromoText,
          customImageUrl: newPadImageUrl,
          sortOrder: Number(newPadOrder) || 1,
          durationDays: Number(newPadDays) || 0,
        }),
      });
      setNewPadPromoText('');
      setNewPadImageUrl('');
      await Promise.all([loadAllAdmin(), refreshStorefront()]);
      showToast('হোমপেজ Product Ad যুক্ত হয়েছে।', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleSaveEditProductAd = async () => {
    if (!editingPad) return;
    try {
      await apiFetch(`/api/admin/product-ads/${editingPad.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          promoText: editingPad.promoText,
          customImageUrl: editingPad.customImageUrl,
          sortOrder: Number(editingPad.sortOrder) || 1,
        }),
      });
      setEditingPad(null);
      await Promise.all([loadAllAdmin(), refreshStorefront()]);
      showToast('Product Ad আপডেট হয়েছে।', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleToggleProductAd = async (ad: any) => {
    try {
      await apiFetch(`/api/admin/product-ads/${ad.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !ad.isActive }),
      });
      await Promise.all([loadAllAdmin(), refreshStorefront()]);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteProductAd = async (id: string) => {
    try {
      await apiFetch(`/api/admin/product-ads/${id}`, { method: 'DELETE' });
      await Promise.all([loadAllAdmin(), refreshStorefront()]);
      showToast('Product Ad সরানো হয়েছে।', 'info');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const resetAdForm = () => {
    setEditingAdId(null);
    setAdTitle('');
    setAdPlacement('homepage_top');
    setAdType('banner');
    setAdImageUrl('');
    setAdTargetUrl('');
    setAdHtmlCode('');
    setAdJsCode('');
  };

  const handleSaveAd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        title: adTitle,
        placement: adPlacement,
        adType,
        imageUrl: adImageUrl,
        targetUrl: adTargetUrl,
        htmlCode: adHtmlCode,
        jsCode: adJsCode,
      };
      if (editingAdId) {
        await apiFetch(`/api/admin/ads/${editingAdId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast('বিজ্ঞাপন আপডেট করা হয়েছে।', 'success');
      } else {
        await apiFetch('/api/admin/ads', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('নতুন বিজ্ঞাপন যোগ করা হয়েছে।', 'success');
      }
      resetAdForm();
      await Promise.all([loadAllAdmin(), refreshStorefront()]);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleStartEditAd = (ad: Advertisement) => {
    setEditingAdId(ad.id);
    setAdTitle(ad.title);
    setAdPlacement(ad.placement);
    setAdType(ad.adType);
    setAdImageUrl(ad.imageUrl || '');
    setAdTargetUrl(ad.targetUrl || '');
    setAdHtmlCode(ad.htmlCode || '');
    setAdJsCode(ad.jsCode || '');
  };

  const resetCatForm = () => {
    setEditingCatId(null);
    setCatNameEn('');
    setCatNameBn('');
    setCatImageUrl('');
    setCatOrder('11');
    setCatSubsInput('');
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const subs = catSubsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const parts = s.split('|').map((p) => p.trim());
          return { nameEn: parts[0], nameBn: parts[1] || parts[0] };
        });

      const payload = {
        nameEn: catNameEn,
        nameBn: catNameBn,
        imageUrl: catImageUrl || '/src/assets/images/cat_baby_gifts_1795274484045.jpg',
        sortOrder: Number(catOrder) || 10,
        subcategories: subs,
      };

      if (editingCatId) {
        await apiFetch(`/api/admin/categories/${editingCatId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast('ক্যাটাগরি আপডেট হয়েছে।', 'success');
      } else {
        await apiFetch('/api/admin/categories', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('নতুন ক্যাটাগরি যোগ হয়েছে।', 'success');
      }
      resetCatForm();
      await refreshStorefront();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleStartEditCategory = (cat: Category) => {
    setEditingCatId(cat.id);
    setCatNameEn(cat.nameEn || '');
    setCatNameBn(cat.nameBn || '');
    setCatImageUrl(cat.imageUrl || '');
    setCatOrder(String(cat.sortOrder ?? 1));
    setCatSubsInput(
      (Array.isArray(cat.subcategories) ? cat.subcategories : [])
        .map((s) => (s.nameBn !== s.nameEn ? `${s.nameEn}|${s.nameBn}` : s.nameEn))
        .join(', ')
    );
  };

  const tabs: Array<{ id: AdminTab; label: string }> = [
    { id: 'overview', label: 'ওভারভিউ' },
    { id: 'product-ads', label: 'Homepage Product Ads' },
    { id: 'ads', label: 'Ad Management' },
    { id: 'categories', label: 'ক্যাটাগরি' },
    { id: 'products', label: 'পণ্য সমূহ' },
    { id: 'orders', label: 'অর্ডার সমূহ' },
    { id: 'users', label: 'ইউজার ও সেলার' },
    { id: 'reports', label: 'রিপোর্ট ও মেসেজ' },
    { id: 'sms', label: 'SMS ও OTP গেটওয়ে' },
    { id: 'settings', label: 'ওয়েবসাইট ও কনটেন্ট সেটিংস' },
    { id: 'code-theme', label: 'কোড ও থিম' },
    { id: 'pages-zip', label: 'পেজ, ফিচার ও .ZIP' },
    { id: 'storage-deploy', label: 'স্টোরেজ ও ডেপ্লয়' },
  ];

  const categories = storefront?.categories || [];
  const inputClass =
    'px-3.5 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-[#C8FA50]">Orvexa Control Center</div>
          <h1 className="text-2xl font-bold text-white mt-0.5">অ্যাডমিন ড্যাশবোর্ড</h1>
        </div>
        <button
          type="button"
          onClick={loadAllAdmin}
          className="self-start px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-200 hover:border-[#C8FA50]/45 hover:text-[#C8FA50]"
        >
          ডেটা রিফ্রেশ করুন
        </button>
      </div>

      {ephemeralWarning && (
        <div className="rounded-2xl bg-rose-500/15 border border-rose-400/40 p-4 text-xs text-rose-100 leading-relaxed">
          <strong>সতর্কতা — স্থায়ী ডাটাবেস যুক্ত নেই:</strong> বর্তমানে সার্ভারটি অস্থায়ী মেমোরিতে চলছে। তাই নতুন অ্যাকাউন্ট,
          লগইন সেশন বা ছবি আপলোড করলে কিছুক্ষণ পর হারিয়ে যেতে পারে এবং "অ্যাডমিন প্রমাণীকরণ প্রয়োজন" এরর আসতে পারে। স্থায়ী সমাধানের জন্য
          হোস্টিং ড্যাশবোর্ডের <strong>Environment Variables</strong>-এ <code className="text-[#C8FA50]">TURSO_DATABASE_URL</code>,{' '}
          <code className="text-[#C8FA50]">TURSO_AUTH_TOKEN</code> এবং <code className="text-[#C8FA50]">SESSION_SECRET</code> বসিয়ে Redeploy করুন।
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
              tab === t.id
                ? 'glow-lime-btn'
                : 'bg-white/5 border border-white/10 text-slate-300 hover:border-white/25'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 1. OVERVIEW */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'মোট ব্যবহারকারী', val: overview.totalUsers, icon: Users },
            { label: 'মোট ক্রেতা (Buyers)', val: overview.totalBuyers, icon: Users },
            { label: 'মোট সেলার (Sellers)', val: overview.totalSellers, icon: Package },
            { label: 'মোট পণ্য', val: overview.totalProducts, icon: Package },
            { label: 'মোট অর্ডার', val: overview.totalOrders, icon: ShoppingBag },
            { label: 'মোট মেসেজ', val: overview.totalMessages, icon: MessageSquare },
            { label: 'খোলা রিপোর্ট', val: overview.openReports, icon: Megaphone },
            { label: 'মোট আয় (Revenue)', val: formatPrice(overview.totalRevenue), icon: Sparkles },
          ].map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div key={idx} className="glass-card rounded-2xl p-5">
                <Icon className="w-5 h-5 text-[#C8FA50] mb-2" />
                <div className="text-xs text-slate-400">{stat.label}</div>
                <div className="text-2xl font-bold text-white tabular-nums mt-1">{stat.val}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* 2. HOMEPAGE PRODUCT ADS */}
      {tab === 'product-ads' && settingsDraft && (
        <div className="space-y-6">
          <div className="glass-card rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-white">হোমপেজ Product Ads সেকশন কনফিগারেশন</h2>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-200">
                <input
                  type="checkbox"
                  className="accent-[#C8FA50]"
                  checked={settingsDraft.productAdsSection.enabled}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      productAdsSection: { ...settingsDraft.productAdsSection, enabled: e.target.checked },
                    })
                  }
                />
                সক্রিয় রাখুন
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={settingsDraft.productAdsSection.heading}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    productAdsSection: { ...settingsDraft.productAdsSection, heading: e.target.value },
                  })
                }
                placeholder="সেকশন শিরোনাম"
                className={inputClass}
              />
              <input
                type="text"
                value={settingsDraft.productAdsSection.subheading}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    productAdsSection: { ...settingsDraft.productAdsSection, subheading: e.target.value },
                  })
                }
                placeholder="উপ-শিরোনাম"
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => saveSettingKey('productAdsSection', settingsDraft.productAdsSection)}
              className="px-5 py-2 rounded-full glow-lime-btn text-xs font-bold"
            >
              সেকশন সেটিংস সংরক্ষণ
            </button>
          </div>

          <form onSubmit={handleAddProductAd} className="glass-card rounded-3xl p-6 space-y-4">
            <h2 className="text-base font-bold text-white">নতুন পণ্য Product Ads-এ যোগ করুন</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <select
                value={newPadProductId}
                onChange={(e) => setNewPadProductId(e.target.value)}
                className={inputClass}
              >
                {productsList.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#0B0E17] text-white">
                    {p.name} ({p.shopName})
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={newPadPromoText}
                onChange={(e) => setNewPadPromoText(e.target.value)}
                placeholder="প্রচারমূলক লেখা (যেমন: বিশেষ অফার)"
                className={inputClass}
              />
              <input
                type="text"
                value={newPadImageUrl}
                onChange={(e) => setNewPadImageUrl(e.target.value)}
                placeholder="কাস্টম ইমেজ URL (ঐচ্ছিক)"
                className={inputClass}
              />
              <input
                type="number"
                value={newPadOrder}
                onChange={(e) => setNewPadOrder(e.target.value)}
                placeholder="ক্রম (Order)"
                className={inputClass}
              />
              <input
                type="number"
                value={newPadDays}
                onChange={(e) => setNewPadDays(e.target.value)}
                placeholder="মেয়াদ (দিন, 0 = সীমাহীন)"
                className={inputClass}
              />
              <button type="submit" className="px-5 py-2.5 rounded-full glow-purple-btn text-xs font-bold">
                + Product Ad যোগ করুন
              </button>
            </div>
          </form>

          {editingPad && (
            <div className="glass-card rounded-2xl p-5 border border-[#C8FA50]/35 space-y-3">
              <h3 className="text-sm font-bold text-white">Product Ad সম্পাদনা: {editingPad.productName}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  value={editingPad.promoText || ''}
                  onChange={(e) => setEditingPad({ ...editingPad, promoText: e.target.value })}
                  placeholder="প্রচারমূলক লেখা"
                  className={inputClass}
                />
                <input
                  type="text"
                  value={editingPad.customImageUrl || ''}
                  onChange={(e) => setEditingPad({ ...editingPad, customImageUrl: e.target.value })}
                  placeholder="কাস্টম ইমেজ URL"
                  className={inputClass}
                />
                <input
                  type="number"
                  value={editingPad.sortOrder}
                  onChange={(e) => setEditingPad({ ...editingPad, sortOrder: Number(e.target.value) })}
                  placeholder="ক্রম (Order)"
                  className={inputClass}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveEditProductAd}
                  className="px-4 py-2 rounded-full glow-lime-btn text-xs font-bold"
                >
                  সংরক্ষণ
                </button>
                <button
                  type="button"
                  onClick={() => setEditingPad(null)}
                  className="px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-300"
                >
                  বাতিল
                </button>
              </div>
            </div>
          )}

          <div className="glass-card rounded-3xl divide-y divide-white/10">
            {productAdsList.map((ad) => (
              <div key={ad.id} className="p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-12 rounded-xl overflow-hidden bg-slate-900 border border-white/10">
                    <SafeImage
                      src={ad.customImageUrl || ad.images?.[0]}
                      alt={ad.productName}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{ad.productName}</div>
                    <div className="text-xs text-slate-400">
                      ক্রম: {ad.sortOrder} · {ad.promoText || 'প্রচারমূলক টেক্সট নেই'} ·{' '}
                      <span className="text-[#C8FA50] font-semibold">{formatPrice(ad.currentPrice)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingPad(ad)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-slate-200 hover:border-purple-400/50"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> এডিট
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleProductAd(ad)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      ad.isActive
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-white/5 text-slate-400 border border-white/10'
                    }`}
                  >
                    {ad.isActive ? 'সক্রিয়' : 'নিষ্ক্রিয়'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteProductAd(ad.id)}
                    className="p-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. ADVERTISEMENT MANAGEMENT */}
      {tab === 'ads' && (
        <div className="space-y-6">
          <form onSubmit={handleSaveAd} className="glass-card rounded-3xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">
                  {editingAdId ? 'বিজ্ঞাপন সম্পাদনা করুন' : 'নতুন বিজ্ঞাপন (Banner / Direct Link / Adsterra / Google Ads)'}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Adsterra Direct Link, Adsterra Banner/Native JS, Google Ad Manager (GPT) বা AdSense কোড সরাসরি চালিয়ে আয় করুন।
                </p>
              </div>
              {editingAdId && (
                <button
                  type="button"
                  onClick={resetAdForm}
                  className="px-3 py-1 rounded-full bg-white/5 border border-white/15 text-xs text-slate-300"
                >
                  বাতিল
                </button>
              )}
            </div>

            {/* Quick Network Presets */}
            <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-[#0A0D16] border border-white/10">
              <span className="text-[11px] font-semibold text-slate-400">দ্রুত নেটওয়ার্ক প্রিসেট:</span>
              <button
                type="button"
                onClick={() => {
                  setAdType('banner');
                  setAdImageUrl('');
                  if (!adTitle) setAdTitle('স্পন্সরড পার্টনার অফার');
                  showToast('Direct Link মোড প্রস্তুত: নিচে Ad URL / Link বক্সে আপনার Adsterra Direct Link বসান।', 'info');
                }}
                className="px-3 py-1 rounded-full bg-white/5 border border-white/15 text-[11px] font-semibold text-[#C8FA50] hover:border-[#C8FA50]/50"
              >
                + Adsterra Direct Link
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdType('js');
                  if (!adTitle) setAdTitle('Adsterra Banner / Native Ad');
                  setAdHtmlCode('<!-- ঐচ্ছিক: Adsterra Native কন্টেইনার div থাকলে এখানে দিন -->');
                  setAdJsCode(
                    '<!-- আপনার Adsterra Banner / Native <script> কোড এখানে পেস্ট করুন -->\n<script type="text/javascript">\n  // atOptions = { ... };\n</script>'
                  );
                  showToast('Adsterra JS প্রিসেট সেট হয়েছে: আপনার <script> কোড পেস্ট করুন।', 'info');
                }}
                className="px-3 py-1 rounded-full bg-white/5 border border-white/15 text-[11px] font-semibold text-purple-300 hover:border-purple-400/50"
              >
                + Adsterra Banner / Native JS
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdType('html');
                  if (!adTitle) setAdTitle('Google Ad Manager / AdSense');
                  setAdHtmlCode(
                    '<!-- Google AdSense / Ad Manager (<ins> + <script>) কোড এখানে পেস্ট করুন -->\n<!-- হেড স্ক্রিপ্ট (gpt.js / adsbygoogle.js) থাকলে "কোড ও থিম" ট্যাবের Head Scripts-এও দিতে পারেন -->'
                  );
                  showToast('Google Ad Manager / AdSense মোড প্রস্তুত: HTML/Script কোড পেস্ট করুন।', 'info');
                }}
                className="px-3 py-1 rounded-full bg-white/5 border border-white/15 text-[11px] font-semibold text-emerald-300 hover:border-emerald-400/50"
              >
                + Google Ad Manager / AdSense
              </button>
              <button
                type="button"
                onClick={() => setTab('code-theme')}
                className="ml-auto px-3 py-1 rounded-full bg-purple-500/15 border border-purple-400/30 text-[11px] font-semibold text-purple-200 hover:bg-purple-500/25"
              >
                Social Bar / Popunder / Head Tag →
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                value={adTitle}
                onChange={(e) => setAdTitle(e.target.value)}
                placeholder="বিজ্ঞাপনের শিরোনাম"
                className={inputClass}
              />
              <select
                value={adPlacement}
                onChange={(e) => setAdPlacement(e.target.value as any)}
                className={inputClass}
              >
                <option value="homepage_top" className="bg-[#0B0E17]">Homepage Top</option>
                <option value="homepage_middle" className="bg-[#0B0E17]">Homepage Middle</option>
                <option value="homepage_bottom" className="bg-[#0B0E17]">Homepage Bottom</option>
                <option value="category_page" className="bg-[#0B0E17]">Category Pages</option>
                <option value="product_page" className="bg-[#0B0E17]">Product Pages</option>
                <option value="sidebar" className="bg-[#0B0E17]">Sidebar Ads</option>
                <option value="other" className="bg-[#0B0E17]">Other Section</option>
              </select>
              <select
                value={adType}
                onChange={(e) => setAdType(e.target.value as any)}
                className={inputClass}
              >
                <option value="banner" className="bg-[#0B0E17]">Banner Ad / Direct Link</option>
                <option value="image" className="bg-[#0B0E17]">Image Ad / Direct Link</option>
                <option value="html" className="bg-[#0B0E17]">Ad HTML Code (AdSense / GAM)</option>
                <option value="js" className="bg-[#0B0E17]">Ad JavaScript Code (Adsterra / Sandboxed)</option>
              </select>
            </div>

            {(adType === 'banner' || adType === 'image') && (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={adImageUrl}
                      onChange={(e) => setAdImageUrl(e.target.value)}
                      placeholder="ছবির URL বা আপলোড (Direct Link হলে ফাঁকা রাখুন)"
                      className={`flex-1 ${inputClass}`}
                    />
                    <label className="px-3.5 py-2 rounded-xl border border-white/15 bg-white/5 text-xs font-medium text-slate-200 cursor-pointer hover:bg-white/10 flex items-center gap-1 shrink-0">
                      <Upload className="w-3.5 h-3.5 text-[#C8FA50]" /> আপলোড
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          try {
                            setAdImageUrl(await uploadImage(f));
                          } catch (err: any) {
                            showToast(err?.message || 'ছবি আপলোড করা যায়নি।', 'error');
                          }
                        }}
                      />
                    </label>
                  </div>
                  <input
                    type="text"
                    value={adTargetUrl}
                    onChange={(e) => setAdTargetUrl(e.target.value)}
                    placeholder="Ad URL / Direct Link (https://...)"
                    className={inputClass}
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  টিপস: ছবি না দিয়ে শুধু <strong>Ad URL / Direct Link</strong> দিলে এটি আকর্ষণীয় "স্পন্সরড পার্টনার অফার" কার্ড হিসেবে দেখাবে।
                </p>
              </div>
            )}

            {(adType === 'html' || adType === 'js') && (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <textarea
                    rows={4}
                    value={adHtmlCode}
                    onChange={(e) => setAdHtmlCode(e.target.value)}
                    placeholder="Ad HTML Code / Container div / <ins> লিখুন..."
                    className="px-3 py-2 text-xs font-mono bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
                  />
                  {adType === 'js' && (
                    <textarea
                      rows={4}
                      value={adJsCode}
                      onChange={(e) => setAdJsCode(e.target.value)}
                      placeholder="Adsterra / Google Ad JavaScript বা <script>...</script> কোড পেস্ট করুন..."
                      className="px-3 py-2 text-xs font-mono bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
                    />
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  নিরাপদ স্যান্ডবক্সড iframe-এ Adsterra, Google Ad Manager (GPT) এবং AdSense-এর পূর্ণ &lt;script&gt; ট্যাগ সরাসরি রান হবে এবং অটো-রিসাইজ হবে।
                </p>
              </div>
            )}

            <button type="submit" className="px-6 py-2.5 rounded-full glow-lime-btn text-xs font-bold">
              {editingAdId ? 'বিজ্ঞাপন আপডেট করুন' : 'বিজ্ঞাপন সংরক্ষণ করুন'}
            </button>
          </form>

          <div className="glass-card rounded-3xl divide-y divide-white/10">
            {adsList.map((ad) => (
              <div key={ad.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{ad.title}</div>
                  <div className="text-xs text-slate-400">
                    স্থান: <span className="text-purple-300">{ad.placement}</span> · ধরন: {ad.adType}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleStartEditAd(ad)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-slate-200 hover:border-purple-400/50"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> এডিট
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/admin/ads/${ad.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ isActive: !ad.isActive }),
                      });
                      await Promise.all([loadAllAdmin(), refreshStorefront()]);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                      ad.isActive
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-white/5 text-slate-400 border border-white/10'
                    }`}
                  >
                    {ad.isActive ? 'সক্রিয়' : 'নিষ্ক্রিয়'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/admin/ads/${ad.id}`, { method: 'DELETE' });
                      await Promise.all([loadAllAdmin(), refreshStorefront()]);
                    }}
                    className="p-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. CATEGORIES MANAGEMENT */}
      {tab === 'categories' && (
        <div className="space-y-6">
          <form onSubmit={handleSaveCategory} className="glass-card rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-white">
                {editingCatId ? 'ক্যাটাগরি সম্পাদনা করুন' : 'নতুন ক্যাটাগরি যোগ করুন'}
              </h2>
              {editingCatId && (
                <button
                  type="button"
                  onClick={resetCatForm}
                  className="px-3 py-1 rounded-full bg-white/5 border border-white/15 text-xs text-slate-300"
                >
                  বাতিল
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                type="text"
                required
                value={catNameEn}
                onChange={(e) => setCatNameEn(e.target.value)}
                placeholder="English Name"
                className={inputClass}
              />
              <input
                type="text"
                required
                value={catNameBn}
                onChange={(e) => setCatNameBn(e.target.value)}
                placeholder="বাংলা নাম"
                className={inputClass}
              />
              <input
                type="text"
                value={catImageUrl}
                onChange={(e) => setCatImageUrl(e.target.value)}
                placeholder="ছবির URL"
                className={inputClass}
              />
              <input
                type="number"
                value={catOrder}
                onChange={(e) => setCatOrder(e.target.value)}
                placeholder="ক্রম (Order)"
                className={inputClass}
              />
            </div>
            <input
              type="text"
              value={catSubsInput}
              onChange={(e) => setCatSubsInput(e.target.value)}
              placeholder="সাব-ক্যাটাগরি (কমা দিয়ে লিখুন, যেমন: Shirts|শার্ট, Panjabi|পাঞ্জাবি)"
              className={`w-full ${inputClass}`}
            />
            <button type="submit" className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full glow-lime-btn text-xs font-bold">
              <Plus className="w-4 h-4" /> {editingCatId ? 'ক্যাটাগরি আপডেট করুন' : 'ক্যাটাগরি যোগ করুন'}
            </button>
          </form>

          <div className="glass-card rounded-3xl divide-y divide-white/10">
            {categories.map((cat: Category) => (
              <div key={cat.id} className="p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-12 rounded-xl overflow-hidden bg-slate-900 border border-white/10">
                    <SafeImage src={cat.imageUrl} alt={cat.nameBn} className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {cat.nameBn} ({cat.nameEn})
                    </div>
                    <div className="text-xs text-slate-400">
                      ক্রম: {cat.sortOrder} · {Array.isArray(cat.subcategories) ? cat.subcategories.length : 0}টি সাব-ক্যাটাগরি
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleStartEditCategory(cat)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-slate-200 hover:border-purple-400/50"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> এডিট
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/admin/categories/${cat.id}`, { method: 'DELETE' });
                      await refreshStorefront();
                      showToast('ক্যাটাগরি মুছে ফেলা হয়েছে।', 'info');
                    }}
                    className="p-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. PRODUCTS MANAGEMENT */}
      {tab === 'products' && (
        <div className="space-y-4">
          <input
            type="search"
            value={prodSearch}
            onChange={(e) => setProdSearch(e.target.value)}
            placeholder="পণ্য বা শপের নাম দিয়ে খুঁজুন..."
            className={`w-full max-w-md ${inputClass}`}
          />

          {editProd && (
            <div className="glass-card rounded-2xl p-5 border border-[#C8FA50]/35 space-y-3">
              <h3 className="text-sm font-bold text-white">পণ্য সম্পাদনা: {editProd.name}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  value={editProd.name}
                  onChange={(e) => setEditProd({ ...editProd, name: e.target.value })}
                  className={inputClass}
                />
                <input
                  type="number"
                  value={editProd.currentPrice}
                  onChange={(e) => setEditProd({ ...editProd, currentPrice: Number(e.target.value) })}
                  className={inputClass}
                />
                <input
                  type="number"
                  value={editProd.stock}
                  onChange={(e) => setEditProd({ ...editProd, stock: Number(e.target.value) })}
                  className={inputClass}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/admin/products/${editProd.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({
                        name: editProd.name,
                        currentPrice: editProd.currentPrice,
                        stock: editProd.stock,
                      }),
                    });
                    setEditProd(null);
                    await Promise.all([loadAllAdmin(), refreshStorefront()]);
                    showToast('পণ্য আপডেট হয়েছে।', 'success');
                  }}
                  className="px-4 py-2 rounded-full glow-lime-btn text-xs font-bold"
                >
                  সংরক্ষণ
                </button>
                <button
                  type="button"
                  onClick={() => setEditProd(null)}
                  className="px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-300"
                >
                  বাতিল
                </button>
              </div>
            </div>
          )}

          <div className="glass-card rounded-3xl divide-y divide-white/10">
            {productsList
              .filter(
                (p) =>
                  Boolean(p) &&
                  (!prodSearch.trim() ||
                    (p.name || '').toLowerCase().includes(prodSearch.toLowerCase()) ||
                    (p.shopName || '').toLowerCase().includes(prodSearch.toLowerCase()))
              )
              .map((p) => (
                <div key={p.id} className="p-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-14 h-12 rounded-xl overflow-hidden bg-slate-900 border border-white/10 shrink-0">
                      <SafeImage src={p.images?.[0]} alt={p.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate">{p.name}</span>
                        {p.promoCode && Number(p.promoDiscount || 0) > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-[#C8FA50]/15 border border-[#C8FA50]/35 text-[10px] font-bold text-[#C8FA50]">
                            প্রোমো: {p.promoCode} (-{formatPrice(p.promoDiscount || 0)})
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        {p.shopName} · <span className="text-[#C8FA50] font-semibold">{formatPrice(p.currentPrice)}</span>{' '}
                        · স্টক: {p.stock}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/admin/products/${p.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ isFeatured: !p.isFeatured }),
                        });
                        loadAllAdmin();
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                        p.isFeatured
                          ? 'bg-amber-500/20 text-amber-300 border-amber-400/35'
                          : 'bg-white/5 text-slate-400 border-white/10'
                      }`}
                    >
                      Featured
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/admin/products/${p.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ isHidden: !p.isHidden }),
                        });
                        await Promise.all([loadAllAdmin(), refreshStorefront()]);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs font-medium text-slate-200"
                    >
                      {p.isHidden ? <EyeOff className="w-3.5 h-3.5 text-rose-400" /> : <Eye className="w-3.5 h-3.5 text-[#C8FA50]" />}
                      {p.isHidden ? 'লুকানো' : 'দৃশ্যমান'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditProd(p)}
                      className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs font-medium text-slate-200 hover:border-purple-400/50"
                    >
                      এডিট
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/admin/products/${p.id}`, { method: 'DELETE' });
                        await Promise.all([loadAllAdmin(), refreshStorefront()]);
                        showToast('পণ্য মুছে ফেলা হয়েছে।', 'info');
                      }}
                      className="p-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 6. ORDERS MANAGEMENT */}
      {tab === 'orders' && (
        <div className="space-y-3">
          {ordersList.map((order) => (
            <div key={order.id} className="glass-card rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-sm font-mono font-bold text-white">
                  {order.orderNumber} · <span className="text-[#C8FA50]">{formatPrice(order.totalAmount)}</span>
                </div>
                <div className="text-xs text-slate-400 flex flex-wrap items-center gap-1.5 mt-0.5">
                  <span>
                    {order.customerName} ({order.customerPhone}
                    {order.backupPhone ? `, বিকল্প: ${order.backupPhone}` : ''})
                  </span>
                  {order.phoneStats && (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        order.phoneStats.isFirstTimeBuyer
                          ? 'bg-sky-500/15 border-sky-400/30 text-sky-300'
                          : 'bg-purple-500/15 border-purple-400/30 text-purple-200'
                      }`}
                    >
                      {order.phoneStats.isFirstTimeBuyer
                        ? '(একটিও অর্ডার করে নি)'
                        : `(${toBnDigits(order.phoneStats.confirmedCount)} টি কনফার্ম অর্ডার) (${toBnDigits(order.phoneStats.cancelledCount)} টি বাতিল)`}
                    </span>
                  )}
                  <span>
                    · {[order.deliveryAddress, order.thana, order.district].filter(Boolean).join(', ')} · {order.paymentMethod}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">{formatDateTime(order.createdAt)}</div>
              </div>
              <select
                value={order.status}
                onChange={async (e) => {
                  await apiFetch(`/api/admin/orders/${order.id}/status`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: e.target.value }),
                  });
                  loadAllAdmin();
                  showToast('অর্ডার স্ট্যাটাস আপডেট হয়েছে।', 'success');
                }}
                className={inputClass}
              >
                {Object.entries(ORDER_STATUS_BN).map(([val, label]) => (
                  <option key={val} value={val} className="bg-[#0B0E17] text-white">
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* 7. USERS MANAGEMENT */}
      {tab === 'users' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['all', 'buyer', 'seller'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setUserRoleFilter(r)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                  userRoleFilter === r
                    ? 'glow-lime-btn'
                    : 'bg-white/5 border border-white/10 text-slate-300 hover:border-white/25'
                }`}
              >
                {r === 'all' ? 'সবাই' : r === 'buyer' ? 'Buyers' : 'Sellers'}
              </button>
            ))}
          </div>

          <div className="glass-card rounded-3xl divide-y divide-white/10">
            {usersList
              .filter((u) => u.role !== 'admin' && (userRoleFilter === 'all' || u.role === userRoleFilter))
              .map((u) => (
                <div key={u.id} className="p-4 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {u.fullName || u.username || 'User'} <span className="text-xs text-slate-400">(@{u.username || 'user'})</span>
                    </div>
                    <div className="text-xs text-slate-400">
                      <span className="text-purple-300 font-semibold">{(u.role || 'buyer').toUpperCase()}</span> · {u.emailOrPhone || ''}{' '}
                      {u.shopName ? `· শপ: ${u.shopName}` : ''} · স্ট্যাটাস:{' '}
                      <span className="font-semibold text-[#C8FA50]">{u.status || 'active'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {u.status !== 'active' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/admin/users/${u.id}/status`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: 'active' }),
                          });
                          loadAllAdmin();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold"
                      >
                        পুনরুদ্ধার (Restore)
                      </button>
                    )}
                    {u.status === 'active' && (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/users/${u.id}/status`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: 'suspended' }),
                            });
                            loadAllAdmin();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold"
                        >
                          স্থগিত (Suspend)
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/users/${u.id}/status`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: 'blocked' }),
                            });
                            loadAllAdmin();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold"
                        >
                          ব্লক (Block)
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                        loadAllAdmin();
                        showToast('অ্যাকাউন্ট মুছে ফেলা হয়েছে।', 'info');
                      }}
                      className="p-2 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 8. REPORTS & MESSAGES */}
      {tab === 'reports' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card rounded-3xl p-5 space-y-4">
            <h2 className="text-base font-bold text-white">ক্রেতা বার্তা ও রিপোর্ট ({reportsList.length})</h2>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {reportsList.length === 0 ? (
                <p className="text-xs text-slate-400">কোনো রিপোর্ট নেই।</p>
              ) : (
                reportsList.map((rep) => (
                  <div key={rep.id} className="p-3.5 bg-[#0A0D16] border border-white/10 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white">
                        {rep.subject} · <span className="text-purple-300">{rep.reportType}</span>
                      </span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/10 text-[#C8FA50]">
                        {rep.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300">{rep.message}</p>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>
                        প্রেরক: {rep.reporterName} {rep.targetName ? `· লক্ষ্য: ${rep.targetName}` : ''}
                      </span>
                      {rep.status === 'Open' && (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/admin/reports/${rep.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: 'Resolved' }),
                            });
                            loadAllAdmin();
                          }}
                          className="inline-flex items-center gap-1 text-[#C8FA50] font-semibold hover:underline"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> সমাধান করুন
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="glass-card rounded-3xl p-5 space-y-4">
            <h2 className="text-base font-bold text-white">ক্রেতা-বিক্রেতা ইনবক্স তদারকি ({conversationsList.length})</h2>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {conversationsList.map((c) => (
                <div key={c.id} className="p-3 bg-[#0A0D16] border border-white/10 rounded-2xl text-xs space-y-1">
                  <div className="font-semibold text-white">
                    {c.buyerName} ↔ {c.sellerShopName || c.sellerName}
                  </div>
                  {c.productName && <div className="text-[#C8FA50]">পণ্য: {c.productName}</div>}
                  <div className="text-slate-400 truncate">সর্বশেষ বার্তা: {c.lastMessage || '—'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 9. SMS & OTP GATEWAY */}
      {tab === 'sms' && <AdminSmsTab />}

      {/* 10. WEBSITE SETTINGS & CONTENT */}
      {tab === 'settings' && settingsDraft && (
        <div className="space-y-6">
          {/* General Announcement Bar */}
          <div className="glass-card rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-white">সাধারণ ওয়েবসাইট ও ঘোষণা (Announcement)</h2>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-200">
                <input
                  type="checkbox"
                  className="accent-[#C8FA50]"
                  checked={settingsDraft.generalSettings?.announcementActive ?? true}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      generalSettings: {
                        ...settingsDraft.generalSettings,
                        announcementActive: e.target.checked,
                      },
                    })
                  }
                />
                টিকার সক্রিয় রাখুন
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={settingsDraft.generalSettings?.siteName || 'Orvexa'}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    generalSettings: { ...settingsDraft.generalSettings, siteName: e.target.value },
                  })
                }
                placeholder="ওয়েবসাইটের নাম"
                className={inputClass}
              />
              <input
                type="text"
                value={settingsDraft.generalSettings?.announcementText || ''}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    generalSettings: { ...settingsDraft.generalSettings, announcementText: e.target.value },
                  })
                }
                placeholder="টিকার / ঘোষণা বার্তা"
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => saveSettingKey('generalSettings', settingsDraft.generalSettings)}
              className="px-5 py-2 rounded-full glow-lime-btn text-xs font-bold"
            >
              সাধারণ সেটিংস সংরক্ষণ
            </button>
          </div>

          {/* Hero Banner */}
          <div className="glass-card rounded-3xl p-6 space-y-4">
            <h2 className="text-base font-bold text-white">হোমপেজ হিরো ব্যানার</h2>
            {settingsDraft.heroBanners[0] && (
              <div className="space-y-3">
                <input
                  type="text"
                  value={settingsDraft.heroBanners[0].title}
                  onChange={(e) => {
                    const next = [...settingsDraft.heroBanners];
                    next[0] = { ...next[0], title: e.target.value };
                    setSettingsDraft({ ...settingsDraft, heroBanners: next });
                  }}
                  placeholder="হিরো শিরোনাম"
                  className={`w-full ${inputClass}`}
                />
                <textarea
                  rows={2}
                  value={settingsDraft.heroBanners[0].subtitle}
                  onChange={(e) => {
                    const next = [...settingsDraft.heroBanners];
                    next[0] = { ...next[0], subtitle: e.target.value };
                    setSettingsDraft({ ...settingsDraft, heroBanners: next });
                  }}
                  placeholder="হিরো বিবরণ"
                  className={`w-full ${inputClass}`}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={settingsDraft.heroBanners[0].ctaLabel}
                    onChange={(e) => {
                      const next = [...settingsDraft.heroBanners];
                      next[0] = { ...next[0], ctaLabel: e.target.value };
                      setSettingsDraft({ ...settingsDraft, heroBanners: next });
                    }}
                    placeholder="বাটন লেখা"
                    className={inputClass}
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={settingsDraft.heroBanners[0].imageUrl}
                      onChange={(e) => {
                        const next = [...settingsDraft.heroBanners];
                        next[0] = { ...next[0], imageUrl: e.target.value };
                        setSettingsDraft({ ...settingsDraft, heroBanners: next });
                      }}
                      placeholder="ব্যানার ছবির URL"
                      className={`flex-1 ${inputClass}`}
                    />
                    <label className="px-3 py-2 rounded-xl border border-white/15 bg-white/5 text-xs text-slate-200 cursor-pointer flex items-center gap-1 shrink-0">
                      <Upload className="w-3.5 h-3.5 text-[#C8FA50]" />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          try {
                            const url = await uploadImage(f);
                            const next = [...settingsDraft.heroBanners];
                            next[0] = { ...next[0], imageUrl: url };
                            setSettingsDraft({ ...settingsDraft, heroBanners: next });
                          } catch (err: any) {
                            showToast(err?.message || 'ব্যানার ছবি আপলোড করা যায়নি।', 'error');
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => saveSettingKey('heroBanners', settingsDraft.heroBanners)}
                  className="px-5 py-2 rounded-full glow-lime-btn text-xs font-bold"
                >
                  ব্যানার সংরক্ষণ করুন
                </button>
              </div>
            )}
          </div>

          {/* Seller Product Ads Page Content */}
          <div className="glass-card rounded-3xl p-6 space-y-4">
            <h2 className="text-base font-bold text-white">সেলার Product Ads পেজের কনটেন্ট</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={settingsDraft.sellerProductAdsPage?.bannerTitle || ''}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    sellerProductAdsPage: { ...settingsDraft.sellerProductAdsPage, bannerTitle: e.target.value },
                  })
                }
                placeholder="ব্যানার শিরোনাম"
                className={inputClass}
              />
              <input
                type="text"
                value={(settingsDraft.sellerProductAdsPage?.whatsappNumbers || []).join(', ')}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    sellerProductAdsPage: {
                      ...settingsDraft.sellerProductAdsPage,
                      whatsappNumbers: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder="WhatsApp নম্বরসমূহ (কমা দিয়ে)"
                className={inputClass}
              />
            </div>
            <textarea
              rows={3}
              value={settingsDraft.sellerProductAdsPage.description}
              onChange={(e) =>
                setSettingsDraft({
                  ...settingsDraft,
                  sellerProductAdsPage: { ...settingsDraft.sellerProductAdsPage, description: e.target.value },
                })
              }
              className={`w-full ${inputClass}`}
            />
            <button
              type="button"
              onClick={() => saveSettingKey('sellerProductAdsPage', settingsDraft.sellerProductAdsPage)}
              className="px-5 py-2 rounded-full glow-lime-btn text-xs font-bold"
            >
              Product Ads পেজ কনটেন্ট সংরক্ষণ করুন
            </button>
          </div>

          {/* Payment Options, Contact Info, Footer */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-card rounded-3xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#C8FA50]" />
                <h2 className="text-base font-bold text-white">পেমেন্ট ও ডেলিভারি সেটিংস</h2>
              </div>
              <div className="p-3 rounded-xl bg-[#C8FA50]/10 border border-[#C8FA50]/30 text-xs font-semibold text-[#C8FA50]">
                পেমেন্ট মাধ্যম: শুধুমাত্র ক্যাশ অন ডেলিভারি (Cash on Delivery) সক্রিয় রয়েছে।
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">ঢাকা জেলার ডেলিভারি চার্জ (৳)</label>
                  <input
                    type="number"
                    value={settingsDraft.paymentOptions.dhakaDeliveryFee ?? 70}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        paymentOptions: {
                          ...settingsDraft.paymentOptions,
                          deliveryFee: Number(e.target.value),
                          dhakaDeliveryFee: Number(e.target.value),
                        },
                      })
                    }
                    className={`w-full ${inputClass}`}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">ঢাকার বাইরে ৬৩ জেলার ডেলিভারি চার্জ (৳)</label>
                  <input
                    type="number"
                    value={settingsDraft.paymentOptions.outsideDhakaDeliveryFee ?? 120}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        paymentOptions: {
                          ...settingsDraft.paymentOptions,
                          outsideDhakaDeliveryFee: Number(e.target.value),
                        },
                      })
                    }
                    className={`w-full ${inputClass}`}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => saveSettingKey('paymentOptions', settingsDraft.paymentOptions)}
                className="px-5 py-2 rounded-full glow-lime-btn text-xs font-bold"
              >
                পেমেন্ট সেটিংস সংরক্ষণ
              </button>
            </div>

            <div className="glass-card rounded-3xl p-6 space-y-4">
              <h2 className="text-base font-bold text-white">যোগাযোগ ও ফুটার সেটিংস</h2>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={settingsDraft.contactInfo.phone}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      contactInfo: { ...settingsDraft.contactInfo, phone: e.target.value },
                    })
                  }
                  placeholder="ফোন নম্বর"
                  className={inputClass}
                />
                <input
                  type="text"
                  value={settingsDraft.contactInfo.email}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      contactInfo: { ...settingsDraft.contactInfo, email: e.target.value },
                    })
                  }
                  placeholder="ইমেইল"
                  className={inputClass}
                />
              </div>
              <input
                type="text"
                value={settingsDraft.footerSettings.copyrightText}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    footerSettings: { ...settingsDraft.footerSettings, copyrightText: e.target.value },
                  })
                }
                placeholder="কপিরাইট টেক্সট"
                className={`w-full ${inputClass}`}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => saveSettingKey('contactInfo', settingsDraft.contactInfo)}
                  className="px-5 py-2 rounded-full glow-lime-btn text-xs font-bold"
                >
                  যোগাযোগ সংরক্ষণ
                </button>
                <button
                  type="button"
                  onClick={() => saveSettingKey('footerSettings', settingsDraft.footerSettings)}
                  className="px-5 py-2 rounded-full glow-purple-btn text-xs font-bold"
                >
                  ফুটার সংরক্ষণ
                </button>
              </div>
            </div>
          </div>

          {/* Google Drive Cloud Storage & Marketplace Backup */}
          <GoogleDriveManager
            mode="full"
            title="Google Drive ক্লাউড স্টোরেজ ও ব্যাকআপ"
            subtitle="ওয়েবসাইটের জায়গার সমস্যা এড়াতে ব্যানার, পণ্যের ছবি এবং সম্পূর্ণ মার্কেটপ্লেস ডেটা ব্যাকআপ Google Drive-এ সংরক্ষণ করুন।"
            onSelectImageUrl={(url) => {
              if (settingsDraft.heroBanners[0]) {
                const next = [...settingsDraft.heroBanners];
                next[0] = { ...next[0], imageUrl: url };
                setSettingsDraft({ ...settingsDraft, heroBanners: next });
                showToast('Drive ছবিটি হিরো ব্যানারে সেট করা হয়েছে। উপরে "ব্যানার সংরক্ষণ করুন" চাপুন।', 'info');
              }
            }}
            onGetBackupPayload={async () => {
              const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
              return {
                filename: `orvexa-backup-${stamp}.json`,
                data: {
                  exportedAt: new Date().toISOString(),
                  overview,
                  categories: storefront?.categories || [],
                  settings: settingsDraft,
                  products: productsList,
                  orders: ordersList,
                  usersCount: usersList.length,
                  productAds: productAdsList,
                  advertisements: adsList,
                },
              };
            }}
          />
        </div>
      )}

      {/* 10. LIVE CUSTOM CODE & THEME */}
      {tab === 'code-theme' && <AdminCodeThemeTab />}

      {/* 11. CUSTOM PAGES, FEATURE BLOCKS & .ZIP EXPORT/IMPORT */}
      {tab === 'pages-zip' && (
        <AdminPagesZipTab
          adsList={adsList}
          productAdsList={productAdsList}
          onAfterImport={async () => {
            await Promise.all([loadAllAdmin(), refreshStorefront()]);
          }}
        />
      )}

      {/* 12. LONG-TERM STORAGE HEALTH & LIVE DEPLOY HOOK */}
      {tab === 'storage-deploy' && <AdminStorageDeployTab />}
    </div>
  );
}
