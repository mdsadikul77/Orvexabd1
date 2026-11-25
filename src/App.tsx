import React, { useEffect, useState } from 'react';
import { AuthModal } from './components/AuthModal';
import { CustomCodeManager } from './components/CustomCodeManager';
import { Footer } from './components/Footer';
import { Navbar, type AppView } from './components/Navbar';
import { ShareModal } from './components/ShareModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { CartAndCheckoutPage } from './pages/CartAndCheckoutPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CustomPageView } from './pages/CustomPageView';
import { FavoritesPage } from './pages/FavoritesPage';
import { HomePage } from './pages/HomePage';
import { InboxPage } from './pages/InboxPage';
import { ProductDetailsPage } from './pages/ProductDetailsPage';
import { ProfilePage } from './pages/ProfilePage';
import { SellerDashboardPage } from './pages/SellerDashboardPage';
import { SellerProductAdsPage } from './pages/SellerProductAdsPage';
import { SellerProfilePage } from './pages/SellerProfilePage';
import type { Category, Product } from './types';

function ToastContainer() {
  const { toasts } = useAuth();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-6 left-4 right-4 sm:left-auto sm:right-4 z-50 flex flex-col gap-2 max-w-sm sm:w-full pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto px-4 py-3 rounded-2xl shadow-2xl border text-xs font-semibold backdrop-blur-md transition-all ${
            t.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/45 text-rose-200'
              : t.type === 'info'
                ? 'bg-[#121624]/95 border-purple-400/40 text-slate-100'
                : 'bg-[#111912]/95 border-[#C8FA50]/45 text-[#C8FA50]'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

interface NavSnapshot {
  __orvexa: true;
  index: number;
  view: AppView;
  selectedProductId: string | null;
  selectedSellerIdentifier: string | null;
  selectedCustomSlug: string | null;
  selectedCategory: Category | null;
  activeConvId: string | null;
  scrollY?: number;
}

function parseInitialPath(): Omit<NavSnapshot, '__orvexa' | 'index' | 'scrollY'> {
  const pathname = window.location.pathname;
  const prodMatch = pathname.match(/^\/product\/([^/]+)$/);
  if (prodMatch) {
    return {
      view: 'product',
      selectedProductId: decodeURIComponent(prodMatch[1]),
      selectedSellerIdentifier: null,
      selectedCustomSlug: null,
      selectedCategory: null,
      activeConvId: null,
    };
  }
  const sellerMatch = pathname.match(/^\/(?:seller|shop)\/([^/]+)$/);
  if (sellerMatch) {
    return {
      view: 'seller-profile',
      selectedProductId: null,
      selectedSellerIdentifier: decodeURIComponent(sellerMatch[1]),
      selectedCustomSlug: null,
      selectedCategory: null,
      activeConvId: null,
    };
  }
  const querySeller = new URLSearchParams(window.location.search).get('seller');
  if (querySeller && querySeller.trim()) {
    return {
      view: 'seller-profile',
      selectedProductId: null,
      selectedSellerIdentifier: querySeller.trim(),
      selectedCustomSlug: null,
      selectedCategory: null,
      activeConvId: null,
    };
  }
  const pageMatch = pathname.match(/^\/page\/([^/]+)$/);
  if (pageMatch) {
    return {
      view: 'page',
      selectedProductId: null,
      selectedSellerIdentifier: null,
      selectedCustomSlug: decodeURIComponent(pageMatch[1]),
      selectedCategory: null,
      activeConvId: null,
    };
  }
  return {
    view: 'home',
    selectedProductId: null,
    selectedSellerIdentifier: null,
    selectedCustomSlug: null,
    selectedCategory: null,
    activeConvId: null,
  };
}

function MarketplaceShell() {
  const initialRoute = React.useMemo(() => parseInitialPath(), []);
  const [view, setView] = useState<AppView>(initialRoute.view);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(initialRoute.selectedProductId);
  const [selectedSellerIdentifier, setSelectedSellerIdentifier] = useState<string | null>(
    initialRoute.selectedSellerIdentifier
  );
  const [selectedCustomSlug, setSelectedCustomSlug] = useState<string | null>(initialRoute.selectedCustomSlug);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(initialRoute.selectedCategory);
  const [activeConvId, setActiveConvId] = useState<string | null>(initialRoute.activeConvId);
  const [categoriesMounted, setCategoriesMounted] = useState(initialRoute.view === 'categories');
  const [shareProduct, setShareProduct] = useState<Product | null>(null);
  const [searchFocusCount, setSearchFocusCount] = useState(0);
  const [sellerNavTarget, setSellerNavTarget] = useState<{
    tab: 'overview' | 'products' | 'add' | 'orders';
    orderId?: string | null;
    key: number;
  } | null>(null);

  const currentNavRef = React.useRef<NavSnapshot>({
    __orvexa: true,
    index: 0,
    ...initialRoute,
    scrollY: 0,
  });
  const pendingScrollRestoreRef = React.useRef<number | null>(null);

  useEffect(() => {
    if (view === 'categories') {
      setCategoriesMounted(true);
    }
  }, [view]);

  const applySnapshotState = React.useCallback((snap: Omit<NavSnapshot, '__orvexa' | 'index' | 'scrollY'>, index: number) => {
    currentNavRef.current = { __orvexa: true, index, ...snap };
    setView(snap.view);
    setSelectedProductId(snap.selectedProductId);
    setSelectedSellerIdentifier(snap.selectedSellerIdentifier);
    setSelectedCustomSlug(snap.selectedCustomSlug);
    setSelectedCategory(snap.selectedCategory);
    setActiveConvId(snap.activeConvId);
  }, []);

  // Manage browser scrollRestoration manually & handle browser/phone Back-Forward (popstate)
  useEffect(() => {
    const prevScrollRestoration =
      'scrollRestoration' in window.history ? window.history.scrollRestoration : undefined;
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }

    const existingState = window.history.state as Partial<NavSnapshot> | null;
    if (!existingState || !existingState.__orvexa) {
      window.history.replaceState(currentNavRef.current, '', window.location.pathname + window.location.search);
    } else {
      currentNavRef.current = {
        __orvexa: true,
        index: typeof existingState.index === 'number' ? existingState.index : 0,
        view: existingState.view || initialRoute.view,
        selectedProductId: existingState.selectedProductId ?? initialRoute.selectedProductId,
        selectedSellerIdentifier: existingState.selectedSellerIdentifier ?? initialRoute.selectedSellerIdentifier,
        selectedCustomSlug: existingState.selectedCustomSlug ?? initialRoute.selectedCustomSlug,
        selectedCategory: existingState.selectedCategory ?? null,
        activeConvId: existingState.activeConvId ?? null,
        scrollY: typeof existingState.scrollY === 'number' ? existingState.scrollY : 0,
      };
      applySnapshotState(currentNavRef.current, currentNavRef.current.index);
    }

    const onPopState = (event: PopStateEvent) => {
      const state = event.state as Partial<NavSnapshot> | null;
      if (state && state.__orvexa && state.view) {
        const savedY = typeof state.scrollY === 'number' ? state.scrollY : 0;
        pendingScrollRestoreRef.current = savedY;
        applySnapshotState(
          {
            view: state.view,
            selectedProductId: state.selectedProductId ?? null,
            selectedSellerIdentifier: state.selectedSellerIdentifier ?? null,
            selectedCustomSlug: state.selectedCustomSlug ?? null,
            selectedCategory: state.selectedCategory ?? null,
            activeConvId: state.activeConvId ?? null,
          },
          typeof state.index === 'number' ? state.index : 0
        );
        return;
      }

      const parsed = parseInitialPath();
      pendingScrollRestoreRef.current = typeof state?.scrollY === 'number' ? state.scrollY : 0;
      applySnapshotState(parsed, 0);
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (prevScrollRestoration && 'scrollRestoration' in window.history) {
        window.history.scrollRestoration = prevScrollRestoration;
      }
    };
  }, [applySnapshotState, initialRoute]);

  // Restore exact scroll position after Back navigation renders the previous view
  useEffect(() => {
    const targetY = pendingScrollRestoreRef.current;
    if (targetY === null) return;
    pendingScrollRestoreRef.current = null;

    if (targetY <= 0) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const cancelOnUserScroll = () => {
      cancelled = true;
    };
    window.addEventListener('wheel', cancelOnUserScroll, { passive: true, once: true });
    window.addEventListener('touchstart', cancelOnUserScroll, { passive: true, once: true });

    const tryScroll = () => {
      if (cancelled) return;
      window.scrollTo({ top: targetY, behavior: 'auto' });
      const maxReachable = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      attempts += 1;
      if (maxReachable + 20 < targetY && attempts < 20) {
        setTimeout(() => {
          if (!cancelled) requestAnimationFrame(tryScroll);
        }, 50);
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(tryScroll);
    });

    return () => {
      cancelled = true;
      window.removeEventListener('wheel', cancelOnUserScroll);
      window.removeEventListener('touchstart', cancelOnUserScroll);
    };
  }, [view, selectedProductId, selectedSellerIdentifier, selectedCustomSlug, selectedCategory]);

  const pushHistoryView = React.useCallback(
    (
      next: Omit<NavSnapshot, '__orvexa' | 'index' | 'scrollY'>,
      urlPath: string,
      scrollBehavior: 'top-instant' | 'top-smooth' | 'none' = 'top-instant'
    ) => {
      const savedScrollY = window.scrollY;
      const updatedCurrent: NavSnapshot = {
        ...currentNavRef.current,
        scrollY: savedScrollY,
      };
      window.history.replaceState(updatedCurrent, '', window.location.pathname + window.location.search);

      const nextIndex = currentNavRef.current.index + 1;
      const nextSnapshot: NavSnapshot = {
        __orvexa: true,
        index: nextIndex,
        ...next,
        scrollY: 0,
      };
      pendingScrollRestoreRef.current = null;
      applySnapshotState(next, nextIndex);
      window.history.pushState(nextSnapshot, '', urlPath);

      if (scrollBehavior === 'top-instant') {
        window.scrollTo({ top: 0, behavior: 'auto' });
      } else if (scrollBehavior === 'top-smooth') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [applySnapshotState]
  );

  const goBack = React.useCallback(
    (fallbackView: AppView = 'home') => {
      if (currentNavRef.current.index > 0 && window.history.length > 1) {
        window.history.back();
        return;
      }
      pushHistoryView(
        {
          view: fallbackView,
          selectedProductId: null,
          selectedSellerIdentifier: null,
          selectedCustomSlug: null,
          selectedCategory: null,
          activeConvId: null,
        },
        '/',
        'top-smooth'
      );
    },
    [pushHistoryView]
  );

  const navigate = (nextView: AppView) => {
    if (nextView === 'search') {
      if (view !== 'home') {
        pushHistoryView(
          {
            view: 'home',
            selectedProductId: null,
            selectedSellerIdentifier: null,
            selectedCustomSlug: null,
            selectedCategory: null,
            activeConvId: null,
          },
          '/',
          'none'
        );
      }
      setSearchFocusCount((c) => c + 1);
      return;
    }

    if (nextView === view && window.location.pathname === '/') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    pushHistoryView(
      {
        view: nextView,
        selectedProductId: null,
        selectedSellerIdentifier: null,
        selectedCustomSlug: null,
        selectedCategory: nextView === 'categories' ? selectedCategory : null,
        activeConvId: nextView === 'inbox' ? activeConvId : null,
      },
      '/',
      'top-smooth'
    );
  };

  const openProduct = (product: Product) => {
    pushHistoryView(
      {
        view: 'product',
        selectedProductId: product.id,
        selectedSellerIdentifier,
        selectedCustomSlug,
        selectedCategory,
        activeConvId,
      },
      `/product/${encodeURIComponent(product.id)}`,
      'top-instant'
    );
  };

  const openProductById = (productId: string) => {
    pushHistoryView(
      {
        view: 'product',
        selectedProductId: productId,
        selectedSellerIdentifier,
        selectedCustomSlug,
        selectedCategory,
        activeConvId,
      },
      `/product/${encodeURIComponent(productId)}`,
      'top-instant'
    );
  };

  const openSellerProfile = (sellerIdentifier: string) => {
    const clean = sellerIdentifier.trim().replace(/^@+/, '');
    if (!clean) return;
    pushHistoryView(
      {
        view: 'seller-profile',
        selectedProductId: null,
        selectedSellerIdentifier: clean,
        selectedCustomSlug,
        selectedCategory,
        activeConvId,
      },
      `/seller/${encodeURIComponent(clean)}`,
      'top-instant'
    );
  };

  const openCustomPage = (slug: string) => {
    pushHistoryView(
      {
        view: 'page',
        selectedProductId: null,
        selectedSellerIdentifier: null,
        selectedCustomSlug: slug,
        selectedCategory,
        activeConvId,
      },
      `/page/${encodeURIComponent(slug)}`,
      'top-instant'
    );
  };

  const openSellerOrders = (orderId?: string) => {
    setSellerNavTarget({ tab: 'orders', orderId: orderId || null, key: Date.now() });
    navigate('seller');
  };

  return (
    <div className="min-h-screen flex flex-col orvexa-bg-ambient bg-[#06070B] text-slate-100 pb-20 lg:pb-0">
      <CustomCodeManager />
      <Navbar
        activeView={view}
        activeCustomSlug={selectedCustomSlug}
        onNavigate={navigate}
        onOpenCustomPage={openCustomPage}
        onOpenSellerOrders={openSellerOrders}
      />

      <main className="flex-1">
        {/* Keep HomePage mounted so filters, fetched products, and exact scroll position survive Back navigation */}
        <div className={view === 'home' ? '' : 'hidden'} aria-hidden={view !== 'home'}>
          <HomePage
            searchFocusCount={searchFocusCount}
            isActive={view === 'home'}
            onOpenProduct={openProduct}
            onShareProduct={(p) => setShareProduct(p)}
            onOpenSeller={openSellerProfile}
            onSelectCategory={(cat) => {
              pushHistoryView(
                {
                  view: 'categories',
                  selectedProductId: null,
                  selectedSellerIdentifier: null,
                  selectedCustomSlug: null,
                  selectedCategory: cat,
                  activeConvId: null,
                },
                '/',
                'top-smooth'
              );
            }}
            onGoCategories={() => navigate('categories')}
            onOpenCustomPage={openCustomPage}
          />
        </div>

        {categoriesMounted && (
          <div className={view === 'categories' ? '' : 'hidden'} aria-hidden={view !== 'categories'}>
            <CategoriesPage
              initialCategory={selectedCategory}
              onOpenProduct={openProduct}
              onShareProduct={(p) => setShareProduct(p)}
              onOpenSeller={openSellerProfile}
            />
          </div>
        )}

        {view === 'product' && selectedProductId && (
          <ProductDetailsPage
            productId={selectedProductId}
            onBack={() => goBack('home')}
            onShareProduct={(p) => setShareProduct(p)}
            onOpenSeller={openSellerProfile}
            onOpenInboxConversation={(convId) => {
              pushHistoryView(
                {
                  view: 'inbox',
                  selectedProductId: null,
                  selectedSellerIdentifier: null,
                  selectedCustomSlug: null,
                  selectedCategory,
                  activeConvId: convId,
                },
                '/',
                'top-instant'
              );
            }}
            onGoToCartCheckout={() => navigate('cart')}
          />
        )}

        {view === 'cart' && (
          <CartAndCheckoutPage
            onBrowseProducts={() => navigate('home')}
            onOrderComplete={() => navigate('profile')}
          />
        )}

        {view === 'favorites' && (
          <FavoritesPage
            onOpenProduct={openProduct}
            onShareProduct={(p) => setShareProduct(p)}
            onOpenSeller={openSellerProfile}
            onBrowseProducts={() => navigate('home')}
          />
        )}

        {view === 'inbox' && (
          <InboxPage
            initialConversationId={activeConvId}
            onOpenProductById={openProductById}
          />
        )}

        {view === 'profile' && (
          <ProfilePage
            onNavigate={navigate}
            onOpenSellerOrders={() => openSellerOrders()}
            onOpenSellerProfile={openSellerProfile}
          />
        )}

        {view === 'seller' && (
          <SellerDashboardPage
            onNavigate={navigate}
            onOpenProduct={openProduct}
            onOpenPublicProfile={openSellerProfile}
            initialTabRequest={sellerNavTarget}
            onOpenInboxConversation={(convId) => {
              pushHistoryView(
                {
                  view: 'inbox',
                  selectedProductId: null,
                  selectedSellerIdentifier: null,
                  selectedCustomSlug: null,
                  selectedCategory,
                  activeConvId: convId,
                },
                '/',
                'top-instant'
              );
            }}
          />
        )}

        {view === 'seller-profile' && selectedSellerIdentifier && (
          <SellerProfilePage
            sellerIdentifier={selectedSellerIdentifier}
            onBack={() => goBack('home')}
            onOpenProduct={openProduct}
            onShareProduct={(p) => setShareProduct(p)}
            onOpenInboxConversation={(convId) => {
              pushHistoryView(
                {
                  view: 'inbox',
                  selectedProductId: null,
                  selectedSellerIdentifier,
                  selectedCustomSlug: null,
                  selectedCategory,
                  activeConvId: convId,
                },
                '/',
                'top-instant'
              );
            }}
            onNavigateSellerDashboard={() => navigate('seller')}
          />
        )}

        {view === 'seller-ads' && (
          <SellerProductAdsPage onBack={() => goBack('seller')} />
        )}

        {view === 'page' && selectedCustomSlug && (
          <CustomPageView slug={selectedCustomSlug} onBack={() => goBack('home')} />
        )}

        {view === 'admin' && <AdminDashboardPage onBack={() => goBack('home')} />}
      </main>

      <Footer onNavigate={navigate} onOpenCustomPage={openCustomPage} />

      <AuthModal />
      <ShareModal product={shareProduct} onClose={() => setShareProduct(null)} />
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MarketplaceShell />
    </AuthProvider>
  );
}
