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

// Update lang and ensure root html & body stay 'ltr' so browser viewport scrollbar stays anchored on right edge (Rule L)
// Dynamic RTL/LTR layout direction is handled by #root and #app-root-container
i18n.on('languageChanged', (lng) => {
  const direction = lng === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', lng);
  if (document.body) {
    document.body.setAttribute('dir', 'ltr');
  }
  const rootEl = document.getElementById('root');
  if (rootEl) {
    rootEl.setAttribute('dir', direction);
  }
});

// Set initial html lang and ensure root html/body stay ltr
const initialLang = i18n.language || 'ar';
document.documentElement.setAttribute('dir', 'ltr');
document.documentElement.setAttribute('lang', initialLang);
if (document.body) {
  document.body.setAttribute('dir', 'ltr');
}
const rootEl = document.getElementById('root');
if (rootEl) {
  rootEl.setAttribute('dir', initialLang === 'ar' ? 'rtl' : 'ltr');
}

export default i18n;
