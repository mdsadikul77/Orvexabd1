import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Inbox,
  MapPin,
  Megaphone,
  MessageSquare,
  Package,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Ticket,
  Trash2,
  TrendingUp,
  Truck,
  Upload,
  User as UserIcon,
  X,
} from 'lucide-react';
import type { AppView } from '../components/Navbar';
import { GoogleDriveManager } from '../components/GoogleDriveManager';
import { SafeImage } from '../components/SafeImage';
import { useAuth } from '../context/AuthContext';
import type { Order, OrderStatus, Product } from '../types';
import { ORDER_STATUS_BN, formatDateTime, formatPrice, toBnDigits } from '../utils/format';

export type SellerTab = 'overview' | 'products' | 'add' | 'orders';

interface SellerDashboardPageProps {
  onNavigate: (view: AppView) => void;
  onOpenProduct: (product: Product) => void;
  onOpenPublicProfile?: (sellerIdentifier: string) => void;
  initialTabRequest?: {
    tab: SellerTab;
    orderId?: string | null;
    key: number;
  } | null;
  onOpenInboxConversation?: (conversationId: string) => void;
}

const PROMO_FONT_STYLES = ['mono', 'serif', 'display', 'tracking'] as const;
type PromoFontStyle = (typeof PROMO_FONT_STYLES)[number];

const PROMO_FONT_STYLE_CLASSES: Record<PromoFontStyle, string> = {
  mono: 'font-mono tracking-[0.22em] text-[#C8FA50]',
  serif: 'font-serif italic tracking-[0.18em] text-[#D8B4FE]',
  display: 'font-sans font-black tracking-[0.26em] text-amber-300',
  tracking: 'font-mono font-extrabold tracking-[0.32em] text-sky-300',
};

