"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Header = Header;
const react_1 = require("react");
const react_i18next_1 = require("react-i18next");
const Container_1 = require("./Container");
const lucide_react_1 = require("lucide-react");
const interaction_1 = require("../../utils/interaction");
function Header({ onEnterAdmin, activePage = 'home', onNavigate }) {
    const { t, i18n } = (0, react_i18next_1.useTranslation)();
    const isAr = i18n.language === 'ar';
    const [activePanelKey, setActivePanelKey] = (0, react_1.useState)(null);
    const [isScrolled, setIsScrolled] = (0, react_1.useState)(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = (0, react_1.useState)(false);
    const panelRef = (0, react_1.useRef)(null);
    // Monitor scroll position to transition header between Resting (top) and Elevated (scrolled) states
    (0, react_1.useEffect)(() => {
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
    (0, react_1.useEffect)(() => {
        function handleClickOutside(event) {
            if (panelRef.current && !panelRef.current.contains(event.target)) {
                setActivePanelKey(null);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);
    // Close contextual panel on Escape key press and return focus to the active trigger button
    (0, react_1.useEffect)(() => {
        function handleKeyDown(event) {
            if (event.key === 'Escape') {
                if (activePanelKey) {
                    const triggerId = `header-${activePanelKey}-nav-btn`;
                    const triggerEl = document.getElementById(triggerId);
                    if (triggerEl) {
                        triggerEl.focus();
                    }
                    setActivePanelKey(null);
                }
            }
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [activePanelKey]);
    const handleNavClick = (key) => {
        if (key === 'library') {
            if (onNavigate) {
                onNavigate('home');
                setTimeout(() => {
                    (0, interaction_1.smoothScrollToSection)('library-section');
                }, 100);
            }
            else {
                (0, interaction_1.smoothScrollToSection)('library-section');
            }
            setActivePanelKey(null);
        }
        else if (key === 'training') {
            if (onNavigate) {
                onNavigate('training-center');
            }
            else {
                (0, interaction_1.smoothScrollToSection)('training-section');
            }
            setActivePanelKey(null);
        }
        else if (key === 'home') {
            if (onNavigate) {
                onNavigate('home');
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setActivePanelKey(null);
        }
        else if (key === 'about') {
            if (onNavigate) {
                onNavigate('about');
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setActivePanelKey(null);
        }
        else if (key === 'contact') {
            if (onNavigate) {
                onNavigate('contact');
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setActivePanelKey(null);
        }
        else if (key === 'media') {
            if (onNavigate) {
                onNavigate('media');
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setActivePanelKey(null);
        }
    };
    const handleTriggerKeyDown = (e, key) => {
        if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
            e.preventDefault();
            setActivePanelKey(key);
            setTimeout(() => {
                const jumpBtn = document.getElementById(`contextual-${key}-jump-btn`);
                if (jumpBtn) {
                    jumpBtn.focus();
                }
            }, 50);
        }
    };
    const handleJumpBtnKeyDown = (e, key) => {
        if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault();
            const triggerEl = document.getElementById(`header-${key}-nav-btn`);
            if (triggerEl) {
                triggerEl.focus();
            }
        }
    };
    const handlePanelItemKeyDown = (e, index, totalItems, key) => {
        if (e.key === 'Tab') {
            if (e.shiftKey) {
                if (index === 0) {
                    e.preventDefault();
                    const jumpEl = document.getElementById(`contextual-${key}-jump-btn`);
                    if (jumpEl) {
                        jumpEl.focus();
                    }
                }
            }
            else {
                if (index === totalItems - 1) {
                    e.preventDefault();
                    if (key === 'library') {
                        const nextTriggerEl = document.getElementById('header-training-nav-btn');
                        if (nextTriggerEl) {
                            nextTriggerEl.focus();
                        }
                    }
                    else {
                        const nextEl = document.getElementById('header-about-nav-btn');
                        if (nextEl) {
                            nextEl.focus();
                        }
                    }
                }
            }
        }
    };
    const handleHeaderBlur = (e) => {
        // Check if focus went to an element completely outside the header
        if (panelRef.current && !panelRef.current.contains(e.relatedTarget)) {
            setActivePanelKey(null);
        }
    };
    const navItems = [
        { key: 'home', label: t('navigation.home') },
        { key: 'library', label: t('navigation.library'), hasPanel: true },
        { key: 'training', label: t('navigation.training'), hasPanel: true },
        { key: 'about', label: t('navigation.aboutUs') },
        { key: 'contact', label: t('navigation.contact') },
        { key: 'media', label: isAr ? 'الوسائط المتعددة' : 'Multimedia' },
    ];
    const librarySubtopics = [
        {
            id: 'handbooks',
            titleAr: 'كتيبات الإدارة المستدامة للمياه والأراضي',
            titleEn: 'Sustainable Water & Land Handbooks',
            descAr: 'أدلة تطبيقية لإدارة المياه الجوفية وحماية التربة في المناطق شبه الجافة',
            descEn: 'Practical handbooks for groundwater and soil conservation in semi-arid zones',
            icon: lucide_react_1.BookOpen,
        },
        {
            id: 'research',
            titleAr: 'الأوراق والدراسات البيئية المحكمة',
            titleEn: 'Peer-Reviewed Environmental Research',
            descAr: 'دراسات بيئية محكمة حول الغطاء النباتي وتغير المناخ في أفريقيا والمنطقة العربية',
            descEn: 'Peer-reviewed studies on vegetation cover and climate change in Africa and Arab region',
            icon: lucide_react_1.FileText,
        },
        {
            id: 'policy',
            titleAr: 'مواجز السياسات والتشريعات البيئية',
            titleEn: 'Environmental Policy & Legislation Briefs',
            descAr: 'أوراق موقف وتوصيات للمشرعين والمنظمات حول حظر المواد الضارة والتعدين',
            descEn: 'Policy briefs and regulator recommendations on artisanal mining and toxic substances',
            icon: lucide_react_1.Scale,
        },
        {
            id: 'toolkits',
            titleAr: 'حقائب الأدوات المعرفية والتدريبية',
            titleEn: 'Knowledge & Training Toolkits',
            descAr: 'حقائب تدريبية موجهة للصحفيين البيئيين والباحثين الميدانيين',
            descEn: 'Training toolkits for environmental journalists and field researchers',
            icon: lucide_react_1.Package,
        },
    ];
    const trainingSubtopics = [
        {
            id: 'foundational',
            titleAr: 'البرامج التأسيسية (Beginner)',
            titleEn: 'Foundational Programs (Beginner)',
            descAr: 'التعلم البيئي التمهيدي والمعرفة التأسيسية لبناء المهارات الأساسية',
            descEn: 'Introductory environmental learning and foundational knowledge for core skills',
            icon: lucide_react_1.BookOpen,
        },
        {
            id: 'applied',
            titleAr: 'البرامج التطبيقية (Intermediate)',
            titleEn: 'Applied Programs (Intermediate)',
            descAr: 'التدريب التطبيقي والعملي الموجه للممارسين والباحثين الميدانيين',
            descEn: 'Applied and practice-oriented training for field practitioners and researchers',
            icon: lucide_react_1.Users,
        },
        {
            id: 'specialized',
            titleAr: 'البرامج المتقدمة (Advanced)',
            titleEn: 'Specialized Programs (Advanced)',
            descAr: 'التعلم البيئي المتقدم والتخصصي لتطوير الحلول المستدامة المعقدة',
            descEn: 'Specialized and advanced environmental learning for complex sustainable solutions',
            icon: lucide_react_1.Sparkles,
        },
        {
            id: 'formats',
            titleAr: 'صيغ تقديم البرامج',
            titleEn: 'Program Delivery Formats',
            descAr: 'برامج مرنة تشمل التعلم الذاتي الرقمي، الورش التفاعلية، والتدريب الميداني المشترك',
            descEn: 'Flexible Online, Interactive Workshop, or Field Cohort programs',
            icon: lucide_react_1.Clock,
        },
    ];
    return (<header data-responsive-guard className={`sticky top-0 z-40 pop-motion-standard w-full max-w-full min-w-0 ${isScrolled
            ? 'bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-b border-gray-200/80 dark:border-gray-800/80 shadow-xs'
            : 'bg-white/80 dark:bg-gray-900/80 backdrop-blur-xs border-b border-gray-100/50 dark:border-gray-800/40 shadow-none'}`} ref={panelRef} onMouseLeave={() => setActivePanelKey(null)} onBlur={handleHeaderBlur} id="main-header">
      <Container_1.Container className="relative w-full max-w-full min-w-0">
        <div className="flex items-center justify-between h-16 sm:h-20 w-full min-w-0 gap-2 sm:gap-4" dir="ltr">
          {/* Brand Logo / Name (Anchored Left in Header Bar) */}
          <button onClick={() => handleNavClick('home')} className="flex items-center gap-2 sm:gap-3 min-w-0 text-start hover:opacity-90 transition-opacity cursor-pointer focus-visible:outline-none" dir={isAr ? 'rtl' : 'ltr'}>
            <span className="text-base min-[390px]:text-lg sm:text-xl lg:text-2xl font-bold text-emerald-700 dark:text-emerald-400 truncate sm:overflow-visible min-w-0 select-none">
              {t('brand.name')}
            </span>
          </button>

          {/* Navigation Links */}
          <nav className="hidden lg:flex items-center gap-6 relative" dir={isAr ? 'rtl' : 'ltr'}>
            {navItems.map((item) => {
            const isActive = (item.key === 'home' && activePage === 'home') ||
                (item.key === 'training' && activePage === 'training-center') ||
                (item.key === 'about' && activePage === 'about') ||
                (item.key === 'contact' && activePage === 'contact') ||
                (item.key === 'media' && activePage === 'media');
            if (item.hasPanel) {
                return (<div key={item.key} className="relative">
                    <button onClick={() => handleNavClick(item.key)} onMouseEnter={() => setActivePanelKey(item.key)} onFocus={() => setActivePanelKey(item.key)} onKeyDown={(e) => handleTriggerKeyDown(e, item.key)} className={`text-sm font-medium inline-flex items-center gap-1.5 py-2 px-2.5 rounded-lg pop-motion-micro cursor-pointer transition-colors duration-150 ${activePanelKey === item.key
                        ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50/80 dark:bg-emerald-950/50'
                        : 'text-gray-700 dark:text-gray-200 hover:text-emerald-600 dark:hover:text-emerald-400'}`} aria-expanded={activePanelKey === item.key} aria-controls={`contextual-${item.key}-header-panel`} id={`header-${item.key}-nav-btn`}>
                      <span>{item.label}</span>
                      <lucide_react_1.ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${activePanelKey === item.key ? 'rotate-180 text-emerald-600' : 'text-gray-400'}`}/>
                    </button>
                  </div>);
            }
            return (<a key={item.key} id={`header-${item.key}-nav-btn`} href={`#${item.key}`} onClick={(e) => {
                    e.preventDefault();
                    handleNavClick(item.key);
                }} onMouseEnter={() => setActivePanelKey(null)} onFocus={() => setActivePanelKey(null)} className={`text-sm font-medium pop-motion-micro cursor-pointer py-2 px-1 border-b-2 transition-colors duration-150 ${isActive
                    ? 'text-emerald-700 dark:text-emerald-400 font-bold border-emerald-600 dark:border-emerald-400'
                    : 'text-gray-700 dark:text-gray-200 hover:text-emerald-600 dark:hover:text-emerald-400 border-transparent'}`}>
                  {item.label}
                </a>);
        })}
          </nav>

          {/* Dedicated Physical Control Zone */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0" dir="ltr" id="header-fixed-control-zone">
            {/* Admin Portal Gateway */}
            {onEnterAdmin && (<button onClick={onEnterAdmin} onFocus={() => setActivePanelKey(null)} className="inline-flex items-center gap-1 sm:gap-1.5 px-2 py-1.5 sm:px-3 sm:py-2 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/40 rounded-lg text-xs font-bold pop-motion-micro pop-hover-lift cursor-pointer shadow-xs focus-visible:outline-2 shrink-0 min-h-[36px]" id="header-enter-admin-btn" dir={isAr ? 'rtl' : 'ltr'}>
                <lucide_react_1.Shield className="w-3.5 h-3.5 shrink-0"/>
                <span className="hidden min-[360px]:inline">{isAr ? 'بوابة الإدارة' : 'Admin Portal'}</span>
                <span className="min-[360px]:hidden">{isAr ? 'إدارة' : 'Admin'}</span>
              </button>)}

            {/* Language Switcher */}
            <button onClick={toggleLanguage} onFocus={() => setActivePanelKey(null)} className="px-2.5 py-1.5 sm:px-4 sm:py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs sm:text-sm font-semibold pop-motion-micro pop-hover-lift shadow-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 shrink-0 min-h-[36px] inline-flex items-center justify-center" id="header-lang-toggle-btn">
              {t('common.languageToggle')}
            </button>
          </div>
        </div>

        {/* CONTEXTUAL HEADER OVERLAY PANEL */}
        {activePanelKey && (<div className="hidden lg:block absolute top-full left-0 right-0 z-50 bg-white/98 dark:bg-gray-900/98 backdrop-blur-xl border-b border-gray-200/80 dark:border-gray-800/80 shadow-2xl rounded-b-2xl p-6 pop-motion-panel" dir={isAr ? 'rtl' : 'ltr'} onMouseLeave={() => setActivePanelKey(null)} id={`contextual-${activePanelKey}-header-panel`}>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
                <lucide_react_1.Sparkles className="w-4 h-4"/>
                <span>
                  {activePanelKey === 'library'
                ? (isAr ? 'أقسام المكتبة البيئية والموارد المعرفية' : 'Environmental Library & Knowledge Resources')
                : (isAr ? 'مسارات التدريب والتمكين البيئي' : 'Environmental Training & Empowerment Paths')}
                </span>
              </div>
              <button id={`contextual-${activePanelKey}-jump-btn`} onClick={() => handleNavClick(activePanelKey)} onKeyDown={(e) => handleJumpBtnKeyDown(e, activePanelKey)} className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer">
                <span>
                  {activePanelKey === 'library'
                ? (isAr ? 'الانتقال المباشر للمكتبة' : 'Jump to Full Library Section')
                : (isAr ? 'الانتقال المباشر لمركز التدريب' : 'Jump to Training Center Hub')}
                </span>
                <span>{isAr ? '↓' : '↓'}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {(activePanelKey === 'library' ? librarySubtopics : trainingSubtopics).map((sub, index) => {
                const IconComponent = sub.icon;
                const totalSubtopics = (activePanelKey === 'library' ? librarySubtopics : trainingSubtopics).length;
                return (<button key={sub.id} id={`contextual-${activePanelKey}-subtopic-${index}`} onClick={() => handleNavClick(activePanelKey)} onKeyDown={(e) => handlePanelItemKeyDown(e, index, totalSubtopics, activePanelKey)} className="flex items-start gap-3 p-3.5 rounded-xl hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40 border border-transparent hover:border-emerald-200/60 dark:hover:border-emerald-800/60 text-start pop-motion-micro pop-hover-lift cursor-pointer group">
                    <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white transition-colors shrink-0 mt-0.5">
                      <IconComponent className="w-4 h-4"/>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-gray-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-300 leading-snug mb-1">
                        {isAr ? sub.titleAr : sub.titleEn}
                      </h4>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">
                        {isAr ? sub.descAr : sub.descEn}
                      </p>
                    </div>
                  </button>);
            })}
            </div>
          </div>)}

        {/* Mobile Navigation Toggle */}
        <div className="lg:hidden flex items-center">
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-gray-700 dark:text-gray-200" aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}>
            {isMobileMenuOpen ? <lucide_react_1.X className="w-6 h-6"/> : <lucide_react_1.Menu className="w-6 h-6"/>}
          </button>
        </div>

        {/* Mobile Navigation Overlay */}
        {isMobileMenuOpen && (<div className="lg:hidden absolute top-16 left-0 right-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 p-4 z-40 shadow-lg">
            <nav className="flex flex-col gap-4">
              {navItems.map((item) => (<a key={item.key} href={`#${item.key}`} onClick={(e) => {
                    e.preventDefault();
                    handleNavClick(item.key);
                    setIsMobileMenuOpen(false);
                }} className="text-lg font-medium text-gray-700 dark:text-gray-200 hover:text-emerald-600 dark:hover:text-emerald-400">
                  {item.label}
                </a>))}
            </nav>
          </div>)}
      </Container_1.Container>
    </header>);
}
//# sourceMappingURL=Header.js.map