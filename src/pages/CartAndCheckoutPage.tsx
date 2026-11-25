import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  MapPin,
  Minus,
  Phone,
  Plus,
  Search,
  ShoppingBag,
  Ticket,
  Trash2,
  Truck,
  X,
  MessageSquare,
} from 'lucide-react';
import { SafeImage } from '../components/SafeImage';
import { useAuth } from '../context/AuthContext';
import { BD_DISTRICTS, type BdDistrict } from '../data/bdLocations';
import { formatPrice } from '../utils/format';

interface CartAndCheckoutPageProps {
  onBrowseProducts: () => void;
  onOrderComplete: () => void;
}

function isLikelyPhoneNumber(value?: string | null): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('@')) return false;
  return /^[0-9+\-\s]{10,16}$/.test(trimmed);
}

export function CartAndCheckoutPage({ onBrowseProducts, onOrderComplete }: CartAndCheckoutPageProps) {
  const {
    user,
    cart,
    storefront,
    updateCartQty,
    removeCartItem,
    applyCartPromo,
    apiFetch,
    refreshUserData,
    showToast,
    openAuthModal,
  } = useAuth();

  const paymentCfg = storefront?.settings?.paymentOptions || {
    cashOnDelivery: true,
    bkashEnabled: false,
    nagadEnabled: false,
    deliveryFee: 70,
    dhakaDeliveryFee: 70,
    outsideDhakaDeliveryFee: 120,
    freeDeliveryThreshold: 0,
  };

  const [customerName, setCustomerName] = useState(user?.fullName || '');
  const [customerPhone, setCustomerPhone] = useState(
    isLikelyPhoneNumber(user?.emailOrPhone) ? user!.emailOrPhone : ''
  );
  const [backupPhone, setBackupPhone] = useState('');

  const [selectedDistrictId, setSelectedDistrictId] = useState<string>('');
  const [districtOpen, setDistrictOpen] = useState(false);
  const [districtSearch, setDistrictSearch] = useState('');

  const [selectedThana, setSelectedThana] = useState<string>('');
  const [thanaOpen, setThanaOpen] = useState(false);
  const [thanaSearch, setThanaSearch] = useState('');

  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [showConfirmPolicyModal, setShowConfirmPolicyModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [openPromoItemId, setOpenPromoItemId] = useState<string | null>(null);
  const [promoInputs, setPromoInputs] = useState<Record<string, string>>({});
  const [verifyingPromoItemId, setVerifyingPromoItemId] = useState<string | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<{
    orderNumber: string;
    totalAmount: number;
    deliveryFee?: number;
    smsNotification?: {
      sent: boolean;
      senderName: string;
      phone: string;
      messageBody: string;
      provider: string;
      status: string;
    } | null;
  } | null>(null);

  const districtBoxRef = useRef<HTMLDivElement | null>(null);
  const thanaBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (user) {
      setCustomerName((prev) => prev || user.fullName);
      if (isLikelyPhoneNumber(user.emailOrPhone)) {
        setCustomerPhone((prev) => prev || user.emailOrPhone);
      }
    }
  }, [user]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (districtBoxRef.current && !districtBoxRef.current.contains(e.target as Node)) {
        setDistrictOpen(false);
      }
      if (thanaBoxRef.current && !thanaBoxRef.current.contains(e.target as Node)) {
        setThanaOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const selectedDistrict: BdDistrict | null = useMemo(
    () => BD_DISTRICTS.find((d) => d.id === selectedDistrictId) || null,
    [selectedDistrictId]
  );

  const filteredDistricts = useMemo(() => {
    const q = districtSearch.trim().toLowerCase();
    if (!q) return BD_DISTRICTS;
    return BD_DISTRICTS.filter(
      (d) =>
        d.nameBn.includes(q) ||
        d.nameEn.toLowerCase().includes(q) ||
        d.divisionBn.includes(q)
    );
  }, [districtSearch]);

  const filteredThanas = useMemo(() => {
    if (!selectedDistrict) return [];
    const q = thanaSearch.trim().toLowerCase();
    if (!q) return selectedDistrict.thanas;
    return selectedDistrict.thanas.filter(
      (t) => t.nameBn.includes(q) || t.nameEn.toLowerCase().includes(q)
    );
  }, [selectedDistrict, thanaSearch]);

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
        <ShoppingBag className="w-12 h-12 mx-auto text-slate-600" />
        <h2 className="text-xl font-bold text-white">কার্ট দেখতে সাইন ইন করুন</h2>
        <p className="text-sm text-slate-400">আপনার নির্বাচিত পণ্য ও অর্ডার দেখতে অনুগ্রহ করে অ্যাকাউন্টে প্রবেশ করুন।</p>
        <button
          type="button"
          onClick={() => openAuthModal('কার্ট ব্যবহার করতে অনুগ্রহ করে সাইন ইন করুন।')}
          className="px-6 py-2.5 rounded-full glow-lime-btn text-sm font-bold"
        >
          সাইন ইন / সাইন আপ
        </button>
      </div>
    );
  }

  if (confirmedOrder) {
    return (
      <div className="max-w-lg mx-auto px-4 py-14">
        <div className="glass-card rounded-2xl p-7 sm:p-8 text-center space-y-4">
          <CheckCircle2 className="w-14 h-14 text-[#C8FA50] mx-auto" />
          <h2 className="text-2xl font-bold text-white">আপনার অর্ডারটি নিশ্চিত হয়েছে!</h2>
          <p className="text-sm text-slate-300">
            অর্ডার নম্বর: <span className="font-mono font-bold text-white">{confirmedOrder.orderNumber}</span>
          </p>
          <p className="text-sm text-slate-300">
            মোট পরিশোধযোগ্য মূল্য (ক্যাশ অন ডেলিভারি):{' '}
            <span className="font-bold text-[#D9FF5B] tabular-nums">{formatPrice(confirmedOrder.totalAmount)}</span>
          </p>

          {confirmedOrder.smsNotification && (
            <div className="text-left rounded-2xl bg-[#080A11] border border-[#C8FA50]/35 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#C8FA50]">
                  <MessageSquare className="w-4 h-4" />
                  <span>{confirmedOrder.smsNotification.senderName} থেকে SMS পাঠানো হয়েছে</span>
                </div>
                <span className="text-[11px] font-mono text-slate-400">{confirmedOrder.smsNotification.phone}</span>
              </div>
              <p className="text-xs text-slate-200 leading-relaxed">
                {confirmedOrder.smsNotification.messageBody}
              </p>
            </div>
          )}

          <div className="pt-3 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={onOrderComplete}
              className="px-5 py-2.5 rounded-full glow-lime-btn text-sm font-bold"
            >
              অর্ডার স্ট্যাটাস দেখুন
            </button>
            <button
              type="button"
              onClick={onBrowseProducts}
              className="px-5 py-2.5 rounded-full glow-purple-btn text-sm font-semibold"
            >
              আরও কেনাকাটা করুন
            </button>
          </div>
        </div>
      </div>
    );
  }

  const dhakaFee = Number(paymentCfg.dhakaDeliveryFee ?? 70);
  const outsideDhakaFee = Number(paymentCfg.outsideDhakaDeliveryFee ?? 120);

  const subtotal = cart.reduce((sum, item) => sum + (item.effectivePrice ?? item.currentPrice) * item.quantity, 0);
  const deliveryFee =
    cart.length === 0 || !selectedDistrict
      ? null
      : selectedDistrict.id === 'dhaka'
        ? dhakaFee
        : outsideDhakaFee;
  const total = subtotal + (deliveryFee ?? 0);

  const invalidCartItems = cart.filter(
    (item) => item.isHidden || Number(item.stock || 0) <= 0 || item.quantity > Number(item.stock || 0)
  );

  const validateCheckoutForm = (): boolean => {
    if (cart.length === 0) return false;
    if (invalidCartItems.length > 0) {
      showToast('আপনার কার্টে স্টক শেষ বা অতিরিক্ত পরিমাণ পণ্য রয়েছে। অনুগ্রহ করে ঠিক করুন।', 'error');
      return false;
    }
    if (!customerName.trim() || customerName.trim().length < 2) {
      showToast('অনুগ্রহ করে আপনার পূর্ণ নাম লিখুন।', 'error');
      return false;
    }
    const cleanPhone = customerPhone.trim();
    if (!cleanPhone || cleanPhone.includes('@') || !/^[0-9+\-\s]{10,16}$/.test(cleanPhone)) {
      showToast('অনুগ্রহ করে সঠিক মোবাইল নম্বর দিন (যেমন: 017XXXXXXXX)।', 'error');
      return false;
    }
    const cleanBackup = backupPhone.trim();
    if (cleanBackup && (cleanBackup.includes('@') || !/^[0-9+\-\s]{10,16}$/.test(cleanBackup))) {
      showToast('অনুগ্রহ করে সঠিক বিকল্প / দ্বিতীয় ফোন নম্বর দিন।', 'error');
      return false;
    }
    if (!selectedDistrict) {
      showToast('অনুগ্রহ করে আপনার জেলা নির্বাচন করুন।', 'error');
      setDistrictOpen(true);
      return false;
    }
    if (!selectedThana) {
      showToast('অনুগ্রহ করে আপনার থানা / উপজেলা নির্বাচন করুন।', 'error');
      setThanaOpen(true);
      return false;
    }
    if (!deliveryAddress.trim() || deliveryAddress.trim().length < 4) {
      showToast('অনুগ্রহ করে ডেলিভারির ঠিকানা লিখুন।', 'error');
      return false;
    }
    return true;
  };

  const handleOpenPolicyModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateCheckoutForm()) return;
    setShowConfirmPolicyModal(true);
  };

  const executePlaceOrder = async () => {
    if (!validateCheckoutForm() || !selectedDistrict) return;
    const cleanPhone = customerPhone.trim();
    const cleanBackup = backupPhone.trim();

    setSubmitting(true);
    try {
      const res = await apiFetch<{
        orderNumber: string;
        totalAmount: number;
        deliveryFee: number;
        smsNotification?: {
          sent: boolean;
          senderName: string;
          phone: string;
          messageBody: string;
          provider: string;
          status: string;
        } | null;
      }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerPhone: cleanPhone,
          backupPhone: cleanBackup || null,
          district: selectedDistrict.nameBn,
          thana: selectedThana,
          deliveryAddress: deliveryAddress.trim(),
          paymentMethod: 'Cash on Delivery',
          fromCart: true,
        }),
      });
      setShowConfirmPolicyModal(false);
      await refreshUserData();
      setConfirmedOrder({
        orderNumber: res.orderNumber,
        totalAmount: res.totalAmount,
        deliveryFee: res.deliveryFee,
        smsNotification: res.smsNotification || null,
      });
      showToast('অর্ডার সফলভাবে প্লেস হয়েছে!', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <h1 className="text-2xl font-bold hero-gradient-text">শপিং কার্ট ও চেকআউট</h1>

      {cart.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center space-y-4">
          <ShoppingBag className="w-12 h-12 text-slate-600 mx-auto" />
          <h2 className="text-lg font-semibold text-white">আপনার কার্টটি বর্তমানে খালি</h2>
          <p className="text-sm text-slate-400">পছন্দের পণ্য কার্টে যোগ করে অর্ডার সম্পন্ন করুন।</p>
          <button
            type="button"
            onClick={onBrowseProducts}
            className="px-6 py-2.5 rounded-full glow-lime-btn text-sm font-bold"
          >
            পণ্য ব্রাউজ করুন
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 space-y-3">
            {cart.map((item) => {
              const outOfStock = item.isHidden || Number(item.stock || 0) <= 0;
              const exceedsStock = !outOfStock && item.quantity > Number(item.stock || 0);
              const unitPrice = item.effectivePrice ?? item.currentPrice;
              const hasDiscountApplied = Boolean(item.appliedPromoCode && (item.promoDiscount || 0) > 0);
              const isPromoBoxOpen = openPromoItemId === item.id;
              return (
                <div
                  key={item.id}
                  className={`glass-card rounded-2xl p-4 space-y-3 ${
                    outOfStock || exceedsStock ? 'border-rose-500/40' : ''
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-xl overflow-hidden bg-[#0B0D14] shrink-0">
                      <SafeImage src={item.images?.[0]} alt={item.name} className="w-full h-full object-cover" />
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <h3 className="text-sm font-semibold text-white truncate">{item.name}</h3>
                      <div className="text-xs text-slate-400">
                        শপ: {item.shopName}
                        {item.selectedVariation ? ` · ${item.selectedVariation}` : ''}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-[#D9FF5B] tabular-nums">
                          {formatPrice(unitPrice)} × {item.quantity} = {formatPrice(unitPrice * item.quantity)}
                        </span>
                        {hasDiscountApplied && (
                          <span className="text-xs text-slate-500 line-through tabular-nums">
                            {formatPrice(item.currentPrice * item.quantity)}
                          </span>
                        )}
                      </div>

                      {hasDiscountApplied ? (
                        <div className="inline-flex items-center gap-2 text-[11px] px-2.5 py-0.5 rounded-full bg-[#C8FA50]/15 border border-[#C8FA50]/35 text-[#C8FA50] font-semibold">
                          <span>
                            প্রোমো কোড ({item.appliedPromoCode}): -{formatPrice(item.promoDiscount)}/টি
                          </span>
                          <button
                            type="button"
                            onClick={() => applyCartPromo(item.id, '', true)}
                            className="text-rose-300 hover:underline"
                          >
                            সরান
                          </button>
                        </div>
                      ) : (
                        item.hasPromoCode && (
                          <button
                            type="button"
                            onClick={() => setOpenPromoItemId(isPromoBoxOpen ? null : item.id)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#C084FC] hover:text-[#C8FA50]"
                          >
                            <Ticket className="w-3.5 h-3.5" />
                            প্রোমো কোড ব্যবহার করুন
                          </button>
                        )
                      )}

                      {outOfStock && (
                        <div className="text-[11px] font-semibold text-rose-400">
                          এই পণ্যটি বর্তমানে স্টকে নেই — কার্ট থেকে সরান
                        </div>
                      )}
                      {exceedsStock && (
                        <div className="text-[11px] font-semibold text-amber-300">
                          স্টকে মাত্র {item.stock}টি বাকি আছে — পরিমাণ কমান
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="inline-flex items-center border border-white/15 rounded-full bg-[#080A11]">
                        <button
                          type="button"
                          onClick={() => updateCartQty(item.id, Math.max(1, item.quantity - 1))}
                          disabled={item.quantity <= 1}
                          className="p-1.5 text-slate-300 hover:text-white disabled:opacity-40"
                          aria-label="কমান"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-8 text-center text-xs font-semibold text-white tabular-nums">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (outOfStock) {
                              showToast('এই পণ্যটির স্টক বর্তমানে শেষ হয়েছে।', 'error');
                              return;
                            }
                            if (item.quantity >= item.stock) {
                              showToast(`সর্বোচ্চ ${item.stock}টি স্টকে রয়েছে।`, 'info');
                              return;
                            }
                            updateCartQty(item.id, Math.min(Math.max(1, item.stock), item.quantity + 1));
                          }}
                          disabled={outOfStock || item.quantity >= item.stock}
                          className="p-1.5 text-slate-300 hover:text-white disabled:opacity-40"
                          aria-label="বাড়ান"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeCartItem(item.id)}
                        className="inline-flex items-center gap-1 text-xs text-rose-400 hover:underline"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> সরান
                      </button>
                    </div>
                  </div>

                  {item.hasPromoCode && !hasDiscountApplied && isPromoBoxOpen && (
                    <div className="flex gap-2 pt-2 border-t border-white/10">
                      <input
                        type="text"
                        maxLength={12}
                        value={promoInputs[item.id] || ''}
                        onChange={(e) => setPromoInputs((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder="এই পণ্যের ৭ অক্ষরের প্রোমো কোড দিন"
                        className="flex-1 px-3 py-1.5 text-xs font-mono bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
                      />
                      <button
                        type="button"
                        disabled={verifyingPromoItemId === item.id}
                        onClick={async () => {
                          const code = (promoInputs[item.id] || '').trim();
                          if (!code) {
                            showToast('প্রোমো কোড লিখুন।', 'error');
                            return;
                          }
                          setVerifyingPromoItemId(item.id);
                          const ok = await applyCartPromo(item.id, code);
                          setVerifyingPromoItemId(null);
                          if (ok) setOpenPromoItemId(null);
                        }}
                        className="px-3.5 py-1.5 rounded-xl glow-lime-btn text-xs font-bold whitespace-nowrap disabled:opacity-55"
                      >
                        {verifyingPromoItemId === item.id ? 'যাচাই...' : 'যাচাই করুন'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <form
            onSubmit={handleOpenPolicyModal}
            className="lg:col-span-5 glass-card rounded-2xl p-5 sm:p-6 space-y-4"
          >
            <h2 className="text-lg font-bold text-white">ডেলিভারি তথ্য</h2>

            <div className="space-y-3.5">
              {/* 1. Customer Name */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  আপনার নাম <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="আপনার পূর্ণ নাম লিখুন"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
                />
              </div>

              {/* 2. Primary Mobile Number & Backup Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    মোবাইল নম্বর <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      inputMode="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="01XXXXXXXXX"
                      className="w-full pl-8 pr-3 py-2.5 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    দ্বিতীয় / ব্যাকআপ নম্বর
                  </label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      inputMode="tel"
                      value={backupPhone}
                      onChange={(e) => setBackupPhone(e.target.value)}
                      placeholder="01XXXXXXXXX (ঐচ্ছিক)"
                      className="w-full pl-8 pr-3 py-2.5 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
                    />
                  </div>
                </div>
              </div>

              {/* 3. Searchable District (All 64 Districts of Bangladesh) */}
              <div ref={districtBoxRef} className="relative">
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  জেলা (বাংলাদেশের ৬৪ জেলা) <span className="text-rose-400">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setDistrictOpen((v) => !v);
                    setThanaOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 text-sm bg-[#080A11] border border-white/15 rounded-xl text-left hover:border-[#C8FA50]/60 transition-colors"
                >
                  <span className={selectedDistrict ? 'text-white font-medium' : 'text-slate-500'}>
                    {selectedDistrict
                      ? `${selectedDistrict.nameBn} (${selectedDistrict.nameEn})`
                      : 'জেলা নির্বাচন করুন...'}
                  </span>
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                </button>

                {districtOpen && (
                  <div className="absolute left-0 right-0 mt-1.5 z-30 rounded-2xl bg-[#0D101B] border border-white/15 shadow-2xl overflow-hidden">
                    {/* Search Bar on top of Districts */}
                    <div className="p-2.5 border-b border-white/10 bg-[#080A11]">
                      <div className="relative">
                        <Search className="w-4 h-4 text-[#C8FA50] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          autoFocus
                          value={districtSearch}
                          onChange={(e) => setDistrictSearch(e.target.value)}
                          placeholder="জেলা খুঁজুন... (যেমন: রংপুর, ঢাকা, Rangpur)"
                          className="w-full pl-9 pr-3 py-2 text-xs bg-[#131726] border border-white/15 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-[#C8FA50]"
                        />
                      </div>
                    </div>

                    <div className="max-h-56 overflow-y-auto divide-y divide-white/5">
                      {filteredDistricts.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-400">কোনো জেলা পাওয়া যায়নি।</div>
                      ) : (
                        filteredDistricts.map((dist) => {
                          const isSelected = dist.id === selectedDistrictId;
                          return (
                            <button
                              key={dist.id}
                              type="button"
                              onClick={() => {
                                setSelectedDistrictId(dist.id);
                                setSelectedThana('');
                                setThanaSearch('');
                                setDistrictOpen(false);
                                setDistrictSearch('');
                                setThanaOpen(true);
                              }}
                              className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between text-xs transition-colors ${
                                isSelected
                                  ? 'bg-[#C8FA50]/15 text-[#C8FA50] font-bold'
                                  : 'text-slate-200 hover:bg-white/5'
                              }`}
                            >
                              <span>
                                {dist.nameBn}{' '}
                                <span className="text-slate-400 font-normal">({dist.nameEn})</span>
                              </span>
                              <span className="text-[10px] text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded-full">
                                {dist.divisionBn}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {selectedDistrict ? (
                  <div
                    className={`mt-2 px-3 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center justify-between ${
                      selectedDistrict.id === 'dhaka'
                        ? 'bg-[#C8FA50]/10 border-[#C8FA50]/35 text-[#C8FA50]'
                        : 'bg-purple-500/10 border-purple-400/35 text-purple-200'
                    }`}
                  >
                    <span>
                      {selectedDistrict.id === 'dhaka'
                        ? 'ঢাকা জেলা (ভেতরে)'
                        : `${selectedDistrict.nameBn} জেলা (ঢাকার বাইরে)`}
                    </span>
                    <span className="font-bold tabular-nums">
                      ডেলিভারি চার্জ: {formatPrice(selectedDistrict.id === 'dhaka' ? dhakaFee : outsideDhakaFee)}
                    </span>
                  </div>
                ) : (
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    ডেলিভারি চার্জ: ঢাকা জেলায় <span className="text-[#C8FA50] font-semibold">{formatPrice(dhakaFee)}</span> · ঢাকার বাইরে ৬৩ জেলায়{' '}
                    <span className="text-purple-300 font-semibold">{formatPrice(outsideDhakaFee)}</span>
                  </p>
                )}
              </div>

              {/* 4. Dynamic Thana / Upazila Selector */}
              <div ref={thanaBoxRef} className="relative">
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  থানা / উপজেলা <span className="text-rose-400">*</span>
                </label>
                <button
                  type="button"
                  disabled={!selectedDistrict}
                  onClick={() => {
                    if (!selectedDistrict) {
                      setDistrictOpen(true);
                      return;
                    }
                    setThanaOpen((v) => !v);
                    setDistrictOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 text-sm bg-[#080A11] border border-white/15 rounded-xl text-left disabled:opacity-55 hover:border-[#C8FA50]/60 transition-colors"
                >
                  <span className={selectedThana ? 'text-white font-medium' : 'text-slate-500'}>
                    {selectedThana
                      ? selectedThana
                      : selectedDistrict
                        ? `${selectedDistrict.nameBn}-এর থানা নির্বাচন করুন...`
                        : 'প্রথমে জেলা নির্বাচন করুন'}
                  </span>
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                </button>

                {thanaOpen && selectedDistrict && (
                  <div className="absolute left-0 right-0 mt-1.5 z-30 rounded-2xl bg-[#0D101B] border border-white/15 shadow-2xl overflow-hidden">
                    <div className="p-2.5 border-b border-white/10 bg-[#080A11]">
                      <div className="relative">
                        <Search className="w-4 h-4 text-[#C8FA50] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          autoFocus
                          value={thanaSearch}
                          onChange={(e) => setThanaSearch(e.target.value)}
                          placeholder={`${selectedDistrict.nameBn}-এর থানা খুঁজুন... (যেমন: কাউনিয়া)`}
                          className="w-full pl-9 pr-3 py-2 text-xs bg-[#131726] border border-white/15 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-[#C8FA50]"
                        />
                      </div>
                    </div>

                    <div className="max-h-56 overflow-y-auto divide-y divide-white/5">
                      {filteredThanas.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-400">কোনো থানা পাওয়া যায়নি।</div>
                      ) : (
                        filteredThanas.map((th) => {
                          const isSelected = selectedThana === th.nameBn;
                          return (
                            <button
                              key={`${selectedDistrict.id}-${th.nameEn}`}
                              type="button"
                              onClick={() => {
                                setSelectedThana(th.nameBn);
                                setThanaOpen(false);
                                setThanaSearch('');
                              }}
                              className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between text-xs transition-colors ${
                                isSelected
                                  ? 'bg-[#C8FA50]/15 text-[#C8FA50] font-bold'
                                  : 'text-slate-200 hover:bg-white/5'
                              }`}
                            >
                              <span>
                                {th.nameBn}{' '}
                                <span className="text-slate-400 font-normal">({th.nameEn})</span>
                              </span>
                              {isSelected && <Check className="w-3.5 h-3.5 text-[#C8FA50]" />}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 5. Delivery Address */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  ডেলিভারির ঠিকানা <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <MapPin className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
                  <textarea
                    required
                    rows={2}
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    placeholder="ডেলিভারির ঠিকানা লিখুন (বাসা/হোল্ডিং নম্বর, রোড, গ্রাম/মহল্লা, বাজার)..."
                    className="w-full pl-8 pr-3.5 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
                  />
                </div>
              </div>

              {/* 6. Payment Method — Cash on Delivery ONLY */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">পেমেন্ট মাধ্যম</label>
                <div className="flex items-center gap-3 p-3 border border-[#C8FA50]/45 bg-[#C8FA50]/10 rounded-xl">
                  <div className="w-8 h-8 rounded-full bg-[#C8FA50]/20 text-[#C8FA50] flex items-center justify-center shrink-0">
                    <Truck className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white">ক্যাশ অন ডেলিভারি (Cash on Delivery)</div>
                    <div className="text-[11px] text-slate-300">পণ্য হাতে পেয়ে সম্পূর্ণ মূল্য পরিশোধ করুন</div>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-[#C8FA50] shrink-0" />
                </div>
              </div>
            </div>

            <div className="border-t border-white/10 pt-4 space-y-2 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>পণ্যের মূল্য (Subtotal)</span>
                <span className="tabular-nums font-medium text-slate-200">{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-400 gap-2">
                <span>
                  ডেলিভারি চার্জ
                  {selectedDistrict
                    ? selectedDistrict.id === 'dhaka'
                      ? ' (ঢাকা)'
                      : ` (${selectedDistrict.nameBn})`
                    : ''}
                </span>
                <span className="tabular-nums font-medium text-slate-200 text-right">
                  {deliveryFee === null ? (
                    <span className="text-xs text-amber-300">জেলা সিলেক্ট করুন ({formatPrice(dhakaFee)} / {formatPrice(outsideDhakaFee)})</span>
                  ) : (
                    formatPrice(deliveryFee)
                  )}
                </span>
              </div>
              <div className="flex justify-between text-base font-bold text-white pt-2 border-t border-white/10">
                <span>সর্বমোট (Total)</span>
                <span className="tabular-nums text-[#D9FF5B]">
                  {deliveryFee === null ? `${formatPrice(subtotal)} + চার্জ` : formatPrice(total)}
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 rounded-full glow-lime-btn disabled:opacity-60 text-sm font-bold transition-all"
            >
              {submitting ? 'অর্ডার প্রসেস হচ্ছে...' : 'অর্ডার কনফার্ম করুন'}
            </button>
          </form>
        </div>
      )}

      {/* Order Confirmation Policy Modal */}
      {showConfirmPolicyModal && selectedDistrict && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg glass-panel rounded-3xl border border-amber-400/35 shadow-2xl overflow-hidden my-auto">
            <div className="px-5 sm:px-6 py-4 border-b border-white/10 bg-[#0A0D16] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-300" />
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                    গুরুত্বপূর্ণ নির্দেশনা
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-white">
                    অর্ডার কনফার্ম করার আগে একবার ভেবে নিন
                  </h3>
                </div>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowConfirmPolicyModal(false)}
                className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-300"
                aria-label="বন্ধ করুন"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-4">
              <div className="rounded-2xl bg-[#080A11] border border-white/10 p-4 space-y-3 text-xs sm:text-sm text-slate-200 leading-relaxed">
                <p>
                  আপনার পছন্দের প্রোডাক্টটি অর্ডার করার আগে অনুগ্রহ করে একবার ভেবে নিন—আপনি কি এই প্রোডাক্টটি সত্যিই নিতে চান?
                </p>
                <p className="text-slate-300">
                  এটি বলা হচ্ছে কারণ এই প্রোডাক্টটি ডেলিভারি ম্যানদের কাছে দেওয়ার সময়ই আমাদের ডেলিভারি চার্জটি আগে থেকেই পরিশোধ করতে হয়। অর্ডার করার পর যদি আপনি অর্ডারটি বাতিল করে দেন বা রিসিভ না করেন, তাহলে আমাদের{' '}
                  <span className="font-bold text-amber-300">৭০ থেকে ১২০ টাকা</span> লোকসান হয়ে যাবে।
                </p>
                <p className="text-[#C8FA50] font-medium">
                  তাই আমাদের লোকসানের কথা বিবেচনা করে নিশ্চিত হয়ে অর্ডারটি কনফার্ম করুন। যদি আপনার কাছে এই মুহূর্তে পর্যাপ্ত পরিমাণ টাকা না থাকে, তাহলে পণ্যটি <span className="underline">Cart (কার্ট)</span>-এ রেখে দিন—সময় হলে অর্ডারটি কনফার্ম করবেন। ধন্যবাদ।
                </p>
              </div>

              {/* Order Summary Strip */}
              <div className="rounded-2xl bg-purple-500/10 border border-purple-400/25 p-3.5 text-xs space-y-1.5">
                <div className="flex justify-between text-slate-300">
                  <span>ডেলিভারি এলাকা</span>
                  <span className="font-semibold text-white">
                    {selectedThana}, {selectedDistrict.nameBn}
                  </span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>ডেলিভারি চার্জ</span>
                  <span className="font-semibold text-white tabular-nums">{formatPrice(deliveryFee ?? 0)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-white/10">
                  <span className="text-white">সর্বমোট পরিশোধযোগ্য (COD)</span>
                  <span className="text-[#C8FA50] tabular-nums">{formatPrice(total)}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={executePlaceOrder}
                  className="w-full py-3 px-5 rounded-full glow-lime-btn disabled:opacity-60 text-sm font-bold flex items-center justify-center gap-2 transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {submitting ? 'অর্ডার কনফার্ম হচ্ছে...' : 'আমি বুঝতে পেরেছি, কনফার্ম করুন'}
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setShowConfirmPolicyModal(false);
                    showToast('পণ্যটি আপনার কার্টে সংরক্ষিত রয়েছে। সময় হলে অর্ডার কনফার্ম করবেন!', 'info');
                  }}
                  className="w-full py-2.5 px-5 rounded-full bg-white/5 border border-white/15 hover:border-purple-400/45 text-xs sm:text-sm font-semibold text-slate-200 flex items-center justify-center gap-2 transition-colors"
                >
                  <Clock className="w-4 h-4 text-purple-300" />
                  আমি পরে অর্ডার করবো
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
