import { useTranslation } from 'react-i18next';
import { Container } from './Container';
import { ExternalLink } from 'lucide-react';

const YouTubeIcon = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

interface FooterProps {
  onNavigate?: (page: 'home' | 'training-center' | 'about' | 'contact') => void;
}

export function Footer({ onNavigate }: FooterProps) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

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
              <li>
                <button
                  type="button"
                  onClick={() => {
                    if (onNavigate) onNavigate('home');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  {t('navigation.home')}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    if (onNavigate) onNavigate('about');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  {t('navigation.aboutUs')}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    if (onNavigate) onNavigate('training-center');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  {t('navigation.training')}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    if (onNavigate) onNavigate('contact');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  {t('navigation.contact')}
                </button>
              </li>
            </ul>
          </div>

          {/* Official Media & Presence Channels */}
          <div className="min-w-0 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              {isAr ? 'القنوات الرسمية' : 'Official Channels'}
            </h4>
            <div className="space-y-2">
              <a
                href="https://www.youtube.com/@PromiseOfPlanet"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-red-950/40 text-gray-200 hover:text-red-400 border border-gray-700/80 hover:border-red-600/50 text-xs font-medium transition-colors cursor-pointer"
              >
                <YouTubeIcon className="w-4 h-4 text-red-500 shrink-0" />
                <span>YouTube: @PromiseOfPlanet</span>
                <ExternalLink className="w-3 h-3 text-gray-500" />
              </a>
              <div className="text-[11px] text-gray-500 leading-snug">
                <span>{isAr ? 'صفحة فيسبوك الرسمية: أرشيف الفعاليات والتغطيات موثق منذ 2024' : 'Official Facebook Page: Coverage and event archive active since 2024'}</span>
              </div>
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

