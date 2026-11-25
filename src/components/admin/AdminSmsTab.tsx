import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { SmsLogItem } from '../../types';
import { formatDateTime, toBnDigits } from '../../utils/format';

interface SmsSettingsState {
  provider: 'built_in' | 'bulksmsbd' | 'greenweb' | 'twilio' | 'webhook';
  senderName: string;
  autoOrderSmsEnabled: boolean;
  hasApiKey: boolean;
  maskedApiKey: string;
  hasApiSecret: boolean;
  maskedApiSecret: string;
  webhookUrl: string;
  fromNumber: string;
}

const PROVIDER_LABELS: Record<SmsSettingsState['provider'], string> = {
  built_in: 'Built-in Gateway (Orvexa লগ ও প্রিভিউ)',
  bulksmsbd: 'BulkSMSBD (বাংলাদেশ SMS গেটওয়ে)',
  greenweb: 'GreenWeb BD (SMS.net.bd / GreenWeb)',
  twilio: 'Twilio International SMS',
  webhook: 'Custom HTTPS Webhook SMS API',
};

const MSG_TYPE_LABELS: Record<SmsLogItem['messageType'], string> = {
  order_confirmation: 'অর্ডার কনফার্মেশন',
  otp_reset: 'পাসওয়ার্ড রিসেট OTP',
  test: 'টেস্ট SMS',
};

