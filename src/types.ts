export type UserRole = 'buyer' | 'seller' | 'admin';

export interface User {
  id: string;
  fullName: string;
  username: string;
  emailOrPhone: string;
  role: UserRole;
  shopName: string | null;
  shopDescription: string | null;
  avatarUrl: string | null;
  status: 'active' | 'blocked' | 'suspended';
  createdAt: number;
}

export interface PublicSellerStats {
  totalProducts: number;
  totalViews: number;
  avgRating: number;
  totalReviews: number;
  deliveredOrders: number;
}

export interface PublicSellerProfile {
  id: string;
  username: string;
  fullName: string;
  shopName: string;
  shopDescription: string | null;
  avatarUrl: string | null;
  createdAt: number;
  stats: PublicSellerStats;
}

export interface SubcategoryItem {
  nameEn: string;
  nameBn: string;
}

export interface Category {
  id: string;
  nameEn: string;
  nameBn: string;
  slug: string;
  imageUrl: string;
  subcategories: SubcategoryItem[];
  sortOrder: number;
}

export interface ProductVariations {
  sizes?: string[];
  colors?: string[];
}

export interface Product {
  id: string;
  slug: string;
  sellerId: string;
  shopName: string;
  name: string;
  description: string;
  categoryId: string;
  categoryNameEn?: string;
  categoryNameBn?: string;
  subcategory: string;
  previousPrice: number | null;
  currentPrice: number;
  stock: number;
  images: string[];
  variations: ProductVariations;
  isFeatured: boolean;
  isTrending: boolean;
  isRecommended: boolean;
  isHidden: boolean;
  views: number;
  ratingAvg: number;
  ratingCount: number;
  createdAt: number;
  sellerFullName?: string;
  sellerUsername?: string;
  sellerShopDescription?: string;
  sellerAvatarUrl?: string;
  hasPromoCode?: boolean;
  promoCode?: string | null;
  promoDiscount?: number;
  promoFontStyle?: string | null;
}

export interface Review {
  id: string;
  productId: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: number;
}

export interface CartItem {
  id: string;
  productId: string;
  quantity: number;
  selectedVariation: string | null;
  name: string;
  currentPrice: number;
  previousPrice: number | null;
  stock: number;
  images: string[];
  shopName: string;
  sellerId: string;
  isHidden?: boolean;
  hasPromoCode?: boolean;
  appliedPromoCode?: string | null;
  promoDiscount?: number;
  effectivePrice?: number;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  sellerId: string;
  productName: string;
  productImage: string;
  shopName: string;
  price: number;
  quantity: number;
  variation: string | null;
  itemStatus: string;
  appliedPromoCode?: string | null;
  promoDiscount?: number;
}

export type OrderStatus = 'Pending' | 'Confirmed' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled';

export interface PhoneOrderStats {
  normalizedPhone: string;
  confirmedCount: number;
  cancelledCount: number;
  pendingCount: number;
  totalCount: number;
  isFirstTimeBuyer: boolean;
}

export interface Order {
  id: string;
  orderNumber: string;
  buyerId: string;
  buyerUsername?: string;
  buyerFullName?: string;
  customerName: string;
  customerPhone: string;
  backupPhone?: string | null;
  district?: string | null;
  thana?: string | null;
  deliveryAddress: string;
  paymentMethod: string;
  subtotal: number;
  sellerSubtotal?: number;
  sellerItemCount?: number;
  isMultiVendorOrder?: boolean;
  deliveryFee: number;
  totalAmount: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  items: OrderItem[];
  phoneStats?: PhoneOrderStats;
}

export interface SmsLogItem {
  id: string;
  recipientPhone: string;
  senderName: string;
  messageType: 'otp_reset' | 'order_confirmation' | 'test' | string;
  messageBody: string;
  provider: string;
  status: string;
  referenceId?: string | null;
  errorDetail?: string | null;
  createdAt: number;
}

