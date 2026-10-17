import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from './components/layout/AppShell';
import { Container } from './components/layout/Container';
import { Section } from './components/layout/Section';
import {
  SectionHeading,
  LatestLibrary,
  LatestTraining,
} from './components/content';
import { AdminAccessGate } from './components/layout/AdminAccessGate';
import { ViewTransition } from './components/common/ViewTransition';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ResponsiveGuard } from './components/dev/ResponsiveGuard';
import { smoothScrollToSection } from './utils/interaction';
import { TrainingCenter } from './components/training/TrainingCenter';
import { AboutUsView } from './components/about/AboutUsView';
import { ContactView } from './components/contact/ContactView';
import { PublicMediaHub } from './components/media/PublicMediaHub';
import { PublicNewsHub } from './components/news/PublicNewsHub';
import type { Language } from './types';
import './App.css';

function App() {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.language === 'en' ? 'en' : 'ar') as Language;
  const isAr = currentLang === 'ar';
  const [isAdminOpen, setIsAdminOpen] = useState(() => {
    try {
      const persisted = sessionStorage.getItem('pop_admin_session');
      if (persisted) {
        const parsed = JSON.parse(persisted);
        return parsed.open === true;
      }
    } catch (e) {
      console.error('Failed to parse admin session:', e);
    }
    return false;
  });
  const [activePage, setActivePage] = useState<'home' | 'news' | 'training-center' | 'about' | 'contact' | 'media'>(() => {
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#news')) {
      return 'news';
    }
    return 'home';
  });

  const [initialNewsSlug, setInitialNewsSlug] = useState<string | undefined>(() => {
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#news/')) {
      return window.location.hash.replace('#news/', '');
    }
    return undefined;
  });

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#news/')) {
        setActivePage('news');
        setInitialNewsSlug(hash.replace('#news/', ''));
      } else if (hash === '#news') {
        setActivePage('news');
        setInitialNewsSlug(undefined);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Sync root container dir attribute to ensure viewport scrollbar stays anchored on the right (Rule L)
  useEffect(() => {
    const rootEl = document.getElementById('root');
    if (rootEl) {
      rootEl.setAttribute('dir', isAr ? 'rtl' : 'ltr');
    }
  }, [isAr]);

  return (
    <div id="app-root-container" dir={isAr ? 'rtl' : 'ltr'} className="min-h-screen w-full">
      <ResponsiveGuard />
      <ErrorBoundary isAr={isAr}>
        <ViewTransition viewKey={isAdminOpen ? 'admin-workspace' : activePage}>
        {isAdminOpen ? (
          <AdminAccessGate 
            onExitAdmin={() => {
              setIsAdminOpen(false);
              try {
                sessionStorage.removeItem('pop_admin_session');
              } catch (e) {
                console.error(e);
              }
            }} 
          />
        ) : (
          <AppShell 
            onEnterAdmin={() => {
              setIsAdminOpen(true);
              try {
                sessionStorage.setItem('pop_admin_session', JSON.stringify({ open: true, tab: 'overview' }));
              } catch (e) {
                console.error(e);
              }
            }}
            activePage={activePage}
            onNavigate={(page) => setActivePage(page)}
          >
            {activePage === 'news' ? (
              <PublicNewsHub initialArticleIdOrSlug={initialNewsSlug} onNavigate={(page) => setActivePage(page)} />
            ) : activePage === 'about' ? (
              <AboutUsView onNavigate={(page) => setActivePage(page)} />
            ) : activePage === 'contact' ? (
              <ContactView onNavigate={(page) => setActivePage(page)} />
            ) : activePage === 'training-center' ? (
              <TrainingCenter />
            ) : activePage === 'media' ? (
              <PublicMediaHub />
            ) : (
              <>
                {/* 1. Hero Section: Gateway to the Platform (Preserved without turning into a news portal) */}
                <div className="bg-emerald-950 text-white border-b border-emerald-900 py-12 sm:py-16 relative overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(5,150,105,0.25),transparent_60%)] pointer-events-none" />
                  <Container>
                    <div className="max-w-3xl relative z-10">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-800/80 text-emerald-200 border border-emerald-700/50 mb-4">
                        {t('home.tagline')}
                      </span>
                      <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-3">
                        {t('brand.name')}
                      </h1>
                      <p className="text-lg sm:text-xl text-emerald-300 font-medium mb-3">
                        {t('brand.subtitle')}
                      </p>
                      <p className="text-sm sm:text-base text-gray-300 max-w-2xl leading-relaxed mb-6">
                        {t('home.description')}
                      </p>
                      {/* Architectural Navigation Anchor Links */}
                      <div className="flex flex-wrap items-center gap-3 pt-2">
                        <button
                          onClick={() => setActivePage('news')}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs sm:text-sm font-medium shadow-xs pop-motion-micro pop-hover-lift cursor-pointer"
                        >
                          <span>{isAr ? 'الأخبار والتحقيقات' : 'News & Investigations'}</span>
                          <span aria-hidden="true">→</span>
                        </button>
                        <button
                          onClick={() => smoothScrollToSection('library-section')}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-medium shadow-xs pop-motion-micro pop-hover-lift cursor-pointer"
                        >
                          <span>{t('home.exploreLibrary')}</span>
                          <span aria-hidden="true">↓</span>
                        </button>
                        <button
                          onClick={() => setActivePage('training-center')}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60 text-xs sm:text-sm font-medium pop-motion-micro pop-hover-lift cursor-pointer"
                        >
                          <span>{isAr ? 'تصفح مركز التدريب والمسارات البيئية' : 'Explore Training Center Hub'}</span>
                          <span aria-hidden="true">→</span>
                        </button>
                        <button
                          onClick={() => setActivePage('about')}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 border border-emerald-800/80 text-xs sm:text-sm font-medium pop-motion-micro pop-hover-lift cursor-pointer"
                        >
                          <span>{isAr ? 'عن المنصة ورسالتها' : 'About Platform & Mission'}</span>
                        </button>
                      </div>
                    </div>
                  </Container>
                </div>

                {/* 3. Latest Library Materials Section: Truthful curation state */}
                <Section id="library-section" className="bg-gray-50/60 dark:bg-gray-950/60 border-b border-gray-200/60 dark:border-gray-800/60 pop-motion-section">
                  <Container>
                    <SectionHeading
                      title={t('home.librarySectionTitle')}
                      subtitle={t('home.librarySectionSubtitle')}
                    />
                    <LatestLibrary
                      currentLanguage={currentLang}
                    />
                  </Container>
                </Section>

                {/* 4. Latest Training Courses Section: Limited curated preview with CTA */}
                <Section id="training-section" className="bg-white dark:bg-gray-900 pop-motion-section">
                  <Container>
                    <SectionHeading
                      title={t('home.trainingSectionTitle')}
                      subtitle={t('home.trainingSectionSubtitle')}
                    />
                    <LatestTraining
                      currentLanguage={currentLang}
                      onExploreTraining={() => setActivePage('training-center')}
                    />
                  </Container>
                </Section>
              </>
            )}
          </AppShell>
        )}
      </ViewTransition>
      </ErrorBoundary>
    </div>
  );
}

export default App;
