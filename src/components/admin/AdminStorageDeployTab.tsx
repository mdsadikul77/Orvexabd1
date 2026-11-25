import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Database,
  HardDrive,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { formatDateTime } from '../../utils/format';

interface StorageStats {
  isRemote?: boolean;
  isServerless?: boolean;
  dbMode?: string;
  dbEngine: string;
  mediaCount: number;
  mediaBytes: number;
  orphanMediaCount: number;
  orphanMediaBytes: number;
  staleSessionsCount: number;
  staleNotificationsCount: number;
  tableCounts: {
    users: number;
    products: number;
    orders: number;
    messages: number;
    notifications: number;
    sessions: number;
  };
}

interface DeployHookStatus {
  configured: boolean;
  maskedUrl: string;
  providerHint: string;
  lastTriggeredAt: number | null;
  lastStatus: string | null;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function AdminStorageDeployTab() {
  const { apiFetch, showToast } = useAuth();

  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const [hookStatus, setHookStatus] = useState<DeployHookStatus>({
    configured: false,
    maskedUrl: '',
    providerHint: 'Vercel / Netlify / Render',
    lastTriggeredAt: null,
    lastStatus: null,
  });
  const [hookUrlInput, setHookUrlInput] = useState('');
  const [providerHint, setProviderHint] = useState('Vercel / Netlify / Render');
  const [savingHook, setSavingHook] = useState(false);
  const [triggeringHook, setTriggeringHook] = useState(false);

  const loadHealthAndHook = useCallback(async () => {
    setLoadingStats(true);
    try {
      const [sRes, hRes] = await Promise.all([
        apiFetch<StorageStats>('/api/admin/storage/stats'),
        apiFetch<DeployHookStatus>('/api/admin/deploy-hook'),
      ]);
      setStats(sRes);
      setHookStatus(hRes);
      if (hRes.providerHint) setProviderHint(hRes.providerHint);
    } catch (err: any) {
      showToast(err.message || 'স্টোরেজ তথ্য লোড করা যায়নি।', 'error');
    } finally {
      setLoadingStats(false);
    }
  }, [apiFetch, showToast]);

  useEffect(() => {
    loadHealthAndHook();
  }, [loadHealthAndHook]);

  const handleRunCleanup = async () => {
    setCleaning(true);
    try {
      const res = await apiFetch<{
        deletedSessions: number;
        deletedNotifications: number;
        deletedOrphanMedia: number;
        freedMediaBytes: number;
        message: string;
      }>('/api/admin/storage/cleanup', { method: 'POST' });
      showToast(
        `${res.message} (${res.deletedOrphanMedia}টি অরফান ছবি, ${res.deletedSessions}টি পুরনো সেশন ও ${res.deletedNotifications}টি পুরনো নোটিফিকেশন মুছে ${formatBytes(res.freedMediaBytes)} মুক্ত হয়েছে)`,
        'success'
      );
      await loadHealthAndHook();
    } catch (err: any) {
      showToast(err.message || 'ক্লিনআপ ব্যর্থ হয়েছে।', 'error');
    } finally {
      setCleaning(false);
    }
  };

  const handleSaveHook = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingHook(true);
    try {
      const res = await apiFetch<DeployHookStatus & { message: string }>('/api/admin/deploy-hook', {
        method: 'PUT',
        body: JSON.stringify({ url: hookUrlInput.trim(), providerHint }),
      });
      setHookStatus(res);
      setHookUrlInput('');
      showToast(res.message, 'success');
    } catch (err: any) {
      showToast(err.message || 'Deploy Hook সংরক্ষণ করা যায়নি।', 'error');
    } finally {
      setSavingHook(false);
    }
  };

  const handleRemoveHook = async () => {
    setSavingHook(true);
    try {
      const res = await apiFetch<DeployHookStatus & { message: string }>('/api/admin/deploy-hook', {
        method: 'PUT',
        body: JSON.stringify({ url: '' }),
      });
      setHookStatus(res);
      setHookUrlInput('');
      showToast(res.message, 'info');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSavingHook(false);
    }
  };

  const handleTriggerDeploy = async () => {
    setTriggeringHook(true);
    try {
      const res = await apiFetch<{ message: string; lastTriggeredAt: number; lastStatus: string }>(
        '/api/admin/deploy-hook/trigger',
        { method: 'POST' }
      );
      setHookStatus((prev) => ({
        ...prev,
        lastTriggeredAt: res.lastTriggeredAt,
        lastStatus: res.lastStatus,
      }));
      showToast(res.message, 'success');
    } catch (err: any) {
      showToast(err.message || 'রি-ডেপ্লয়মেন্ট ট্রিগার ব্যর্থ হয়েছে।', 'error');
      await loadHealthAndHook();
    } finally {
      setTriggeringHook(false);
    }
  };

