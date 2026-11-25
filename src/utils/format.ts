export function toBnDigits(value: number | string): string {
  const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(value).replace(/\d/g, (d) => bnDigits[Number(d)] ?? d);
}

export function formatPrice(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '৳0';
  return `৳${Math.round(amount).toLocaleString('en-US')}`;
}

export function getDiscountPercent(previousPrice: number | null | undefined, currentPrice: number): number | null {
  if (!previousPrice || previousPrice <= currentPrice) return null;
  return Math.round(((previousPrice - currentPrice) / previousPrice) * 100);
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'এইমাত্র';
  if (mins < 60) return `${mins} মি. আগে`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ঘ. আগে`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} দিন আগে`;
  return new Date(timestamp).toLocaleDateString('bn-BD', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('bn-BD', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ORDER_STATUS_BN: Record<string, string> = {
  Pending: 'অপেক্ষমাণ (Pending)',
  Confirmed: 'নিশ্চিতকৃত (Confirmed)',
  Processing: 'প্রক্রিয়াধীন (Processing)',
  Shipped: 'পাঠানো হয়েছে (Shipped)',
  Delivered: 'ডেলিভারি সম্পন্ন (Delivered)',
  Cancelled: 'বাতিল (Cancelled)',
};
