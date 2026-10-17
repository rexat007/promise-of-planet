import { useTranslation } from 'react-i18next';
import { Container } from '../layout/Container';
import { 
  Share2, 
  ExternalLink, 
  Info,
  Calendar
} from 'lucide-react';

const YouTubeIcon = ({ className = 'w-6 h-6' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);


interface ContactViewProps {
  onNavigate?: (page: 'home' | 'news' | 'training-center' | 'about' | 'contact' | 'media') => void;
}

export function ContactView({ onNavigate: _onNavigate }: ContactViewProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  return (
    <div className="bg-gray-50/50 dark:bg-gray-950 min-h-screen py-8 sm:py-14 pop-page-fade">
      <Container className="max-w-4xl">
        {/* Breadcrumb Header */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-200/80 dark:border-gray-800/80">
          <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider">
            {isAr ? 'القنوات الرسمية والتواصل الإعلامي' : 'Official Channels & Media Inquiries'}
          </span>
        </div>

        {/* Header Title */}
        <div className="mb-10 space-y-3">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            {isAr ? 'التواصل والقنوات المعتمدة' : 'Official Channels & Engagement'}
          </h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 leading-relaxed max-w-2xl">
            {isAr
              ? 'متابعة المواد التوثيقية والندوات والتغطيات الميدانية عبر المنافذ الرسمية لمنصة وعد الكوكب، والتواصل المباشر مع فرق التحرير والتدريب.'
              : 'Follow documentary releases, webinars, and field reporting through the verified official channels of Promise of Planet.'}
          </p>
        </div>

        <div className="space-y-6">
          {/* 1. Official YouTube Channel (Confirmed) */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 sm:p-8 shadow-xs hover:border-red-500/40 transition-colors">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 shrink-0">
                  <YouTubeIcon className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-300">
                      {isAr ? 'قناة معتمدة' : 'Official Channel'}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">@PromiseOfPlanet</span>
                  </div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                    {isAr ? 'قناة وعد الكوكب على يوتيوب' : 'Promise of Planet on YouTube'}
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-xl">
                    {isAr
                      ? 'القناة الرسمية المخصصة للمواد المرئية، الندوات البيئية، والتقارير الميدانية المصورة.'
                      : 'The official channel dedicated to documentary features, environmental webinars, and visual field reports.'}
                  </p>
                </div>
              </div>

              <div className="sm:self-center shrink-0">
                <a
                  href="https://www.youtube.com/@PromiseOfPlanet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium text-xs sm:text-sm transition-colors shadow-xs"
                >
                  <span>{isAr ? 'زيارة القناة الرسمية' : 'Visit Official Channel'}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>

          {/* 2. Official Facebook Archive & Community (Established 2024) */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 sm:p-8 shadow-xs">
            <div className="flex items-start gap-4">
              <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 shrink-0">
                <Share2 className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300">
                    {isAr ? 'مجتمع وأرشيف موثق' : 'Official Page & Archive'}
                  </span>
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    <span>{isAr ? 'نشط منذ 2024' : 'Active since 2024'}</span>
                  </span>
                </div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  {isAr ? 'صفحة وعد الكوكب على فيسبوك' : 'Promise of Planet on Facebook'}
                </h2>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-xl">
                  {isAr
                    ? 'تضم الصفحة أرشيف التغطيات الميدانية، الفعاليات الحية، والتقارير الصحفية المنشورة منذ عام 2024.'
                    : 'Features field reporting, live broadcasts, and media releases published since 2024.'}
                </p>
                <div className="pt-3">
                  <a
                    href="https://www.facebook.com/PromiseOfPlanet/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs sm:text-sm transition-colors shadow-xs"
                  >
                    <span>{isAr ? 'زيارة صفحة فيسبوك الرسمية' : 'Visit Official Facebook Page'}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Instagram Account */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 sm:p-8 shadow-xs hover:border-pink-500/40 transition-colors">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="p-3.5 rounded-xl bg-pink-50 dark:bg-pink-950/50 text-pink-600 dark:text-pink-400 shrink-0">
                  <Share2 className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-pink-100 dark:bg-pink-900/60 text-pink-800 dark:text-pink-300">
                      {isAr ? 'حساب معتمد' : 'Official Account'}
                    </span>
                    <span className="text-xs text-gray-400 font-mono">@promiseplanet1974</span>
                  </div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                    {isAr ? 'إنستغرام وعد الكوكب' : 'Promise of Planet on Instagram'}
                  </h2>
                </div>
              </div>
              <div className="sm:self-center shrink-0">
                <a
                  href="https://www.instagram.com/promiseplanet1974?igsh=aXhiOHpzMDB3ajZx"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-700 text-white font-medium text-xs sm:text-sm transition-colors shadow-xs"
                >
                  <span>{isAr ? 'زيارة إنستغرام الرسمي' : 'Visit Official Instagram'}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>

          {/* 4. WhatsApp Channel */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 sm:p-8 shadow-xs hover:border-green-500/40 transition-colors">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="p-3.5 rounded-xl bg-green-50 dark:bg-green-950/50 text-green-600 dark:text-green-400 shrink-0">
                  <Share2 className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-green-100 dark:bg-green-900/60 text-green-800 dark:text-green-300">
                      {isAr ? 'قناة بث مباشرة' : 'Broadcast Channel'}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                    {isAr ? 'قناة وعد الكوكب على واتساب' : 'Promise of Planet on WhatsApp'}
                  </h2>
                </div>
              </div>
              <div className="sm:self-center shrink-0">
                <a
                  href="https://whatsapp.com/channel/0029Vazh20iB4hdWzpMeOI0r"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-medium text-xs sm:text-sm transition-colors shadow-xs"
                >
                  <span>{isAr ? 'متابعة قناة واتساب' : 'Follow WhatsApp Channel'}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>

          {/* 5. Journalist Accreditation & Conference Coverage Guidance */}
          <div className="bg-emerald-50/70 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200/80 dark:border-emerald-800/60 p-6 sm:p-8 space-y-3">
            <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold text-sm">
              <Info className="w-4 h-4 shrink-0" />
              <h3>
                {isAr ? 'استفسارات الاعتماد والتغطيات الصحفية للمؤتمرات' : 'Press Accreditation & Conference Inquiries'}
              </h3>
            </div>
            <p className="text-xs sm:text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {isAr
                ? 'للصحفيين والباحثين والمؤسسات المهتمة بالتغطيات الصحفية والفعاليات البيئية والمناخية، يمكن التواصل ومتابعة التحديثات عبر قنوات البث الرسمية المعلنة أعلاه، إلى حين إطلاق بوابة الاتصال التحريرية المباشرة.'
                : 'Journalists, researchers, and organizations seeking accreditation verification and environmental conference coverage inquiries can follow official updates via our official broadcast channels above.'}
            </p>
          </div>
        </div>
      </Container>
    </div>
  );
}
