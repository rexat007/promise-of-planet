"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AboutUsView = AboutUsView;
const react_i18next_1 = require("react-i18next");
const Container_1 = require("../layout/Container");
const lucide_react_1 = require("lucide-react");
function AboutUsView({ onNavigate }) {
    const { i18n } = (0, react_i18next_1.useTranslation)();
    const isAr = i18n.language === 'ar';
    const ArrowIcon = isAr ? lucide_react_1.ArrowLeft : lucide_react_1.ArrowRight;
    const corePillars = [
        {
            id: 'journalism',
            icon: lucide_react_1.FileText,
            titleAr: 'الصحافة والتحقيقات البيئية الميدانية',
            titleEn: 'Environmental Journalism & Field Reporting',
            descAr: 'توثيق قضايا التغير المناخي، شح المياه، التدهور البيئي، وتأثيرات الأنشطة التعدينية والصناعية بالاستناد إلى الأدلة الميدانية والتحقق المهني.',
            descEn: 'Documenting climate change impacts, water scarcity, land degradation, and resource governance through evidence-based investigative reporting.',
        },
        {
            id: 'knowledge',
            icon: lucide_react_1.Globe,
            titleAr: 'المعرفة والمصادر البيئية الموثوقة',
            titleEn: 'Environmental Knowledge & Publications',
            descAr: 'إتاحة الدراسات وأدلة الإدارة المستدامة ومواجز السياسات للباحثين والمجتمعات المحلية، بهدف جسر الفجوة بين البحث العلمي وصناع القرار.',
            descEn: 'Providing verified studies, sustainable management handbooks, and policy briefs to bridge scientific research and decision-making.',
        },
        {
            id: 'training',
            icon: lucide_react_1.GraduationCap,
            titleAr: 'بناء القدرات والتمكين المعرفي',
            titleEn: 'Capacity Building & Environmental Training',
            descAr: 'برامج ومسارات تدريبية متخصصة تستهدف الصحفيين والباحثين والناشطين البيئيين لبناء مهارات الرصد البيئي والصحافة العلمية.',
            descEn: 'Structured learning paths empowering researchers, journalists, and advocates with modern environmental monitoring tools.',
        },
        {
            id: 'multimedia',
            icon: lucide_react_1.Tv,
            titleAr: 'التغطية المرئية والبثوث التفاعلية',
            titleEn: 'Visual Documentation & Broadcasts',
            descAr: 'إنتاج وثائقيات وتغطيات حية عبر القنوات الرسمية لنقل أصوات المجتمعات المحلية في المناطق الأكثر تأثراً بالهشاشة المناخية.',
            descEn: 'Producing visual documentaries and live event coverage to amplify the voices of communities vulnerable to climate challenges.',
        },
    ];
    return (<div className="bg-gray-50/50 dark:bg-gray-950 min-h-screen py-8 sm:py-14 pop-page-fade">
      <Container_1.Container className="max-w-5xl">
        {/* Header Breadcrumb */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-200/80 dark:border-gray-800/80">
          <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider">
            {isAr ? 'عن المنصة والمهمة التحريرية' : 'About the Platform & Editorial Mission'}
          </span>
          {onNavigate && (<button onClick={() => onNavigate('contact')} className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer">
              <span>{isAr ? 'القنوات الرسمية والاتصال' : 'Official Channels & Contact'}</span>
              <ArrowIcon className="w-3.5 h-3.5"/>
            </button>)}
        </div>

        {/* Hero Introduction */}
        <div className="mb-12 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
            <lucide_react_1.ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400"/>
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
            return (<div key={pillar.id} className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-xs space-y-3 hover:border-emerald-500/60 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                    <Icon className="w-5 h-5"/>
                  </div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">
                    {isAr ? pillar.titleAr : pillar.titleEn}
                  </h3>
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                    {isAr ? pillar.descAr : pillar.descEn}
                  </p>
                </div>);
        })}
          </div>
        </div>

        {/* Conference Coverage & Press Engagement */}
        <div className="bg-emerald-950 text-white rounded-2xl p-6 sm:p-8 border border-emerald-900 space-y-4">
          <h2 className="text-lg sm:text-xl font-bold text-emerald-200">
            {isAr ? 'التغطيات البيئية والمؤتمرات المناخية' : 'Environmental & Climate Conference Coverage'}
          </h2>
          <p className="text-xs sm:text-sm text-gray-300 leading-relaxed max-w-3xl">
            {isAr
            ? 'تعمل المنصة على متابعة وتغطية المؤتمرات والفعاليات البيئية الإقليمية والدولية المعنية بالعدالة المناخية، التصحر، حماية المسطحات المائية، وإبراز أولويات التكيف للمجتمعات الأكثر هشاشة.'
            : 'Promise of Planet tracks and covers regional and multilateral environmental events focusing on climate justice, anti-desertification initiatives, and ecological adaptation priorities for vulnerable regions.'}
          </p>

          {onNavigate && (<div className="pt-2 flex flex-wrap items-center gap-3">
              <button onClick={() => onNavigate('contact')} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-medium transition-colors cursor-pointer">
                {isAr ? 'التواصل والاستفسارات الصحفية' : 'Media & Press Inquiries'}
              </button>
              <button onClick={() => onNavigate('training-center')} className="px-4 py-2 rounded-lg bg-emerald-900 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60 text-xs sm:text-sm font-medium transition-colors cursor-pointer">
                {isAr ? 'تصفح مركز التدريب' : 'Explore Training Center'}
              </button>
            </div>)}
        </div>
      </Container_1.Container>
    </div>);
}
//# sourceMappingURL=AboutUsView.js.map