function generateClientPromoCode7(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const rnd = new Uint32Array(12);
  window.crypto.getRandomValues(rnd);
  const chars = [
    upper[rnd[0] % upper.length],
    lower[rnd[1] % lower.length],
    digits[rnd[2] % digits.length],
  ];
  let idx = 3;
  while (chars.length < 7) {
    chars.push(all[rnd[idx++] % all.length]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd[(idx + i) % rnd.length] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function pickRandomPromoFont(): PromoFontStyle {
  const rnd = new Uint32Array(1);
  window.crypto.getRandomValues(rnd);
  return PROMO_FONT_STYLES[rnd[0] % PROMO_FONT_STYLES.length];
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  Pending: 'bg-amber-500/15 border-amber-400/35 text-amber-300',
  Confirmed: 'bg-sky-500/15 border-sky-400/35 text-sky-300',
  Processing: 'bg-purple-500/15 border-purple-400/35 text-purple-300',
  Shipped: 'bg-indigo-500/15 border-indigo-400/35 text-indigo-300',
  Delivered: 'bg-[#C8FA50]/15 border-[#C8FA50]/45 text-[#C8FA50]',
  Cancelled: 'bg-rose-500/15 border-rose-400/35 text-rose-300',
};

export function SellerDashboardPage({
  onNavigate,
  onOpenProduct,
  onOpenPublicProfile,
  initialTabRequest = null,
  onOpenInboxConversation,
}: SellerDashboardPageProps) {
  const { user, storefront, apiFetch, uploadImage, showToast, refreshStorefront, subscribeWsMessage } = useAuth();
  const [tab, setTab] = useState<SellerTab>(initialTabRequest?.tab || 'overview');
  const [overview, setOverview] = useState({
    totalProducts: 0,
    totalViews: 0,
    totalOrders: 0,
    totalRevenue: 0,
    unreadMessages: 0,
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Orders filtering & detail modal state
  const [orderStatusFilter, setOrderStatusFilter] = useState<'All' | OrderStatus>('All');
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [pendingSelectOrderId, setPendingSelectOrderId] = useState<string | null>(initialTabRequest?.orderId || null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [messagingOrderId, setMessagingOrderId] = useState<string | null>(null);

  // Add / Edit Product form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('cat-fashion');
  const [subcategory, setSubcategory] = useState('Panjabi');
  const [previousPrice, setPreviousPrice] = useState('');
  const [currentPrice, setCurrentPrice] = useState('');
  const [stock, setStock] = useState('10');
  const [shopName, setShopName] = useState(user?.shopName || '');
  const [images, setImages] = useState<string[]>([]);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [sizesInput, setSizesInput] = useState('');
  const [colorsInput, setColorsInput] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [promoEnabled, setPromoEnabled] = useState(false);
  const [promoDiscount, setPromoDiscount] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoFontStyle, setPromoFontStyle] = useState<PromoFontStyle>('mono');

  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [subcatDropdownOpen, setSubcatDropdownOpen] = useState(false);
  const [subcatSearch, setSubcatSearch] = useState('');
  const categoryBoxRef = useRef<HTMLDivElement>(null);
  const subcatBoxRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [ov, prods, ords] = await Promise.all([
          apiFetch('/api/seller/overview'),
          apiFetch<{ products: Product[] }>('/api/seller/products'),
          apiFetch<{ orders: Order[] }>('/api/seller/orders'),
        ]);
        if (ov && typeof ov === 'object') setOverview((prev) => ({ ...prev, ...ov }));
        setProducts(Array.isArray(prods?.products) ? prods.products : []);
        const nextOrders = Array.isArray(ords?.orders) ? ords.orders : [];
        setOrders(nextOrders);
        setSelectedOrder((prev) => (prev ? nextOrders.find((o) => o.id === prev.id) || prev : null));
      } catch {
        // ignore
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [apiFetch]
  );

  useEffect(() => {
    if (user && user.role === 'seller') {
      loadData();
    }
  }, [user, loadData]);

  // Respond to external navigation requests (e.g., clicking a new order notification)
  useEffect(() => {
    if (initialTabRequest) {
      setTab(initialTabRequest.tab);
      if (initialTabRequest.orderId) {
        setPendingSelectOrderId(initialTabRequest.orderId);
      }
    }
  }, [initialTabRequest]);

  // Auto-open specific order details once orders finish loading
  useEffect(() => {
    if (pendingSelectOrderId && orders.length > 0) {
      const target = orders.find((o) => o.id === pendingSelectOrderId || o.orderNumber === pendingSelectOrderId);
      if (target) {
        setSelectedOrder(target);
        setPendingSelectOrderId(null);
      }
    }
  }, [pendingSelectOrderId, orders]);

  // Real-time WebSocket auto-refresh whenever a buyer places an order or status updates
  useEffect(() => {
    if (!user || user.role !== 'seller') return;
    return subscribeWsMessage((evt) => {
      if (evt.type === 'order:new' || evt.type === 'order:updated') {
        loadData(true);
      }
    });
  }, [user, subscribeWsMessage, loadData]);

  useEffect(() => {
    if (user?.shopName && !shopName) {
      setShopName(user.shopName);
    }
  }, [user?.shopName, shopName]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (categoryBoxRef.current && !categoryBoxRef.current.contains(target)) {
        setCategoryDropdownOpen(false);
      }
      if (subcatBoxRef.current && !subcatBoxRef.current.contains(target)) {
        setSubcatDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    const cats = storefront?.categories || [];
    if (cats.length === 0) return;
    const matchedCat = cats.find((c) => c.id === categoryId);
    if (!matchedCat && !editingId) {
      setCategoryId(cats[0].id);
      const firstSub = Array.isArray(cats[0].subcategories) ? cats[0].subcategories[0]?.nameEn || '' : '';
      setSubcategory(firstSub);
      return;
    }
    const targetCat = matchedCat || cats[0];
    const targetSubs = Array.isArray(targetCat?.subcategories) ? targetCat.subcategories : [];
    if (
      targetCat &&
      targetSubs.length > 0 &&
      !editingId &&
      !targetSubs.some((s) => s.nameEn === subcategory)
    ) {
      setSubcategory(targetSubs[0]?.nameEn || '');
    }
  }, [storefront?.categories, categoryId, subcategory, editingId]);

  const orderCountsByStatus = useMemo(() => {
    const counts: Record<string, number> = {
      All: orders.length,
      Pending: 0,
      Confirmed: 0,
      Processing: 0,
      Shipped: 0,
      Delivered: 0,
      Cancelled: 0,
    };
    for (const o of orders) {
      counts[o.status] = (counts[o.status] || 0) + 1;
    }
    return counts;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return orders.filter((o) => {
      if (orderStatusFilter !== 'All' && o.status !== orderStatusFilter) return false;
      if (!q) return true;
      const haystack = [
        o.orderNumber,
        o.customerName,
        o.customerPhone,
        o.backupPhone || '',
        o.district || '',
        o.thana || '',
        o.deliveryAddress,
        ...(o.items || []).map((i) => i.productName),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [orders, orderStatusFilter, orderSearch]);

  // Strict Seller-account gate
  if (!user || user.role !== 'seller') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-5">
        <div className="w-16 h-16 mx-auto rounded-full bg-purple-500/15 border border-purple-400/30 flex items-center justify-center">
          <Package className="w-8 h-8 text-[#C8FA50]" />
        </div>
        <h2 className="text-xl font-bold text-white">শুধুমাত্র সেলার অ্যাকাউন্টের জন্য</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          পণ্য ব্যবস্থাপনা এবং ক্রেতার অর্ডারের সম্পূর্ণ ডিটেইলস দেখার অপশনটি শুধুমাত্র নিবন্ধিত Seller অ্যাকাউন্টে উপলব্ধ।
        </p>
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="px-6 py-2.5 rounded-full glow-lime-btn text-sm font-bold"
        >
          হোমপেজে ফিরে যান
        </button>
      </div>
    );
  }

  const categories = storefront?.categories || [];
  const selectedCategoryObj = categories.find((c) => c.id === categoryId) || categories[0];
  const filteredCategories = categories.filter((c) => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return true;
    return (c.nameBn || '').toLowerCase().includes(q) || (c.nameEn || '').toLowerCase().includes(q);
  });
  const availableSubcategories = Array.isArray(selectedCategoryObj?.subcategories)
    ? selectedCategoryObj.subcategories
    : [];
  const filteredSubcategories = availableSubcategories.filter((s) => {
    const q = subcatSearch.trim().toLowerCase();
    if (!q) return true;
    return (s.nameBn || '').toLowerCase().includes(q) || (s.nameEn || '').toLowerCase().includes(q);
  });
  const selectedSubcatObj = availableSubcategories.find((s) => s.nameEn === subcategory);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setCategoryId(categories[0]?.id || 'cat-fashion');
    setSubcategory(
      Array.isArray(categories[0]?.subcategories) ? categories[0].subcategories[0]?.nameEn || '' : ''
    );
    setPreviousPrice('');
    setCurrentPrice('');
    setStock('10');
    setShopName(user.shopName || '');
    setImages([]);
    setImageUrlInput('');
    setSizesInput('');
    setColorsInput('');
    setPreviewMode(false);
    setPromoEnabled(false);
    setPromoDiscount('');
    setPromoCode('');
    setPromoFontStyle('mono');
    setCategoryDropdownOpen(false);
    setCategorySearch('');
    setSubcatDropdownOpen(false);
    setSubcatSearch('');
  };

  const handleEditProduct = (p: Product) => {
    setEditingId(p.id);
    setName(p.name);
    setDescription(p.description);
    setCategoryId(p.categoryId);
    setSubcategory(p.subcategory);
    setPreviousPrice(p.previousPrice ? String(p.previousPrice) : '');
    setCurrentPrice(String(p.currentPrice));
    setStock(String(p.stock));
    setShopName(p.shopName);
    setImages(p.images || []);
    setSizesInput((p.variations?.sizes || []).join(', '));
    setColorsInput((p.variations?.colors || []).join(', '));
    const hasExistingPromo = Boolean(p.promoCode && Number(p.promoDiscount || 0) > 0);
    setPromoEnabled(hasExistingPromo);
    setPromoDiscount(hasExistingPromo ? String(p.promoDiscount) : '');
    setPromoCode(hasExistingPromo ? p.promoCode || '' : '');
    setPromoFontStyle(
      p.promoFontStyle && (PROMO_FONT_STYLES as readonly string[]).includes(p.promoFontStyle)
        ? (p.promoFontStyle as PromoFontStyle)
        : 'mono'
    );
    setCategoryDropdownOpen(false);
    setCategorySearch('');
    setSubcatDropdownOpen(false);
    setSubcatSearch('');
    setPreviewMode(false);
    setTab('add');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      for (let i = 0; i < files.length; i++) {
        const url = await uploadImage(files[i]);
        setImages((prev) => [...prev, url]);
      }
      showToast('ছবি আপলোড সম্পন্ন হয়েছে।', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleAddImageUrl = () => {
    if (!imageUrlInput.trim()) return;
    setImages((prev) => [...prev, imageUrlInput.trim()]);
    setImageUrlInput('');
  };

  const handlePublishProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (images.length === 0) {
      showToast('কমপক্ষে একটি পণ্যের ছবি যোগ করুন।', 'error');
      return;
    }
    if (promoEnabled) {
      const discVal = Number(promoDiscount);
      const priceVal = Number(currentPrice);
      if (!discVal || discVal <= 0 || (priceVal > 0 && discVal >= priceVal)) {
        showToast('প্রোমো ছাড়ের পরিমাণ ১ টাকা থেকে বিক্রয় মূল্যের কম হতে হবে।', 'error');
        return;
      }
    }
    setSavingProduct(true);
    try {
      const activePromoCode = promoEnabled
        ? promoCode && /^[A-Za-z0-9]{7}$/.test(promoCode)
          ? promoCode
          : generateClientPromoCode7()
        : null;
      const payload = {
        name,
        description,
        categoryId,
        subcategory,
        previousPrice: previousPrice ? Number(previousPrice) : null,
        currentPrice: Number(currentPrice),
        stock: Number(stock),
        shopName,
        images,
        promoEnabled,
        promoDiscount: promoEnabled ? Number(promoDiscount) : 0,
        promoCode: activePromoCode,
        promoFontStyle: promoEnabled ? promoFontStyle : null,
        variations: {
          sizes: sizesInput
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          colors: colorsInput
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
      };

      if (editingId) {
        await apiFetch(`/api/seller/products/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast('পণ্যটি সফলভাবে আপডেট হয়েছে।', 'success');
      } else {
        await apiFetch('/api/seller/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('নতুন পণ্য সফলভাবে প্রকাশিত হয়েছে!', 'success');
      }
      resetForm();
      setTab('products');
      await Promise.all([loadData(), refreshStorefront()]);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSavingProduct(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      await apiFetch(`/api/seller/products/${id}`, { method: 'DELETE' });
      showToast('পণ্যটি মুছে ফেলা হয়েছে।', 'info');
      await Promise.all([loadData(), refreshStorefront()]);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: string) => {
    setUpdatingOrderId(orderId);
    try {
      await apiFetch(`/api/seller/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast('অর্ডার স্ট্যাটাস আপডেট হয়েছে।', 'success');
      await loadData(true);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleCopyShareLink = async (productId: string) => {
    try {
      const url = `${window.location.origin}/product/${productId}`;
      await navigator.clipboard.writeText(url);
      showToast('পণ্যের স্থায়ী লিংক কপি করা হয়েছে!', 'success');
    } catch {
      showToast('লিংক কপি করা যায়নি। অনুগ্রহ করে ম্যানুয়ালি কপি করুন।', 'error');
    }
  };

  const handleCopyText = async (text: string, label: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      showToast(`${label} কপি হয়েছে!`, 'success');
      setTimeout(() => setCopiedId((curr) => (curr === key ? null : curr)), 2000);
    } catch {
      showToast('কপি করা যায়নি।', 'error');
    }
  };

  const renderPhoneVerificationBadge = (order: Order, compact = false) => {
    const st = order.phoneStats;
    if (!st) return null;
    if (st.isFirstTimeBuyer) {
      return (
        <div
          className={`inline-flex items-center gap-1.5 rounded-xl bg-white/5 border border-white/15 text-slate-300 font-semibold ${
            compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
          }`}
        >
          <span>(একটিও অর্ডার করে নি)</span>
        </div>
      );
    }
    const hasRisk = st.cancelledCount > 0 && st.cancelledCount >= st.confirmedCount;
    return (
      <div
        className={`inline-flex flex-wrap items-center gap-1.5 rounded-xl border font-bold ${
          hasRisk
            ? 'bg-amber-500/10 border-amber-400/35 text-amber-200'
            : 'bg-emerald-500/10 border-emerald-400/35 text-emerald-200'
        } ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'}`}
      >
        {hasRisk ? (
          <ShieldAlert className="w-3.5 h-3.5 text-amber-300 shrink-0" />
        ) : (
          <ShieldCheck className="w-3.5 h-3.5 text-[#C8FA50] shrink-0" />
        )}
        <span>({toBnDigits(st.confirmedCount)} টি কনফার্ম অর্ডার)</span>
        <span className={st.cancelledCount > 0 ? 'text-rose-300' : 'text-slate-300'}>
          ({toBnDigits(st.cancelledCount)} টি অর্ডার বাতিল করেছেন)
        </span>
      </div>
    );
  };

  const buildCourierSlip = (order: Order) => {
    const sellerVal = order.sellerSubtotal ?? (order.items || []).reduce((s, i) => s + i.price * i.quantity, 0);
    const phoneHistoryText = order.phoneStats
      ? order.phoneStats.isFirstTimeBuyer
        ? '(একটিও অর্ডার করে নি)'
        : `(${toBnDigits(order.phoneStats.confirmedCount)} টি কনফার্ম অর্ডার) (${toBnDigits(
            order.phoneStats.cancelledCount
          )} টি অর্ডার বাতিল করেছেন)`
      : '';
    const lines = [
      `অর্ডার নম্বর: #${order.orderNumber}`,
      `তারিখ: ${formatDateTime(order.createdAt)}`,
      `ক্রেতার নাম: ${order.customerName}`,
      `মোবাইল: ${order.customerPhone} ${phoneHistoryText}`.trim(),
      ...(order.backupPhone ? [`বিকল্প নম্বর: ${order.backupPhone}`] : []),
      `জেলা: ${order.district || '-'}`,
      `থানা/উপজেলা: ${order.thana || '-'}`,
      `ঠিকানা: ${order.deliveryAddress}`,
      `পেমেন্ট: ${order.paymentMethod}`,
      `--- পণ্যসমূহ ---`,
      ...(order.items || []).map(
        (it, idx) =>
          `${idx + 1}. ${it.productName}${it.variation ? ` [${it.variation}]` : ''} × ${it.quantity} = ${formatPrice(
            it.price * it.quantity
          )}`
      ),
      `সেলারের পণ্যের মূল্য: ${formatPrice(sellerVal)}`,
      ...(!order.isMultiVendorOrder ? [`ডেলিভারি চার্জ: ${formatPrice(order.deliveryFee)}`, `মোট COD বিল: ${formatPrice(order.totalAmount)}`] : []),
    ];
    return lines.join('\n');
  };

  const handleMessageBuyer = async (order: Order) => {
    setMessagingOrderId(order.id);
    try {
      const res = await apiFetch<{ conversation: { id: string } }>(`/api/seller/orders/${order.id}/conversation`, {
        method: 'POST',
      });
      setSelectedOrder(null);
      if (onOpenInboxConversation) {
        onOpenInboxConversation(res.conversation.id);
      } else {
        onNavigate('inbox');
      }
    } catch (err: any) {
      showToast(err.message || 'চ্যাট শুরু করা যায়নি।', 'error');
    } finally {
      setMessagingOrderId(null);
    }
  };

  const inputClass =
    'w-full px-3.5 py-2.5 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]';

  const pendingOrdersCount = orderCountsByStatus.Pending || 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#C8FA50]">
            <span>Seller Studio</span>
            <span className="px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-400/30 text-[10px] text-purple-200">
              Seller Only
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white mt-0.5">
            সেলার ড্যাশবোর্ড · {user.shopName || user.fullName}
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            আপনার পণ্য, স্টক, ক্রেতার অর্ডারের সম্পূর্ণ ডিটেইলস এবং ইনবক্স পরিচালনা করুন
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {onOpenPublicProfile && (
            <button
              type="button"
              onClick={() => onOpenPublicProfile(user.username || user.id)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-200 hover:border-[#C8FA50]/45 hover:text-[#C8FA50] transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#C8FA50]" />
              আমার প্রোফাইল দেখুন
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              handleCopyText(
                `${window.location.origin}/seller/${encodeURIComponent(user.username || user.id)}`,
                'সেলার প্রোফাইল লিংক',
                'seller-own-profile-link'
              )
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#C8FA50]/10 border border-[#C8FA50]/35 text-xs font-bold text-[#C8FA50] hover:bg-[#C8FA50]/20 transition-colors"
          >
            {copiedId === 'seller-own-profile-link' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedId === 'seller-own-profile-link' ? 'লিংক কপি হয়েছে' : 'প্রোফাইল লিংক কপি'}
          </button>

          <button
            type="button"
            onClick={() => onNavigate('inbox')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-200 hover:border-[#C8FA50]/45 hover:text-[#C8FA50] transition-colors"
          >
            <Inbox className="w-4 h-4 text-[#C8FA50]" />
            Customer Inbox ({overview.unreadMessages})
          </button>

          <button
            type="button"
            onClick={() => onNavigate('seller-ads')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full glow-purple-btn text-xs font-semibold"
          >
            <Megaphone className="w-4 h-4 text-[#C8FA50]" />
            Product Ads
          </button>
        </div>
      </div>

      {/* Live Pending Order Alert Banner (Visible across tabs except when already viewing Orders) */}
      {pendingOrdersCount > 0 && tab !== 'orders' && (
        <div className="rounded-2xl border border-[#C8FA50]/40 bg-gradient-to-r from-[#C8FA50]/12 via-[#121728] to-purple-500/15 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[0_10px_30px_rgba(200,250,80,0.08)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#C8FA50]/20 border border-[#C8FA50]/45 flex items-center justify-center shrink-0">
              <BellRing className="w-5 h-5 text-[#C8FA50] animate-pulse" />
            </div>
            <div>
              <div className="text-sm font-bold text-white">
                আপনার কাছে <span className="text-[#C8FA50] tabular-nums">{pendingOrdersCount}টি</span> নতুন অপেক্ষমাণ অর্ডার এসেছে!
              </div>
              <div className="text-xs text-slate-300 mt-0.5">
                ক্রেতার নাম, মোবাইল, ব্যাকআপ নম্বর, জেলা-থানা ও ডেলিভারির সম্পূর্ণ ঠিকানা এখনই দেখুন।
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTab('orders')}
            className="px-4 py-2 rounded-full glow-lime-btn text-xs font-bold whitespace-nowrap shrink-0"
          >
            অর্ডারের ডিটেইলস দেখুন →
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        <button
          type="button"
          onClick={() => setTab('overview')}
          className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
            tab === 'overview'
              ? 'glow-lime-btn'
              : 'bg-white/5 border border-white/10 text-slate-300 hover:border-white/25'
          }`}
        >
          ওভারভিউ
        </button>
        <button
          type="button"
          onClick={() => setTab('orders')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
            tab === 'orders'
              ? 'glow-lime-btn'
              : 'bg-white/5 border border-white/10 text-slate-300 hover:border-white/25'
          }`}
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          <span>প্রাপ্ত অর্ডার ({orders.length})</span>
          {pendingOrdersCount > 0 && (
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold tabular-nums ${
                tab === 'orders' ? 'bg-slate-950 text-[#C8FA50]' : 'bg-[#C8FA50] text-slate-950'
              }`}
            >
              {pendingOrdersCount} নতুন
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab('products')}
          className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
            tab === 'products'
              ? 'glow-lime-btn'
              : 'bg-white/5 border border-white/10 text-slate-300 hover:border-white/25'
          }`}
        >
          আমার পণ্য ({products.length})
        </button>
        <button
          type="button"
          onClick={() => {
            resetForm();
            setTab('add');
          }}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
            tab === 'add'
              ? 'glow-lime-btn'
              : 'bg-white/5 border border-white/10 text-slate-300 hover:border-white/25'
          }`}
        >
          <Plus className="w-4 h-4" />
          {editingId ? 'পণ্য সম্পাদনা' : 'নতুন পণ্য যোগ করুন'}
        </button>
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="glass-card rounded-2xl p-5">
              <Package className="w-5 h-5 text-[#C8FA50] mb-2" />
              <div className="text-xs text-slate-400">মোট পণ্য</div>
              <div className="text-2xl font-bold text-white tabular-nums mt-1">{overview.totalProducts}</div>
            </div>
            <div className="glass-card rounded-2xl p-5">
              <Eye className="w-5 h-5 text-purple-400 mb-2" />
              <div className="text-xs text-slate-400">মোট পণ্যের ভিউ</div>
              <div className="text-2xl font-bold text-white tabular-nums mt-1">{overview.totalViews}</div>
            </div>
            <button
              type="button"
              onClick={() => setTab('orders')}
              className="glass-card rounded-2xl p-5 text-left hover:border-[#C8FA50]/45 transition-all"
            >
              <ShoppingBag className="w-5 h-5 text-amber-400 mb-2" />
              <div className="text-xs text-slate-400">মোট প্রাপ্ত অর্ডার</div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-white tabular-nums">{overview.totalOrders}</span>
                {pendingOrdersCount > 0 && (
                  <span className="text-[11px] font-bold text-[#C8FA50]">{pendingOrdersCount} অপেক্ষমাণ</span>
                )}
              </div>
            </button>
            <div className="glass-card rounded-2xl p-5">
              <TrendingUp className="w-5 h-5 text-emerald-400 mb-2" />
              <div className="text-xs text-slate-400">মোট বিক্রয়</div>
              <div className="text-2xl font-bold text-[#C8FA50] tabular-nums mt-1">
                {formatPrice(overview.totalRevenue)}
              </div>
            </div>
          </div>

          {/* Latest Received Orders Preview */}
          <div className="glass-card rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <Truck className="w-5 h-5 text-[#C8FA50]" />
                  সর্বশেষ ক্রেতার অর্ডারসমূহ
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  কোনো ক্রেতা পণ্য অর্ডার করলে সাথে সাথে এখানে সব তথ্য চলে আসে
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTab('orders')}
                className="px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-[#C8FA50] hover:border-[#C8FA50]/50 transition-colors"
              >
                সব অর্ডার দেখুন ({orders.length})
              </button>
            </div>

            {orders.length === 0 ? (
              <div className="rounded-2xl bg-[#080A11]/80 border border-white/10 p-8 text-center text-xs text-slate-400">
                এখনো কোনো ক্রেতা আপনার শপ থেকে অর্ডার করেনি। অর্ডার এলেই এখানে ক্রেতার সম্পূর্ণ বিবরণ দেখা যাবে।
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {orders.slice(0, 4).map((order) => {
                  const sellerVal =
                    order.sellerSubtotal ?? (order.items || []).reduce((s, i) => s + i.price * i.quantity, 0);
                  return (
                    <div
                      key={order.id}
                      className="rounded-2xl bg-[#090C15] border border-white/10 hover:border-purple-400/40 p-4 space-y-3 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono font-bold text-[#C8FA50]">#{order.orderNumber}</span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold ${
                            STATUS_BADGE_STYLES[order.status] || 'bg-white/5 border-white/15 text-slate-200'
                          }`}
                        >
                          {ORDER_STATUS_BN[order.status] || order.status}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <div className="text-sm font-bold text-white flex items-center gap-1.5">
                          <UserIcon className="w-3.5 h-3.5 text-purple-300" />
                          <span>{order.customerName}</span>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-slate-300 flex items-center gap-1.5 flex-wrap">
                            <Phone className="w-3.5 h-3.5 text-[#C8FA50]" />
                            <span className="tabular-nums font-semibold">{order.customerPhone}</span>
                            {order.backupPhone && (
                              <span className="text-slate-400 tabular-nums">· বিকল্প: {order.backupPhone}</span>
                            )}
                          </div>
                          {renderPhoneVerificationBadge(order, true)}
                        </div>
                        <div className="text-xs text-slate-400 flex items-start gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-purple-300 shrink-0 mt-0.5" />
                          <span className="line-clamp-1">
                            {[order.thana, order.district, order.deliveryAddress].filter(Boolean).join(', ')}
                          </span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-[11px] text-slate-400">
                            {order.items?.[0]?.productName}
                            {(order.items?.length || 0) > 1 ? ` +আরও ${order.items.length - 1}টি` : ''}
                          </div>
                          <div className="text-sm font-extrabold text-[#C8FA50] tabular-nums">
                            {formatPrice(sellerVal)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setTab('orders');
                            setSelectedOrder(order);
                          }}
                          className="px-3.5 py-1.5 rounded-full glow-purple-btn text-xs font-semibold"
                        >
                          সম্পূর্ণ ডিটেইলস
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'products' && (
        <div className="glass-card rounded-3xl overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-slate-400">লোড হচ্ছে...</div>
          ) : products.length === 0 ? (
            <div className="p-10 text-center space-y-4">
              <p className="text-sm text-slate-400">আপনি এখনো কোনো পণ্য আপলোড করেননি।</p>
              <button
                type="button"
                onClick={() => setTab('add')}
                className="px-5 py-2.5 rounded-full glow-lime-btn text-xs font-bold"
              >
                প্রথম পণ্য যোগ করুন
              </button>
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {products.map((p) => (
                <div key={p.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-16 h-14 rounded-xl overflow-hidden bg-slate-900 border border-white/10 shrink-0">
                      <SafeImage src={p.images?.[0]} alt={p.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenProduct(p)}
                        className="text-sm font-semibold text-white hover:text-[#C8FA50] truncate block text-left"
                      >
                        {p.name}
                      </button>
                      <div className="text-xs text-slate-400 tabular-nums mt-0.5 flex flex-wrap items-center gap-2">
                        <span className="text-[#C8FA50] font-semibold">{formatPrice(p.currentPrice)}</span> · স্টক:{' '}
                        {p.stock} · ভিউ: {p.views}
                        {p.promoCode && Number(p.promoDiscount || 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => handleCopyText(p.promoCode!, 'প্রোমো কোড', `prod-promo-${p.id}`)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-400/35 text-[11px] text-purple-200 hover:border-[#C8FA50]/50"
                            title="প্রোমো কোড কপি করুন"
                          >
                            <Ticket className="w-3 h-3 text-[#C8FA50]" />
                            <span className="font-mono font-bold text-[#C8FA50]">{p.promoCode}</span>
                            <span>(-{formatPrice(p.promoDiscount)})</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopyShareLink(p.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-medium text-slate-200 hover:border-[#C8FA50]/40"
                    >
                      <Copy className="w-3.5 h-3.5" /> লিংক
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEditProduct(p)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-medium text-slate-200 hover:border-purple-400/50"
                    >
                      <Edit3 className="w-3.5 h-3.5" /> এডিট
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteProduct(p.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> মুছুন
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'add' && (
        <div className="glass-card rounded-3xl p-6 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-white">
              {editingId ? 'পণ্য সম্পাদনা করুন' : 'নতুন পণ্য আপলোড করুন'}
            </h2>
            <button
              type="button"
              onClick={() => setPreviewMode((v) => !v)}
              className="px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-200 hover:border-[#C8FA50]/50"
            >
              {previewMode ? 'ফর্মে ফিরুন' : 'প্রিভিউ দেখুন'}
            </button>
          </div>

          {previewMode ? (
            <div className="bg-[#0A0D16] border border-white/10 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="aspect-[4/3] rounded-2xl overflow-hidden bg-slate-900 border border-white/10">
                <SafeImage src={images[0]} alt={name || 'Preview'} className="w-full h-full object-cover" />
              </div>
              <div className="space-y-3">
                <div className="text-xs text-purple-300">
                  {shopName || user.shopName} · {selectedCategoryObj?.nameBn} ({subcategory})
                </div>
                <h3 className="text-xl font-bold text-white">{name || 'পণ্যের নাম'}</h3>
                <div className="flex items-baseline gap-2.5">
                  <span className="text-2xl font-extrabold text-[#C8FA50] tabular-nums">
                    {formatPrice(Number(currentPrice) || 0)}
                  </span>
                  {previousPrice && (
                    <span className="text-sm text-slate-500 line-through tabular-nums">
                      {formatPrice(Number(previousPrice))}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-300 whitespace-pre-line">{description}</p>
                <div className="text-xs text-slate-400">স্টক: {stock}টি</div>
              </div>
            </div>
          ) : (
            <form onSubmit={handlePublishProduct} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">পণ্যের নাম (Product Name)</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="যেমন: প্রিমিয়াম কটন শার্ট"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">শপের নাম (Shop Name)</label>
                  <input
                    type="text"
                    required
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    className={inputClass}
                  />
                </div>

                <div ref={categoryBoxRef} className="relative">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">ক্যাটাগরি</label>
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryDropdownOpen((v) => !v);
                      setSubcatDropdownOpen(false);
                      setCategorySearch('');
                    }}
                    className={`${inputClass} flex items-center justify-between gap-2 text-left`}
                    aria-expanded={categoryDropdownOpen}
                  >
                    <span className="truncate">
                      {selectedCategoryObj
                        ? `${selectedCategoryObj.nameBn} (${selectedCategoryObj.nameEn})`
                        : categories.length === 0
                          ? 'ক্যাটাগরি লোড হয়নি'
                          : 'ক্যাটাগরি নির্বাচন করুন'}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                        categoryDropdownOpen ? 'rotate-180 text-[#C8FA50]' : ''
                      }`}
                    />
                  </button>

                  {categoryDropdownOpen && (
                    <div className="absolute left-0 right-0 mt-1.5 z-30 rounded-2xl bg-[#0B0E17] border border-purple-400/35 shadow-2xl overflow-hidden">
                      <div className="p-2 border-b border-white/10">
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={categorySearch}
                            onChange={(e) => setCategorySearch(e.target.value)}
                            placeholder="ক্যাটাগরি খুঁজুন..."
                            className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-[#06070B] border border-white/15 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
                          />
                        </div>
                      </div>
                      <div className="max-h-56 overflow-y-auto divide-y divide-white/5">
                        {categories.length === 0 ? (
                          <div className="p-4 text-center space-y-2">
                            <div className="text-xs text-slate-400">কোনো ক্যাটাগরি পাওয়া যায়নি।</div>
                            <button
                              type="button"
                              onClick={() => refreshStorefront()}
                              className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#C8FA50]/15 border border-[#C8FA50]/35 text-[11px] font-semibold text-[#C8FA50]"
                            >
                              <RefreshCw className="w-3 h-3" /> রিলোড করুন
                            </button>
                          </div>
                        ) : filteredCategories.length === 0 ? (
                          <div className="p-3 text-center text-xs text-slate-400">কোনো ক্যাটাগরি মেলেনি।</div>
                        ) : (
                          filteredCategories.map((c) => {
                            const isSelected = c.id === (selectedCategoryObj?.id || categoryId);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setCategoryId(c.id);
                                  setSubcategory(
                                    Array.isArray(c.subcategories) ? c.subcategories[0]?.nameEn || '' : ''
                                  );
                                  setCategoryDropdownOpen(false);
                                  setCategorySearch('');
                                  setSubcatSearch('');
                                }}
                                className={`w-full px-3.5 py-2.5 text-left text-xs flex items-center justify-between gap-2 transition-colors ${
                                  isSelected
                                    ? 'bg-[#C8FA50]/15 text-[#C8FA50] font-bold'
                                    : 'text-slate-200 hover:bg-white/5'
                                }`}
                              >
                                <span className="truncate">
                                  {c.nameBn} <span className="text-slate-400 font-normal">({c.nameEn})</span>
                                </span>
                                {isSelected && <Check className="w-3.5 h-3.5 text-[#C8FA50] shrink-0" />}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div ref={subcatBoxRef} className="relative">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">সাব-ক্যাটাগরি</label>
                  <button
                    type="button"
                    onClick={() => {
                      setSubcatDropdownOpen((v) => !v);
                      setCategoryDropdownOpen(false);
                      setSubcatSearch('');
                    }}
                    className={`${inputClass} flex items-center justify-between gap-2 text-left`}
                    aria-expanded={subcatDropdownOpen}
                  >
                    <span className="truncate">
                      {selectedSubcatObj
                        ? `${selectedSubcatObj.nameBn} (${selectedSubcatObj.nameEn})`
                        : subcategory || 'সাব-ক্যাটাগরি নির্বাচন করুন'}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                        subcatDropdownOpen ? 'rotate-180 text-[#C8FA50]' : ''
                      }`}
                    />
                  </button>

                  {subcatDropdownOpen && (
                    <div className="absolute left-0 right-0 mt-1.5 z-30 rounded-2xl bg-[#0B0E17] border border-purple-400/35 shadow-2xl overflow-hidden">
                      <div className="p-2 border-b border-white/10">
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={subcatSearch}
                            onChange={(e) => setSubcatSearch(e.target.value)}
                            placeholder="সাব-ক্যাটাগরি খুঁজুন..."
                            className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-[#06070B] border border-white/15 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
                          />
                        </div>
                      </div>
                      <div className="max-h-56 overflow-y-auto divide-y divide-white/5">
                        {filteredSubcategories.length === 0 ? (
                          <div className="p-3 text-center text-xs text-slate-400">
                            এই ক্যাটাগরিতে কোনো সাব-ক্যাটাগরি পাওয়া যায়নি।
                          </div>
                        ) : (
                          filteredSubcategories.map((s) => {
                            const isSelected = s.nameEn === subcategory;
                            return (
                              <button
                                key={s.nameEn}
                                type="button"
                                onClick={() => {
                                  setSubcategory(s.nameEn);
                                  setSubcatDropdownOpen(false);
                                  setSubcatSearch('');
                                }}
                                className={`w-full px-3.5 py-2.5 text-left text-xs flex items-center justify-between gap-2 transition-colors ${
                                  isSelected
                                    ? 'bg-[#C8FA50]/15 text-[#C8FA50] font-bold'
                                    : 'text-slate-200 hover:bg-white/5'
                                }`}
                              >
                                <span className="truncate">
                                  {s.nameBn} <span className="text-slate-400 font-normal">({s.nameEn})</span>
                                </span>
                                {isSelected && <Check className="w-3.5 h-3.5 text-[#C8FA50] shrink-0" />}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">বর্তমান বিক্রয় মূল্য (৳)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={currentPrice}
                    onChange={(e) => setCurrentPrice(e.target.value)}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">পূর্বের মূল্য (ঐচ্ছিক, ৳)</label>
                  <input
                    type="number"
                    min={0}
                    value={previousPrice}
                    onChange={(e) => setPreviousPrice(e.target.value)}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">স্টকের পরিমাণ</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">সাইজ ভ্যারিয়েন্ট (কমা দিয়ে)</label>
                  <input
                    type="text"
                    value={sizesInput}
                    onChange={(e) => setSizesInput(e.target.value)}
                    placeholder="M, L, XL"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">রঙ ভ্যারিয়েন্ট (কমা দিয়ে)</label>
                  <input
                    type="text"
                    value={colorsInput}
                    onChange={(e) => setColorsInput(e.target.value)}
                    placeholder="কালো, সাদা, সবুজ"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">পণ্যের বিস্তারিত বিবরণ</label>
                <textarea
                  required
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="পণ্যের গুণমান, উপাদান, সাইজ এবং ব্যবহারবিধি সম্পর্কে লিখুন..."
                  className={inputClass}
                />
              </div>

              {/* Per-Product Promo Code Mode Selector */}
              <div className="rounded-2xl bg-[#080B13] border border-purple-400/25 p-4 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#C8FA50]">
                      <Ticket className="w-4 h-4" />
                      <span>মূল্য ও প্রোমো কোড অপশন</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      সাভাবিক রাখুন অথবা এই পণ্যের জন্য আলাদা ৭ অক্ষরের প্রোমো কোড তৈরি করুন
                    </p>
                  </div>

                  <div className="inline-flex p-1 rounded-xl bg-[#0D101B] border border-white/10 self-start">
                    <button
                      type="button"
                      onClick={() => setPromoEnabled(false)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        !promoEnabled
                          ? 'bg-[#C8FA50] text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      সাভাবিক
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPromoEnabled(true);
                        if (!promoCode || !/^[A-Za-z0-9]{7}$/.test(promoCode)) {
                          setPromoCode(generateClientPromoCode7());
                          setPromoFontStyle(pickRandomPromoFont());
                        }
                      }}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        promoEnabled
                          ? 'bg-purple-600 text-white shadow-[0_0_16px_rgba(168,85,247,0.45)]'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      প্রোমো কোড তৈরি করুন
                    </button>
                  </div>
                </div>

                {promoEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/10 items-end">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        কতো টাকা ছাড় দিতে চান (৳)? <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="number"
                        required={promoEnabled}
                        min={1}
                        max={currentPrice && Number(currentPrice) > 1 ? Number(currentPrice) - 1 : undefined}
                        value={promoDiscount}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPromoDiscount(val);
                          if (Number(val) > 0) {
                            setPromoCode(generateClientPromoCode7());
                            setPromoFontStyle(pickRandomPromoFont());
                          }
                        }}
                        placeholder="যেমন: 24 বা 30"
                        className={inputClass}
                      />
                      {Number(promoDiscount) > 0 && Number(currentPrice) > Number(promoDiscount) && (
                        <p className="text-[11px] text-[#C8FA50] mt-1 font-medium tabular-nums">
                          প্রোমো ব্যবহার করলে মূল্য হবে: {formatPrice(Number(currentPrice) - Number(promoDiscount))}{' '}
                          (মূল মূল্য: {formatPrice(Number(currentPrice))})
                        </p>
                      )}
                      {Number(promoDiscount) > 0 &&
                        Number(currentPrice) > 0 &&
                        Number(promoDiscount) >= Number(currentPrice) && (
                          <p className="text-[11px] text-rose-400 mt-1 font-medium">
                            ছাড়ের পরিমাণ অবশ্যই বিক্রয় মূল্য ({formatPrice(Number(currentPrice))}) থেকে কম হতে হবে।
                          </p>
                        )}
                    </div>

                    <div className="rounded-xl bg-[#0C101C] border border-white/15 p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400 font-medium">
                          ৭ অক্ষরের প্রোমো কোড (ক্রেতাদের শেয়ার করুন)
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setPromoCode(generateClientPromoCode7());
                            setPromoFontStyle(pickRandomPromoFont());
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-300 hover:text-[#C8FA50]"
                        >
                          <RefreshCw className="w-3 h-3" /> নতুন কোড
                        </button>
                      </div>

                      {Number(promoDiscount) > 0 && promoCode ? (
                        <div className="flex items-center justify-between gap-2 bg-[#06070B] border border-[#C8FA50]/30 rounded-xl px-3.5 py-2.5">
                          <span
                            className={`text-lg sm:text-xl select-all ${
                              PROMO_FONT_STYLE_CLASSES[promoFontStyle] || PROMO_FONT_STYLE_CLASSES.mono
                            }`}
                          >
                            {promoCode}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyText(promoCode, '৭ অক্ষরের প্রোমো কোড', 'form-promo-copy')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg glow-lime-btn text-xs font-bold shrink-0"
                          >
                            {copiedId === 'form-promo-copy' ? (
                              <>
                                <Check className="w-3.5 h-3.5" /> কপি হয়েছে
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" /> কপি করুন
                              </>
                            )}
                          </button>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400 py-2">
                          পাশে ছাড়ের টাকার পরিমাণ লিখলেই অটোমেটিক নতুন ৭ অক্ষরের কোড তৈরি হবে।
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Multiple Images Upload + URL */}
              <div className="space-y-3">
                <label className="block text-xs font-medium text-slate-300">
                  পণ্যের ছবি (ফাইল আপলোড অথবা Image URL — একাধিক ছবি যোগ করা যাবে)
                </label>
                <div className="flex flex-wrap gap-2.5">
                  <label className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 cursor-pointer">
                    <Upload className="w-4 h-4 text-[#C8FA50]" />
                    ডিভাইস থেকে ছবি আপলোড
                    <input type="file" multiple accept="image/*" onChange={handleFileUpload} className="hidden" />
                  </label>

                  <div className="flex-1 min-w-[220px] flex gap-2">
                    <input
                      type="text"
                      value={imageUrlInput}
                      onChange={(e) => setImageUrlInput(e.target.value)}
                      placeholder="https://... ছবির লিংক দিন"
                      className="flex-1 px-3 py-2 text-xs bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
                    />
                    <button
                      type="button"
                      onClick={handleAddImageUrl}
                      className="px-4 py-2 rounded-xl glow-purple-btn text-xs font-semibold shrink-0"
                    >
                      লিংক যোগ করুন
                    </button>
                  </div>
                </div>

                {images.length > 0 && (
                  <div className="flex flex-wrap gap-3 pt-1">
                    {images.map((img, i) => (
                      <div key={i} className="relative w-24 h-20 rounded-xl overflow-hidden border border-white/15 bg-slate-900">
                        <SafeImage src={img} alt={`Upload ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded-md hover:bg-rose-600"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-2">
                  <GoogleDriveManager
                    mode="image-picker"
                    title="Google Drive থেকে ছবি আপলোড বা নির্বাচন করুন"
                    subtitle="সার্ভার স্টোরেজ বাঁচাতে পণ্যের ছবি সরাসরি আপনার Google Drive-এ সংরক্ষণ ও ব্যবহার করুন।"
                    onSelectImageUrl={(url) =>
                      setImages((prev) => (prev.includes(url) ? prev : [...prev, url]))
                    }
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingProduct}
                className="px-7 py-3 rounded-full glow-lime-btn text-sm font-bold"
              >
                {savingProduct ? 'প্রকাশ হচ্ছে...' : editingId ? 'আপডেট সংরক্ষণ করুন' : 'পণ্য প্রকাশ করুন'}
              </button>
            </form>
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-5">
          {/* Seller Orders Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="glass-card rounded-2xl p-4">
              <div className="text-[11px] text-slate-400">মোট প্রাপ্ত অর্ডার</div>
              <div className="text-xl font-extrabold text-white tabular-nums mt-0.5">{orders.length}টি</div>
            </div>
            <div className="glass-card rounded-2xl p-4 border border-amber-400/20">
              <div className="text-[11px] text-amber-300">অপেক্ষমাণ (Pending)</div>
              <div className="text-xl font-extrabold text-amber-300 tabular-nums mt-0.5">
                {orderCountsByStatus.Pending || 0}টি
              </div>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <div className="text-[11px] text-slate-400">ডেলিভারি সম্পন্ন</div>
              <div className="text-xl font-extrabold text-[#C8FA50] tabular-nums mt-0.5">
                {orderCountsByStatus.Delivered || 0}টি
              </div>
            </div>
            <div className="glass-card rounded-2xl p-4">
              <div className="text-[11px] text-slate-400">মোট বিক্রয় (বাতিল বাদে)</div>
              <div className="text-xl font-extrabold text-[#C8FA50] tabular-nums mt-0.5">
                {formatPrice(overview.totalRevenue)}
              </div>
            </div>
          </div>

          {/* Search & Status Filter Toolbar */}
          <div className="glass-card rounded-2xl p-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                placeholder="অর্ডার নম্বর (#ORV-...), ক্রেতার নাম, মোবাইল, জেলা বা থানা দিয়ে খুঁজুন..."
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
              {(
                [
                  { key: 'All', label: 'সব অর্ডার' },
                  { key: 'Pending', label: 'অপেক্ষমাণ' },
                  { key: 'Confirmed', label: 'নিশ্চিতকৃত' },
                  { key: 'Processing', label: 'প্রক্রিয়াধীন' },
                  { key: 'Shipped', label: 'পাঠানো হয়েছে' },
                  { key: 'Delivered', label: 'ডেলিভারড' },
                  { key: 'Cancelled', label: 'বাতিল' },
                ] as const
              ).map((f) => {
                const active = orderStatusFilter === f.key;
                const count = orderCountsByStatus[f.key] || 0;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setOrderStatusFilter(f.key)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                      active
                        ? 'bg-[#C8FA50] text-slate-950 font-bold'
                        : 'bg-white/5 border border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {f.label} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Orders List */}
          {loading ? (
            <div className="glass-card rounded-3xl p-10 text-center text-sm text-slate-400">অর্ডার তথ্য লোড হচ্ছে...</div>
          ) : filteredOrders.length === 0 ? (
            <div className="glass-card rounded-3xl p-10 text-center space-y-2">
              <ShoppingBag className="w-10 h-10 text-purple-400/50 mx-auto" />
              <div className="text-sm font-semibold text-white">কোনো অর্ডার পাওয়া যায়নি</div>
              <p className="text-xs text-slate-400">
                {orders.length === 0
                  ? 'ক্রেতারা আপনার পণ্য অর্ডার করলে তাদের সম্পূর্ণ নাম, মোবাইল, জেলা-থানা ও পণ্যের ডিটেইলস এখানে চলে আসবে।'
                  : 'অনুসন্ধান বা স্ট্যাটাস ফিল্টার পরিবর্তন করে আবার দেখুন।'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredOrders.map((order) => {
                const sellerVal =
                  order.sellerSubtotal ?? (order.items || []).reduce((sum, it) => sum + it.price * it.quantity, 0);
                const sellerQty =
                  order.sellerItemCount ?? (order.items || []).reduce((sum, it) => sum + it.quantity, 0);
                const slipKey = `slip-${order.id}`;

                return (
                  <div
                    key={order.id}
                    className="glass-card rounded-3xl p-5 sm:p-6 space-y-5 border border-white/10 hover:border-purple-400/35 transition-all"
                  >
                    {/* Top Order Header */}
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-white/10">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => handleCopyText(order.orderNumber, 'অর্ডার নম্বর', `num-${order.id}`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#090B11] border border-white/15 text-sm font-mono font-extrabold text-[#C8FA50] hover:border-[#C8FA50]/50"
                          title="অর্ডার নম্বর কপি করুন"
                        >
                          <span>#{order.orderNumber}</span>
                          {copiedId === `num-${order.id}` ? (
                            <Check className="w-3.5 h-3.5 text-[#C8FA50]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-slate-400" />
                          )}
                        </button>

                        <span
                          className={`px-3 py-1 rounded-full border text-xs font-bold ${
                            STATUS_BADGE_STYLES[order.status] || 'bg-white/5 border-white/15 text-slate-200'
                          }`}
                        >
                          {ORDER_STATUS_BN[order.status] || order.status}
                        </span>

                        <span className="px-2.5 py-1 rounded-full bg-purple-500/15 border border-purple-400/30 text-[11px] font-semibold text-purple-200">
                          {order.paymentMethod}
                        </span>

                        <span className="text-xs text-slate-400">{formatDateTime(order.createdAt)}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-400">স্ট্যাটাস পরিবর্তন:</span>
                        <select
                          value={order.status}
                          disabled={updatingOrderId === order.id}
                          onChange={(e) => handleUpdateOrderStatus(order.id, e.target.value)}
                          className="px-3 py-1.5 rounded-xl bg-[#080A11] border border-white/15 text-xs font-semibold text-white focus:outline-none focus:border-[#C8FA50] disabled:opacity-60"
                        >
                          {Object.entries(ORDER_STATUS_BN).map(([val, label]) => (
                            <option key={val} value={val} className="bg-[#0B0E17] text-white">
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* 2-Column Rich Detail Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                      {/* Left: Customer & Full Delivery Info */}
                      <div className="lg:col-span-5 rounded-2xl bg-[#080B13] border border-white/10 p-4 space-y-3">
                        <div className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-[#C8FA50]" />
                          ক্রেতা ও ডেলিভারির সম্পূর্ণ তথ্য
                        </div>

                        <div className="space-y-2.5 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-[11px] text-slate-500">ক্রেতার নাম</div>
                              <div className="text-sm font-bold text-white mt-0.5">{order.customerName}</div>
                              {order.buyerUsername && (
                                <div className="text-[11px] text-slate-400">অ্যাকাউন্ট: @{order.buyerUsername}</div>
                              )}
                            </div>
                          </div>

                          <div className="pt-2 border-t border-white/5 space-y-2">
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div className="text-[11px] text-slate-500">মূল মোবাইল নম্বর</div>
                                  <div className="text-sm font-bold text-[#C8FA50] tabular-nums">
                                    {order.customerPhone}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <a
                                    href={`tel:${order.customerPhone}`}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#C8FA50]/15 border border-[#C8FA50]/35 text-[11px] font-semibold text-[#C8FA50] hover:bg-[#C8FA50]/25"
                                  >
                                    <Phone className="w-3 h-3" /> কল
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleCopyText(order.customerPhone, 'মোবাইল নম্বর', `ph-${order.id}`)
                                    }
                                    className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white"
                                    title="নম্বর কপি করুন"
                                  >
                                    {copiedId === `ph-${order.id}` ? (
                                      <Check className="w-3.5 h-3.5 text-[#C8FA50]" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              </div>
                              {renderPhoneVerificationBadge(order)}
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="text-[11px] text-slate-500">বিকল্প / ব্যাকআপ নম্বর</div>
                                {order.backupPhone ? (
                                  <div className="text-xs font-semibold text-white tabular-nums">
                                    {order.backupPhone}
                                  </div>
                                ) : (
                                  <div className="text-xs text-slate-500">দেওয়া হয়নি</div>
                                )}
                              </div>
                              {order.backupPhone && (
                                <div className="flex items-center gap-1.5">
                                  <a
                                    href={`tel:${order.backupPhone}`}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/15 text-[11px] font-semibold text-slate-200 hover:border-[#C8FA50]/45"
                                  >
                                    <Phone className="w-3 h-3" /> কল
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleCopyText(order.backupPhone!, 'বিকল্প নম্বর', `bph-${order.id}`)
                                    }
                                    className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white"
                                    title="বিকল্প নম্বর কপি করুন"
                                  >
                                    {copiedId === `bph-${order.id}` ? (
                                      <Check className="w-3.5 h-3.5 text-[#C8FA50]" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="pt-2 border-t border-white/5 space-y-2">
                            <div className="flex flex-wrap gap-2">
                              <span className="px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-400/30 text-[11px] font-semibold text-purple-200">
                                জেলা: {order.district || 'উল্লেখ নেই'}
                              </span>
                              <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/15 text-[11px] font-semibold text-slate-200">
                                থানা/উপজেলা: {order.thana || 'উল্লেখ নেই'}
                              </span>
                            </div>

                            <div>
                              <div className="text-[11px] text-slate-500">বিস্তারিত ডেলিভারির ঠিকানা</div>
                              <div className="text-xs text-slate-200 mt-0.5 leading-relaxed bg-white/[0.03] border border-white/10 rounded-xl p-2.5">
                                {order.deliveryAddress}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right: Ordered Items & Financial Breakdown */}
                      <div className="lg:col-span-7 rounded-2xl bg-[#080B13] border border-white/10 p-4 flex flex-col justify-between space-y-4">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                              <Package className="w-3.5 h-3.5 text-[#C8FA50]" />
                              অর্ডারকৃত পণ্যসমূহ ({sellerQty}টি)
                            </div>
                            {order.isMultiVendorOrder && (
                              <span className="px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-400/30 text-[10px] text-purple-200">
                                মাল্টি-সেলার অর্ডার
                              </span>
                            )}
                          </div>

                          <div className="divide-y divide-white/10">
                            {order.items?.map((item) => (
                              <div key={item.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3">
                                <div className="w-14 h-12 rounded-xl overflow-hidden bg-slate-900 border border-white/10 shrink-0">
                                  <SafeImage
                                    src={item.productImage}
                                    alt={item.productName}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs sm:text-sm font-semibold text-white truncate">
                                    {item.productName}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                                    {item.variation && (
                                      <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-purple-200">
                                        ভ্যারিয়েন্ট: {item.variation}
                                      </span>
                                    )}
                                    <span className="tabular-nums">
                                      {formatPrice(item.price)} × {item.quantity}টি
                                    </span>
                                    {item.appliedPromoCode && Number(item.promoDiscount || 0) > 0 && (
                                      <span className="px-2 py-0.5 rounded-md bg-[#C8FA50]/15 border border-[#C8FA50]/30 text-[#C8FA50] font-mono">
                                        প্রোমো {item.appliedPromoCode} (-{formatPrice(item.promoDiscount)})
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="text-sm font-extrabold text-[#C8FA50] tabular-nums shrink-0">
                                  {formatPrice(item.price * item.quantity)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="pt-3 border-t border-white/10 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between text-slate-300">
                            <span>আপনার পণ্যের মোট মূল্য</span>
                            <span className="font-bold text-white tabular-nums">{formatPrice(sellerVal)}</span>
                          </div>
                          {!order.isMultiVendorOrder && (
                            <>
                              <div className="flex items-center justify-between text-slate-400">
                                <span>ডেলিভারি চার্জ</span>
                                <span className="tabular-nums">
                                  {order.deliveryFee === 0 ? 'ফ্রি' : formatPrice(order.deliveryFee)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-sm font-extrabold pt-1 border-t border-white/5">
                                <span className="text-white">মোট সংগ্রহযোগ্য (COD)</span>
                                <span className="text-[#C8FA50] tabular-nums">{formatPrice(order.totalAmount)}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(order)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full glow-lime-btn text-xs font-bold"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          সম্পূর্ণ রসিদ ও ডিটেইলস
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleCopyText(buildCourierSlip(order), 'কুরিয়ার ডিসপ্যাচ তথ্য', slipKey)
                          }
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-200 hover:border-[#C8FA50]/50 hover:text-[#C8FA50] transition-colors"
                        >
                          {copiedId === slipKey ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#C8FA50]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          কুরিয়ার তথ্য কপি
                        </button>
                      </div>

                      <button
                        type="button"
                        disabled={messagingOrderId === order.id}
                        onClick={() => handleMessageBuyer(order)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full glow-purple-btn text-xs font-semibold disabled:opacity-60"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-[#C8FA50]" />
                        {messagingOrderId === order.id ? 'খুলছে...' : 'ক্রেতাকে মেসেজ দিন'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Full Order Receipt & Dispatch Modal (Seller Only) */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl glass-panel rounded-3xl border border-white/15 shadow-2xl overflow-hidden my-auto">
            <div className="px-6 py-4 border-b border-white/10 bg-[#0A0D16] flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#C8FA50]">
                  Seller Order Receipt
                </div>
                <h3 className="text-lg font-extrabold text-white font-mono">#{selectedOrder.orderNumber}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-300"
                aria-label="বন্ধ করুন"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Status Stepper */}
              <div className="rounded-2xl bg-[#080A11] border border-white/10 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-300">অর্ডারের বর্তমান অবস্থা</span>
                  <span className="text-[11px] text-slate-400">{formatDateTime(selectedOrder.createdAt)}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(ORDER_STATUS_BN).map(([val, label]) => {
                    const active = selectedOrder.status === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        disabled={updatingOrderId === selectedOrder.id}
                        onClick={() => handleUpdateOrderStatus(selectedOrder.id, val)}
                        className={`px-3 py-2 rounded-xl border text-[11px] font-bold text-left transition-all ${
                          active
                            ? 'bg-[#C8FA50] border-[#C8FA50] text-slate-950'
                            : 'bg-white/5 border-white/10 text-slate-300 hover:border-purple-400/45'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Customer & Delivery Details */}
              <div className="rounded-2xl bg-[#080A11] border border-white/10 p-4 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-purple-300">
                  ক্রেতা ও ডেলিভারি বিবরণ
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-slate-500">ক্রেতার নাম</div>
                    <div className="text-sm font-bold text-white mt-0.5">{selectedOrder.customerName}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">পেমেন্ট পদ্ধতি</div>
                    <div className="text-sm font-bold text-[#C8FA50] mt-0.5">{selectedOrder.paymentMethod}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">মূল মোবাইল নম্বর ও অর্ডার ইতিহাস</div>
                    <div className="space-y-1.5 mt-0.5">
                      <a
                        href={`tel:${selectedOrder.customerPhone}`}
                        className="text-sm font-bold text-[#C8FA50] hover:underline tabular-nums inline-block"
                      >
                        {selectedOrder.customerPhone}
                      </a>
                      <div>{renderPhoneVerificationBadge(selectedOrder)}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">বিকল্প / দ্বিতীয় নম্বর</div>
                    <div className="text-sm font-semibold text-white tabular-nums mt-0.5">
                      {selectedOrder.backupPhone || 'দেওয়া হয়নি'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">জেলা</div>
                    <div className="text-sm font-semibold text-white mt-0.5">{selectedOrder.district || '-'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">থানা / উপজেলা</div>
                    <div className="text-sm font-semibold text-white mt-0.5">{selectedOrder.thana || '-'}</div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-slate-500">পূর্ণ ডেলিভারির ঠিকানা</div>
                    <div className="text-xs text-slate-200 mt-1 p-2.5 rounded-xl bg-white/[0.03] border border-white/10 leading-relaxed">
                      {selectedOrder.deliveryAddress}
                    </div>
                  </div>
                </div>
              </div>

              {/* Ordered Products */}
              <div className="rounded-2xl bg-[#080A11] border border-white/10 p-4 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-purple-300">অর্ডারকৃত পণ্যসমূহ</div>
                <div className="divide-y divide-white/10">
                  {selectedOrder.items?.map((item) => (
                    <div key={item.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-900 border border-white/10 shrink-0">
                        <SafeImage src={item.productImage} alt={item.productName} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-white">{item.productName}</div>
                        <div className="text-[11px] text-slate-400">
                          {item.variation ? `${item.variation} · ` : ''}
                          {formatPrice(item.price)} × {item.quantity}
                        </div>
                      </div>
                      <div className="text-sm font-bold text-[#C8FA50] tabular-nums">
                        {formatPrice(item.price * item.quantity)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="pt-3 border-t border-white/10 space-y-1 text-xs">
                  <div className="flex justify-between text-slate-300">
                    <span>সেলার পণ্যের মূল্য</span>
                    <span className="font-bold text-white tabular-nums">
                      {formatPrice(
                        selectedOrder.sellerSubtotal ??
                          (selectedOrder.items || []).reduce((s, i) => s + i.price * i.quantity, 0)
                      )}
                    </span>
                  </div>
                  {!selectedOrder.isMultiVendorOrder && (
                    <>
                      <div className="flex justify-between text-slate-400">
                        <span>ডেলিভারি চার্জ</span>
                        <span className="tabular-nums">
                          {selectedOrder.deliveryFee === 0 ? 'ফ্রি' : formatPrice(selectedOrder.deliveryFee)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm font-extrabold pt-1 border-t border-white/5">
                        <span className="text-white">সর্বমোট COD বিল</span>
                        <span className="text-[#C8FA50] tabular-nums">{formatPrice(selectedOrder.totalAmount)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-white/10 bg-[#0A0D16] flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    handleCopyText(
                      buildCourierSlip(selectedOrder),
                      'কুরিয়ার ডিসপ্যাচ তথ্য',
                      `modal-slip-${selectedOrder.id}`
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full glow-lime-btn text-xs font-bold"
                >
                  <Copy className="w-3.5 h-3.5" />
                  কুরিয়ার তথ্য কপি
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-200 hover:border-white/30"
                >
                  <Printer className="w-3.5 h-3.5" />
                  প্রিন্ট / PDF
                </button>
              </div>
              <button
                type="button"
                disabled={messagingOrderId === selectedOrder.id}
                onClick={() => handleMessageBuyer(selectedOrder)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full glow-purple-btn text-xs font-semibold"
              >
                <MessageSquare className="w-3.5 h-3.5 text-[#C8FA50]" />
                ক্রেতাকে মেসেজ দিন
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
