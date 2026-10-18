import { useTranslation } from 'react-i18next';
import { Container } from './Container';
import { SocialPlatformIcon, type SocialPlatformKey } from '../common/SocialPlatformIcon';
import { smoothScrollToSection } from '../../utils/interaction';
import type { PublicPageKey } from './Header';

const SocialIcon = ({ 
  platform,
  ariaLabel, 
  href, 
  hoverColor 
}: { 
  platform: SocialPlatformKey;
  ariaLabel: string; 
  href: string; 
  hoverColor: string; 
}) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={ariaLabel}
    title={ariaLabel}
    className={`p-2 rounded-full bg-gray-800 text-gray-300 transition-all duration-300 hover:scale-110 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-gray-500 hover:text-white inline-flex items-center justify-center ${hoverColor}`}
  >
    <SocialPlatformIcon platform={platform} alt={ariaLabel} sizeClassName="w-6 h-6" />
  </a>
);

export function Footer({ onNavigate }: { onNavigate?: (page: PublicPageKey) => void; }) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const handleLibraryJump = () => {
    if (onNavigate) {
      onNavigate('home');
      setTimeout(() => {
        smoothScrollToSection('library-section');
      }, 100);
    } else {
      smoothScrollToSection('library-section');
    }
  };

  return (
    <footer 
      data-responsive-guard
      className="bg-gray-900 text-gray-300 py-12 border-t border-gray-800 w-full max-w-full min-w-0"
    >
      <Container className="w-full max-w-full min-w-0">
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
              <li><button onClick={() => { if (onNavigate) onNavigate('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-emerald-400 transition-colors cursor-pointer">{isAr ? 'الرئيسية' : 'Home'}</button></li>
              <li><button onClick={() => { if (onNavigate) onNavigate('news'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-emerald-400 transition-colors cursor-pointer">{isAr ? 'الأخبار' : 'News'}</button></li>
              <li><button onClick={() => { if (onNavigate) onNavigate('media'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-emerald-400 transition-colors cursor-pointer">{isAr ? 'الوسائط' : 'Multimedia'}</button></li>
              <li><button onClick={handleLibraryJump} className="hover:text-emerald-400 transition-colors cursor-pointer">{isAr ? 'المكتبة' : 'Library'}</button></li>
              <li><button onClick={() => { if (onNavigate) onNavigate('training-center'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-emerald-400 transition-colors cursor-pointer">{isAr ? 'التدريب' : 'Training'}</button></li>
              <li><button onClick={() => { if (onNavigate) onNavigate('citizen-journalist'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-emerald-400 transition-colors cursor-pointer">{isAr ? 'المواطن الصحفي' : 'Citizen Journalist'}</button></li>
              <li><button onClick={() => { if (onNavigate) onNavigate('about'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="hover:text-emerald-400 transition-colors cursor-pointer">{isAr ? 'من نحن' : 'About Us'}</button></li>
            </ul>
          </div>

          {/* Official Media & Presence Channels */}
          <div className="min-w-0 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              {isAr ? 'القنوات الرسمية' : 'Official Channels'}
            </h4>
            <div className="flex items-center gap-3">
              <SocialIcon
                platform="youtube"
                href="https://www.youtube.com/@PromiseOfPlanet"
                ariaLabel={isAr ? "يوتيوب الرسمي لوعد الكوكب" : "Official YouTube Channel"}
                hoverColor="hover:bg-red-600/20"
              />
              <SocialIcon
                platform="facebook"
                href="https://www.facebook.com/PromiseOfPlanet/"
                ariaLabel={isAr ? "فيسبوك الرسمي لوعد الكوكب" : "Official Facebook Page"}
                hoverColor="hover:bg-blue-600/20"
              />
              <SocialIcon
                platform="instagram"
                href="https://www.instagram.com/promiseplanet1974?igsh=aXhiOHpzMDB3ajZx"
                ariaLabel={isAr ? "إنستغرام الرسمي لوعد الكوكب" : "Official Instagram Account"}
                hoverColor="hover:bg-pink-600/20"
              />
              <SocialIcon
                platform="whatsapp"
                href="https://whatsapp.com/channel/0029Vazh20iB4hdWzpMeOI0r"
                ariaLabel={isAr ? "قناة واتساب الرسمية لوعد الكوكب" : "Official WhatsApp Channel"}
                hoverColor="hover:bg-green-600/20"
              />
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
      </Container>
    </footer>
  );
}


