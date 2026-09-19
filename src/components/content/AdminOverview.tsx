import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  MOCK_PLATFORM_METRICS, 
  MOCK_OPERATIONAL_ALERTS 
} from '../../data/mockAdminData';
import type { AdminUser, OperationalAlert } from '../../types/admin';
import { ContentWorkflowPanel } from './ContentWorkflowPanel';
import { 
  Newspaper, 
  BookOpen, 
  GraduationCap, 
  Clock, 
  AlertTriangle, 
  CheckCircle, 
  Layers, 
  Sparkles,
  AlertOctagon,
  Info
} from 'lucide-react';

interface AdminOverviewProps {
  currentUser: AdminUser;
}

export function AdminOverview({ currentUser }: AdminOverviewProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const [alerts, setAlerts] = useState<OperationalAlert[]>(MOCK_OPERATIONAL_ALERTS);

  // Action handler for alerts
  const handleDismissAlert = (id: string) => {
    setAlerts(alerts.filter(a => a.id !== id));
  };

  const formatTimestamp = (isoString: string) => {
    const d = new Date(isoString);
    return isAr 
      ? d.toLocaleDateString('ar-SD', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-8" id="admin-overview-container">
      {/* 1. Header Hero Panel with Context */}
      <div className="bg-gradient-to-r from-emerald-900 to-teal-950 text-white rounded-2xl p-6 sm:p-8 shadow-md relative overflow-hidden" id="admin-hero-panel">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.15),transparent_50%)] pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-800 text-emerald-200 border border-emerald-700">
                {isAr ? 'بيئة لوحة الإدارة الآمنة' : 'Secure Admin Environment'}
              </span>
              <span className="flex items-center gap-1 text-xs text-teal-300">
                <Sparkles className="w-3.5 h-3.5" />
                {isAr ? 'نواة المعمارية الموحدة' : 'Unified Core Architecture'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold mb-2" id="admin-welcome-heading">
              {isAr ? `أهلاً بك، ${currentUser.name}` : `Welcome back, ${currentUser.name}`}
            </h1>
            <p className="text-sm sm:text-base text-emerald-100 max-w-2xl leading-relaxed">
              {isAr 
                ? `أنت تتصفح المنصة بصفتك: (${currentUser.role}). يتيح لك نموذج التحكم الهيكلي بالوصول تنفيذ المهام المعتمدة لدورك فقط.`
                : `Logged in as: (${currentUser.role}). The role-based access control grants you access only to tasks approved for your role.`}
            </p>
          </div>
        </div>
      </div>

      {/* 2. Platform Status Metrics Cards Grid */}
      <div>
        <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2" id="metrics-section-heading">
          <Layers className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <span>{isAr ? 'الحالة العامة للمنصة' : 'Platform Status Overview'}</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" id="metrics-grid">
          {/* News Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-xs flex items-center gap-4 pop-motion-standard pop-hover-lift">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 rounded-lg text-emerald-600 dark:text-emerald-400">
              <Newspaper className="w-6 h-6" />
            </div>
            <div>
              <span className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                {isAr ? 'إجمالي الأخبار' : 'Total News Articles'}
              </span>
              <span className="text-2xl font-extrabold text-gray-900 dark:text-white mt-0.5 block">
                {MOCK_PLATFORM_METRICS.totalNews}
              </span>
            </div>
          </div>

          {/* Library Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-xs flex items-center gap-4 pop-motion-standard pop-hover-lift">
            <div className="p-3 bg-teal-50 dark:bg-teal-950/50 rounded-lg text-teal-600 dark:text-teal-400">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <span className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                {isAr ? 'مواد المكتبة المعرفية' : 'Library Publications'}
              </span>
              <span className="text-2xl font-extrabold text-gray-900 dark:text-white mt-0.5 block">
                {MOCK_PLATFORM_METRICS.totalLibraryItems}
              </span>
            </div>
          </div>

          {/* Courses Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-xs flex items-center gap-4 pop-motion-standard pop-hover-lift">
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg text-indigo-600 dark:text-indigo-400">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <span className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                {isAr ? 'البرامج التدريبية' : 'Training Courses'}
              </span>
              <span className="text-2xl font-extrabold text-gray-900 dark:text-white mt-0.5 block">
                {MOCK_PLATFORM_METRICS.totalCourses}
              </span>
            </div>
          </div>

          {/* Pending Action Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 shadow-xs flex items-center gap-4 pop-motion-standard pop-hover-lift">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/50 rounded-lg text-amber-600 dark:text-amber-500">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <span className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                {isAr ? 'مواد قيد المراجعة والاعتماد' : 'Workflow Items Active'}
              </span>
              <span className="text-2xl font-extrabold text-gray-900 dark:text-white mt-0.5 block">
                5
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. CORE CONTENT LIFECYCLE WORKFLOW PANEL */}
      <ContentWorkflowPanel currentUser={currentUser} />

      {/* 4. OPERATIONAL SYSTEM SIGNALS */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-6 shadow-xs space-y-4" id="alerts-container">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <span>{isAr ? 'تنبيهات النظام والتشغيل' : 'Operational Signals'}</span>
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {isAr ? 'حالة التزامن والمؤشرات التقنية للمنصة' : 'Synchronization health and technical indicators'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" id="alerts-list">
          {alerts.length === 0 ? (
            <div className="col-span-2 p-6 text-center text-gray-400 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
              <CheckCircle className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
              <p className="text-xs font-semibold">{isAr ? 'جميع إشارات النظام تعمل بنجاح' : 'All system signals are healthy'}</p>
            </div>
          ) : (
            alerts.map((alert) => (
              <div 
                key={alert.id} 
                className={`border rounded-xl p-4 shadow-xs transition-all flex gap-3 relative ${
                  alert.type === 'critical' 
                    ? 'bg-red-50/50 dark:bg-red-950/10 border-red-100 dark:border-red-900/30' 
                    : alert.type === 'warning'
                    ? 'bg-amber-50/50 dark:bg-amber-950/10 border-amber-100 dark:border-amber-900/30'
                    : 'bg-blue-50/50 dark:bg-blue-950/10 border-blue-100 dark:border-blue-900/30'
                }`}
              >
                <div className={`p-2 rounded-lg h-fit ${
                  alert.type === 'critical' ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400' :
                  alert.type === 'warning' ? 'bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400' :
                  'bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
                }`}>
                  {alert.type === 'critical' ? <AlertOctagon className="w-4 h-4" /> :
                   alert.type === 'warning' ? <AlertTriangle className="w-4 h-4" /> :
                   <Info className="w-4 h-4" />}
                </div>

                <div className="space-y-1 pr-4">
                  <p className="text-xs font-semibold text-gray-400 dark:text-gray-500">
                    {formatTimestamp(alert.timestamp)}
                  </p>
                  <p className="text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-100 leading-snug">
                    {isAr ? alert.messageAr : alert.messageEn}
                  </p>
                  <button
                    onClick={() => handleDismissAlert(alert.id)}
                    className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline mt-1 block cursor-pointer"
                  >
                    {isAr ? 'تجاهل الإشارة' : 'Acknowledge Signal'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

