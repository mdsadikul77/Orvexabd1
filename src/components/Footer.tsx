import React, { useState } from 'react';
import { Mail, MapPin, MessageCircle, Phone, Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { orvexaFetch, safeParseJson, toFriendlyFetchError } from '../lib/apiConfig';
import type { AppView } from './Navbar';

interface FooterProps {
  onNavigate: (view: AppView) => void;
  onOpenCustomPage?: (slug: string) => void;
}

export function Footer({ onNavigate, onOpenCustomPage }: FooterProps) {
  const { storefront, showToast, user, token } = useAuth();
  const [supportOpen, setSupportOpen] = useState(false);
  const [reporterName, setReporterName] = useState(user?.fullName || '');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const footer = storefront?.settings?.footerSettings;
  const contact = storefront?.settings?.contactInfo;

  const handleSubmitContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await orvexaFetch(
        '/api/reports',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            reporterName: user?.fullName || reporterName,
            reportType: 'customer_message',
            subject,
            message,
          }),
        },
        { retryOnNetworkError: true }
      );
      const data = await safeParseJson(res);
      if (!res.ok) throw new Error(data.error || 'পাঠানো যায়নি।');
      showToast(data.message, 'success');
      setSubject('');
      setMessage('');
      setSupportOpen(false);
    } catch (err: any) {
      showToast(await toFriendlyFetchError(err, 'বার্তা পাঠানো যায়নি।'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <footer className="bg-[#07090F] text-slate-300 border-t border-white/10 mt-16 pb-20 lg:pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 text-lg font-bold">
            <img
              src="/assets/aistudio/file_000000006e008208abb53399401b7236_1c57ca49.png"
              alt="Orvexa Logo"
              className="w-9 h-9 rounded-full object-cover ring-1 ring-purple-400/50 shadow-[0_0_14px_rgba(168,85,247,0.35)] shrink-0"
            />
            <span className="text-[#D9FF5B]">Orvexa</span>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">
            {footer?.aboutText ||
              'Orvexa হলো বাংলাদেশের আধুনিক মাল্টি-ভেন্ডর ই-কমার্স মার্কেটপ্লেস, যেখানে ক্রেতা ও বিক্রেতারা সরাসরি যুক্ত হয়ে নিরাপদ ও দ্রুত কেনাকাটা করতে পারেন।'}
          </p>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white">দ্রুত নেভিগেশন</h4>
          <ul className="space-y-2 text-sm text-slate-400">
            <li>
              <button type="button" onClick={() => onNavigate('home')} className="hover:text-[#C8FA50] transition-colors">
                হোমপেজ (Home)
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onNavigate('categories')} className="hover:text-[#C8FA50] transition-colors">
                সব ক্যাটাগরি (Categories)
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onNavigate('search')} className="hover:text-[#C8FA50] transition-colors">
                পণ্য খুঁজুন (Search)
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onNavigate('profile')} className="hover:text-[#C8FA50] transition-colors">
                আমার অ্যাকাউন্ট (Profile)
              </button>
            </li>
            {onOpenCustomPage &&
              (storefront?.settings?.customPages || [])
                .filter((p) => p.isActive && p.showInFooter)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onOpenCustomPage(p.slug)}
                      className="hover:text-[#C8FA50] transition-colors text-left"
                    >
                      {p.title}
                    </button>
                  </li>
                ))}
          </ul>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white">যোগাযোগ ও সহায়তা</h4>
          <div className="space-y-2 text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-[#C8FA50]" />
              <span>{contact?.phone || '01622922252'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-[#C084FC]" />
              <span>{contact?.email || 'support@orvexa.com'}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#C8FA50]" />
              <span>{contact?.address || 'ঢাকা, বাংলাদেশ'}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSupportOpen((v) => !v)}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-full glow-purple-btn text-xs font-medium transition-colors"
          >
            <MessageCircle className="w-4 h-4 text-[#C084FC]" />
            অ্যাডমিনকে বার্তা বা অভিযোগ পাঠান
          </button>
        </div>
      </div>

      {supportOpen && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-8">
          <form
            onSubmit={handleSubmitContact}
            className="glass-card rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            {!user && (
              <input
                type="text"
                required
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                placeholder="আপনার নাম"
                className="px-3.5 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
              />
            )}
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="বিষয় (যেমন: অর্ডার সহায়তা / পরামর্শ)"
              className="px-3.5 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
            />
            <div className="flex gap-2 md:col-span-2">
              <input
                type="text"
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="আপনার বিস্তারিত বার্তা লিখুন..."
                className="flex-1 px-3.5 py-2 text-sm bg-[#080A11] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-[#C8FA50]"
              />
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl glow-lime-btn text-xs font-bold whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                পাঠান
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="border-t border-white/10 py-5 px-4 sm:px-6 text-center text-xs text-slate-500">
        {footer?.copyrightText || '© ২০২৬ Orvexa. সর্বস্বত্ব সংরক্ষিত।'}
      </div>
    </footer>
  );
}
