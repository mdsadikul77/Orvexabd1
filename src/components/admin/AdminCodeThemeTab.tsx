import React, { useEffect, useState } from 'react';
import { Code2, Palette, RotateCcw, Save, ShieldAlert, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { CustomCodeConfig } from '../../types';

const DEFAULT_CUSTOM_CODE: CustomCodeConfig = {
  enabled: true,
  customCss: '',
  customBannerHtml: '',
  headScripts: '',
  customJs: '',
};

const INPUT_CLASS =
  'w-full px-3.5 py-2.5 text-xs font-mono bg-[#080A11] border border-white/15 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]';

export function AdminCodeThemeTab() {
  const { storefront, apiFetch, refreshStorefront, showToast } = useAuth();
  const [draft, setDraft] = useState<CustomCodeConfig>(DEFAULT_CUSTOM_CODE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (storefront?.settings?.customCode) {
      setDraft({
        enabled: storefront.settings.customCode.enabled !== false,
        customCss: storefront.settings.customCode.customCss || '',
        customBannerHtml: storefront.settings.customCode.customBannerHtml || '',
        headScripts: storefront.settings.customCode.headScripts || '',
        customJs: storefront.settings.customCode.customJs || '',
      });
    }
  }, [storefront?.settings?.customCode]);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/admin/settings/customCode', {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
      await refreshStorefront();
      showToast('কাস্টম কোড, থিম এবং স্ক্রিপ্ট লাইভ হয়েছে!', 'success');
    } catch (err: any) {
      showToast(err.message || 'সংরক্ষণ করা যায়নি।', 'error');
    } finally {
      setSaving(false);
    }
  };

  const applyThemePreset = (presetCss: string, label: string) => {
    setDraft((prev) => ({
      ...prev,
      enabled: true,
      customCss: prev.customCss ? `${prev.customCss.trim()}\n\n${presetCss}` : presetCss,
    }));
    showToast(`${label} CSS প্রিসেট যুক্ত হয়েছে। সেভ করতে "সংরক্ষণ ও লাইভ করুন" চাপুন।`, 'info');
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Header & Global Enable Switch */}
      <div className="glass-card rounded-3xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#C8FA50]">
              <Code2 className="w-4 h-4" />
              <span>Live Custom Code & Theme Editor</span>
            </div>
            <h2 className="text-lg font-bold text-white">লাইভ CSS, HTML ব্যানার ও গ্লোবাল Ad Network স্ক্রিপ্ট</h2>
            <p className="text-xs text-slate-400">
              এখানে লেখা যেকোনো CSS, প্রোমো HTML ব্যানার এবং Adsterra / Google Ad Manager স্ক্রিপ্ট সাথে সাথে লাইভ সাইটে কার্যকর হবে।
            </p>
          </div>

          <label className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-bold text-white cursor-pointer">
            <input
              type="checkbox"
              className="accent-[#C8FA50] w-4 h-4"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            <span>কাস্টম কোড সক্রিয় রাখুন</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-slate-400 inline-flex items-center gap-1">
            <Palette className="w-3.5 h-3.5 text-purple-300" /> দ্রুত CSS প্রিসেট:
          </span>
          <button
            type="button"
            onClick={() =>
              applyThemePreset(
                `/* Orvexa Gold Accent Override */\n.glow-lime-btn { background: linear-gradient(135deg, #FDE047 0%, #F59E0B 100%); color: #090B10; }`,
                'Royal Gold Button'
              )
            }
            className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] font-semibold text-slate-200 hover:border-[#C8FA50]/50"
          >
            + গোল্ড বাটন থিম
          </button>
          <button
            type="button"
            onClick={() =>
              applyThemePreset(
                `/* Soft Rounded Cards */\n.glass-card { border-color: rgba(200, 250, 80, 0.16); }`,
                'Lime Border Glow'
              )
            }
            className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] font-semibold text-slate-200 hover:border-[#C8FA50]/50"
          >
            + নিওন কার্ড বর্ডার
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(DEFAULT_CUSTOM_CODE);
              showToast('ফর্ম রিসেট হয়েছে। স্থায়ী করতে সংরক্ষণ করুন চাপুন।', 'info');
            }}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/25 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20"
          >
            <RotateCcw className="w-3 h-3" /> সব রিসেট
          </button>
        </div>
      </div>

      {/* Custom CSS & Custom Banner HTML */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card rounded-3xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-bold text-white">১. Custom CSS (লাইভ ডিজাইন ও রঙ)</label>
            <span className="text-[11px] text-[#C8FA50]">Live CSS</span>
          </div>
          <p className="text-xs text-slate-400">
            ফন্ট, কার্ডের রঙ, বাটন স্টাইল বা স্পেসিং পরিবর্তন করতে CSS লিখুন।
          </p>
          <textarea
            rows={9}
            value={draft.customCss}
            onChange={(e) => setDraft({ ...draft, customCss: e.target.value })}
            placeholder={`/* উদাহরণ:\nbody { letter-spacing: 0.01em; }\n.glass-card { border-radius: 24px; }\n*/`}
            className={INPUT_CLASS}
          />
        </div>

        <div className="glass-card rounded-3xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-bold text-white">২. Custom Banner / Notice HTML (হোমপেজ)</label>
            <span className="text-[11px] text-purple-300">After Hero</span>
          </div>
          <p className="text-xs text-slate-400">
            হিরো সেকশনের নিচে কাস্টম HTML প্রোমো ব্যানার বা অফার নোটিশ দেখাতে এখানে HTML লিখুন।
          </p>
          <textarea
            rows={9}
            value={draft.customBannerHtml}
            onChange={(e) => setDraft({ ...draft, customBannerHtml: e.target.value })}
            placeholder={`<div style="text-align:center; padding:8px;">\n  <strong style="color:#C8FA50;">ঈদ স্পেশাল অফার!</strong> সারাদেশে দ্রুত ক্যাশ অন ডেলিভারি।\n</div>`}
            className={INPUT_CLASS}
          />
        </div>
      </div>

      {/* Global Head / Ad Network Scripts & Custom JS */}
      <div className="glass-card rounded-3xl p-6 space-y-5">
        <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-400/25 text-xs text-amber-200">
          <ShieldAlert className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
          <div>
            <strong>শুধুমাত্র বিশ্বস্ত কোড ব্যবহার করুন:</strong> এখানে Adsterra Social Bar, Adsterra Popunder, Google Ad
            Manager (GPT) `<code className="text-[#C8FA50]">&lt;head&gt;</code>` ট্যাগ, Google AdSense Auto-Ads অথবা Google Analytics
            স্ক্রিপ্ট বসানো যাবে। ব্যানার/নেটিভ অ্যাডের জন্য <strong>Ad Management</strong> ট্যাব ব্যবহার করা আরও ভালো।
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-2.5">
            <label className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#C8FA50]" />
              ৩. Global Head & Ad Network Scripts (Adsterra / GAM / AdSense)
            </label>
            <p className="text-xs text-slate-400">
              সরাসরি &lt;script src="..."&gt;&lt;/script&gt; ট্যাগ বা গ্লোবাল হেড স্ক্রিপ্ট এখানে পেস্ট করুন।
            </p>
            <textarea
              rows={7}
              value={draft.headScripts}
              onChange={(e) => setDraft({ ...draft, headScripts: e.target.value })}
              placeholder={`<!-- উদাহরণ: Adsterra Social Bar বা Google Tag -->\n<script type="text/javascript" src="https://..."></script>`}
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-2.5">
            <label className="text-sm font-bold text-white">৪. Custom Storefront JavaScript</label>
            <p className="text-xs text-slate-400">
              স্টোরফ্রন্টের অতিরিক্ত ইন্টারঅ্যাক্টিভিটি বা বডি স্ক্রিপ্টের জন্য জাভাস্ক্রিপ্ট লিখুন।
            </p>
            <textarea
              rows={7}
              value={draft.customJs}
              onChange={(e) => setDraft({ ...draft, customJs: e.target.value })}
              placeholder={`// console.log('Orvexa storefront active');`}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full glow-lime-btn text-xs sm:text-sm font-extrabold disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {saving ? 'সংরক্ষণ হচ্ছে...' : 'কোড ও থিম সংরক্ষণ ও লাইভ করুন'}
          </button>
        </div>
      </div>
    </form>
  );
}
