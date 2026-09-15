import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import arTranslation from '../locales/ar.json';
import enTranslation from '../locales/en.json';

const resources = {
  ar: {
    translation: arTranslation,
  },
  en: {
    translation: enTranslation,
  },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'ar',
    fallbackLng: 'ar',
    interpolation: {
      escapeValue: false,
    },
  });

// Update html lang and dir on language change
i18n.on('languageChanged', (lng) => {
  const direction = lng === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', direction);
  document.documentElement.setAttribute('lang', lng);
});

// Set initial html lang and dir
const initialLang = i18n.language || 'ar';
document.documentElement.setAttribute('dir', initialLang === 'ar' ? 'rtl' : 'ltr');
document.documentElement.setAttribute('lang', initialLang);

export default i18n;
