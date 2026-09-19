import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Container } from './Container';
import { Shield, ChevronDown, BookOpen, FileText, Scale, Package, Sparkles } from 'lucide-react';
import { smoothScrollToSection } from '../../lib/interaction';

interface HeaderProps {
  onEnterAdmin?: () => void;
}

export function Header({ onEnterAdmin }: HeaderProps) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const [isLibraryPanelOpen, setIsLibraryPanelOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Monitor scroll position to transition header between Resting (top) and Elevated (scrolled) states
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial check
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleLanguage = () => {
    const nextLang = i18n.language === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(nextLang);
  };

  // Close contextual panel on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsLibraryPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNavClick = (key: string) => {
    if (key === 'library') {
      smoothScrollToSection('library-section');
      setIsLibraryPanelOpen(false);
    } else if (key === 'training') {
      smoothScrollToSection('training-section');
    } else if (key === 'home') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const navItems = [
    { key: 'home', label: t('navigation.home') },
    { key: 'news', label: t('navigation.news') },
    { key: 'library', label: t('navigation.library'), hasPanel: true },
    { key: 'training', label: t('navigation.training') },
    { key: 'citizenJournalism', label: t('navigation.citizenJournalism') },
    { key: 'aboutUs', label: t('navigation.aboutUs') },
  ];

  const librarySubtopics = [
    {
      id: 'handbooks',
      titleAr: 'كتيبات الإدارة المستدامة للمياه والأراضي',
      titleEn: 'Sustainable Water & Land Handbooks',
      descAr: 'أدلة تطبيقية لإدارة المياه الجوفية وحماية التربة في المناطق شبه الجافة',
      descEn: 'Practical handbooks for groundwater and soil conservation in semi-arid zones',
      icon: BookOpen,
    },
    {
      id: 'research',
      titleAr: 'الأوراق والدراسات البيئية المحكمة',
      titleEn: 'Peer-Reviewed Environmental Research',
      descAr: 'دراسات بيئية محكمة حول الغطاء النباتي وتغير المناخ في أفريقيا والمنطقة العربية',
      descEn: 'Peer-reviewed studies on vegetation cover and climate change in Africa and Arab region',
      icon: FileText,
    },
    {
      id: 'policy',
      titleAr: 'مواجز السياسات والتشريعات البيئية',
      titleEn: 'Environmental Policy & Legislation Briefs',
      descAr: 'أوراق موقف وتوصيات للمشرعين والمنظمات حول حظر المواد الضارة والتعدين',
      descEn: 'Policy briefs and regulator recommendations on artisanal mining and toxic substances',
      icon: Scale,
    },
    {
      id: 'toolkits',
      titleAr: 'حقائب الأدوات المعرفية والتدريبية',
      titleEn: 'Knowledge & Training Toolkits',
      descAr: 'حقائب تدريبية موجهة للصحفيين البيئيين والباحثين الميدانيين',
      descEn: 'Training toolkits for environmental journalists and field researchers',
      icon: Package,
    },
  ];

  return (
    <header 
      data-responsive-guard
      className={`sticky top-0 z-40 pop-motion-standard w-full max-w-full min-w-0 ${
        isScrolled
          ? 'bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-b border-gray-200/80 dark:border-gray-800/80 shadow-xs'
          : 'bg-white/80 dark:bg-gray-900/80 backdrop-blur-xs border-b border-gray-100/50 dark:border-gray-800/40 shadow-none'
      }`} 
      ref={panelRef}
      id="main-header"
    >
      <Container className="relative w-full max-w-full min-w-0">
        <div className="flex items-center justify-between h-16 sm:h-20 w-full min-w-0 gap-2 sm:gap-4" dir="ltr">
          {/* Brand Logo / Name (Anchored Left in Header Bar) */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0" dir={isAr ? 'rtl' : 'ltr'}>
            <span className="text-base min-[390px]:text-lg sm:text-xl lg:text-2xl font-bold text-emerald-700 dark:text-emerald-400 truncate sm:overflow-visible min-w-0">
              {t('brand.name')}
            </span>
          </div>

          {/* Navigation Links */}
          <nav className="hidden lg:flex items-center gap-6 relative" dir={isAr ? 'rtl' : 'ltr'}>
            {navItems.map((item) => {
              if (item.hasPanel) {
                return (
                  <div key={item.key} className="relative">
                    <button
                      onClick={() => setIsLibraryPanelOpen(!isLibraryPanelOpen)}
                      onMouseEnter={() => setIsLibraryPanelOpen(true)}
                      className={`text-sm font-medium inline-flex items-center gap-1.5 py-2 px-2.5 rounded-lg pop-motion-micro cursor-pointer ${
                        isLibraryPanelOpen
                          ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50/80 dark:bg-emerald-950/50'
                          : 'text-gray-700 dark:text-gray-200 hover:text-emerald-600 dark:hover:text-emerald-400'
                      }`}
                      aria-expanded={isLibraryPanelOpen}
                      id="header-library-nav-btn"
                    >
                      <span>{item.label}</span>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isLibraryPanelOpen ? 'rotate-180 text-emerald-600' : 'text-gray-400'}`} />
                    </button>
                  </div>
                );
              }

              return (
                <a
                  key={item.key}
                  href={`#${item.key}`}
                  onClick={(e) => {
                    e.preventDefault();
                    handleNavClick(item.key);
                  }}
                  className="text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-emerald-600 dark:hover:text-emerald-400 pop-motion-micro cursor-pointer py-2 px-1"
                >
                  {item.label}
                </a>
              );
            })}
          </nav>

          {/* Dedicated Physical Control Zone:
              Pinned strictly to dir="ltr" so control buttons keep their exact 
              physical position on screen regardless of document direction. */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0" dir="ltr" id="header-fixed-control-zone">
            {/* Admin Portal Gateway */}
            {onEnterAdmin && (
              <button
                onClick={onEnterAdmin}
                className="inline-flex items-center gap-1 sm:gap-1.5 px-2 py-1.5 sm:px-3 sm:py-2 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/40 rounded-lg text-xs font-bold pop-motion-micro pop-hover-lift cursor-pointer shadow-xs focus-visible:outline-2 shrink-0 min-h-[36px]"
                id="header-enter-admin-btn"
                dir={isAr ? 'rtl' : 'ltr'}
              >
                <Shield className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden min-[360px]:inline">{isAr ? 'بوابة الإدارة' : 'Admin Portal'}</span>
                <span className="min-[360px]:hidden">{isAr ? 'إدارة' : 'Admin'}</span>
              </button>
            )}

            {/* Language Switcher — Physically Anchored at Far Right Edge */}
            <button
              onClick={toggleLanguage}
              className="px-2.5 py-1.5 sm:px-4 sm:py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs sm:text-sm font-semibold pop-motion-micro pop-hover-lift shadow-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 shrink-0 min-h-[36px] inline-flex items-center justify-center"
              id="header-lang-toggle-btn"
            >
              {t('common.languageToggle')}
            </button>
          </div>
        </div>

        {/* CONTEXTUAL HEADER OVERLAY PANEL FOR ENVIRONMENTAL LIBRARY */}
        {isLibraryPanelOpen && (
          <div 
            className="hidden lg:block absolute top-full left-0 right-0 z-50 bg-white/98 dark:bg-gray-900/98 backdrop-blur-xl border-b border-gray-200/80 dark:border-gray-800/80 shadow-2xl rounded-b-2xl p-6 pop-motion-panel"
            dir={isAr ? 'rtl' : 'ltr'}
            onMouseLeave={() => setIsLibraryPanelOpen(false)}
            id="contextual-library-header-panel"
          >
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
                <Sparkles className="w-4 h-4" />
                <span>{isAr ? 'أقسام المكتبة البيئية والموارد المعرفية' : 'Environmental Library & Knowledge Resources'}</span>
              </div>
              <button
                onClick={() => handleNavClick('library')}
                className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>{isAr ? 'الانتقال المباشر للمكتبة' : 'Jump to Full Library Section'}</span>
                <span>{isAr ? '↓' : '↓'}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {librarySubtopics.map((sub) => {
                const IconComponent = sub.icon;
                return (
                  <button
                    key={sub.id}
                    onClick={() => handleNavClick('library')}
                    className="flex items-start gap-3 p-3.5 rounded-xl hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40 border border-transparent hover:border-emerald-200/60 dark:hover:border-emerald-800/60 text-start pop-motion-micro pop-hover-lift cursor-pointer group"
                  >
                    <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white transition-colors shrink-0 mt-0.5">
                      <IconComponent className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-gray-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-300 leading-snug mb-1">
                        {isAr ? sub.titleAr : sub.titleEn}
                      </h4>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">
                        {isAr ? sub.descAr : sub.descEn}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Mobile Navigation Bar */}
        <div className="lg:hidden py-2.5 border-t border-gray-100 dark:border-gray-800 flex overflow-x-auto gap-4 no-scrollbar" dir={isAr ? 'rtl' : 'ltr'}>
          {navItems.map((item) => (
            <a
              key={item.key}
              href={`#${item.key}`}
              onClick={(e) => {
                e.preventDefault();
                handleNavClick(item.key);
              }}
              className="text-xs font-medium text-gray-700 dark:text-gray-200 hover:text-emerald-600 dark:hover:text-emerald-400 whitespace-nowrap pop-motion-micro py-1"
            >
              {item.label}
            </a>
          ))}
        </div>
      </Container>
    </header>
  );
}
