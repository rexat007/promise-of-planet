import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  History,
  Search,
  Shield,
  ShieldAlert,
  ArrowUpDown,
  Eye,
  Layers,
  User,
  CheckCircle2,
  Lock,
  Newspaper,
  BookOpen,
  GraduationCap,
  Users,
  Cpu,
  Settings,
  FileText,
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import { AdminPermission } from '../../types/admin';
import type { AuditEvent } from '../../types/audit';
import { AuditAction, AuditTargetType } from '../../types/audit';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminAuditService } from '../../services/adminAuditService';
import {
  getActionLabel,
  getActionBadgeClass,
  getTargetTypeLabel,
  getTargetTypeBadgeClass,
  formatAuditTimestamp,
} from './auditFormatters';
import { getRoleLabel, getRoleBadgeClass } from '../users/userFormatters';
import { AuditEventInspectorModal } from './AuditEventInspectorModal';

interface AdminAuditLogManagementProps {
  currentUser: AdminUser;
}

export const AdminAuditLogManagement: React.FC<AdminAuditLogManagementProps> = ({
  currentUser,
}) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  // RBAC Permission Check
  const canViewAuditLog = AdminAccessService.hasPermission(
    currentUser,
    AdminPermission.ManageSettings
  );

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTargetFilter, setSelectedTargetFilter] = useState<string>('ALL');
  const [selectedActionFilter, setSelectedActionFilter] = useState<string>('ALL');
  const [selectedActorFilter, setSelectedActorFilter] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

  // Inspector Modal State
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  // Retrieve raw events from canonical service
  const allEvents = useMemo(() => {
    return AdminAuditService.getEvents();
  }, []);

  // Compute list of distinct actors present in historical events
  const distinctActors = useMemo(() => {
    const actorMap = new Map<string, { id: string; name: string }>();
    allEvents.forEach((evt) => {
      if (!actorMap.has(evt.actorUserId)) {
        actorMap.set(evt.actorUserId, { id: evt.actorUserId, name: evt.actorName });
      }
    });
    return Array.from(actorMap.values());
  }, [allEvents]);

  // Derived Operational Summary Metrics
  const totalEventsCount = allEvents.length;
  const workflowEventsCount = allEvents.filter(
    (e) => e.action === AuditAction.WorkflowTransitioned
  ).length;
  const securityEventsCount = allEvents.filter(
    (e) => e.action === AuditAction.RoleChanged || e.action === AuditAction.StatusChanged
  ).length;
  const uniqueActorsCount = distinctActors.length;

  // Single Canonical Presentation Pipeline: search, filter, and sort
  const filteredEvents = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    const filtered = allEvents.filter((event) => {
      // 1. Search Query filter across metadata
      if (q) {
        const actionLabel = getActionLabel(event.action, isAr).toLowerCase();
        const targetTypeLabel = getTargetTypeLabel(event.targetType, isAr).toLowerCase();
        const actorRoleLabel = getRoleLabel(event.actorRole, isAr).toLowerCase();
        const targetTitle = (event.targetTitle || '').toLowerCase();

        const matchesSearch =
          event.id.toLowerCase().includes(q) ||
          event.actorName.toLowerCase().includes(q) ||
          event.actorUserId.toLowerCase().includes(q) ||
          event.targetId.toLowerCase().includes(q) ||
          targetTitle.includes(q) ||
          actionLabel.includes(q) ||
          targetTypeLabel.includes(q) ||
          actorRoleLabel.includes(q);

        if (!matchesSearch) return false;
      }

      // 2. Target Type filter
      if (selectedTargetFilter !== 'ALL' && event.targetType !== selectedTargetFilter) {
        return false;
      }

      // 3. Action filter
      if (selectedActionFilter !== 'ALL' && event.action !== selectedActionFilter) {
        return false;
      }

      // 4. Actor filter
      if (selectedActorFilter !== 'ALL' && event.actorUserId !== selectedActorFilter) {
        return false;
      }

      return true;
    });

    // 5. Apply sort order
    filtered.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
    });

    return filtered;
  }, [
    allEvents,
    searchQuery,
    selectedTargetFilter,
    selectedActionFilter,
    selectedActorFilter,
    sortOrder,
    isAr,
  ]);

  const handleOpenInspector = (event: AuditEvent) => {
    setSelectedEvent(event);
    setIsInspectorOpen(true);
  };

  const handleCloseInspector = () => {
    setIsInspectorOpen(false);
    setSelectedEvent(null);
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedTargetFilter('ALL');
    setSelectedActionFilter('ALL');
    setSelectedActorFilter('ALL');
    setSortOrder('newest');
  };

  const renderTargetIcon = (type: AuditTargetType) => {
    switch (type) {
      case AuditTargetType.News:
        return <Newspaper className="w-3.5 h-3.5 shrink-0" />;
      case AuditTargetType.LibraryDocument:
        return <BookOpen className="w-3.5 h-3.5 shrink-0" />;
      case AuditTargetType.TrainingCourse:
        return <GraduationCap className="w-3.5 h-3.5 shrink-0" />;
      case AuditTargetType.CitizenSubmission:
        return <Users className="w-3.5 h-3.5 shrink-0" />;
      case AuditTargetType.AdminUser:
        return <Shield className="w-3.5 h-3.5 shrink-0" />;
      case AuditTargetType.AIReviewArtifact:
        return <Cpu className="w-3.5 h-3.5 shrink-0" />;
      case AuditTargetType.GlobalSettings:
        return <Settings className="w-3.5 h-3.5 shrink-0" />;
      default:
        return <FileText className="w-3.5 h-3.5 shrink-0" />;
    }
  };

  // Unauthorized State
  if (!canViewAuditLog) {
    return (
      <div className="space-y-6 max-w-full min-w-0" id="admin-audit-log-unauthorized">
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 md:p-8 text-center space-y-4 shadow-xs">
          <div className="h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
              {isAr ? 'صلاحية الوصول لسجل التدقيق مقيدة' : 'Audit Log Access Restricted'}
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {isAr
                ? `يتطلب استعراض سجل تدقيق الأنشطة صلاحية (${AdminPermission.ManageSettings}). دورك الحالي هو (${currentUser.role}).`
                : `Viewing the platform audit trail requires (${AdminPermission.ManageSettings}) permission. Your current role is (${currentUser.role}).`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-full min-w-0" id="admin-audit-log-management">
      {/* 1. Module Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-gray-100 dark:border-gray-800 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2.5 rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-400 border border-emerald-200/50 shrink-0">
            <History className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-black text-gray-900 dark:text-gray-100 flex items-center gap-2 truncate">
              {isAr ? 'سجل تدقيق الأنشطة والعمليات' : 'Platform Audit Log & History'}
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-bold border border-gray-200 dark:border-gray-700 shrink-0">
                {isAr ? 'للقراءة فقط' : 'Read-Only'}
              </span>
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {isAr
                ? 'توثيق غير قابل للتعديل لكافة الإجراءات الإدارية وتغييرات سير العمل وحقوق النشر'
                : 'Append-only historical audit trail for administrative actions, workflow transitions, and access changes'}
            </p>
          </div>
        </div>

        {/* Sort Toggle Button */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
            className="px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            id="audit-sort-toggle-btn"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>
              {sortOrder === 'newest'
                ? isAr
                  ? 'الأحدث أولاً'
                  : 'Newest First'
                : isAr
                ? 'الأقدم أولاً'
                : 'Oldest First'}
            </span>
          </button>
        </div>
      </div>

      {/* 2. Summary Metric Chips (Directly Derived) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 min-w-0 max-w-full">
        {/* Total Events */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800/80 p-3.5 shadow-xs flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/50 shrink-0">
            <History className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 truncate">
              {isAr ? 'إجمالي الأحداث' : 'Total Events'}
            </p>
            <p className="text-lg font-black text-gray-900 dark:text-gray-100" id="metric-total-events">
              {totalEventsCount}
            </p>
          </div>
        </div>

        {/* Workflow Transitions */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800/80 p-3.5 shadow-xs flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 border border-purple-200/50 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 truncate">
              {isAr ? 'تحولات سير العمل' : 'Workflow Transitions'}
            </p>
            <p className="text-lg font-black text-gray-900 dark:text-gray-100" id="metric-workflow-events">
              {workflowEventsCount}
            </p>
          </div>
        </div>

        {/* Security & Access Changes */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800/80 p-3.5 shadow-xs flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200/50 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 truncate">
              {isAr ? 'تغييرات الهوية والأدوار' : 'Security & Roles'}
            </p>
            <p className="text-lg font-black text-gray-900 dark:text-gray-100" id="metric-security-events">
              {securityEventsCount}
            </p>
          </div>
        </div>

        {/* Distinct Actors */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800/80 p-3.5 shadow-xs flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 border border-sky-200/50 shrink-0">
            <User className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 truncate">
              {isAr ? 'المنفذون المسجلون' : 'Active Actors'}
            </p>
            <p className="text-lg font-black text-gray-900 dark:text-gray-100" id="metric-active-actors">
              {uniqueActorsCount}
            </p>
          </div>
        </div>
      </div>

      {/* 3. Search & Filter Bar (Responsive with fluid stacking) */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800/80 p-4 shadow-xs space-y-3 min-w-0 max-w-full">
        <div className="flex flex-col lg:flex-row gap-3 min-w-0">
          {/* Search Input */}
          <div className="relative flex-1 min-w-0">
            <div className="absolute inset-y-0 start-0 flex items-center ps-3.5 pointer-events-none text-gray-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                isAr
                  ? 'البحث باسم المنفّذ، المعرّف، السجل المستهدف، أو نوع الإجراء...'
                  : 'Search by actor, ID, target title, or action...'
              }
              className="w-full min-w-0 ps-10 pe-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
              id="audit-search-input"
            />
          </div>

          {/* Filter Selects Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-0">
            {/* Target Type Filter */}
            <div className="relative min-w-0">
              <select
                value={selectedTargetFilter}
                onChange={(e) => setSelectedTargetFilter(e.target.value)}
                className="w-full min-w-0 max-w-full truncate px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-800 dark:text-gray-200 focus:outline-hidden focus:border-emerald-500 cursor-pointer"
                id="target-filter-select"
              >
                <option value="ALL">{isAr ? 'جميع المجالات' : 'All Domains'}</option>
                {Object.values(AuditTargetType).map((type) => (
                  <option key={type} value={type}>
                    {getTargetTypeLabel(type, isAr)}
                  </option>
                ))}
              </select>
            </div>

            {/* Action Filter */}
            <div className="relative min-w-0">
              <select
                value={selectedActionFilter}
                onChange={(e) => setSelectedActionFilter(e.target.value)}
                className="w-full min-w-0 max-w-full truncate px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-800 dark:text-gray-200 focus:outline-hidden focus:border-emerald-500 cursor-pointer"
                id="action-filter-select"
              >
                <option value="ALL">{isAr ? 'جميع أنواع الإجراءات' : 'All Actions'}</option>
                {Object.values(AuditAction).map((action) => (
                  <option key={action} value={action}>
                    {getActionLabel(action, isAr)}
                  </option>
                ))}
              </select>
            </div>

            {/* Actor Filter */}
            <div className="relative min-w-0">
              <select
                value={selectedActorFilter}
                onChange={(e) => setSelectedActorFilter(e.target.value)}
                className="w-full min-w-0 max-w-full truncate px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-800 dark:text-gray-200 focus:outline-hidden focus:border-emerald-500 cursor-pointer"
                id="actor-filter-select"
              >
                <option value="ALL">{isAr ? 'جميع المنفذين' : 'All Actors'}</option>
                {distinctActors.map((act) => (
                  <option key={act.id} value={act.id}>
                    {act.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Filter Summary & Reset Bar */}
        <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-800 flex-wrap gap-1 min-w-0">
          <span className="min-w-0 truncate">
            {isAr
              ? `عرض ${filteredEvents.length} من إجمالي ${totalEventsCount} حدث مسجل`
              : `Showing ${filteredEvents.length} of ${totalEventsCount} recorded audit events`}
          </span>
          {(searchQuery ||
            selectedTargetFilter !== 'ALL' ||
            selectedActionFilter !== 'ALL' ||
            selectedActorFilter !== 'ALL' ||
            sortOrder !== 'newest') && (
            <button
              onClick={handleResetFilters}
              className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline cursor-pointer shrink-0"
              id="audit-reset-filters-btn"
            >
              {isAr ? 'إعادة ضبط التصفية' : 'Reset Filters'}
            </button>
          )}
        </div>
      </div>

      {/* 4. Empty State */}
      {filteredEvents.length === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center space-y-3 shadow-xs min-w-0 max-w-full">
          <div className="h-12 w-12 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 flex items-center justify-center mx-auto">
            <Search className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {isAr ? 'لا توجد أحداث تدقيق مطابقة' : 'No audit events match your criteria'}
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            {isAr
              ? 'جرّب تعديل مصطلحات البحث أو تغيير خيارات التصفية للمجالات والإجراءات والمنفذين.'
              : 'Try adjusting your search terms or clearing the domain, action, or actor filters.'}
          </p>
        </div>
      )}

      {/* 5. Responsive Data Presentation */}
      {filteredEvents.length > 0 && (
        <>
          {/* A. Compact Cards (< 1280px / xl breakpoint) */}
          <div
            className="xl:hidden grid grid-cols-1 md:grid-cols-2 gap-3.5 min-w-0 max-w-full"
            id="audit-compact-cards-view"
          >
            {filteredEvents.map((event) => {
              const timestampMeta = formatAuditTimestamp(event.timestamp, isAr);
              const actionLabel = getActionLabel(event.action, isAr);
              const actionBadge = getActionBadgeClass(event.action);
              const targetTypeLabel = getTargetTypeLabel(event.targetType, isAr);
              const targetTypeBadge = getTargetTypeBadgeClass(event.targetType);
              const actorRoleLabel = getRoleLabel(event.actorRole, isAr);
              const actorRoleBadge = getRoleBadgeClass(event.actorRole);
              const changesCount = event.changes?.length || 0;

              return (
                <div
                  key={event.id}
                  className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800/80 p-4 shadow-xs space-y-3 relative overflow-hidden min-w-0 max-w-full flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Top Row: Action & Target Badges + Timestamp */}
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border ${actionBadge}`}
                        >
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                          {actionLabel}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${targetTypeBadge}`}
                        >
                          {renderTargetIcon(event.targetType)}
                          {targetTypeLabel}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono shrink-0">
                        {timestampMeta.date}
                      </span>
                    </div>

                    {/* Target Title & ID */}
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-xs font-bold text-gray-900 dark:text-gray-100 line-clamp-2 break-words">
                        {event.targetTitle || event.targetId}
                      </p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate">
                        ID: {event.targetId}
                      </p>
                    </div>

                    {/* Actor Snapshot */}
                    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-2.5 flex items-center justify-between gap-2 min-w-0 border border-gray-100 dark:border-gray-800">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-7 w-7 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-400 flex items-center justify-center shrink-0 font-bold text-xs">
                          {event.actorName.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">
                            {event.actorName}
                          </p>
                          <span
                            className={`inline-block text-[9px] px-1.5 py-0.2 rounded font-bold border ${actorRoleBadge}`}
                          >
                            {actorRoleLabel}
                          </span>
                        </div>
                      </div>
                      {changesCount > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-200/80 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold shrink-0">
                          {changesCount} {isAr ? 'تعديلات' : 'deltas'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Action: Inspect */}
                  <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between min-w-0">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate">
                      {event.id}
                    </span>
                    <button
                      onClick={() => handleOpenInspector(event)}
                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{isAr ? 'معاينة التفاصيل' : 'Inspect'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* B. Dense Desktop Table (>= 1280px / xl breakpoint) */}
          <div
            className="hidden xl:block bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800/80 shadow-xs overflow-hidden min-w-0 max-w-full"
            id="audit-dense-table-view"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50/80 dark:bg-gray-800/60 border-b border-gray-200/80 dark:border-gray-800 text-gray-600 dark:text-gray-300 font-bold">
                    <th className="py-3 px-4 text-start w-40">{isAr ? 'التوقيت' : 'Timestamp'}</th>
                    <th className="py-3 px-4 text-start w-52">{isAr ? 'المنفّذ (لحظة الحدث)' : 'Actor (Snapshot)'}</th>
                    <th className="py-3 px-4 text-start w-36">{isAr ? 'الإجراء' : 'Action'}</th>
                    <th className="py-3 px-4 text-start w-36">{isAr ? 'المجال' : 'Domain'}</th>
                    <th className="py-3 px-4 text-start">{isAr ? 'السجل المستهدف' : 'Target Entity'}</th>
                    <th className="py-3 px-4 text-start w-28">{isAr ? 'التعديلات' : 'Deltas'}</th>
                    <th className="py-3 px-4 text-center w-24">{isAr ? 'فحص' : 'Inspect'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-gray-800 dark:text-gray-200">
                  {filteredEvents.map((event) => {
                    const timestampMeta = formatAuditTimestamp(event.timestamp, isAr);
                    const actionLabel = getActionLabel(event.action, isAr);
                    const actionBadge = getActionBadgeClass(event.action);
                    const targetTypeLabel = getTargetTypeLabel(event.targetType, isAr);
                    const targetTypeBadge = getTargetTypeBadgeClass(event.targetType);
                    const actorRoleLabel = getRoleLabel(event.actorRole, isAr);
                    const actorRoleBadge = getRoleBadgeClass(event.actorRole);
                    const changesCount = event.changes?.length || 0;

                    return (
                      <tr
                        key={event.id}
                        className="hover:bg-gray-50/60 dark:hover:bg-gray-800/40 transition-colors"
                      >
                        {/* Timestamp */}
                        <td className="py-3 px-4 font-mono text-[11px] text-gray-600 dark:text-gray-400">
                          <div className="font-semibold text-gray-900 dark:text-gray-100">
                            {timestampMeta.date}
                          </div>
                          <div className="text-[10px] text-gray-400">{timestampMeta.time}</div>
                        </td>

                        {/* Actor Snapshot */}
                        <td className="py-3 px-4">
                          <div className="font-bold text-gray-900 dark:text-gray-100 truncate max-w-[180px]">
                            {event.actorName}
                          </div>
                          <span
                            className={`inline-block text-[9px] px-1.5 py-0.2 rounded font-bold border ${actorRoleBadge}`}
                          >
                            {actorRoleLabel}
                          </span>
                        </td>

                        {/* Action */}
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border ${actionBadge}`}
                          >
                            {actionLabel}
                          </span>
                        </td>

                        {/* Target Domain */}
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${targetTypeBadge}`}
                          >
                            {renderTargetIcon(event.targetType)}
                            {targetTypeLabel}
                          </span>
                        </td>

                        {/* Target Entity */}
                        <td className="py-3 px-4">
                          <div className="font-bold text-gray-900 dark:text-gray-100 truncate max-w-xs">
                            {event.targetTitle || event.targetId}
                          </div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate">
                            ID: {event.targetId}
                          </div>
                        </td>

                        {/* Deltas Count */}
                        <td className="py-3 px-4">
                          {changesCount > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-[11px] font-bold border border-gray-200 dark:border-gray-700">
                              <Layers className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              {changesCount} {isAr ? 'حقول' : 'fields'}
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-400 dark:text-gray-500">
                              {isAr ? 'لا يوجد' : 'None'}
                            </span>
                          )}
                        </td>

                        {/* Inspect Button */}
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => handleOpenInspector(event)}
                            className="p-1.5 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded-lg transition-colors cursor-pointer"
                            title={isAr ? 'معاينة تفاصيل الحدث' : 'Inspect event details'}
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 6. Event Inspector Modal */}
      <AuditEventInspectorModal
        event={selectedEvent}
        isOpen={isInspectorOpen}
        onClose={handleCloseInspector}
      />
    </div>
  );
};
