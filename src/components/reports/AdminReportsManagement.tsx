import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  RefreshCw,
  Info,
  Shield,
  Lock,
  Newspaper,
  BookOpen,
  GraduationCap,
  Users,
  Cpu,
  History,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Layers,
  ArrowUpRight,
  Paperclip,
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import { AdminPermission, AdminRole } from '../../types/admin';
import { WorkflowState } from '../../types/workflow';
import { LibraryRightsStatus, LibraryDocumentType } from '../../types/library';
import { SubmissionStatus } from '../../types/community';
import type { DeliveryMode, TrainingLevel } from '../../types/training';
import {
  AIReviewExecutionState,
  AIReviewSeverity,
  AIReviewCategory,
  AIReviewTargetType,
} from '../../types/aiReview';
import { AuditTargetType, AuditAction } from '../../types/audit';
import { AdminAccessService } from '../../services/adminAccess';
import { SystemReportsService } from '../../services/systemReportsService';
import type { SystemOperationalSummary } from '../../types/reports';
import {
  formatWorkflowState,
  formatSubmissionStatus,
  formatRightsStatus,
  getTargetTypeLabel as getAuditTargetTypeLabel,
  getActionLabel as getAuditActionLabel,
} from '../audit/auditFormatters';
import { getRoleLabel, getRoleBadgeClass } from '../users/userFormatters';
import {
  getCategoryLabel as getAICategoryLabel,
  getSeverityLabel as getAISeverityLabel,
  getExecutionStateLabel as getAIExecutionStateLabel,
  getTargetTypeLabel as getAITargetTypeLabel,
} from '../aiReview/aiReviewFormatters';

interface AdminReportsManagementProps {
  currentUser: AdminUser;
  onNavigate?: (tabId: string) => void;
}

// Canonical Domain Types for Tab Filter
type ReportDomainFilter = 'ALL' | 'news' | 'library' | 'training' | 'community' | 'aiReview' | 'users' | 'audit';