  const inputClass =
    'w-full px-3.5 py-2.5 text-xs sm:text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]';

  return (
    <div className="space-y-6">
      {/* 10-20 Year Long-Term Storage Health & Auto-Optimization */}
      <div className="glass-card rounded-3xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#C8FA50]">
              <Database className="w-4 h-4" />
              <span>10–20 Year Database & Media Health</span>
            </div>
            <h2 className="text-lg font-bold text-white mt-0.5">দীর্ঘমেয়াদি স্টোরেজ স্বাস্থ্য ও অটো-অপটিমাইজেশন</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              সব নতুন আপলোড করা ছবি স্বয়ংক্রিয়ভাবে HD WebP-তে কম্প্রেস হয়ে ~৯০% জায়গা বাঁচায়। অপ্রয়োজনীয় অরফান ফাইল এখান থেকে পরিষ্কার করুন।
            </p>
          </div>

          <button
            type="button"
            disabled={loadingStats}
            onClick={loadHealthAndHook}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-200 hover:border-[#C8FA50]/45"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingStats ? 'animate-spin' : ''}`} />
            হিসাব রিফ্রেশ করুন
          </button>
        </div>

        {stats && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
              <div className="rounded-2xl bg-[#090C14] border border-white/10 p-4">
                <div className="text-[11px] text-slate-400">ডাটাবেস ইঞ্জিন</div>
                <div className="text-sm font-bold text-[#C8FA50] mt-1">{stats.dbEngine}</div>
                <div className="text-[11px] text-slate-500 mt-1">ইন্ডেক্স সক্রিয় রয়েছে</div>
              </div>
              <div className="rounded-2xl bg-[#090C14] border border-white/10 p-4">
                <div className="text-[11px] text-slate-400">মোট সংরক্ষিত ছবি</div>
                <div className="text-lg font-extrabold text-white tabular-nums mt-0.5">
                  {stats.mediaCount}টি · {formatBytes(stats.mediaBytes)}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">অটো HD কম্প্রেশন চালু</div>
              </div>
              <div className="rounded-2xl bg-[#090C14] border border-white/10 p-4">
                <div className="text-[11px] text-slate-400">অরফান (অব্যবহৃত) ছবি</div>
                <div className="text-lg font-extrabold text-amber-300 tabular-nums mt-0.5">
                  {stats.orphanMediaCount}টি ({formatBytes(stats.orphanMediaBytes)})
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">মুছে ফেলার জন্য প্রস্তুত</div>
              </div>
              <div className="rounded-2xl bg-[#090C14] border border-white/10 p-4">
                <div className="text-[11px] text-slate-400">পুরনো সেশন ও নোটিফিকেশন</div>
                <div className="text-lg font-extrabold text-purple-300 tabular-nums mt-0.5">
                  {stats.staleSessionsCount + stats.staleNotificationsCount}টি
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  সেশন: {stats.staleSessionsCount} · নোটিফ: {stats.staleNotificationsCount}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-[#0B0E17] border border-white/10">
              <div className="flex flex-wrap gap-3 text-xs text-slate-300 tabular-nums">
                <span>ইউজার: <strong className="text-white">{stats.tableCounts.users}</strong></span>
                <span>· পণ্য: <strong className="text-white">{stats.tableCounts.products}</strong></span>
                <span>· অর্ডার: <strong className="text-white">{stats.tableCounts.orders}</strong></span>
                <span>· মেসেজ: <strong className="text-white">{stats.tableCounts.messages}</strong></span>
                <span>· সেশন: <strong className="text-white">{stats.tableCounts.sessions}</strong></span>
              </div>

              <button
                type="button"
                disabled={cleaning}
                onClick={handleRunCleanup}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full glow-lime-btn text-xs font-extrabold disabled:opacity-60"
              >
                <Sparkles className="w-4 h-4" />
                {cleaning ? 'পরিষ্কার হচ্ছে...' : 'অব্যবহৃত ডেটা ও ছবি পরিষ্কার করুন (Optimize)'}
              </button>
            </div>
          </>
        )}

        {stats?.isServerless && !stats?.isRemote ? (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-400/35 p-4 flex items-start gap-3 text-xs text-amber-200 leading-relaxed">
            <HardDrive className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
            <div>
              <strong>সার্ভারলেস অস্থায়ী মোড চালু আছে:</strong> Vercel / Netlify-তে স্থায়ীভাবে অ্যাকাউন্ট, অর্ডার ও ছবি সংরক্ষণ করতে হোস্টিং ড্যাশবোর্ডের{' '}
              <strong>Environment Variables</strong>-এ <code className="text-[#C8FA50]">TURSO_DATABASE_URL</code> এবং{' '}
              <code className="text-[#C8FA50]">TURSO_AUTH_TOKEN</code> যোগ করুন এবং তারপর একবার Redeploy করুন।
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/25 p-4 flex items-start gap-3 text-xs text-emerald-200 leading-relaxed">
            <HardDrive className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
            <div>
              <strong>{stats?.isRemote ? 'Turso Cloud স্থায়ী স্টোরেজ সক্রিয়:' : 'দীর্ঘস্থায়ী (১০–২০ বছর) টিপস:'}</strong>{' '}
              {stats?.isRemote
                ? 'আপনার সাইট Turso Cloud ডাটাবেসের সাথে যুক্ত আছে, তাই Vercel / Netlify / Render-এ সব ইউজার, অর্ডার ও ছবি স্থায়ীভাবে সংরক্ষিত থাকবে।'
                : (
                  <>
                    স্থায়ী ক্লাউড স্টোরেজের জন্য Vercel/Netlify এনভায়রনমেন্টে{' '}
                    <code className="text-[#C8FA50]">TURSO_DATABASE_URL</code> এবং{' '}
                    <code className="text-[#C8FA50]">TURSO_AUTH_TOKEN</code> যুক্ত করুন এবং ছবি Google Drive বা কম্প্রেসড আপলোডের মাধ্যমে সংরক্ষণ করুন।
                  </>
                )}
            </div>
          </div>
        )}
      </div>

      {/* Option 3: Live Deploy Hook Control */}
      <div className="glass-card rounded-3xl p-6 space-y-5 border border-purple-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-purple-300">
              <Rocket className="w-4 h-4 text-[#C8FA50]" />
              <span>Live Deploy Hook Control</span>
            </div>
            <h2 className="text-lg font-bold text-white mt-0.5">ওয়ান-ক্লিক লাইভ রি-ডেপ্লয়মেন্ট ও বিল্ড ট্রিগার</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Vercel, Netlify বা Render-এর Deploy Hook URL নিরাপদভাবে সার্ভারে সংরক্ষণ করুন (সাধারণ ভিজিটররা এটি দেখতে পাবে না)।
            </p>
          </div>

          {hookStatus.configured && (
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#C8FA50]/15 border border-[#C8FA50]/40 text-xs font-bold text-[#C8FA50]">
              <ShieldCheck className="w-4 h-4" />
              সংযুক্ত ({hookStatus.providerHint})
            </span>
          )}
        </div>

        {hookStatus.configured && (
          <div className="rounded-2xl bg-[#090C14] border border-white/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1 text-xs">
              <div className="text-slate-400">
                সংরক্ষিত Webhook: <span className="font-mono text-white">{hookStatus.maskedUrl}</span>
              </div>
              {hookStatus.lastTriggeredAt && (
                <div className="text-slate-400 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#C8FA50]" />
                  <span>সর্বশেষ ট্রিগার: {formatDateTime(hookStatus.lastTriggeredAt)}</span>
                  {hookStatus.lastStatus && (
                    <span className="text-[#C8FA50] font-semibold">({hookStatus.lastStatus})</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={triggeringHook}
                onClick={handleTriggerDeploy}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full glow-lime-btn text-xs font-extrabold disabled:opacity-60"
              >
                <Rocket className="w-4 h-4" />
                {triggeringHook ? 'ট্রিগার হচ্ছে...' : 'এখনই রি-ডেপ্লয় করুন'}
              </button>
              <button
                type="button"
                disabled={savingHook}
                onClick={handleRemoveHook}
                className="p-2.5 rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                title="Deploy Hook সরান"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSaveHook} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <input
            type="url"
            required
            value={hookUrlInput}
            onChange={(e) => setHookUrlInput(e.target.value)}
            placeholder="নতুন Deploy Hook URL দিন (https://api.vercel.com/v1/integrations/deploy/...)"
            className={`sm:col-span-7 ${inputClass}`}
          />
          <select
            value={providerHint}
            onChange={(e) => setProviderHint(e.target.value)}
            className={`sm:col-span-3 ${inputClass}`}
          >
            <option value="Vercel" className="bg-[#0B0E17]">Vercel Deploy Hook</option>
            <option value="Netlify" className="bg-[#0B0E17]">Netlify Build Hook</option>
            <option value="Render" className="bg-[#0B0E17]">Render Deploy Hook</option>
            <option value="Railway / Other" className="bg-[#0B0E17]">অন্যান্য হোস্ট</option>
          </select>
          <button
            type="submit"
            disabled={savingHook}
            className="sm:col-span-2 px-4 py-2.5 rounded-xl glow-purple-btn text-xs font-bold disabled:opacity-60"
          >
            {savingHook ? 'সংরক্ষণ...' : 'সংরক্ষণ করুন'}
          </button>
        </form>
      </div>
    </div>
  );
}
