import { useTranslation } from 'react-i18next';
import { AppShell } from './components/layout/AppShell';
import { Container } from './components/layout/Container';
import { Section } from './components/layout/Section';
import {
  SectionHeading,
  InteractiveWorldMap,
  LatestLibrary,
  LatestTraining,
} from './components/content';
import type { Language } from './types';
import './App.css';

function App() {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.language === 'en' ? 'en' : 'ar') as Language;

  return (
    <AppShell>
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
              <a
                href="#world-map-section"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-medium transition-colors shadow-xs"
              >
                <span>{t('home.exploreMap')}</span>
                <span aria-hidden="true">↓</span>
              </a>
              <a
                href="#library-section"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60 text-xs sm:text-sm font-medium transition-colors"
              >
                <span>{t('home.exploreLibrary')}</span>
                <span aria-hidden="true">↓</span>
              </a>
              <a
                href="#training-section"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60 text-xs sm:text-sm font-medium transition-colors"
              >
                <span>{t('home.exploreTraining')}</span>
                <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
        </Container>
      </div>

      {/* 2. Interactive World Map Section: Immediately following Hero with Sudan focus */}
      <Section id="world-map-section" className="bg-gray-950 text-white border-b border-gray-800">
        <Container>
          <SectionHeading
            title={t('home.mapSectionTitle')}
            subtitle={t('home.mapSectionSubtitle')}
            className="border-gray-800/80"
          />
          <InteractiveWorldMap
            currentLanguage={currentLang}
          />
        </Container>
      </Section>

      {/* 3. Latest Library Materials Section: Limited curated preview (3 items) with CTA */}
      <Section id="library-section" className="bg-gray-50/60 dark:bg-gray-950/60 border-b border-gray-200/60 dark:border-gray-800/60">
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

      {/* 4. Latest Training Courses Section: Limited curated preview (3 courses) with CTA */}
      <Section id="training-section" className="bg-white dark:bg-gray-900">
        <Container>
          <SectionHeading
            title={t('home.trainingSectionTitle')}
            subtitle={t('home.trainingSectionSubtitle')}
          />
          <LatestTraining
            currentLanguage={currentLang}
          />
        </Container>
      </Section>
    </AppShell>
  );
}

export default App;