export const AdminReportsManagement: React.FC<AdminReportsManagementProps> = ({
  currentUser,
  onNavigate,
}) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  // 1. RBAC Defense-in-Depth Authorization Check
  const canViewReports = AdminAccessService.hasPermission(
    currentUser,
    AdminPermission.ViewReports
  );

  // 2. Active Tab Domain Filter State
  const [activeDomainFilter, setActiveDomainFilter] = useState<ReportDomainFilter>('ALL');

  // 3. Refresh Trigger State directly from accepted SystemReportsService
  const [refreshKey, setRefreshKey] = useState<number>(0);

  // Derive SystemOperationalSummary strictly from SystemReportsService
  const summary: SystemOperationalSummary = useMemo(() => {
    return SystemReportsService.getSystemSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Handler for refreshing snapshot
  const handleRefreshSnapshot = () => {
    setRefreshKey((prev) => prev + 1);
  };

  // Helper for localized formatting of document types
  const formatDocumentType = (type: LibraryDocumentType): string => {
    switch (type) {
      case LibraryDocumentType.Law:
        return isAr ? 'قانون / تشريع' : 'Law / Legislation';
      case LibraryDocumentType.ExecutiveRegulation:
        return isAr ? 'لائحة تنفيذية' : 'Executive Regulation';
      case LibraryDocumentType.Decision:
        return isAr ? 'قرار وزاري / إداري' : 'Administrative Decision';
      case LibraryDocumentType.InstitutionalReport:
        return isAr ? 'تقرير مؤسسي' : 'Institutional Report';
      case LibraryDocumentType.PolicyPaper:
        return isAr ? 'ورقة سياسات' : 'Policy Paper';
      case LibraryDocumentType.ResearchStudy:
        return isAr ? 'دراسة بحثية' : 'Research Study';
      case LibraryDocumentType.InternationalAgreement:
        return isAr ? 'اتفاقية دولية' : 'International Agreement';
      default:
        return type;
    }
  };

  // Helper for localized training level
  const formatTrainingLevel = (level: TrainingLevel): string => {
    switch (level) {
      case 'Beginner':
        return isAr ? 'مبتدئ' : 'Beginner';
      case 'Intermediate':
        return isAr ? 'متوسط' : 'Intermediate';
      case 'Advanced':
        return isAr ? 'متقدم' : 'Advanced';
      default:
        return level;
    }
  };

  // Helper for localized delivery mode
  const formatDeliveryMode = (mode: DeliveryMode): string => {
    switch (mode) {
      case 'OnlineSelfPaced':
        return isAr ? 'ذاتي عبر الإنترنت' : 'Online Self-Paced';
      case 'LiveWorkshop':
        return isAr ? 'ورشة تفاعلية مباشرة' : 'Live Interactive Workshop';
      case 'FieldCohort':
        return isAr ? 'فوج ميداني تطبيقي' : 'Applied Field Cohort';
      default:
        return mode;
    }
  };

  // Localized date formatter for snapshot timestamp
  const formattedSnapshotTime = useMemo(() => {
    try {
      const d = new Date(summary.generatedAt);
      return isAr
        ? d.toLocaleString('ar-SD', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : d.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
    } catch {
      return summary.generatedAt;
    }
  }, [summary.generatedAt, isAr]);

  // Compute total platform entities across all operational domains
  const totalPlatformEntities = useMemo(() => {
    return (
      summary.news.totalCount +
      summary.library.totalCount +
      summary.training.totalCount +
      summary.community.totalCount
    );
  }, [summary]);

  // Compute total items requiring workflow attention across news, library, training
  const pendingWorkflowAttention = useMemo(() => {
    const newsPending =
      summary.news.byWorkflowState[WorkflowState.InReview] +
      summary.news.byWorkflowState[WorkflowState.ChangesRequested];
    const libraryPending =
      summary.library.byWorkflowState[WorkflowState.InReview] +
      summary.library.byWorkflowState[WorkflowState.ChangesRequested];
    const trainingPending =
      summary.training.byWorkflowState[WorkflowState.InReview] +
      summary.training.byWorkflowState[WorkflowState.ChangesRequested];
    const communityPending =
      summary.community.byStatus[SubmissionStatus.Received] +
      summary.community.byStatus[SubmissionStatus.UnderReview];
    return newsPending + libraryPending + trainingPending + communityPending;
  }, [summary]);

  // 4. Unauthorized Fallback (if user lacks ViewReports permission)
  if (!canViewReports) {
    return (
      <div className="space-y-6 max-w-full min-w-0" id="admin-reports-unauthorized">
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 md:p-8 text-center space-y-4 shadow-xs">
          <div className="h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
              {isAr ? 'صلاحية الوصول للتقارير التشغيلية مقيدة' : 'System Reports Access Restricted'}
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {isAr
                ? `يتطلب استعراض التقارير التشغيلية صلاحية (${AdminPermission.ViewReports}). دورك الحالي هو (${currentUser.role}).`
                : `Viewing operational system reports requires (${AdminPermission.ViewReports}) permission. Your current role is (${currentUser.role}).`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-full min-w-0" id="admin-system-reports-management">
      {/* ========================================================================= */}
      {/* 1. MODULE HEADER & SNAPSHOT CONTEXT                                        */}
      {/* ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-gray-100 dark:border-gray-800 min-w-0" id="reports-module-header">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="p-2.5 rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-400 border border-emerald-200/50 shrink-0">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-2">
              <h2 className="text-lg sm:text-xl font-black text-gray-900 dark:text-gray-100 leading-tight">
                {isAr ? 'التقارير التشغيلية للمنصة' : 'System Operational Reports'}
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-bold border border-gray-200 dark:border-gray-700 shrink-0 inline-flex items-center">
                {isAr ? 'للقراءة فقط' : 'Read-Only'}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 sm:mt-0.5 leading-relaxed">
              {isAr
                ? 'استعراض دقيق للحالة التشغيلية الحالية وتوزيع الكيانات وحالات سير العمل'
                : 'Derived operational report reflecting current platform entity counts and workflow distributions'}
            </p>
          </div>
        </div>

        {/* Refresh Snapshot Button */}
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <button
            onClick={handleRefreshSnapshot}
            className="px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs pop-motion-micro"
            id="reports-refresh-btn"
            title={isAr ? 'تحديث اللقطة التشغيلية' : 'Refresh In-Memory Snapshot'}
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{isAr ? 'تحديث اللقطة' : 'Refresh Snapshot'}</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. PERSISTENCE DISCLOSURE & SNAPSHOT SCOPE NOTICE                          */}
      {/* ========================================================================= */}
      <div
        className="bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/70 dark:border-blue-800/50 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-blue-900 dark:text-blue-200 min-w-0"
        id="reports-scope-notice"
      >
        <div className="flex items-start sm:items-center gap-2.5 min-w-0">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5 sm:mt-0" />
          <div className="min-w-0">
            <span className="font-bold">
              {isAr ? 'نطاق البيانات: ' : 'Data Scope: '}
            </span>
            <span className="text-blue-800 dark:text-blue-300">
              {isAr
                ? 'لقطة تشغيلية حيّة من الذاكرة للحالة الراهنة للجلسة (ليست تحليلات تاريخية طويلة الأمد).'
                : 'Live in-memory operational snapshot of current session state (not historical long-term analytics).'}
            </span>
          </div>
        </div>
        <div className="text-[11px] text-blue-700 dark:text-blue-400 font-mono shrink-0 flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-blue-500" />
          <span>{isAr ? `وقت التوليد: ${formattedSnapshotTime}` : `Generated: ${formattedSnapshotTime}`}</span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. OPERATIONAL TOP-LEVEL SUMMARY (High-Value Operational Indicators)       */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 min-w-0" id="reports-top-summary-cards">
        {/* Card 1: Total Managed Entities */}
        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-xs min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 truncate">
              {isAr ? 'إجمالي الكيانات الإدارية' : 'Total Managed Entities'}
            </span>
            <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-gray-900 dark:text-gray-100">
            {totalPlatformEntities}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 truncate">
            {isAr
              ? `${summary.news.totalCount} أخبار • ${summary.library.totalCount} وثائق • ${summary.training.totalCount} برامج`
              : `${summary.news.totalCount} News • ${summary.library.totalCount} Docs • ${summary.training.totalCount} Courses`}
          </div>
        </div>

        {/* Card 2: Items Requiring Review / Attention */}
        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-xs min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 truncate">
              {isAr ? 'بانتظار المراجعة والتدقيق' : 'Pending Workflow Action'}
            </span>
            <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400">
            {pendingWorkflowAttention}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 truncate">
            {isAr ? 'سير عمل قيد التدقيق أو تعديلات مطلوبة' : 'Items InReview or ChangesRequested'}
          </div>
        </div>

        {/* Card 3: AI Advisory Findings */}
        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-xs min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 truncate">
              {isAr ? 'ملاحظات التدقيق الذكي (AI)' : 'AI Advisory Findings'}
            </span>
            <div className="p-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 shrink-0">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-purple-600 dark:text-purple-400">
            {summary.aiReview.totalFindingsCount}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 truncate">
            {isAr
              ? `${summary.aiReview.totalArtifactsCount} محتويات تم فحصها استرشادياً`
              : `Across ${summary.aiReview.totalArtifactsCount} advisory artifacts`}
          </div>
        </div>

        {/* Card 4: Platform RBAC & Safety */}
        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-xs min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 truncate">
              {isAr ? 'المستخدمون المشرفون' : 'Active Administrators'}
            </span>
            <div className="p-1.5 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 shrink-0">
              <Shield className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-teal-700 dark:text-teal-300">
            {summary.users.activeUsersCount}{' '}
            <span className="text-xs font-semibold text-gray-400">
              / {summary.users.totalUsersCount}
            </span>
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 truncate flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
            <span>
              {isAr
                ? `مالك المنصة نشط (${summary.users.activeOwnerCount})`
                : `Active Platform Owner (${summary.users.activeOwnerCount})`}
            </span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. DOMAIN SELECTION FILTER PILLS                                           */}
      {/* ========================================================================= */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-bold border-b border-gray-100 dark:border-gray-800 min-w-0" id="reports-domain-filter-bar">
        {[
          { key: 'ALL', labelAr: 'كافة المجالات', labelEn: 'All Domains', icon: Layers },
          { key: 'news', labelAr: 'الأخبار البيئية', labelEn: 'News', icon: Newspaper },
          { key: 'library', labelAr: 'المكتبة المعرفية', labelEn: 'Library', icon: BookOpen },
          { key: 'training', labelAr: 'المسارات التدريبية', labelEn: 'Training', icon: GraduationCap },
          { key: 'community', labelAr: 'صحافة المواطن', labelEn: 'Community', icon: Users },
          { key: 'aiReview', labelAr: 'تدقيق AI', labelEn: 'AI Auditor', icon: Cpu },
          { key: 'users', labelAr: 'المستخدمون والصلاحيات', labelEn: 'Users & RBAC', icon: Shield },
          { key: 'audit', labelAr: 'سجل التدقيق', labelEn: 'Audit Activity', icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeDomainFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveDomainFilter(tab.key as ReportDomainFilter)}
              className={`px-3 py-1.5 rounded-xl flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors pop-motion-micro ${
                isSelected
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200/80 dark:border-gray-800'
              }`}
              id={`report-domain-tab-${tab.key}`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{isAr ? tab.labelAr : tab.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* 5. DOMAIN OPERATIONAL BREAKDOWNS                                          */}
      {/* ========================================================================= */}
      <div className="space-y-6 min-w-0" id="reports-domain-breakdown-sections">

        {/* ----------------------------------------------------------------------- */}
        {/* DOMAIN 1: ENVIRONMENTAL NEWS                                            */}
        {/* ----------------------------------------------------------------------- */}
        {(activeDomainFilter === 'ALL' || activeDomainFilter === 'news') && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 p-5 shadow-xs space-y-4 min-w-0" id="reports-section-news">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-3 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 shrink-0">
                  <Newspaper className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                    {isAr ? 'الأخبار والتقارير الميدانية البيئية' : 'Environmental News & Field Reports'}
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {isAr ? `إجمالي المواد الإخبارية الحالية: ${summary.news.totalCount}` : `Total Current News Articles: ${summary.news.totalCount}`}
                  </p>
                </div>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-200/50 dark:border-emerald-800 shrink-0">
                {summary.news.totalCount} {isAr ? 'خبر' : 'items'}
              </span>
            </div>

            {/* Workflow Distribution */}
            <div className="space-y-2 min-w-0">
              <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                {isAr ? 'التوزيع حسب حالة سير العمل:' : 'Distribution by Workflow State:'}
              </h4>

              {/* Compact Cards (<1280px) */}
              <div className="xl:hidden grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 min-w-0">
                {Object.values(WorkflowState).map((state) => {
                  const count = summary.news.byWorkflowState[state] || 0;
                  const pct = summary.news.totalCount > 0 ? Math.round((count / summary.news.totalCount) * 100) : 0;
                  return (
                    <div key={state} className="bg-gray-50 dark:bg-gray-800/60 p-3 rounded-xl border border-gray-100 dark:border-gray-800 min-w-0">
                      <div className="text-[11px] text-gray-600 dark:text-gray-300 font-bold truncate">
                        {formatWorkflowState(state, isAr)}
                      </div>
                      <div className="text-lg font-black text-gray-900 dark:text-gray-100 mt-0.5">
                        {count}
                      </div>
                      <div className="text-[10px] text-gray-400 font-semibold">{pct}%</div>
                    </div>
                  );
                })}
              </div>

              {/* Dense Desktop Structured Representation (>=1280px) */}
              <div className="hidden xl:block overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800 min-w-0">
                <table className="w-full text-xs text-start min-w-0">
                  <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-bold">
                    <tr>
                      <th className="py-2.5 px-4 text-start">{isAr ? 'حالة سير العمل' : 'Workflow State'}</th>
                      <th className="py-2.5 px-4 text-center">{isAr ? 'العدد' : 'Count'}</th>
                      <th className="py-2.5 px-4 text-start">{isAr ? 'النسبة من الإجمالي' : 'Proportion'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-gray-700 dark:text-gray-300">
                    {Object.values(WorkflowState).map((state) => {
                      const count = summary.news.byWorkflowState[state] || 0;
                      const pct = summary.news.totalCount > 0 ? Math.round((count / summary.news.totalCount) * 100) : 0;
                      return (
                        <tr key={state} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                          <td className="py-2.5 px-4 font-bold">{formatWorkflowState(state, isAr)}</td>
                          <td className="py-2.5 px-4 text-center font-mono font-bold text-gray-900 dark:text-gray-100">{count}</td>
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 w-10 text-end">{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Categories Breakdown */}
            {Object.keys(summary.news.byCategory).length > 0 && (
              <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2 min-w-0">
                <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300">
                  {isAr ? 'التوزيع حسب التصنيف البيئي:' : 'Breakdown by Environmental Category:'}
                </h4>
                <div className="flex flex-wrap gap-2 min-w-0">
                  {Object.entries(summary.news.byCategory).map(([cat, count]) => (
                    <span
                      key={cat}
                      className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-medium border border-gray-200 dark:border-gray-700 truncate max-w-full"
                    >
                      <span className="font-bold">{cat}:</span> <span className="font-mono text-emerald-700 dark:text-emerald-400 font-bold">{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* DOMAIN 2: KNOWLEDGE LIBRARY                                             */}
        {/* ----------------------------------------------------------------------- */}
        {(activeDomainFilter === 'ALL' || activeDomainFilter === 'library') && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 p-5 shadow-xs space-y-5 min-w-0" id="reports-section-library">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-3 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 shrink-0">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                    {isAr ? 'المكتبة البيئية والمعرفية' : 'Knowledge Library & Publications'}
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {isAr
                      ? `${summary.library.totalCount} وثيقة • ${summary.library.totalOrganizationsCount} مؤسسات • ${summary.library.totalSourcesCount} مصادر توثيق`
                      : `${summary.library.totalCount} Documents • ${summary.library.totalOrganizationsCount} Organizations • ${summary.library.totalSourcesCount} Sources`}
                  </p>
                </div>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 font-bold border border-teal-200/50 dark:border-teal-800 shrink-0">
                {summary.library.totalCount} {isAr ? 'وثيقة' : 'docs'}
              </span>
            </div>

            {/* A. Rights & Licensing Status Distribution */}
            <div className="space-y-2 min-w-0">
              <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                {isAr ? 'التوزيع حسب الوضع الحقوقي والرخص:' : 'Distribution by Rights & Licensing Status:'}
              </h4>

              {/* Compact Cards (<1280px) */}
              <div className="xl:hidden grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 min-w-0">
                {Object.values(LibraryRightsStatus).map((status) => {
                  const count = summary.library.byRightsStatus[status] || 0;
                  const pct = summary.library.totalCount > 0 ? Math.round((count / summary.library.totalCount) * 100) : 0;
                  return (
                    <div key={status} className="bg-gray-50 dark:bg-gray-800/60 p-3 rounded-xl border border-gray-100 dark:border-gray-800 min-w-0">
                      <div className="text-[11px] text-gray-700 dark:text-gray-200 font-bold truncate">
                        {formatRightsStatus(status, isAr)}
                      </div>
                      <div className="flex items-baseline justify-between mt-1">
                        <span className="text-lg font-black text-gray-900 dark:text-gray-100">{count}</span>
                        <span className="text-[10px] text-gray-400 font-semibold">{pct}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Dense Table (>=1280px) */}
              <div className="hidden xl:block overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800 min-w-0">
                <table className="w-full text-xs text-start min-w-0">
                  <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-bold">
                    <tr>
                      <th className="py-2 px-4 text-start">{isAr ? 'الوضع الحقوقي' : 'Rights Status'}</th>
                      <th className="py-2 px-4 text-center">{isAr ? 'العدد' : 'Count'}</th>
                      <th className="py-2 px-4 text-start">{isAr ? 'النسبة' : 'Proportion'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-gray-700 dark:text-gray-300">
                    {Object.values(LibraryRightsStatus).map((status) => {
                      const count = summary.library.byRightsStatus[status] || 0;
                      const pct = summary.library.totalCount > 0 ? Math.round((count / summary.library.totalCount) * 100) : 0;
                      return (
                        <tr key={status} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                          <td className="py-2 px-4 font-bold">{formatRightsStatus(status, isAr)}</td>
                          <td className="py-2 px-4 text-center font-mono font-bold text-gray-900 dark:text-gray-100">{count}</td>
                          <td className="py-2 px-4">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full bg-teal-600 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 w-10 text-end">{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* B. Document Type Distribution */}
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2 min-w-0">
              <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                {isAr ? 'التوزيع حسب نوع الوثيقة:' : 'Distribution by Document Type:'}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 min-w-0">
                {Object.values(LibraryDocumentType).map((type) => {
                  const count = summary.library.byDocumentType[type] || 0;
                  return (
                    <div key={type} className="bg-gray-50 dark:bg-gray-800/40 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800 text-xs min-w-0">
                      <div className="text-gray-500 dark:text-gray-400 text-[10px] truncate">{formatDocumentType(type)}</div>
                      <div className="font-bold text-gray-900 dark:text-gray-100 text-sm mt-0.5">{count}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* C. Languages Distribution */}
            {Object.keys(summary.library.byLanguage).length > 0 && (
              <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-2 text-xs min-w-0">
                <span className="font-bold text-gray-600 dark:text-gray-400">{isAr ? 'لغات الوثائق:' : 'Document Languages:'}</span>
                {Object.entries(summary.library.byLanguage).map(([lang, count]) => (
                  <span key={lang} className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium">
                    {lang === 'ar' ? (isAr ? 'العربية' : 'Arabic') : lang === 'en' ? (isAr ? 'الإنجليزية' : 'English') : lang}: <strong className="font-mono">{count}</strong>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* DOMAIN 3: TRAINING & COURSES                                            */}
        {/* ----------------------------------------------------------------------- */}
        {(activeDomainFilter === 'ALL' || activeDomainFilter === 'training') && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 p-5 shadow-xs space-y-4 min-w-0" id="reports-section-training">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-3 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 shrink-0">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                    {isAr ? 'البرامج والمسارات التدريبية' : 'Training Programs & Curricula'}
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {isAr
                      ? `إجمالي المسارات: ${summary.training.totalCount} • إجمالي ساعات التدريب: ${summary.training.totalDurationHours} ساعة`
                      : `Total Courses: ${summary.training.totalCount} • Cumulative Curriculum Hours: ${summary.training.totalDurationHours} hrs`}
                  </p>
                </div>
              </div>
              <div className="text-end shrink-0">
                <span className="text-xs px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-bold border border-blue-200/50 dark:border-blue-800">
                  {summary.training.totalDurationHours} {isAr ? 'ساعة تدريبية' : 'hrs'}
                </span>
              </div>
            </div>

            {/* Level & Delivery Breakdowns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
              {/* Training Level */}
              <div className="space-y-2 min-w-0">
                <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300">
                  {isAr ? 'التوزيع حسب المستوى المعرفي:' : 'Breakdown by Training Level:'}
                </h4>
                <div className="space-y-1.5 min-w-0">
                  {(['Beginner', 'Intermediate', 'Advanced'] as TrainingLevel[]).map((lvl) => {
                    const count = summary.training.byLevel[lvl] || 0;
                    const pct = summary.training.totalCount > 0 ? Math.round((count / summary.training.totalCount) * 100) : 0;
                    return (
                      <div key={lvl} className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-xs min-w-0">
                        <span className="font-bold text-gray-700 dark:text-gray-200 truncate">{formatTrainingLevel(lvl)}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-bold text-gray-900 dark:text-gray-100">{count}</span>
                          <span className="text-[10px] text-gray-400 w-8 text-end">({pct}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Delivery Mode */}
              <div className="space-y-2 min-w-0">
                <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300">
                  {isAr ? 'التوزيع حسب طريقة التنفيذ:' : 'Breakdown by Delivery Mode:'}
                </h4>
                <div className="space-y-1.5 min-w-0">
                  {(['OnlineSelfPaced', 'LiveWorkshop', 'FieldCohort'] as DeliveryMode[]).map((mode) => {
                    const count = summary.training.byDeliveryMode[mode] || 0;
                    const pct = summary.training.totalCount > 0 ? Math.round((count / summary.training.totalCount) * 100) : 0;
                    return (
                      <div key={mode} className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-xs min-w-0">
                        <span className="font-bold text-gray-700 dark:text-gray-200 truncate">{formatDeliveryMode(mode)}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-bold text-gray-900 dark:text-gray-100">{count}</span>
                          <span className="text-[10px] text-gray-400 w-8 text-end">({pct}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* DOMAIN 4: COMMUNITY & CITIZEN JOURNALISM                                */}
        {/* ----------------------------------------------------------------------- */}
        {(activeDomainFilter === 'ALL' || activeDomainFilter === 'community') && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 p-5 shadow-xs space-y-4 min-w-0" id="reports-section-community">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-3 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                    {isAr ? 'صحافة المواطن والمشاركات المجتمعية' : 'Community & Citizen Journalism Submissions'}
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {isAr
                      ? `${summary.community.totalCount} مشاركة مجتمعية • ${summary.community.withAttachmentsCount} مشاركة بمرفقات (${summary.community.totalAttachmentsCount} ملف)`
                      : `${summary.community.totalCount} Submissions • ${summary.community.withAttachmentsCount} with Attachments (${summary.community.totalAttachmentsCount} files)`}
                  </p>
                </div>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-bold border border-amber-200/50 dark:border-amber-800 shrink-0">
                {summary.community.totalCount} {isAr ? 'مشاركة' : 'submissions'}
              </span>
            </div>

            {/* Submission Statuses */}
            <div className="space-y-2 min-w-0">
              <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                {isAr ? 'حالات التدقيق التحريري للمشاركات:' : 'Editorial Review Statuses:'}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 min-w-0">
                {Object.values(SubmissionStatus).map((status) => {
                  const count = summary.community.byStatus[status] || 0;
                  const pct = summary.community.totalCount > 0 ? Math.round((count / summary.community.totalCount) * 100) : 0;
                  return (
                    <div key={status} className="bg-gray-50 dark:bg-gray-800/60 p-3 rounded-xl border border-gray-100 dark:border-gray-800 min-w-0">
                      <div className="text-[11px] text-gray-600 dark:text-gray-300 font-bold truncate">
                        {formatSubmissionStatus(status, isAr)}
                      </div>
                      <div className="text-lg font-black text-gray-900 dark:text-gray-100 mt-0.5">
                        {count}
                      </div>
                      <div className="text-[10px] text-gray-400 font-semibold">{pct}%</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Attachment Metrics & Category Badges */}
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3 text-xs min-w-0">
              <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                <Paperclip className="w-3.5 h-3.5 text-gray-500" />
                <span>
                  {isAr
                    ? `${summary.community.withAttachmentsCount} مشاركة تتضمن أدلة ومرفقات وثائقية`
                    : `${summary.community.withAttachmentsCount} submissions include documented attachments`}
                </span>
              </div>
              {Object.keys(summary.community.byCategory).length > 0 && (
                <div className="flex flex-wrap gap-1.5 min-w-0">
                  {Object.entries(summary.community.byCategory).map(([cat, count]) => (
                    <span key={cat} className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                      {cat}: <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* DOMAIN 5: AI CONTENT AUDITOR ARTIFACTS                                  */}
        {/* ----------------------------------------------------------------------- */}
        {(activeDomainFilter === 'ALL' || activeDomainFilter === 'aiReview') && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 p-5 shadow-xs space-y-4 min-w-0" id="reports-section-aireview">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-3 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400 shrink-0">
                  <Cpu className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                    {isAr ? 'مراجعات وتدقيق الذكاء الاصطناعي الاسترشادي' : 'AI Content Auditor Advisory Artifacts'}
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {isAr
                      ? `${summary.aiReview.totalArtifactsCount} محتوى مفحوص • ${summary.aiReview.totalFindingsCount} ملاحظة استرشادية (غير ملزمة)`
                      : `${summary.aiReview.totalArtifactsCount} Reviewed Artifacts • ${summary.aiReview.totalFindingsCount} Advisory Findings (Non-binding)`}
                  </p>
                </div>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 font-bold border border-purple-200/50 dark:border-purple-800 shrink-0">
                {summary.aiReview.totalFindingsCount} {isAr ? 'ملاحظة' : 'findings'}
              </span>
            </div>

            {/* Execution State Distribution */}
            <div className="space-y-2 min-w-0">
              <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                {isAr ? 'حالات معالجة التدقيق الاسترشادي:' : 'Advisory Review Execution States:'}
              </h4>
              <div className="grid grid-cols-3 gap-2.5 min-w-0">
                {Object.values(AIReviewExecutionState).map((st) => {
                  const count = summary.aiReview.byExecutionState[st] || 0;
                  return (
                    <div key={st} className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 text-xs min-w-0">
                      <div className="font-bold text-gray-800 dark:text-gray-200 truncate">
                        {getAIExecutionStateLabel(st, isAr)}
                      </div>
                      <div className="text-lg font-black text-gray-900 dark:text-gray-100 mt-0.5">
                        {count}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Severity Breakdown */}
            <div className="space-y-2 min-w-0">
              <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                {isAr ? 'ملاحظات التدقيق حسب مستوى الأهمية:' : 'Findings by Severity Level:'}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 min-w-0">
                {Object.values(AIReviewSeverity).map((sev) => {
                  const count = summary.aiReview.findingsBySeverity[sev] || 0;
                  return (
                    <div key={sev} className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 text-xs min-w-0">
                      <div className="font-bold text-gray-800 dark:text-gray-200 truncate">
                        {getAISeverityLabel(sev, isAr)}
                      </div>
                      <div className="text-lg font-black text-gray-900 dark:text-gray-100 mt-0.5">
                        {count}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Target Type & Category Details */}
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs min-w-0">
              <div className="space-y-1.5 min-w-0">
                <span className="font-bold text-gray-600 dark:text-gray-400 block">
                  {isAr ? 'المحتويات المفحوصة حسب النوع:' : 'Reviewed Targets by Type:'}
                </span>
                <div className="space-y-1 min-w-0">
                  {Object.values(AIReviewTargetType).map((tt) => (
                    <div key={tt} className="flex justify-between py-1 border-b border-gray-50 dark:border-gray-800/40">
                      <span className="text-gray-600 dark:text-gray-400">{getAITargetTypeLabel(tt, isAr)}</span>
                      <strong className="font-mono text-gray-800 dark:text-gray-200">{summary.aiReview.byTargetType[tt] || 0}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 min-w-0">
                <span className="font-bold text-gray-600 dark:text-gray-400 block">
                  {isAr ? 'أبرز فئات الملاحظات:' : 'Findings by Category:'}
                </span>
                <div className="space-y-1 min-w-0">
                  {Object.values(AIReviewCategory).map((cat) => (
                    <div key={cat} className="flex justify-between py-1 border-b border-gray-50 dark:border-gray-800/40">
                      <span className="text-gray-600 dark:text-gray-400 truncate max-w-[200px]">{getAICategoryLabel(cat, isAr)}</span>
                      <strong className="font-mono text-gray-800 dark:text-gray-200">{summary.aiReview.findingsByCategory[cat] || 0}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* DOMAIN 6: USERS & RBAC PERMISSIONS                                      */}
        {/* ----------------------------------------------------------------------- */}
        {(activeDomainFilter === 'ALL' || activeDomainFilter === 'users') && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 p-5 shadow-xs space-y-4 min-w-0" id="reports-section-users">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-3 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 shrink-0">
                  <Shield className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                    {isAr ? 'إدارة المستخدمين والأدوار والصلاحيات (RBAC)' : 'Administrators, Roles & RBAC Distribution'}
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {isAr
                      ? `${summary.users.activeUsersCount} نشط من أصل ${summary.users.totalUsersCount} حساب • مالك المنصة نشط (${summary.users.activeOwnerCount})`
                      : `${summary.users.activeUsersCount} Active of ${summary.users.totalUsersCount} Accounts • Active Owner Safeguard (${summary.users.activeOwnerCount})`}
                  </p>
                </div>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-bold border border-rose-200/50 dark:border-rose-800 shrink-0">
                {summary.users.totalUsersCount} {isAr ? 'مستخدم' : 'users'}
              </span>
            </div>

            {/* Distribution Across All 9 Admin Roles */}
            <div className="space-y-2 min-w-0">
              <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                {isAr ? 'التوزيع التشغيلي للأدوار الإدارية (9 أدوار):' : 'Distribution Across 9 Administrative Roles:'}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 min-w-0">
                {Object.values(AdminRole).map((role) => {
                  const count = summary.users.byRole[role] || 0;
                  const badgeClass = getRoleBadgeClass(role);
                  return (
                    <div key={role} className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 text-xs min-w-0">
                      <div className="min-w-0 pr-2">
                        <div className="font-bold text-gray-900 dark:text-gray-100 truncate">
                          {getRoleLabel(role, isAr)}
                        </div>
                        <span className={`inline-block text-[9px] px-1.5 py-0.2 rounded-md font-mono border mt-0.5 ${badgeClass}`}>
                          {role}
                        </span>
                      </div>
                      <div className="font-black text-base font-mono text-gray-900 dark:text-gray-100 shrink-0">
                        {count}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* DOMAIN 7: AUDIT ACTIVITY OPERATIONAL REPORT                             */}
        {/* ----------------------------------------------------------------------- */}
        {(activeDomainFilter === 'ALL' || activeDomainFilter === 'audit') && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 p-5 shadow-xs space-y-4 min-w-0" id="reports-section-audit">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-3 min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300 shrink-0">
                  <History className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                    {isAr ? 'نشاط سجل التدقيق والرقابة' : 'Audit Trail Operational Activity'}
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {isAr
                      ? `إجمالي الأحداث الإدارية المسجلة: ${summary.auditActivity.totalEventsCount}`
                      : `Total Recorded Administrative Events: ${summary.auditActivity.totalEventsCount}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {onNavigate && (
                  <button
                    onClick={() => onNavigate('auditLog')}
                    className="text-xs px-2.5 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/80 font-bold flex items-center gap-1 cursor-pointer transition-colors border border-emerald-200/60 dark:border-emerald-800 pop-motion-micro"
                    id="reports-goto-audit-btn"
                  >
                    <span>{isAr ? 'استعراض السجل التفصيلي' : 'View Full Audit Log'}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Events by Target and Action Breakdowns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs min-w-0">
              {/* By Target Type */}
              <div className="space-y-2 min-w-0">
                <h4 className="font-bold text-gray-700 dark:text-gray-300">
                  {isAr ? 'الأحداث حسب نوع الكيان المستهدف:' : 'Events by Target Domain:'}
                </h4>
                <div className="space-y-1.5 min-w-0">
                  {Object.values(AuditTargetType).map((target) => (
                    <div key={target} className="flex justify-between items-center p-2 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                      <span className="text-gray-700 dark:text-gray-300 font-semibold">{getAuditTargetTypeLabel(target, isAr)}</span>
                      <span className="font-mono font-bold text-gray-900 dark:text-gray-100">{summary.auditActivity.byTargetType[target] || 0}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* By Action */}
              <div className="space-y-2 min-w-0">
                <h4 className="font-bold text-gray-700 dark:text-gray-300">
                  {isAr ? 'الأحداث حسب نوع الإجراء الإداري:' : 'Events by Administrative Action:'}
                </h4>
                <div className="space-y-1.5 min-w-0">
                  {Object.values(AuditAction).map((act) => (
                    <div key={act} className="flex justify-between items-center p-2 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                      <span className="text-gray-700 dark:text-gray-300 font-semibold">{getAuditActionLabel(act, isAr)}</span>
                      <span className="font-mono font-bold text-gray-900 dark:text-gray-100">{summary.auditActivity.byAction[act] || 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
