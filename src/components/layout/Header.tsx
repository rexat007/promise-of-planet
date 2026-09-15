import { useTranslation } from 'react-i18next';
import { Container } from './Container';

export function Header() {
  const { t, i18n } = useTranslation();

  const toggleLanguage = () => {
    const nextLang = i18n.language === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(nextLang);
  };

  const navItems = [
    { key: 'home', label: t('navigation.home') },
    { key: 'news', label: t('navigation.news') },
    { key: 'library', label: t('navigation.library') },
    { key: 'training', label: t('navigation.training') },
    { key: 'citizenJournalism', label: t('navigation.citizenJournalism') },
    { key: 'aboutUs', label: t('navigation.aboutUs') },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 transition-colors">
      <Container>
        <div className="flex items-center justify-between h-16 sm:h-20">
          {/* Brand Logo / Name */}
          <div className="flex items-center gap-3">
            <span className="text-xl sm:text-2xl font-bold text-emerald-700 dark:text-emerald-400">
              {t('brand.name')}
            </span>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => (
              <a
                key={item.key}
                href={`#${item.key}`}
                onClick={(e) => e.preventDefault()}
                className="text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer"
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Language Toggle & Actions */}
          <div className="flex items-center gap-4">
            <button
              onClick={toggleLanguage}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              {t('common.languageToggle')}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Bar */}
        <div className="md:hidden py-2.5 border-t border-gray-100 dark:border-gray-800 flex overflow-x-auto gap-4 no-scrollbar">
          {navItems.map((item) => (
            <a
              key={item.key}
              href={`#${item.key}`}
              onClick={(e) => e.preventDefault()}
              className="text-xs font-medium text-gray-700 dark:text-gray-200 hover:text-emerald-600 dark:hover:text-emerald-400 whitespace-nowrap transition-colors"
            >
              {item.label}
            </a>
          ))}
        </div>
      </Container>
    </header>
  );
}