export function AdminSmsTab() {
  const { apiFetch, showToast } = useAuth();

  const [settings, setSettings] = useState<SmsSettingsState>({
    provider: 'built_in',
    senderName: 'Orvexa',
    autoOrderSmsEnabled: true,
    hasApiKey: false,
    maskedApiKey: '',
    hasApiSecret: false,
    maskedApiSecret: '',
    webhookUrl: '',
    fromNumber: '',
  });
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiSecretInput, setApiSecretInput] = useState('');
  const [logs, setLogs] = useState<SmsLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  const loadSmsData = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, logsRes] = await Promise.all([
        apiFetch<SmsSettingsState>('/api/admin/sms-settings'),
        apiFetch<{ logs: SmsLogItem[] }>('/api/admin/sms-logs'),
      ]);
      setSettings(cfgRes);
      setLogs(logsRes.logs || []);
    } catch (err: any) {
      showToast(err.message || 'SMS তথ্য লোড করা যায়নি।', 'error');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, showToast]);

  useEffect(() => {
    loadSmsData();
  }, [loadSmsData]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        provider: settings.provider,
        senderName: settings.senderName.trim() || 'Orvexa',
        autoOrderSmsEnabled: settings.autoOrderSmsEnabled,
        webhookUrl: settings.webhookUrl.trim(),
        fromNumber: settings.fromNumber.trim(),
      };
      if (apiKeyInput.trim()) payload.apiKey = apiKeyInput.trim();
      if (apiSecretInput.trim()) payload.apiSecret = apiSecretInput.trim();

      const res = await apiFetch<{ message: string }>('/api/admin/sms-settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setApiKeyInput('');
      setApiSecretInput('');
      showToast(res.message || 'SMS গেটওয়ে সেটিংস সংরক্ষিত হয়েছে।', 'success');
      await loadSmsData();
    } catch (err: any) {
      showToast(err.message || 'সেটিংস সংরক্ষণ করা যায়নি।', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestSms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone.trim()) return;
    setSendingTest(true);
    try {
      const res = await apiFetch<{
        message: string;
        result?: {
          deliveredViaCarrier?: boolean;
          status?: string;
          errorDetail?: string | null;
        };
      }>('/api/admin/sms-test', {
        method: 'POST',
        body: JSON.stringify({ phone: testPhone.trim() }),
      });
      if (res.result?.status === 'failed') {
        showToast(res.result.errorDetail || res.message || 'টেস্ট SMS পাঠানো যায়নি।', 'error');
      } else if (!res.result?.deliveredViaCarrier) {
        showToast(res.message || 'টেস্ট SMS কেবল সার্ভারে লগ হয়েছে (লাইভ ক্যারিয়ার সক্রিয় নয়)।', 'info');
      } else {
        showToast(res.message || 'টেস্ট SMS পাঠানো হয়েছে।', 'success');
      }
      setTestPhone('');
      await loadSmsData();
    } catch (err: any) {
      showToast(err.message || 'টেস্ট SMS ব্যর্থ হয়েছে।', 'error');
    } finally {
      setSendingTest(false);
    }
  };

  const inputClass =
    'w-full px-3.5 py-2.5 text-xs sm:text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]';

  return (
    <div className="space-y-6">
      {/* Configuration Form */}
      <form onSubmit={handleSaveSettings} className="glass-card rounded-3xl p-6 space-y-5 border border-[#C8FA50]/20">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#C8FA50]">
              <MessageSquareText className="w-4 h-4" />
              <span>Auto SMS & Password OTP Gateway</span>
            </div>
            <h2 className="text-lg font-bold text-white mt-0.5">অর্ডার কনফার্মেশন অটো-SMS ও পাসওয়ার্ড রিসেট OTP সেটিংস</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              ক্রেতা অর্ডার কনফার্ম করলে স্বয়ংক্রিয়ভাবে &quot;{settings.senderName || 'Orvexa'}&quot; নামে মেসেজ যাবে এবং ভুলে যাওয়া পাসওয়ার্ডে মোবাইল OTP কাজ করবে।
            </p>
          </div>

          <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/5 border border-white/10 text-xs font-semibold text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              className="accent-[#C8FA50]"
              checked={settings.autoOrderSmsEnabled}
              onChange={(e) => setSettings({ ...settings, autoOrderSmsEnabled: e.target.checked })}
            />
            অর্ডার কনফার্ম হলে অটো-SMS চালু রাখুন
          </label>
        </div>

        {settings.provider === 'built_in' ? (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-400/30 flex items-start gap-2.5 text-xs text-amber-200 leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold">Built-in মোড (শুধুমাত্র প্রিভিউ লগ):</strong> এই মোডে আসল মোবাইল সিমে SMS যায় না, তাই ক্রেতারা ফরগট পাসওয়ার্ড OTP পাবেন না। লাইভ মোবাইলে অর্ডার কনফার্মেশন ও OTP পাঠাতে নিচে থেকে{' '}
              <span className="text-white font-semibold">BulkSMSBD</span>,{' '}
              <span className="text-white font-semibold">GreenWeb BD</span>,{' '}
              <span className="text-white font-semibold">Twilio</span> অথবা{' '}
              <span className="text-white font-semibold">Webhook</span> বেছে নিয়ে আপনার API Key সংরক্ষণ করুন।
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-400/30 flex items-start gap-2.5 text-xs text-emerald-200 leading-relaxed">
            <CheckCircle2 className="w-4 h-4 text-[#C8FA50] shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold">লাইভ SMS গেটওয়ে নির্বাচিত ({PROVIDER_LABELS[settings.provider]}):</strong>{' '}
              {settings.hasApiKey
                ? 'API Key সংরক্ষিত আছে। অর্ডার কনফার্মেশন এবং পাসওয়ার্ড রিসেট OTP সরাসরি ক্রেতার মোবাইলে পাঠানো হবে।'
                : 'দয়া করে নিচে আপনার API Key / Token দিয়ে সেটিংস সংরক্ষণ করুন, তারপর টেস্ট SMS পাঠিয়ে যাচাই করুন।'}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">SMS প্রোভাইডার / গেটওয়ে</label>
            <select
              value={settings.provider}
              onChange={(e) => setSettings({ ...settings, provider: e.target.value as SmsSettingsState['provider'] })}
              className={inputClass}
            >
              {(Object.entries(PROVIDER_LABELS) as Array<[SmsSettingsState['provider'], string]>).map(([val, label]) => (
                <option key={val} value={val} className="bg-[#0B0E17] text-white">
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Sender Name / Brand Mask</label>
            <input
              type="text"
              value={settings.senderName}
              onChange={(e) => setSettings({ ...settings, senderName: e.target.value })}
              maxLength={20}
              placeholder="Orvexa"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5">From Number / Sender ID (ঐচ্ছিক)</label>
            <input
              type="text"
              value={settings.fromNumber}
              onChange={(e) => setSettings({ ...settings, fromNumber: e.target.value })}
              placeholder="যেমন: 8809617600000"
              className={inputClass}
            />
          </div>
        </div>

        {settings.provider !== 'built_in' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 rounded-2xl bg-[#090C14] border border-white/10">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                API Key / Account SID
                {settings.hasApiKey && (
                  <span className="ml-1.5 text-[10px] text-[#C8FA50] font-mono">({settings.maskedApiKey})</span>
                )}
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={settings.hasApiKey ? 'পরিবর্তন করতে নতুন Key লিখুন' : 'API Key লিখুন'}
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                API Secret / Auth Token (প্রয়োজন হলে)
                {settings.hasApiSecret && (
                  <span className="ml-1.5 text-[10px] text-[#C8FA50] font-mono">({settings.maskedApiSecret})</span>
                )}
              </label>
              <input
                type="password"
                value={apiSecretInput}
                onChange={(e) => setApiSecretInput(e.target.value)}
                placeholder={settings.hasApiSecret ? 'পরিবর্তন করতে নতুন Secret লিখুন' : 'API Secret / Token লিখুন'}
                className={inputClass}
              />
            </div>

            {settings.provider === 'webhook' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">HTTPS SMS Webhook Endpoint</label>
                <input
                  type="url"
                  value={settings.webhookUrl}
                  onChange={(e) => setSettings({ ...settings, webhookUrl: e.target.value })}
                  placeholder="https://api.example.com/sms/send"
                  className={inputClass}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-[#C8FA50] shrink-0" />
            <span>API Key সার্ভারে এনক্রিপ্টেড ও নিরাপদভাবে সংরক্ষিত থাকে এবং ব্রাউজারে প্রকাশ করা হয় না।</span>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 rounded-full glow-lime-btn text-xs font-extrabold disabled:opacity-60"
          >
            {saving ? 'সংরক্ষণ হচ্ছে...' : 'SMS সেটিংস সংরক্ষণ করুন'}
          </button>
        </div>
      </form>

      {/* Send Test SMS */}
      <form onSubmit={handleSendTestSms} className="glass-card rounded-3xl p-6 space-y-3 border border-purple-500/25">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-purple-300" />
          <h3 className="text-sm font-bold text-white">টেস্ট SMS পাঠিয়ে যাচাই করুন</h3>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="tel"
            required
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="প্রাপকের মোবাইল নম্বর (যেমন: 017XXXXXXXX)"
            className={`flex-1 ${inputClass}`}
          />
          <button
            type="submit"
            disabled={sendingTest}
            className="inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-full glow-purple-btn text-xs font-bold disabled:opacity-60 shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            {sendingTest ? 'পাঠানো হচ্ছে...' : 'টেস্ট SMS পাঠান'}
          </button>
        </div>
      </form>

      {/* Live SMS Logs */}
      <div className="glass-card rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white">সাম্প্রতিক SMS ও OTP লগ ({toBnDigits(logs.length)}টি)</h3>
            <p className="text-xs text-slate-400">অর্ডার কনফার্মেশন ও পাসওয়ার্ড রিসেট OTP মেসেজের লাইভ ডেলিভারি রেকর্ড</p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={loadSmsData}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-200 hover:border-[#C8FA50]/45"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            রিফ্রেশ
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 rounded-2xl bg-[#090C14] border border-white/10">
            এখনো কোনো SMS লগ তৈরি হয়নি।
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
            {logs.map((log) => (
              <div key={log.id} className="p-4 rounded-2xl bg-[#090C14] border border-white/10 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#C8FA50]/15 border border-[#C8FA50]/35 text-[#C8FA50] font-bold">
                      {log.senderName}
                    </span>
                    <span className="font-mono font-bold text-white">{log.recipientPhone}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-400/30 text-purple-200 text-[11px] font-semibold">
                      {log.messageType === 'otp_reset' ? (
                        <KeyRound className="w-3 h-3" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3" />
                      )}
                      {MSG_TYPE_LABELS[log.messageType] || log.messageType}
                    </span>
                    <span className="text-[11px] text-slate-500">({log.provider})</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`px-2 py-0.5 rounded-full font-semibold ${
                        log.status === 'failed'
                          ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                          : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {log.status}
                    </span>
                    <span className="text-slate-500">{formatDateTime(log.createdAt)}</span>
                  </div>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{log.messageBody}</p>
                {log.errorDetail && (
                  <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3 py-1.5 font-mono break-all">
                    ক্যারিয়ার তথ্য: {log.errorDetail}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
