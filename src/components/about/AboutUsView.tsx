import { useTranslation } from 'react-i18next';
import { Container } from '../layout/Container';
import { SocialPlatformIcon } from '../common/SocialPlatformIcon';
import { smoothScrollToSection } from '../../utils/interaction';
import type { PublicPageKey } from '../layout/Header';
import { 
  Globe, 
  FileText, 
  GraduationCap, 
  ShieldCheck, 
  Tv, 
  ArrowRight, 
  ArrowLeft,
  ExternalLink,
  Info,
  Calendar
} from 'lucide-react';

interface AboutUsViewProps {
  onNavigate?: (page: PublicPageKey) => void;
}

export function AboutUsView({ onNavigate }: AboutUsViewProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const ArrowIcon = isAr ? ArrowLeft : ArrowRight;

  const corePillars = [
    {
      id: 'journalism',
      icon: FileText,
      titleAr: 'الصحافة والتحقيقات البيئية الميدانية',
      titleEn: 'Environmental Journalism & Field Reporting',
      descAr: 'توثيق قضايا التغير المناخي، شح المياه، التدهور البيئي، وتأثيرات الأنشطة التعدينية والصناعية بالاستناد إلى الأدلة الميدانية والتحقق المهني.',
      descEn: 'Documenting climate change impacts, water scarcity, land degradation, and resource governance through evidence-based investigative reporting.',
    },
    {
      id: 'knowledge',
      icon: Globe,
      titleAr: 'المعرفة والمصادر البيئية الموثوقة',
      titleEn: 'Environmental Knowledge & Publications',
      descAr: 'إتاحة الدراسات وأدلة الإدارة المستدامة ومواجز السياسات للباحثين والمجتمعات المحلية، بهدف جسر الفجوة بين البحث العلمي وصناع القرار.',
      descEn: 'Providing verified studies, sustainable management handbooks, and policy briefs to bridge scientific research and decision-making.',
    },
    {
      id: 'training',
      icon: GraduationCap,
      titleAr: 'بناء القدرات والتمكين المعرفي',
      titleEn: 'Capacity Building & Environmental Training',
      descAr: 'برامج ومسارات تدريبية متخصصة تستهدف الصحفيين والباحثين والناشطين البيئيين لبناء مهارات الرصد البيئي والصحافة العلمية.',
      descEn: 'Structured learning paths empowering researchers, journalists, and advocates with modern environmental monitoring tools.',
    },
    {
      id: 'multimedia',
      icon: Tv,
      titleAr: 'التغطية المرئية والبثوث التفاعلية',
      titleEn: 'Visual Documentation & Broadcasts',
      descAr: 'إنتاج وثائقيات وتغطيات حية عبر القنوات الرسمية لنقل أصوات المجتمعات المحلية في المناطق الأكثر تأثراً بالهشاشة المناخية.',
      descEn: 'Producing visual documentaries and live event coverage to amplify the voices of communities vulnerable to climate challenges.',
    },
  ];

  const handleScrollToChannels = () => {
    smoothScrollToSection('official-channels-section');
  };

  return (
    <div className="bg-gray-50/50 dark:bg-gray-950 min-h-screen py-8 sm:py-14 pop-page-fade">
      <Container className="max-w-5xl">
        {/* Header Breadcrumb */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-200/80 dark:border-gray-800/80">
          <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider">
            {isAr ? 'عن المنصة والمهمة التحريرية' : 'About the Platform & Editorial Mission'}
          </span>
          <button
            type="button"
            onClick={handleScrollToChannels}
            className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            <span>{isAr ? 'القنوات الرسمية والاتصال' : 'Official Channels & Contact'}</span>
            <ArrowIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Hero Introduction */}
        <div className="mb-12 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span>{isAr ? 'منصة إعلامية ومعرفية بيئية متخصصة' : 'Specialized Environmental Media & Knowledge Platform'}</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 dark:text-white tracking-tight leading-tight">
            {isAr ? 'منصة وعد الكوكب — Promise of Planet' : 'Promise of Planet — Environmental Platform'}
          </h1>
          <p className="text-base sm:text-xl text-emerald-900/80 dark:text-emerald-300 font-medium leading-relaxed max-w-3xl">
            {isAr
              ? 'منصة إعلامية ومعرفية وتدريبية مستقلة مكرسة لقضايا البيئة، التغير المناخي، حوكمة الموارد الطبيعية، والتنمية المستدامة في السودان والمنطقة.'
              : 'An environmental media, knowledge, and training platform dedicated to climate resilience, natural resource governance, and ecological stewardship in Sudan and the surrounding region.'}
          </p>
        </div>

        {/* Institutional Mission & Editorial Principles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 sm:p-8 border border-gray-200 dark:border-gray-800 shadow-xs space-y-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {isAr ? 'الرؤية والرسالة' : 'Vision & Purpose'}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              {isAr
                ? 'تهدف المنصة إلى تقديم تغطية صحفية علمية رصينة وموضوعية حول التحديات المناخية والبيئية، وتوفير مساحة لتوثيق التحولات الميدانية، ومساندة التدريب وبناء المهارات الصحفية المتخصصة في القضايا البيئية.'
                : 'The platform is committed to delivering rigorous, fact-based environmental journalism, documenting on-the-ground ecological transitions, and advancing professional capacity building in climate reporting.'}
            </p>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 sm:p-8 border border-gray-200 dark:border-gray-800 shadow-xs space-y-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {isAr ? 'معايير النشر والتحقق الصحفي' : 'Editorial Standards & Verification'}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              {isAr
                ? 'تلتزم المنصة بأعلى معايير الدقة الصحفية والنزاهة العلمية، والاعتماد على الشهادات الميدانية الموثقة والمصادر الأولية والبيانات المعتمدة، مع الالتزام التام بعدم نشر أي محتوى مضلل أو غير متحقق منه.'
                : 'Content published adheres to strict factual verification, reliance on documented field observations and primary sources, and unwavering dedication to journalistic integrity without fabricated claims.'}
            </p>
          </div>
        </div>

        {/* Core Pillars */}
        <div className="mb-12 space-y-6">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
            {isAr ? 'مجالات العمل الرئيسية' : 'Core Focus Areas'}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {corePillars.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <div
                  key={pillar.id}
                  className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-xs space-y-3 hover:border-emerald-500/60 transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">
                    {isAr ? pillar.titleAr : pillar.titleEn}
                  </h3>
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    {isAr ? pillar.descAr : pillar.descEn}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Conference Coverage & Press Engagement */}
        <div className="bg-emerald-950 text-white rounded-2xl p-6 sm:p-8 border border-emerald-900 space-y-4 mb-12">
          <h2 className="text-lg sm:text-xl font-bold text-emerald-200">
            {isAr ? 'التغطيات البيئية والمؤتمرات المناخية' : 'Environmental & Climate Conference Coverage'}
          </h2>
          <p className="text-xs sm:text-sm text-gray-300 leading-relaxed max-w-3xl">
            {isAr
              ? 'تعمل المنصة على متابعة وتغطية المؤتمرات والفعاليات البيئية الإقليمية والدولية المعنية بالعدالة المناخية، التصحر، حماية المسطحات المائية، وإبراز أولويات التكيف للمجتمعات الأكثر هشاشة.'
              : 'Promise of Planet tracks and covers regional and multilateral environmental events focusing on climate justice, anti-desertification initiatives, and ecological adaptation priorities for vulnerable regions.'}
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleScrollToChannels}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-medium transition-colors cursor-pointer"
            >
              {isAr ? 'التواصل والاستفسارات الصحفية' : 'Media & Press Inquiries'}
            </button>
            {onNavigate && (
              <>
                <button
                  type="button"
                  onClick={() => onNavigate('citizen-journalist')}
                  className="px-4 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-emerald-100 border border-emerald-600/60 text-xs sm:text-sm font-medium transition-colors cursor-pointer"
                >
                  {isAr ? 'المواطن الصحفي — إرسال بلاغ' : 'Citizen Journalist — Submit Report'}
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('training-center')}
                  className="px-4 py-2 rounded-lg bg-emerald-900 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60 text-xs sm:text-sm font-medium transition-colors cursor-pointer"
                >
                  {isAr ? 'تصفح مركز التدريب' : 'Explore Training Center'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Consolidated Official Channels & Engagement Section */}
        <div id="official-channels-section" className="pt-8 border-t border-gray-200 dark:border-gray-800 space-y-6">
          <div className="space-y-2">
            <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider block">
              {isAr ? 'القنوات الرسمية والتواصل الإعلامي' : 'Official Channels & Media Inquiries'}
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
              {isAr ? 'التواصل والقنوات المعتمدة' : 'Official Channels & Engagement'}
            </h2>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-2xl">
              {isAr
                ? 'متابعة المواد التوثيقية والندوات والتغطيات الميدانية عبر المنافذ الرسمية لمنصة وعد الكوكب، والتواصل المباشر مع فرق التحرير والتدريب.'
                : 'Follow documentary releases, webinars, and field reporting through the verified official channels of Promise of Planet.'}
            </p>
          </div>

          <div className="space-y-5">
            {/* 1. Official YouTube Channel */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 sm:p-8 shadow-xs hover:border-red-500/40 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 shrink-0">
                    <SocialPlatformIcon
                      platform="youtube"
                      alt={isAr ? 'يوتيوب وعد الكوكب' : 'Promise of Planet YouTube'}
                      sizeClassName="w-8 h-8"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-300">
                        {isAr ? 'قناة معتمدة' : 'Official Channel'}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">@PromiseOfPlanet</span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                      {isAr ? 'قناة وعد الكوكب على يوتيوب' : 'Promise of Planet on YouTube'}
                    </h3>
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

            {/* 2. Official Facebook Archive & Community */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 sm:p-8 shadow-xs hover:border-blue-500/40 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 shrink-0">
                    <SocialPlatformIcon
                      platform="facebook"
                      alt={isAr ? 'فيسبوك وعد الكوكب' : 'Promise of Planet Facebook'}
                      sizeClassName="w-8 h-8"
                    />
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
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                      {isAr ? 'صفحة وعد الكوكب على فيسبوك' : 'Promise of Planet on Facebook'}
                    </h3>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-w-xl">
                      {isAr
                        ? 'تضم الصفحة أرشيف التغطيات الميدانية، الفعاليات الحية، والتقارير الصحفية المنشورة منذ عام 2024.'
                        : 'Features field reporting, live broadcasts, and media releases published since 2024.'}
                    </p>
                  </div>
                </div>

                <div className="sm:self-center shrink-0">
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

            {/* 3. Instagram Account */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 sm:p-8 shadow-xs hover:border-pink-500/40 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-pink-50 dark:bg-pink-950/50 text-pink-600 dark:text-pink-400 shrink-0">
                    <SocialPlatformIcon
                      platform="instagram"
                      alt={isAr ? 'إنستغرام وعد الكوكب' : 'Promise of Planet Instagram'}
                      sizeClassName="w-8 h-8"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-pink-100 dark:bg-pink-900/60 text-pink-800 dark:text-pink-300">
                        {isAr ? 'حساب معتمد' : 'Official Account'}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">@promiseplanet1974</span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                      {isAr ? 'إنستغرام وعد الكوكب' : 'Promise of Planet on Instagram'}
                    </h3>
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
                  <div className="p-2.5 rounded-xl bg-green-50 dark:bg-green-950/50 text-green-600 dark:text-green-400 shrink-0">
                    <SocialPlatformIcon
                      platform="whatsapp"
                      alt={isAr ? 'واتساب وعد الكوكب' : 'Promise of Planet WhatsApp'}
                      sizeClassName="w-8 h-8"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-green-100 dark:bg-green-900/60 text-green-800 dark:text-green-300">
                        {isAr ? 'قناة بث مباشرة' : 'Broadcast Channel'}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                      {isAr ? 'قناة وعد الكوكب على واتساب' : 'Promise of Planet on WhatsApp'}
                    </h3>
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
        </div>
      </Container>
    </div>
  );
}

