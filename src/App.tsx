import { useTranslation } from 'react-i18next';
import './App.css';

function App() {
  const { t, i18n } = useTranslation();

  const toggleLanguage = () => {
    const nextLang = i18n.language === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(nextLang);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-gray-900 dark:to-gray-800">
      <header className="container mx-auto px-4 py-6 flex justify-between items-center">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
          {i18n.language === 'ar' ? 'العربية' : 'English'}
        </span>
        <button
          onClick={toggleLanguage}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm cursor-pointer"
        >
          {t('common.languageToggle')}
        </button>
      </header>
      <main className="container mx-auto px-4 py-10">
        <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-6">
          {t('brand.name')}
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 mb-8">
          {t('brand.subtitle')}
        </p>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 max-w-2xl mx-auto">
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mb-4">
            {t('home.welcome')}
          </h2>
          <p className="text-gray-600 dark:text-gray-300">
            {t('home.description')}
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;

