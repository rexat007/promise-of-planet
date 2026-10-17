"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Footer = Footer;
const react_i18next_1 = require("react-i18next");
const Container_1 = require("./Container");
const SocialIcon = ({ children, ariaLabel, href, hoverColor }) => (<a href={href} target="_blank" rel="noopener noreferrer" aria-label={ariaLabel} title={ariaLabel} className={`p-2.5 rounded-full bg-gray-800 text-gray-300 transition-all duration-300 hover:scale-110 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-500 hover:text-white ${hoverColor}`}>
    {children}
  </a>);
function Footer({ onNavigate }) {
    const { t, i18n } = (0, react_i18next_1.useTranslation)();
    const isAr = i18n.language === 'ar';
    return (<footer data-responsive-guard className="bg-gray-900 text-gray-300 py-12 border-t border-gray-800 w-full max-w-full min-w-0">
      <Container_1.Container className="w-full max-w-full min-w-0">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start justify-between w-full min-w-0 mb-8 pb-8 border-b border-gray-800/80">
          {/* Brand & Mission Statement */}
          <div className="min-w-0 space-y-3">
            <h3 className="text-lg font-bold text-white tracking-tight">{t('brand.name')}</h3>
            <p className="text-xs sm:text-sm text-gray-400 leading-relaxed max-w-sm">{t('footer.description')}</p>
          </div>

          {/* Quick Platform Navigation */}
          <div className="min-w-0 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              {isAr ? 'أقسام المنصة' : 'Platform Navigation'}
            </h4>
            <ul className="space-y-2 text-xs sm:text-sm text-gray-400">
              <li><button onClick={() => { if (onNavigate)
        onNavigate('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-emerald-400 transition-colors cursor-pointer">{t('navigation.home')}</button></li>
              <li><button onClick={() => { if (onNavigate)
        onNavigate('about'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-emerald-400 transition-colors cursor-pointer">{t('navigation.aboutUs')}</button></li>
              <li><button onClick={() => { if (onNavigate)
        onNavigate('training-center'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-emerald-400 transition-colors cursor-pointer">{t('navigation.training')}</button></li>
              <li><button onClick={() => { if (onNavigate)
        onNavigate('media'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-emerald-400 transition-colors cursor-pointer">{isAr ? 'الوسائط المتعددة' : 'Multimedia'}</button></li>
              <li><button onClick={() => { if (onNavigate)
        onNavigate('contact'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-emerald-400 transition-colors cursor-pointer">{t('navigation.contact')}</button></li>
            </ul>
          </div>

          {/* Official Media & Presence Channels */}
          <div className="min-w-0 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              {isAr ? 'القنوات الرسمية' : 'Official Channels'}
            </h4>
            <div className="flex items-center gap-3">
              <SocialIcon href="https://www.youtube.com/@PromiseOfPlanet" ariaLabel={isAr ? "يوتيوب الرسمي لوعد الكوكب" : "Official YouTube Channel"} hoverColor="hover:bg-red-600">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              </SocialIcon>
              <SocialIcon href="https://www.facebook.com/PromiseOfPlanet/" ariaLabel={isAr ? "فيسبوك الرسمي لوعد الكوكب" : "Official Facebook Page"} hoverColor="hover:bg-blue-600">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M20.48 1H3.52A2.52 2.52 0 0 0 1 3.52v16.96A2.52 2.52 0 0 0 3.52 23h9.12v-7.37H10.2v-2.87h2.44v-2.1c0-2.4 1.46-3.7 3.58-3.7a20.08 20.08 0 0 1 2.12.11v2.46h-1.46c-1.16 0-1.39.55-1.39 1.36v1.76h2.72l-.35 2.87h-2.37V23h4.88A2.52 2.52 0 0 0 23 20.48V3.52A2.52 2.52 0 0 0 20.48 1z"/></svg>
              </SocialIcon>
              <SocialIcon href="https://www.instagram.com/promiseplanet1974?igsh=aXhiOHpzMDB3ajZx" ariaLabel={isAr ? "إنستغرام الرسمي لوعد الكوكب" : "Official Instagram Account"} hoverColor="hover:bg-pink-600">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 1.173.056 1.956.248 2.533.473.655.255 1.12.564 1.61 1.054.49.49.8.955 1.054 1.61.225.577.417 1.36.473 2.533.058 1.267.07 1.646.07 4.85s-.012 3.584-.07 4.85c-.056 1.173-.248 1.956-.473 2.533-.255.655-.564 1.12-1.054 1.61-.49.49-.955.8-1.61 1.054-.577.225-1.36.417-2.533.473-1.267.058-1.646.07-4.85.07s-3.584-.012-4.85-.07c-1.173-.056-1.956-.248-2.533-.473-.655-.255-1.12-.564-1.61-1.054-.49-.49-.8-.955-1.054-1.61-.225-.577-.417-1.36-.473-2.533-.058-1.267-.07-1.646-.07-4.85s.012-3.584.07-4.85c.056-1.173.248-1.956.473-2.533.255-.655.564-1.12 1.054-1.61.49-.49.955-.8 1.61-1.054.577-.225 1.36-.417 2.533-.473 1.267-.058 1.646-.07 4.85-.07zm0 2.163c-2.88 0-3.23.01-4.366.062-1.055.048-1.625.215-2.006.365-.506.198-.865.437-1.243.816-.379.379-.618.737-.816 1.243-.15.381-.317.95-.365 2.006-.052 1.136-.062 1.486-.062 4.366s.01 3.23.062 4.366c.048 1.055.215 1.625.365 2.006.198.506.437.865 1.243.816.379.379.737.618 1.243.816.381.15.95.317 2.006.365 1.136.052 1.486.062 4.366.062s3.23-.01 4.366-.062c1.055-.048 1.625-.215 2.006-.365.506-.198.865-.437 1.243-.816.379-.379.618-.737.816-1.243.15-.381.317-.95.365-2.006.052-1.136.062-1.486.062-4.366s-.01-3.23-.062-4.366c-.048-1.055-.215-1.625-.365-2.006-.198-.506-.437-.865-1.243-.816-.379-.379-.737-.618-1.243-.816-.381-.15-.95-.317-2.006-.365-1.136-.052-1.486-.062-4.366-.062zm0 3.328c3.67 0 6.644 2.974 6.644 6.644s-2.974 6.644-6.644 6.644-6.644-2.974-6.644-6.644 2.974-6.644 6.644-6.644zm0 2.163c-2.473 0-4.481 2.008-4.481 4.481s2.008 4.481 4.481 4.481 4.481-2.008 4.481-4.481-2.008-4.481-4.481-4.481zm8.326-7.854c0 .858-.696 1.554-1.554 1.554-.858 0-1.554-.696-1.554-1.554 0-.858.696-1.554 1.554-1.554.858 0 1.554.696 1.554 1.554z"/></svg>
              </SocialIcon>
              <SocialIcon href="https://whatsapp.com/channel/0029Vazh20iB4hdWzpMeOI0r" ariaLabel={isAr ? "قناة واتساب الرسمية لوعد الكوكب" : "Official WhatsApp Channel"} hoverColor="hover:bg-green-600">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.148-.67-1.613-.916-2.207-.242-.579-.487-.5-.67-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a5.498 5.498 0 0 1-2.827-.775l-.203-.12-2.106.552.562-2.052-.132-.211a5.498 5.498 0 0 1-.843-2.909c0-3.036 2.471-5.508 5.508-5.508 1.47 0 2.852.573 3.89 1.614a5.525 5.525 0 0 1 1.614 3.89c0 3.037-2.472 5.509-5.508 5.509m8.326-17.785C19.145 2.757 16.37 0 12.983 0 7.82 0 3.633 4.187 3.633 9.352c0 1.649.432 3.259 1.257 4.678l-1.34 4.897 5.004-1.313a9.387 9.387 0 0 0 4.437 1.133h.004c5.163 0 9.351-4.187 9.351-9.352 0-2.497-.971-4.847-2.736-6.613"/></svg>
              </SocialIcon>
            </div>
            <div className="text-[11px] text-gray-500 leading-snug mt-3">
              <span>{isAr ? 'أرشيف التغطيات موثق منذ 2024' : 'Coverage archive documented since 2024'}</span>
            </div>
          </div>
        </div>

        {/* Bottom Rights Notice */}
        <div className="text-center sm:text-start text-xs text-gray-500 min-w-0">
          <p>{t('footer.rights')}</p>
        </div>
      </Container_1.Container>
    </footer>);
}
//# sourceMappingURL=Footer.js.map