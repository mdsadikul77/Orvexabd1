import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageSquare, Send, Sparkles } from 'lucide-react';
import { SafeImage } from '../components/SafeImage';
import { useAuth } from '../context/AuthContext';
import type { ChatMessage, Conversation } from '../types';
import { formatDateTime, formatPrice, formatTimeAgo } from '../utils/format';

interface InboxPageProps {
  initialConversationId?: string | null;
  onOpenProductById: (productId: string) => void;
}

export function InboxPage({ initialConversationId = null, onOpenProductById }: InboxPageProps) {
  const { user, token, conversations, apiFetch, refreshUserData, subscribeWsMessage, openAuthModal, showToast } =
    useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialConversationId) setSelectedId(initialConversationId);
  }, [initialConversationId]);

  useEffect(() => {
    if (!selectedId && conversations.length > 0 && window.innerWidth >= 768) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, selectedId]);

  useEffect(() => {
    if (!token || !selectedId) {
      setMessages([]);
      return;
    }
    let active = true;
    const load = async () => {
      setLoadingMsgs(true);
      try {
        const res = await apiFetch<{ messages: ChatMessage[] }>(`/api/conversations/${selectedId}/messages`);
        if (active) {
          setMessages(res.messages || []);
          refreshUserData();
        }
      } catch {
        if (active) setMessages([]);
      } finally {
        if (active) setLoadingMsgs(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [selectedId, token, apiFetch, refreshUserData]);

  // Real-time incoming WebSocket messages
  useEffect(() => {
    return subscribeWsMessage((evt) => {
      if (evt.type === 'message:new' && evt.conversationId === selectedId && evt.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === evt.message!.id)) return prev;
          return [...prev, evt.message!];
        });
      }
    });
  }, [selectedId, subscribeWsMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (!user) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-5">
        <div className="w-16 h-16 mx-auto rounded-full bg-purple-500/15 border border-purple-400/30 flex items-center justify-center">
          <MessageSquare className="w-8 h-8 text-[#C8FA50]" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-white">ইনবক্স দেখতে সাইন ইন করুন</h2>
        <p className="text-sm text-slate-400">ক্রেতা ও বিক্রেতার সাথে সরাসরি কথা বলতে লগইন করুন।</p>
        <button
          type="button"
          onClick={() => openAuthModal('ইনবক্স ব্যবহার করতে অনুগ্রহ করে সাইন ইন করুন।')}
          className="px-7 py-3 rounded-full glow-lime-btn text-sm font-bold transition-all"
        >
          সাইন ইন / সাইন আপ
        </button>
      </div>
    );
  }

  const activeConv: Conversation | undefined = conversations.find((c) => c.id === selectedId);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    const textToSend = draft.trim();
    setDraft('');
    try {
      const res = await apiFetch<{ message: ChatMessage }>(`/api/conversations/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text: textToSend }),
      });
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      refreshUserData();
    } catch (err: any) {
      setDraft(textToSend);
      showToast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="glass-card rounded-3xl overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[540px] max-h-[78vh] shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
        {/* Left: Conversation List */}
        <div
          className={`md:col-span-4 border-b md:border-b-0 md:border-r border-white/10 flex flex-col overflow-hidden bg-[#0A0D16]/85 ${
            selectedId ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <h1 className="text-base font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#C8FA50]" />
              মেসেজ ইনবক্স ({conversations.length})
            </h1>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/5">
            {conversations.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 leading-relaxed">
                এখনো কোনো কথোপকথন শুরু হয়নি। পণ্যের বিস্তারিত পেজ থেকে "Inbox Seller" বাটনে ক্লিক করে মেসেজ পাঠান।
              </div>
            ) : (
              conversations.map((conv) => {
                const isBuyer = conv.buyerId === user.id;
                const partnerName = isBuyer
                  ? conv.sellerShopName || conv.sellerName || 'Seller'
                  : conv.buyerName || 'Buyer';
                const unread = isBuyer ? conv.buyerUnread : conv.sellerUnread;
                const isSelected = conv.id === selectedId;

                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => setSelectedId(conv.id)}
                    className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors ${
                      isSelected
                        ? 'bg-purple-500/15 border-r-2 border-[#C8FA50]'
                        : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full neon-ring-purple p-[2px] shrink-0">
                      <div className="w-full h-full rounded-full bg-[#090B11] text-[#C8FA50] font-bold text-sm flex items-center justify-center">
                        {partnerName.charAt(0).toUpperCase()}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-white truncate">{partnerName}</span>
                        <span className="text-[11px] text-slate-500 shrink-0">
                          {formatTimeAgo(conv.lastMessageAt)}
                        </span>
                      </div>
                      {conv.productName && (
                        <div className="text-[11px] text-[#C8FA50] font-medium truncate mt-0.5">
                          পণ্য: {conv.productName}
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <p className="text-xs text-slate-400 truncate">
                          {conv.lastMessage || 'কথোপকথন শুরু করুন...'}
                        </p>
                        {unread > 0 && (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#C8FA50] text-[#090B10] text-[10px] font-extrabold flex items-center justify-center tabular-nums">
                            {unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Active Chat Thread */}
        <div className={`md:col-span-8 flex flex-col overflow-hidden bg-[#07090F] ${selectedId ? 'flex' : 'hidden md:flex'}`}>
          {!activeConv ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
              <MessageSquare className="w-10 h-10 mb-3 text-purple-400/60" />
              <p className="text-sm text-slate-400">বাম পাশ থেকে একটি কথোপকথন নির্বাচন করুন</p>
            </div>
          ) : (
            <>
              {/* Chat Header with Product Reference */}
              <div className="px-4 sm:px-6 py-3.5 border-b border-white/10 flex items-center justify-between gap-3 bg-[#0C0F19]">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="md:hidden p-1.5 rounded-lg text-slate-300 hover:bg-white/10"
                    aria-label="তালিকায় ফিরুন"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white truncate">
                      {activeConv.buyerId === user.id
                        ? activeConv.sellerShopName || activeConv.sellerName
                        : activeConv.buyerName}
                    </div>
                    <div className="text-[11px] text-purple-300">
                      {activeConv.buyerId === user.id ? 'Seller' : 'Buyer'}
                    </div>
                  </div>
                </div>

                {activeConv.productId && activeConv.productName && (
                  <button
                    type="button"
                    onClick={() => onOpenProductById(activeConv.productId!)}
                    className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/15 hover:border-[#C8FA50]/50 transition-colors max-w-[230px] shrink-0"
                  >
                    {activeConv.productImage && (
                      <SafeImage
                        src={activeConv.productImage}
                        alt={activeConv.productName}
                        className="w-8 h-8 rounded-lg object-cover shrink-0"
                      />
                    )}
                    <div className="min-w-0 text-left">
                      <div className="text-[11px] font-semibold text-white truncate">{activeConv.productName}</div>
                      {activeConv.productPrice && (
                        <div className="text-[11px] font-bold text-[#C8FA50] tabular-nums">
                          {formatPrice(activeConv.productPrice)}
                        </div>
                      )}
                    </div>
                  </button>
                )}
              </div>

              {/* Messages Body */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 bg-[#06080E]">
                {loadingMsgs ? (
                  <div className="text-center text-xs text-slate-400 py-8">মেসেজ লোড হচ্ছে...</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-xs text-slate-400 py-8">
                    প্রথম মেসেজ পাঠিয়ে কথা শুরু করুন।
                  </div>
                ) : (
                  messages.map((m) => {
                    const isMine = m.senderId === user.id;
                    return (
                      <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                        <div
                          className={`max-w-[82%] sm:max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                            isMine
                              ? 'bg-[#C8FA50] text-[#090B10] font-medium rounded-br-sm shadow-[0_8px_20px_rgba(200,250,80,0.18)]'
                              : 'bg-[#121624] border border-white/10 text-slate-100 rounded-bl-sm'
                          }`}
                        >
                          {m.text}
                        </div>
                        <span className="text-[10px] text-slate-500 mt-1 px-1">
                          {formatDateTime(m.createdAt)}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {/* Send Message Bar */}
              <form onSubmit={handleSend} className="p-3 sm:p-4 border-t border-white/10 bg-[#0C0F19] flex gap-2.5">
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="আপনার বার্তা লিখুন..."
                  className="flex-1 px-4 py-2.5 text-sm bg-[#080A11] border border-white/15 rounded-full text-white placeholder-slate-500 focus:outline-none focus:border-[#C8FA50]"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full glow-lime-btn disabled:opacity-50 text-sm font-bold transition-all"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">পাঠান</span>
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
