import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Heart,
  KeyRound,
  LogOut,
  Megaphone,
  Package,
  ShieldCheck,
  ShoppingCart,
  Store,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import { AuthPanel } from '../components/AuthModal';
import { GoogleDriveManager } from '../components/GoogleDriveManager';
import type { AppView } from '../components/Navbar';
import { SafeImage } from '../components/SafeImage';
import { useAuth } from '../context/AuthContext';
import type { Order } from '../types';
import { ORDER_STATUS_BN, formatDateTime, formatPrice } from '../utils/format';

interface ProfilePageProps {
  onNavigate: (view: AppView) => void;
  onOpenSellerOrders?: () => void;
  onOpenSellerProfile?: (sellerIdentifier: string) => void;
}

export function ProfilePage({ onNavigate, onOpenSellerOrders, onOpenSellerProfile }: ProfilePageProps) {
  const { user, token, apiFetch, updateUser, logout, showToast, uploadImage, cart, favorites } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [copiedProfileLink, setCopiedProfileLink] = useState(false);

  // Profile edit state
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [emailOrPhone, setEmailOrPhone] = useState(user?.emailOrPhone || '');
  const [shopName, setShopName] = useState(user?.shopName || '');
  const [shopDescription, setShopDescription] = useState(user?.shopDescription || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [changingPass, setChangingPass] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName || '');
      setEmailOrPhone(user.emailOrPhone || '');
      setShopName(user.shopName || '');
      setShopDescription(user.shopDescription || '');
      setAvatarUrl(user.avatarUrl || '');
    }
  }, [user]);

  useEffect(() => {
    if (!token || !user) return;
    setLoadingOrders(true);
    apiFetch<{ orders: Order[] }>('/api/orders')
      .then((res) => setOrders(res.orders || []))
      .catch(() => {})
      .finally(() => setLoadingOrders(false));
  }, [token, user, apiFetch]);

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <AuthPanel />
      </div>
    );
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadImage(file);
      setAvatarUrl(url);
      showToast('প্রোফাইল ছবি আপলোড হয়েছে! সংরক্ষণ করুন।', 'info');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await apiFetch('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          fullName,
          emailOrPhone,
          shopName: user.role === 'seller' ? shopName : undefined,
          shopDescription: user.role === 'seller' ? shopDescription : undefined,
          avatarUrl: avatarUrl || null,
        }),
      });
      if (res?.user?.id) {
        updateUser(res.user);
      }
      showToast('প্রোফাইল তথ্য আপডেট হয়েছে।', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPass(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword }),
      });
      showToast(res.message, 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setChangingPass(false);
    }
  };

  const inputClass =
    'w-full px-3.5 py-2.5 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]';

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header Summary Card */}
      <div className="glass-card rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full neon-ring-purple p-[2px] shrink-0">
            <div className="w-full h-full rounded-full overflow-hidden bg-[#090B11] flex items-center justify-center">
              {user.avatarUrl ? (
                <SafeImage src={user.avatarUrl} alt={user.fullName} className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-7 h-7 text-[#C8FA50]" />
              )}
            </div>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{user.fullName}</h1>
            <div className="text-xs text-slate-400 mt-0.5">
              @{user.username} · {user.emailOrPhone} ·{' '}
              <span className="font-bold text-[#C8FA50] uppercase">{user.role}</span>
            </div>
            {user.shopName && <div className="text-xs font-medium text-purple-300 mt-1">শপ: {user.shopName}</div>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {user.role === 'seller' && (
            <>
              <button
                type="button"
                onClick={() => onNavigate('seller')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full glow-lime-btn text-xs font-bold"
              >
                <Store className="w-4 h-4" />
                সেলার ড্যাশবোর্ড
              </button>
              <button
                type="button"
                onClick={() => (onOpenSellerOrders ? onOpenSellerOrders() : onNavigate('seller'))}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-[#C8FA50]/40 bg-[#C8FA50]/10 text-[#C8FA50] hover:bg-[#C8FA50]/20 text-xs font-bold transition-colors"
              >
                <Package className="w-4 h-4" />
                প্রাপ্ত অর্ডার সমূহ
              </button>
              <button
                type="button"
                onClick={() => onNavigate('seller-ads')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full glow-purple-btn text-xs font-semibold"
              >
                <Megaphone className="w-4 h-4 text-[#C8FA50]" />
                Product Ads
              </button>
              {onOpenSellerProfile && (
                <button
                  type="button"
                  onClick={() => onOpenSellerProfile(user.username || user.id)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 border border-white/15 hover:border-[#C8FA50]/50 text-xs font-semibold text-slate-200 hover:text-[#C8FA50] transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-[#C8FA50]" />
                  পাবলিক প্রোফাইল
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  try {
                    const url = `${window.location.origin}/seller/${encodeURIComponent(user.username || user.id)}`;
                    await navigator.clipboard.writeText(url);
                    setCopiedProfileLink(true);
                    showToast('আপনার সেলার প্রোফাইল লিংক কপি হয়েছে!', 'success');
                    setTimeout(() => setCopiedProfileLink(false), 2000);
                  } catch {
                    showToast('লিংক কপি করা যায়নি।', 'error');
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 border border-white/15 hover:border-[#C8FA50]/50 text-xs font-semibold text-slate-200 hover:text-[#C8FA50] transition-colors"
              >
                {copiedProfileLink ? (
                  <Check className="w-3.5 h-3.5 text-[#C8FA50]" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#C8FA50]" />
                )}
                {copiedProfileLink ? 'লিংক কপি হয়েছে' : 'প্রোফাইল লিংক কপি'}
              </button>
            </>
          )}

          {user.role === 'admin' && (
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full glow-lime-btn text-xs font-bold"
            >
              <ShieldCheck className="w-4 h-4" />
              Admin ড্যাশবোর্ড
            </button>
          )}

          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-rose-500/35 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-xs font-semibold transition-colors"
          >
            <LogOut className="w-4 h-4" />
            লগআউট
          </button>
        </div>
      </div>

      {/* Quick Shortcuts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('cart')}
          className="glass-card rounded-2xl p-4 text-left hover:border-[#C8FA50]/45 transition-all"
        >
          <ShoppingCart className="w-5 h-5 text-[#C8FA50] mb-2" />
          <div className="text-sm font-semibold text-white">আমার কার্ট</div>
          <div className="text-xs text-slate-400 tabular-nums">
            {cart.reduce((s, c) => s + Number(c?.quantity || 0), 0)} টি পণ্য
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('favorites')}
          className="glass-card rounded-2xl p-4 text-left hover:border-purple-400/45 transition-all"
        >
          <Heart className="w-5 h-5 text-rose-400 mb-2" />
          <div className="text-sm font-semibold text-white">পছন্দের তালিকা</div>
          <div className="text-xs text-slate-400 tabular-nums">{favorites.length} টি সংরক্ষিত</div>
        </button>

        <button
          type="button"
          onClick={() => document.getElementById('buyer-order-history')?.scrollIntoView({ behavior: 'smooth' })}
          className="glass-card rounded-2xl p-4 text-left hover:border-purple-400/45 transition-all"
        >
          <Package className="w-5 h-5 text-purple-400 mb-2" />
          <div className="text-sm font-semibold text-white">মোট অর্ডার</div>
          <div className="text-xs text-slate-400 tabular-nums">{orders.length} টি অর্ডার</div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="glass-card rounded-2xl p-4 text-left hover:border-[#C8FA50]/45 transition-all"
        >
          <Store className="w-5 h-5 text-[#C8FA50] mb-2" />
          <div className="text-sm font-semibold text-white">শপিং করুন</div>
          <div className="text-xs text-slate-400">হোমপেজে যান</div>
        </button>
      </div>

      {/* Order History */}
      <section id="buyer-order-history" className="glass-card rounded-3xl p-6 space-y-4">
        <h2 className="text-lg font-bold text-white">আমার অর্ডারের ইতিহাস ও স্ট্যাটাস</h2>
        {loadingOrders ? (
          <p className="text-sm text-slate-400">অর্ডার লোড হচ্ছে...</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-slate-400">আপনি এখনো কোনো অর্ডার করেননি।</p>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <div key={order.id} className="bg-[#0B0E17] border border-white/10 rounded-2xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/10">
                  <div>
                    <span className="text-sm font-mono font-bold text-white">{order.orderNumber}</span>
                    <span className="text-xs text-slate-500 ml-2">{formatDateTime(order.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-200">
                      {ORDER_STATUS_BN[order.status] || order.status}
                    </span>
                    <span className="text-sm font-bold text-[#C8FA50] tabular-nums">
                      {formatPrice(order.totalAmount)}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
                  <span>নাম: {order.customerName}</span>
                  <span>মোবাইল: {order.customerPhone}{order.backupPhone ? ` (বিকল্প: ${order.backupPhone})` : ''}</span>
                  <span>
                    ঠিকানা: {[order.deliveryAddress, order.thana, order.district].filter(Boolean).join(', ')}
                  </span>
                  <span className="text-[#C8FA50]">ক্যাশ অন ডেলিভারি</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(order.items || []).map((item) => (
                    <div key={item.id} className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-900 border border-white/10 shrink-0">
                        <SafeImage src={item.productImage} alt={item.productName} className="w-full h-full object-cover" />
                      </div>
                      <div className="min-w-0 text-xs">
                        <div className="font-semibold text-white truncate">{item.productName}</div>
                        <div className="text-slate-400">
                          {item.shopName} · {item.quantity}টি × {formatPrice(item.price)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Account Settings & Change Password */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form onSubmit={handleSaveProfile} className="glass-card rounded-3xl p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">অ্যাকাউন্ট সেটিংস</h2>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">প্রোফাইল ছবি</label>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
              <label className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-white/15 bg-white/5 text-xs font-medium text-slate-200 hover:bg-white/10 cursor-pointer shrink-0">
                <Upload className="w-3.5 h-3.5 text-[#C8FA50]" />
                ছবি আপলোড
                <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
              </label>
              <input
                type="text"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="অথবা ছবির URL দিন"
                className="flex-1 min-w-[160px] px-3 py-2.5 text-xs bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">পূর্ণ নাম</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">ইমেইল বা মোবাইল</label>
            <input
              type="text"
              required
              value={emailOrPhone}
              onChange={(e) => setEmailOrPhone(e.target.value)}
              className={inputClass}
            />
          </div>

          {user.role === 'seller' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">শপের নাম</label>
                <input
                  type="text"
                  required
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">শপের বিবরণ</label>
                <textarea
                  rows={2}
                  value={shopDescription}
                  onChange={(e) => setShopDescription(e.target.value)}
                  className={inputClass}
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={savingProfile}
            className="px-6 py-2.5 rounded-full glow-lime-btn text-xs font-bold"
          >
            {savingProfile ? 'সংরক্ষণ হচ্ছে...' : 'পরিবর্তন সংরক্ষণ করুন'}
          </button>
        </form>

        <form onSubmit={handleChangePassword} className="glass-card rounded-3xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[#C8FA50]" />
            <h2 className="text-lg font-bold text-white">পাসওয়ার্ড পরিবর্তন করুন</h2>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">বর্তমান পাসওয়ার্ড</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">নতুন পাসওয়ার্ড</label>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">নতুন পাসওয়ার্ড নিশ্চিত করুন</label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <button
            type="submit"
            disabled={changingPass}
            className="px-6 py-2.5 rounded-full glow-purple-btn text-xs font-bold"
          >
            {changingPass ? 'আপডেট হচ্ছে...' : 'পাসওয়ার্ড আপডেট করুন'}
          </button>
        </form>
      </div>

      {/* Google Drive Cloud Storage Card */}
      <GoogleDriveManager
        mode="full"
        title="আমার Google Drive ক্লাউড স্টোরেজ"
        subtitle="আপনার প্রোফাইল ছবি বা শপের মিডিয়া ফাইল সরাসরি Google Drive-এ সংরক্ষণ করুন এবং প্রয়োজনে প্রোফাইলে ব্যবহার করুন।"
        onSelectImageUrl={(url) => {
          setAvatarUrl(url);
          showToast('Drive ছবিটি প্রোফাইল ছবি হিসেবে সেট করা হয়েছে। "পরিবর্তন সংরক্ষণ করুন" চাপুন।', 'info');
        }}
      />
    </div>
  );
}
