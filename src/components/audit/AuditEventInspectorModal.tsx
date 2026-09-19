import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  History,
  Shield,
  Clock,
  User,
  Layers,
  Tag,
  Info,
  FileText,
  Cpu,
  Settings,
  BookOpen,
  GraduationCap,
  Users,
  Newspaper,
  CheckCircle2,
} from 'lucide-react';
import type { AuditEvent } from '../../types/audit';
import { AuditTargetType } from '../../types/audit';
import {
  getActionLabel,
  getActionBadgeClass,
  getTargetTypeLabel,
  getTargetTypeBadgeClass,
  formatAuditValue,
  formatFieldName,
  formatAuditTimestamp,
} from './auditFormatters';
import { getRoleLabel, getRoleBadgeClass } from '../users/userFormatters';

interface AuditEventInspectorModalProps {
  event: AuditEvent | null;
  isOpen: boolean;
  onClose: () => void;
}

export const AuditEventInspectorModal: React.FC<AuditEventInspectorModalProps> = ({
  event,
  isOpen,
  onClose,
}) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  if (!isOpen || !event) return null;

  const timestampMeta = formatAuditTimestamp(event.timestamp, isAr);
  const actionLabel = getActionLabel(event.action, isAr);
  const actionBadge = getActionBadgeClass(event.action);
  const targetTypeLabel = getTargetTypeLabel(event.targetType, isAr);
  const targetTypeBadge = getTargetTypeBadgeClass(event.targetType);
  const actorRoleLabel = getRoleLabel(event.actorRole, isAr);
  const actorRoleBadge = getRoleBadgeClass(event.actorRole);

  const renderTargetIcon = () => {
    switch (event.targetType) {
      case AuditTargetType.News:
        return <Newspaper className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
      case AuditTargetType.LibraryDocument:
        return <BookOpen className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />;
      case AuditTargetType.TrainingCourse:
        return <GraduationCap className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />;
      case AuditTargetType.CitizenSubmission:
        return <Users className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />;
      case AuditTargetType.AdminUser:
        return <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />;
      case AuditTargetType.AIReviewArtifact:
        return <Cpu className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />;
      case AuditTargetType.GlobalSettings:
        return <Settings className="w-4 h-4 text-slate-600 dark:text-slate-400 shrink-0" />;
      default:
        return <FileText className="w-4 h-4 text-gray-500 shrink-0" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
      aria-labelledby="audit-inspector-title"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col my-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200 min-w-0"
        onClick={(e) => e.stopPropagation()}
        id="audit-event-inspector-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-400 border border-emerald-200/50 shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate" id="audit-inspector-title">
                {isAr ? 'فحص تفاصيل سجل التدقيق' : 'Audit Event Inspector'}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                {event.id}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer shrink-0"
            aria-label={isAr ? 'إغلاق' : 'Close'}
            id="audit-inspector-close-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 min-w-0 text-xs sm:text-sm">
          {/* 1. Core Summary Banner */}
          <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200/80 dark:border-gray-700/80 rounded-xl p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${actionBadge}`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {actionLabel}
                </span>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border ${targetTypeBadge}`}>
                  {renderTargetIcon()}
                  {targetTypeLabel}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-xs font-medium">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>{timestampMeta.full}</span>
              </div>
            </div>
          </div>

          {/* 2. Grid: Actor Snapshot & Target Snapshot */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Actor Card */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-500 dark:text-gray-400">
                <User className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{isAr ? 'بيانات المنفّذ (لحظة الحدث)' : 'Actor Snapshot (Event Time)'}</span>
              </div>
              <div className="space-y-1">
                <p className="font-bold text-gray-900 dark:text-gray-100 text-sm break-words">
                  {event.actorName}
                </p>
                <div className="pt-0.5">
                  <span className={`inline-block text-[11px] px-2 py-0.5 rounded-md font-bold border ${actorRoleBadge}`}>
                    {actorRoleLabel}
                  </span>
                </div>
                <p className="text-[11px] font-mono text-gray-400 dark:text-gray-500 break-all pt-1">
                  ID: {event.actorUserId}
                </p>
              </div>
            </div>

            {/* Target Card */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-500 dark:text-gray-400">
                <Tag className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span>{isAr ? 'السجل المستهدف' : 'Target Entity'}</span>
              </div>
              <div className="space-y-1">
                <p className="font-bold text-gray-900 dark:text-gray-100 text-sm break-words">
                  {event.targetTitle || event.targetId}
                </p>
                <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400 break-all">
                  ID: {event.targetId}
                </p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  {isAr ? 'النوع: ' : 'Type: '}
                  <span className="font-semibold text-gray-700 dark:text-gray-300">{targetTypeLabel}</span>
                </p>
              </div>
            </div>
          </div>

          {/* 3. Structured Changes Breakdown */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                {isAr ? 'التغييرات المسجلة بالتفصيل' : 'Structured Changes'}
              </h4>
              <span className="text-[11px] text-gray-400 dark:text-gray-500 font-semibold">
                {event.changes?.length || 0} {isAr ? 'حقل معدل' : 'field(s) modified'}
              </span>
            </div>

            {(!event.changes || event.changes.length === 0) ? (
              <div className="bg-gray-50 dark:bg-gray-800/40 rounded-xl p-4 text-center text-xs text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700">
                {isAr ? 'لم تسجل فروقات حقول تفصيلية لهذا الحدث.' : 'No detailed field-level deltas were recorded for this event.'}
              </div>
            ) : (
              <div className="space-y-2" id="audit-changes-list">
                {event.changes.map((change, idx) => {
                  const fieldLabel = formatFieldName(change.field, isAr);
                  const prevFormatted = formatAuditValue(change.field, change.previousValue, isAr);
                  const newFormatted = formatAuditValue(change.field, change.newValue, isAr);

                  return (
                    <div
                      key={`${change.field}-${idx}`}
                      className="bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-xl p-3 space-y-2 shadow-xs"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-1.5">
                        <span className="font-bold text-xs text-gray-900 dark:text-gray-100">
                          {fieldLabel}
                        </span>
                        <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500">
                          {change.field}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
                        {/* Previous Value */}
                        <div className="bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-900/40 rounded-lg p-2 space-y-0.5">
                          <span className="text-[10px] font-bold text-rose-700 dark:text-rose-400 block">
                            {isAr ? 'القيمة السابقة:' : 'Previous Value:'}
                          </span>
                          <p className="font-semibold text-rose-900 dark:text-rose-200 break-words">
                            {prevFormatted}
                          </p>
                        </div>

                        {/* New Value */}
                        <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 rounded-lg p-2 space-y-0.5">
                          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 block">
                            {isAr ? 'القيمة الجديدة:' : 'New Value:'}
                          </span>
                          <p className="font-semibold text-emerald-900 dark:text-emerald-200 break-words">
                            {newFormatted}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4. Metadata & Notes (if present) */}
          {event.metadata && Object.keys(event.metadata).length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                {isAr ? 'بيانات وملاحظات سياقية' : 'Context Metadata & Notes'}
              </h4>
              <div className="bg-gray-50 dark:bg-gray-800/40 rounded-xl p-3 border border-gray-200 dark:border-gray-800 space-y-1.5">
                {Object.entries(event.metadata).map(([key, value]) => (
                  <div key={key} className="flex flex-col sm:flex-row sm:items-baseline gap-1 text-xs">
                    <span className="font-bold text-gray-600 dark:text-gray-400 sm:w-32 shrink-0">
                      {key}:
                    </span>
                    <span className="text-gray-800 dark:text-gray-200 break-words font-medium">
                      {String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5. Read-Only Notice */}
          <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-300">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              {isAr
                ? 'سجل التدقيق للقراءة والمعاينة فقط. كافة الأحداث غير قابلة للتعديل أو الحذف أو إعادة الترتيب لحفظ الشفافية الإدارية.'
                : 'The audit log is strictly read-only. All events are immutable and cannot be edited, deleted, or reordered to maintain administrative transparency.'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 rounded-xl text-xs font-bold hover:bg-gray-900 dark:hover:bg-white transition-colors cursor-pointer"
            id="audit-inspector-dismiss-btn"
          >
            {isAr ? 'إغلاق المعاينة' : 'Close Inspector'}
          </button>
        </div>
      </div>
    </div>
  );
};