export interface Conversation {
  id: string;
  buyerId: string;
  sellerId: string;
  productId: string | null;
  productName: string | null;
  productImage: string | null;
  productPrice: number | null;
  lastMessage: string;
  lastMessageAt: number;
  buyerUnread: number;
  sellerUnread: number;
  buyerName?: string;
  buyerUsername?: string;
  buyerAvatar?: string;
  sellerName?: string;
  sellerShopName?: string;
  sellerUsername?: string;
  sellerAvatar?: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: number;
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  isRead: number;
  createdAt: number;
}

export interface HomepageProductAd {
  adId: string;
  promoText: string | null;
  customImageUrl: string | null;
  sortOrder: number;
  expiresAt: number | null;
  product: Product;
}

export interface Advertisement {
  id: string;
  title: string;
  placement: 'homepage_top' | 'homepage_middle' | 'homepage_bottom' | 'category_page' | 'product_page' | 'sidebar' | 'other';
  adType: 'image' | 'banner' | 'html' | 'js';
  imageUrl: string | null;
  targetUrl: string | null;
  htmlCode: string | null;
  jsCode: string | null;
  isActive: number;
  createdAt: number;
}

export interface HeroBanner {
  id: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaTarget: string;
  imageUrl: string;
  isActive: boolean;
}

export interface SellerProductAdsPageConfig {
  bannerTitle: string;
  bannerSubtitle: string;
  bannerImageUrl: string;
  description: string;
  benefits: string[];
  howItWorks: string[];
  contactHeading: string;
  whatsappNumbers: string[];
  ctaText: string;
}

export interface PaymentOptionsConfig {
  cashOnDelivery: boolean;
  bkashEnabled: boolean;
  bkashNumber?: string;
  nagadEnabled: boolean;
  nagadNumber?: string;
  deliveryFee: number;
  dhakaDeliveryFee?: number;
  outsideDhakaDeliveryFee?: number;
  freeDeliveryThreshold: number;
}

export interface CustomCodeConfig {
  enabled: boolean;
  customCss: string;
  customBannerHtml: string;
  headScripts: string;
  customJs: string;
}

export interface CustomPage {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  content: string;
  htmlContent?: string;
  showInNavbar: boolean;
  showInFooter: boolean;
  isActive: boolean;
  createdAt: number;
}

export interface CustomBlockItem {
  title: string;
  description: string;
  badge?: string;
}

export interface CustomBlock {
  id: string;
  title: string;
  subtitle?: string;
  blockType: 'feature_cards' | 'promo_banner' | 'faq' | 'custom_html';
  placement: 'after_hero' | 'after_categories' | 'after_products' | 'before_footer';
  content: string;
  ctaLabel?: string;
  ctaUrl?: string;
  items?: CustomBlockItem[];
  isActive: boolean;
  sortOrder: number;
}

export interface SiteSettings {
  heroBanners: HeroBanner[];
  productAdsSection: {
    enabled: boolean;
    heading: string;
    subheading: string;
  };
  sellerProductAdsPage: SellerProductAdsPageConfig;
  paymentOptions: PaymentOptionsConfig;
  contactInfo: {
    email: string;
    phone: string;
    whatsapp: string;
    address: string;
  };
  footerSettings: {
    aboutText: string;
    copyrightText: string;
  };
  generalSettings: {
    siteName: string;
    announcementText: string;
    announcementActive: boolean;
  };
  customCode?: CustomCodeConfig;
  customPages?: CustomPage[];
  customBlocks?: CustomBlock[];
}

export interface ReportItem {
  id: string;
  reporterId: string | null;
  reporterName: string;
  reportType: 'customer_message' | 'seller_report' | 'product_report';
  targetId: string | null;
  targetName: string | null;
  subject: string;
  message: string;
  status: 'Open' | 'Resolved' | 'Dismissed';
  createdAt: number;
}
