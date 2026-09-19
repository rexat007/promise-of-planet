import { useTranslation } from 'react-i18next';
import { AdminPermission } from '../../types/admin';
import type { AdminUser } from '../../types/admin';
import { AdminAccessService } from '../../services/adminAccess';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Lock, 
  Info,
  CheckCircle,
  ChevronRight
} from 'lucide-react';

interface AdminPlaceholderViewProps {
  id: string;
  currentUser: AdminUser;
}

export function AdminPlaceholderView({ id, currentUser }: AdminPlaceholderViewProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  // Define section configuration: Required permissions and description
  const sectionConfigs: Record<string, {
    titleAr: string;
    titleEn: string;
    descAr: string;
    descEn: string;
    requiredPermission: AdminPermission;
  }> = {
    news: {
      titleAr: 'إدارة الأخبار البيئية',
      titleEn: 'Environmental News Management',
      descAr: 'قسم إدارة المقالات والتغطيات الميدانية العاجلة، وكتابة تقارير الطوارئ البيئية في الولايات السودانية.',
      descEn: 'Publish, draft, and manage time-sensitive climate alerts, regional news reports, and ecological updates.',
      requiredPermission: AdminPermission.Create,
    },
    library: {
      titleAr: 'إدارة المكتبة البيئية',
      titleEn: 'Environmental Library Curator',
      descAr: 'قسم مراجعة ونشر الأوراق البحثية، وكتب البيئة، وكتيبات الإرشاد المجتمعي لولاية البحر الأحمر والنيل الأزرق.',
      descEn: 'Curate, review, and catalog peer-reviewed environmental studies, regional resource books, and climate textbooks.',
      requiredPermission: AdminPermission.Create,
    },
    training: {
      titleAr: 'إدارة البرامج والمسارات التدريبية',
      titleEn: 'Training & Capacities Management',
      descAr: 'قسم إنشاء الدورات التدريبية المعتمدة في مجالات الصحافة الاستقصائية، والتحليل البيئي، ونظم المعلومات الجغرافية.',
      descEn: 'Schedule, edit, and organize training modules, webinars, and certification programs for journalists and students.',
      requiredPermission: AdminPermission.Edit,
    },
    community: {
      titleAr: 'إدارة مشاركات صحافة المواطن والمجتمع',
      titleEn: 'Community & Citizen Moderator',
      descAr: 'قسم الإشراف على مساهمات المواطنين، ومراجعة بلاغات التلوث ومشاركات الرصد البيئي الميداني.',
      descEn: 'Moderate community submissions, verify ecological reports submitted by citizens, and handle flagged content.',
      requiredPermission: AdminPermission.Review,
    },
    subscriptions: {
      titleAr: 'إدارة الاشتراكات والتبرعات البيئية',
      titleEn: 'Subscriptions & Sponsorships',
      descAr: 'قسم متابعة مساهمات الرعاة، واشتراكات الأعضاء الداعمين لمشاريع التوعية والطباعة الورقية للمجلات.',
      descEn: 'Track member subscriptions, environmental project sponsorships, and community donation campaigns.',
      requiredPermission: AdminPermission.ViewReports,
    },
    aiReviews: {
      titleAr: 'مساعد الذكاء الاصطناعي ومراجعة المحتوى واللغة',
      titleEn: 'AI Content Auditor & Copilot',
      descAr: 'قسم التحقق التلقائي من دقة ومصداقية التقارير المرفوعة للتدقيق، وإثراء صياغتها، ومطابقة الترجمة المتبادلة.',
      descEn: 'Deploy Gemini models server-side to check journalistic standards, cross-verify source reliability, and audit translations.',
      requiredPermission: AdminPermission.Review,
    },
    users: {
      titleAr: 'المستخدمون والصلاحيات (RBAC)',
      titleEn: 'Identity & Access Controls (RBAC)',
      descAr: 'قسم تخصيص الأدوار الإدارية التسعة، وإدارة صلاحيات الموظفين والباحثين، وتوليد دعوات الانضمام الآمنة.',
      descEn: 'Assign one of the 9 strict system roles, manage permissions, create new accounts, and configure identity rules.',
      requiredPermission: AdminPermission.ManageUsers,
    },
    auditLog: {
      titleAr: 'سجل تدقيق الأنشطة والعمليات الفنية',
      titleEn: 'Security & Action Audit Logs',
      descAr: 'السجل الهيكلي الكامل لتسجيل كافة عمليات النشر، والتعديل، والتغييرات الأمنية المنفذة في المنصة.',
      descEn: 'Un-alterable logs documenting who created, edited, approved, or published any content on the platform.',
      requiredPermission: AdminPermission.ManageSettings,
    },
    reports: {
      titleAr: 'التقارير والإحصائيات والتحليلات البيئية',
      titleEn: 'System Analytical Reports',
      descAr: 'قسم استخراج التقارير التحليلية، وإحصائيات القراءة والتدريب، ومدى تغطية المقالات للولايات المختلفة.',
      descEn: 'Generate and export analytical reports regarding article read counts, course completion rates, and regional coverage.',
      requiredPermission: AdminPermission.ViewReports,
    },
    settings: {
      titleAr: 'الإعدادات العامة وإعدادات الـ API',
      titleEn: 'Platform Settings & Secrets',
      descAr: 'التحكم العام بالمنصة، وتأمين مفاتيح يوتيوب، وربط الخدمات السحابية وإعدادات اللغات الافتراضية.',
      descEn: 'Configure global platform metadata, manage system keys, customize cache intervals, and set site preferences.',
      requiredPermission: AdminPermission.ManageSettings,
    },
  };

  const config = sectionConfigs[id] || {
    titleAr: 'قسم إداري معلق',
    titleEn: 'Pending Admin Module',
    descAr: 'هذا القسم الإداري مخصص للمراحل القادمة.',
    descEn: 'This admin section is reserved for upcoming blocks.',
    requiredPermission: AdminPermission.View,
  };

  const hasPermission = AdminAccessService.hasPermission(currentUser, config.requiredPermission);

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-10 shadow-xs max-w-4xl" id={`placeholder-view-${id}`}>
      <div className="space-y-6">
        {/* Module Title */}
        <div className="space-y-2">
          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tracking-wider uppercase block">
            {isAr ? 'نواة لوحة التحكم' : 'Admin Control Hub'}
          </span>
          <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">
            {isAr ? config.titleAr : config.titleEn}
          </h1>
          <p className="text-sm sm:text-base text-gray-500 dark:text-gray-400 leading-relaxed">
            {isAr ? config.descAr : config.descEn}
          </p>
        </div>

        {/* Permission Authorization Board */}
        <div className={`p-5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all ${
          hasPermission 
            ? 'bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-900/30' 
            : 'bg-rose-50/50 dark:bg-rose-950/10 border-rose-100 dark:border-rose-900/30'
        }`}>
          <div className="flex items-start gap-3.5">
            <div className={`p-2.5 rounded-lg h-fit ${
              hasPermission 
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400' 
                : 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400'
            }`}>
              {hasPermission ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
            </div>
            <div className="space-y-0.5">
              <h3 className="text-sm sm:text-base font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                <span>{isAr ? 'حالة التخويل والصلاحيات' : 'Authorization Status'}</span>
                {hasPermission ? (
                  <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">({isAr ? 'مصرح لك' : 'Authorized'})</span>
                ) : (
                  <span className="text-xs text-rose-700 dark:text-rose-400 font-semibold">({isAr ? 'مرفوض' : 'Restricted'})</span>
                )}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-normal">
                {isAr 
                  ? `يتطلب العمل في هذا الملحق صلاحية: [${config.requiredPermission}] الممنوحة لدورك الحالي (${currentUser.role}).`
                  : `This operational section requires permission: [${config.requiredPermission}] associated with your role (${currentUser.role}).`}
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {hasPermission ? (
              <span className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold shadow-xs inline-flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>{isAr ? 'جاهز للتشغيل' : 'Operational'}</span>
              </span>
            ) : (
              <span className="px-3.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold shadow-xs inline-flex items-center gap-1">
                <Lock className="w-3.5 h-3.5" />
                <span>{isAr ? 'مغلق ومحمي' : 'Restricted Access'}</span>
              </span>
            )}
          </div>
        </div>

        {/* Architectural Blueprint Note */}
        <div className="bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 rounded-xl p-5" id="architecture-blueprint-panel">
          <div className="flex items-start gap-3 text-gray-500 dark:text-gray-400">
            <Info className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1.5 text-xs">
              <p className="font-bold text-gray-900 dark:text-white">
                {isAr ? 'ملاحظة تخطيطية من معمارية الهيكل الموحد:' : 'Modular Monolith Architectural Blueprint Note:'}
              </p>
              <p className="leading-relaxed">
                {isAr 
                  ? 'هذا القسم يمثل واجهة هيكلية معدّة للربط المباشر مع مكونات البلوكات القادمة. يتم هنا فحص الصلاحيات محلياً وموثوقاً وتخويل العمليات بشكل كامل قبل تنفيذ أي واجهة أو ترحيل بيانات إلى قواعد البيانات السحابية لاحقاً.'
                  : 'This panel represents a structural shell ready to mount operational code in subsequent blocks. Access validation is handled completely inside our AdminAccessService layer prior to mounting any live UI state or Cloud DB writes.'}
              </p>
              <div className="flex items-center gap-2 pt-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <span>{isAr ? 'التالي: بناء البلوكات المخصصة للمحتوى' : 'Next: Creating dedicated content modules'}</span>
                <ChevronRight className="w-3 h-3" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
