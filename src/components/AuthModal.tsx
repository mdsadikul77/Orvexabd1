import React, { useEffect, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, KeyRound, Lock, Mail, RefreshCw, ShieldCheck, ShoppingBag, Store, User as UserIcon, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authPostJson } from '../lib/apiConfig';
import type { User } from '../types';

interface AuthPanelProps {
  isModal?: boolean;
  onClose?: () => void;
  onSuccess?: (user: User) => void;
}

type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';

export function AuthPanel({ isModal = false, onClose, onSuccess }: AuthPanelProps) {
  const { setSession, showToast, authPromptReason } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [accountType, setAccountType] = useState<'buyer' | 'seller'>('buyer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);

  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [showLoginPass, setShowLoginPass] = useState(false);

  const [fullName, setFullName] = useState('');
  const [shopName, setShopName] = useState('');
  const [username, setUsername] = useState('');
  const [emailOrPhone, setEmailOrPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showSignupPass, setShowSignupPass] = useState(false);

  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPass, setResetNewPass] = useState('');
  const [resetConfirmPass, setResetConfirmPass] = useState('');
  const [showResetPass, setShowResetPass] = useState(false);
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    if (nextMode !== 'reset') {
      setInfoNotice(null);
    }
  };

  useEffect(() => {
    if (otpResendCooldown <= 0) return;
    const t = setTimeout(() => setOtpResendCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [otpResendCooldown]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = loginId.trim();
    if (!cleanId || !loginPass) {
      setError('ইউজারনেম/ইমেইল/ফোন এবং পাসওয়ার্ড দিন।');
      return;
    }
    setError(null);
    setInfoNotice(null);
    setLoading(true);
    try {
      const data = await authPostJson<{ token?: string; user?: User }>(
        '/api/auth/login',
        { identifier: cleanId, password: loginPass },
        'লগইন ব্যর্থ হয়েছে।'
      );
      if (!data || typeof data.token !== 'string' || !data.user || typeof data.user.id !== 'string') {
        throw new Error(
          'সার্ভার থেকে সঠিক লগইন তথ্য পাওয়া যায়নি। অনুগ্রহ করে হোস্টিংয়ের Environment Variables ও সার্ভার লগ যাচাই করে আবার চেষ্টা করুন।'
        );
      }
      setSession(data.token, data.user);
      showToast(`স্বাগতম, ${data.user.fullName || data.user.username || 'সদস্য'}!`, 'success');
      onSuccess?.(data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanFullName = fullName.trim();
    const cleanUsername = username.trim();
    const cleanContact = emailOrPhone.trim();
    const cleanShopName = shopName.trim();

    if (cleanFullName.length < 2) {
      setError('অনুগ্রহ করে আপনার পূর্ণ নাম লিখুন।');
      return;
    }
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(cleanUsername)) {
      setError('ইউজারনেম ৩ থেকে ৩০ অক্ষরের হতে হবে (শুধুমাত্র ইংরেজি অক্ষর, সংখ্যা, _ . -)।');
      return;
    }
    if (accountType === 'seller' && cleanShopName.length < 2) {
      setError('অনুগ্রহ করে আপনার শপের নাম লিখুন।');
      return;
    }
    if (password.length < 6) {
      setError('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।');
      return;
    }
    if (password !== confirmPassword) {
      setError('পাসওয়ার্ড এবং কনফার্ম পাসওয়ার্ড মিলছে না।');
      return;
    }

    setError(null);
    setInfoNotice(null);
    setLoading(true);
    try {
      const data = await authPostJson<{ token?: string; user?: User }>(
        '/api/auth/register',
        {
          role: accountType,
          fullName: cleanFullName,
          shopName: accountType === 'seller' ? cleanShopName : undefined,
          username: cleanUsername,
          emailOrPhone: cleanContact,
          password,
          confirmPassword,
        },
        'অ্যাকাউন্ট তৈরি করা যায়নি।'
      );
      if (!data || typeof data.token !== 'string' || !data.user || typeof data.user.id !== 'string') {
        throw new Error('সার্ভার থেকে অ্যাকাউন্ট তথ্য পাওয়া যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।');
      }
      setSession(data.token, data.user);
      showToast('অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে!', 'success');
      onSuccess?.(data.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const requestOtpForReset = async (cleanId: string) => {
    setError(null);
    setInfoNotice(null);
    setLoading(true);
    try {
      const data = await authPostJson<{ message: string }>(
        '/api/auth/forgot-password',
        { identifier: cleanId },
        'OTP পাঠানো যায়নি।'
      );
      setInfoNotice(data.message || 'আপনার নিবন্ধিত মোবাইল নম্বরে ৬ ডিজিটের OTP পাঠানো হয়েছে।');
      setOtpResendCooldown(45);
      setMode('reset');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = resetIdentifier.trim();
    if (!cleanId) {
      setError('আপনার ইউজারনেম, ইমেইল অথবা মোবাইল নম্বর দিন।');
      return;
    }
    await requestOtpForReset(cleanId);
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = resetCode.replace(/\D/g, '').trim();
    if (cleanCode.length !== 6) {
      setError('আপনার মোবাইলে আসা সঠিক ৬ ডিজিটের OTP কোডটি লিখুন।');
      return;
    }
    if (resetNewPass.length < 6) {
      setError('নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।');
      return;
    }
    if (resetNewPass !== resetConfirmPass) {
      setError('নতুন পাসওয়ার্ড এবং কনফার্ম পাসওয়ার্ড মিলছে না।');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const data = await authPostJson<{ message: string }>(
        '/api/auth/reset-password',
        {
          identifier: resetIdentifier.trim(),
          code: cleanCode,
          newPassword: resetNewPass,
          confirmPassword: resetConfirmPass,
        },
        'পাসওয়ার্ড রিসেট ব্যর্থ হয়েছে।'
      );
      showToast(data.message, 'success');
      setResetCode('');
      setResetNewPass('');
      setResetConfirmPass('');
      setShowResetPass(false);
      setInfoNotice(data.message);
      setMode('signin');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto glass-panel rounded-2xl shadow-2xl overflow-hidden">
      <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-[#0B0D14]/80">
        <div className="flex items-center gap-3">
          <img
            src="/assets/aistudio/file_000000006e008208abb53399401b7236_1c57ca49.png"
            alt="Orvexa"
            className="w-10 h-10 rounded-full object-cover ring-1 ring-purple-400/50 shrink-0"
          />
          <div>
            <h2 className="text-xl font-bold hero-gradient-text">
              {mode === 'signin' && 'সাইন ইন করুন (Sign In)'}
              {mode === 'signup' && 'নতুন অ্যাকাউন্ট তৈরি করুন (Sign Up)'}
              {mode === 'forgot' && 'OTP দিয়ে পাসওয়ার্ড পুনরুদ্ধার'}
              {mode === 'reset' && 'OTP যাচাই ও নতুন পাসওয়ার্ড'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {authPromptReason || 'একবার সাইন ইন করলে লগআউট না করা পর্যন্ত আপনার অ্যাকাউন্ট সক্রিয় থাকবে।'}
            </p>
          </div>
        </div>
        {isModal && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="বন্ধ করুন"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="p-6 space-y-5">
        {(mode === 'signin' || mode === 'signup') && (
          <div className="grid grid-cols-2 gap-1 p-1 bg-[#080A11] border border-white/10 rounded-xl">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className={`py-2 text-sm font-semibold rounded-lg transition-colors ${
                mode === 'signin' ? 'bg-[#C8FA50] text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              সাইন ইন (Sign In)
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className={`py-2 text-sm font-semibold rounded-lg transition-colors ${
                mode === 'signup' ? 'bg-[#C8FA50] text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              সাইন আপ (Sign Up)
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs font-medium text-rose-300">
            {error}
          </div>
        )}
        {infoNotice && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs font-medium text-emerald-300">
            {infoNotice}
          </div>
        )}

        {mode === 'signin' && (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                ইউজারনেম, ইমেইল বা মোবাইল নম্বর
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="আপনার ইউজারনেম / ইমেইল / ফোন"
                  className="w-full pl-9 pr-3.5 py-2.5 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-300">পাসওয়ার্ড</label>
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-xs font-medium text-[#C8FA50] hover:underline"
                >
                  পাসওয়ার্ড ভুলে গেছেন?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showLoginPass ? 'text' : 'password'}
                  required
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2.5 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPass((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                  aria-label={showLoginPass ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখুন'}
                >
                  {showLoginPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-full glow-lime-btn disabled:opacity-60 text-sm font-bold transition-all"
            >
              {loading ? 'যাচাই করা হচ্ছে...' : 'সাইন ইন করুন'}
            </button>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-2">
                অ্যাকাউন্টের ধরন নির্বাচন করুন
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAccountType('buyer')}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                    accountType === 'buyer'
                      ? 'border-[#C8FA50] bg-[#C8FA50]/10 text-[#C8FA50]'
                      : 'border-white/15 bg-white/5 hover:border-white/30 text-slate-300'
                  }`}
                >
                  <ShoppingBag className="w-5 h-5 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">Buyer</div>
                    <div className="text-[11px] opacity-80">ক্রেতা অ্যাকাউন্ট</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setAccountType('seller')}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                    accountType === 'seller'
                      ? 'border-[#A855F7] bg-purple-500/15 text-[#C084FC]'
                      : 'border-white/15 bg-white/5 hover:border-white/30 text-slate-300'
                  }`}
                >
                  <Store className="w-5 h-5 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold">Seller</div>
                    <div className="text-[11px] opacity-80">বিক্রেতা অ্যাকাউন্ট</div>
                  </div>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">পূর্ণ নাম (Full Name)</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="যেমন: আরিফুল ইসলাম"
                  className="w-full px-3 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">ইউজারনেম (Username)</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ariful_bd"
                  className="w-full px-3 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
                />
              </div>
            </div>

            {accountType === 'seller' && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">শপের নাম (Shop Name)</label>
                <input
                  type="text"
                  required
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="আপনার দোকানের নাম লিখুন"
                  className="w-full px-3 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">ইমেইল অথবা মোবাইল নম্বর</label>
              <input
                type="text"
                required
                value={emailOrPhone}
                onChange={(e) => setEmailOrPhone(e.target.value)}
                placeholder="email@example.com অথবা 017XXXXXXXX"
                className="w-full px-3 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">পাসওয়ার্ড</label>
                <div className="relative">
                  <input
                    type={showSignupPass ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="কমপক্ষে ৬ অক্ষর"
                    className="w-full pl-3 pr-9 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignupPass((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                    aria-label={showSignupPass ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখুন'}
                  >
                    {showSignupPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">কনফার্ম পাসওয়ার্ড</label>
                <input
                  type={showSignupPass ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="পুনরায় লিখুন"
                  className="w-full px-3 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-full glow-lime-btn disabled:opacity-60 text-sm font-bold transition-all"
            >
              {loading
                ? 'অ্যাকাউন্ট তৈরি হচ্ছে...'
                : accountType === 'seller'
                  ? 'Seller হিসেবে সাইন আপ করুন'
                  : 'Buyer হিসেবে সাইন আপ করুন'}
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgot} className="space-y-4">
            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-400/25 flex items-start gap-2.5 text-xs text-slate-200">
              <ShieldCheck className="w-4 h-4 text-[#C8FA50] shrink-0 mt-0.5" />
              <div>
                আপনার নিবন্ধিত মোবাইল নম্বর, ইমেইল বা ইউজারনেম দিলে আমরা ৬ ডিজিটের{' '}
                <strong className="text-[#C8FA50]">SMS OTP</strong> পাঠিয়ে দেব।
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                আপনার মোবাইল নম্বর, ইমেইল বা ইউজারনেম দিন
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={resetIdentifier}
                  onChange={(e) => setResetIdentifier(e.target.value)}
                  placeholder="01XXXXXXXXX / ইউজারনেম / ইমেইল"
                  className="w-full pl-9 pr-3.5 py-2.5 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white"
                />
              </div>
            </div>

            <button type="submit" disabled={loading} className="w-full py-2.5 px-4 rounded-full glow-lime-btn text-sm font-bold">
              {loading ? 'OTP পাঠানো হচ্ছে...' : 'OTP পাঠান'}
            </button>

            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> সাইন ইনে ফিরে যান
            </button>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-medium text-slate-300">৬ ডিজিটের OTP কোড</label>
                <button
                  type="button"
                  disabled={loading || otpResendCooldown > 0}
                  onClick={() => requestOtpForReset(resetIdentifier.trim())}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#C8FA50] hover:underline disabled:opacity-50"
                >
                  <RefreshCw className="w-3 h-3" />
                  {otpResendCooldown > 0 ? `পুনরায় পাঠান (${otpResendCooldown}s)` : 'পুনরায় OTP পাঠান'}
                </button>
              </div>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="৬ ডিজিটের OTP লিখুন"
                  className="w-full pl-9 pr-3.5 py-2 text-sm font-mono tracking-widest bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">নতুন পাসওয়ার্ড</label>
              <div className="relative">
                <input
                  type={showResetPass ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={resetNewPass}
                  onChange={(e) => setResetNewPass(e.target.value)}
                  placeholder="কমপক্ষে ৬ অক্ষর"
                  className="w-full pl-3 pr-10 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPass((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                  aria-label={showResetPass ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখুন'}
                >
                  {showResetPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">কনফার্ম পাসওয়ার্ড</label>
              <input
                type={showResetPass ? 'text' : 'password'}
                required
                minLength={6}
                value={resetConfirmPass}
                onChange={(e) => setResetConfirmPass(e.target.value)}
                placeholder="পুনরায় লিখুন"
                className="w-full px-3 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
              />
            </div>

            <button type="submit" disabled={loading} className="w-full py-2.5 px-4 rounded-full glow-lime-btn text-sm font-bold disabled:opacity-60">
              {loading ? 'যাচাই হচ্ছে...' : 'OTP যাচাই ও পাসওয়ার্ড রিসেট করুন'}
            </button>

            <button
              type="button"
              onClick={() => switchMode('forgot')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> নম্বর/ইমেইল পরিবর্তন করুন
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function AuthModal() {
  const { authModalOpen, closeAuthModal } = useAuth();
  if (!authModalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={closeAuthModal}
    >
      <div className="w-full max-w-lg my-8" onClick={(e) => e.stopPropagation()}>
        <AuthPanel isModal onClose={closeAuthModal} />
      </div>
    </div>
  );
}
