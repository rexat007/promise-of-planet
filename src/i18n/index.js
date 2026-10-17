"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const i18next_1 = require("i18next");
const react_i18next_1 = require("react-i18next");
const ar_json_1 = require("../locales/ar.json");
const en_json_1 = require("../locales/en.json");
const globalSettingsService_1 = require("../services/globalSettingsService");
const resources = {
    ar: {
        translation: ar_json_1.default,
    },
    en: {
        translation: en_json_1.default,
    },
};
const defaultLang = globalSettingsService_1.GlobalSettingsService.getSettings().defaultLanguage;
i18next_1.default
    .use(react_i18next_1.initReactI18next)
    .init({
    resources,
    lng: defaultLang,
    fallbackLng: defaultLang,
    interpolation: {
        escapeValue: false,
    },
});
// Update lang and ensure root html & body stay 'ltr' so browser viewport scrollbar stays anchored on right edge (Rule L)
// Dynamic RTL/LTR layout direction is handled by #root and #app-root-container
i18next_1.default.on('languageChanged', (lng) => {
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
const initialLang = i18next_1.default.language || defaultLang || 'ar';
document.documentElement.setAttribute('dir', 'ltr');
document.documentElement.setAttribute('lang', initialLang);
if (document.body) {
    document.body.setAttribute('dir', 'ltr');
}
const rootEl = document.getElementById('root');
if (rootEl) {
    rootEl.setAttribute('dir', initialLang === 'ar' ? 'rtl' : 'ltr');
}
exports.default = i18next_1.default;
//# sourceMappingURL=index.js.map