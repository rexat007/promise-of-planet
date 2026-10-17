"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTION_METADATA = exports.TARGET_TYPE_METADATA = void 0;
exports.getTargetTypeLabel = getTargetTypeLabel;
exports.getTargetTypeBadgeClass = getTargetTypeBadgeClass;
exports.getActionLabel = getActionLabel;
exports.getActionBadgeClass = getActionBadgeClass;
exports.formatWorkflowState = formatWorkflowState;
exports.formatSubmissionStatus = formatSubmissionStatus;
exports.formatRightsStatus = formatRightsStatus;
exports.formatAuditValue = formatAuditValue;
exports.formatFieldName = formatFieldName;
exports.formatAuditTimestamp = formatAuditTimestamp;
const audit_1 = require("../../types/audit");
const admin_1 = require("../../types/admin");
const workflow_1 = require("../../types/workflow");
const library_1 = require("../../types/library");
const community_1 = require("../../types/community");
const userFormatters_1 = require("../users/userFormatters");
exports.TARGET_TYPE_METADATA = {
    [audit_1.AuditTargetType.News]: {
        type: audit_1.AuditTargetType.News,
        labelAr: 'الأخبار البيئية',
        labelEn: 'Environmental News',
        iconName: 'Newspaper',
        badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
    },
    [audit_1.AuditTargetType.LibraryDocument]: {
        type: audit_1.AuditTargetType.LibraryDocument,
        labelAr: 'المكتبة والوثائق',
        labelEn: 'Library Document',
        iconName: 'BookOpen',
        badgeClass: 'bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300 border-teal-300 dark:border-teal-800',
    },
    [audit_1.AuditTargetType.TrainingCourse]: {
        type: audit_1.AuditTargetType.TrainingCourse,
        labelAr: 'البرامج التدريبية',
        labelEn: 'Training Course',
        iconName: 'GraduationCap',
        badgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border-sky-300 dark:border-sky-800',
    },
    [audit_1.AuditTargetType.CitizenSubmission]: {
        type: audit_1.AuditTargetType.CitizenSubmission,
        labelAr: 'صحافة المواطن',
        labelEn: 'Citizen Submission',
        iconName: 'Users',
        badgeClass: 'bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-300 border-orange-300 dark:border-orange-800',
    },
    [audit_1.AuditTargetType.AdminUser]: {
        type: audit_1.AuditTargetType.AdminUser,
        labelAr: 'المستخدمون والصلاحيات',
        labelEn: 'Admin User & Access',
        iconName: 'Shield',
        badgeClass: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800',
    },
    [audit_1.AuditTargetType.AIReviewArtifact]: {
        type: audit_1.AuditTargetType.AIReviewArtifact,
        labelAr: 'مراجعة الذكاء الاصطناعي',
        labelEn: 'AI Review Artifact',
        iconName: 'Cpu',
        badgeClass: 'bg-violet-100 text-violet-800 dark:bg-violet-950/70 dark:text-violet-300 border-violet-300 dark:border-violet-800',
    },
    [audit_1.AuditTargetType.GlobalSettings]: {
        type: audit_1.AuditTargetType.GlobalSettings,
        labelAr: 'الإعدادات العامة',
        labelEn: 'Global Settings',
        iconName: 'Settings',
        badgeClass: 'bg-slate-100 text-slate-800 dark:bg-slate-950/70 dark:text-slate-300 border-slate-300 dark:border-slate-800',
    },
    [audit_1.AuditTargetType.Media]: {
        type: audit_1.AuditTargetType.Media,
        labelAr: 'الوسائط والفيديو',
        labelEn: 'Media & Video',
        iconName: 'Video',
        badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
    },
};
exports.ACTION_METADATA = {
    [audit_1.AuditAction.Created]: {
        action: audit_1.AuditAction.Created,
        labelAr: 'إنشاء جديد',
        labelEn: 'Created',
        descAr: 'تم إنشاء سجل أو مسودة جديدة في النظام.',
        descEn: 'A new record or draft was created in the platform.',
        badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
    },
    [audit_1.AuditAction.Updated]: {
        action: audit_1.AuditAction.Updated,
        labelAr: 'تحديث بيانات',
        labelEn: 'Updated',
        descAr: 'تم تعديل البيانات الوصفية أو الحقول الفنية للسجل.',
        descEn: 'Metadata or entity properties were modified.',
        badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border-blue-300 dark:border-blue-800',
    },
    [audit_1.AuditAction.WorkflowTransitioned]: {
        action: audit_1.AuditAction.WorkflowTransitioned,
        labelAr: 'انتقال سير العمل',
        labelEn: 'Workflow Transitioned',
        descAr: 'تم نقل المحتوى بين حالات الاعتماد والنشر التحريري.',
        descEn: 'Editorial content moved between workflow stages.',
        badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border-purple-300 dark:border-purple-800',
    },
    [audit_1.AuditAction.StatusChanged]: {
        action: audit_1.AuditAction.StatusChanged,
        labelAr: 'تغيير الحالة',
        labelEn: 'Status Changed',
        descAr: 'تم تحديث حالة النشاط أو المراجعة الرقابية للسجل.',
        descEn: 'Operational status or moderation state was updated.',
        badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-800',
    },
    [audit_1.AuditAction.RoleChanged]: {
        action: audit_1.AuditAction.RoleChanged,
        labelAr: 'تغيير الدور والصلاحيات',
        labelEn: 'Role Changed',
        descAr: 'تم إعادة تعيين الدور الإداري وصلاحيات الهوية.',
        descEn: 'Administrative role and permissions were reassigned.',
        badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-800',
    },
    [audit_1.AuditAction.RightsChanged]: {
        action: audit_1.AuditAction.RightsChanged,
        labelAr: 'تحديث رخصة النشر',
        labelEn: 'Rights Changed',
        descAr: 'تم تحديث ترخيص أو حالة حقوق الملكية الفكرية للوثيقة.',
        descEn: 'Intellectual property or distribution rights clearance changed.',
        badgeClass: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/70 dark:text-cyan-300 border-cyan-300 dark:border-cyan-800',
    },
};
/**
 * Returns localized label for an AuditTargetType
 */
function getTargetTypeLabel(type, isAr) {
    const meta = exports.TARGET_TYPE_METADATA[type];
    return meta ? (isAr ? meta.labelAr : meta.labelEn) : type;
}
/**
 * Returns localized badge class for an AuditTargetType
 */
function getTargetTypeBadgeClass(type) {
    return exports.TARGET_TYPE_METADATA[type]?.badgeClass || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-300';
}
/**
 * Returns localized label for an AuditAction
 */
function getActionLabel(action, isAr) {
    const meta = exports.ACTION_METADATA[action];
    return meta ? (isAr ? meta.labelAr : meta.labelEn) : action;
}
/**
 * Returns localized badge class for an AuditAction
 */
function getActionBadgeClass(action) {
    return exports.ACTION_METADATA[action]?.badgeClass || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-300';
}
/**
 * Format workflow states
 */
function formatWorkflowState(state, isAr) {
    switch (state) {
        case workflow_1.WorkflowState.Draft:
            return isAr ? 'مسودة أولية' : 'Draft';
        case workflow_1.WorkflowState.InReview:
            return isAr ? 'قيد المراجعة والتدقيق' : 'In Review';
        case workflow_1.WorkflowState.ChangesRequested:
            return isAr ? 'مطلوب تعديلات' : 'Changes Requested';
        case workflow_1.WorkflowState.Approved:
            return isAr ? 'معتمد رسمياً' : 'Approved';
        case workflow_1.WorkflowState.Published:
            return isAr ? 'منشور للعامة' : 'Published';
        default:
            return state;
    }
}
/**
 * Format submission status
 */
function formatSubmissionStatus(status, isAr) {
    switch (status) {
        case community_1.SubmissionStatus.Received:
            return isAr ? 'مستلم جديد' : 'Received';
        case community_1.SubmissionStatus.UnderReview:
            return isAr ? 'قيد التدقيق والتحقق' : 'Under Review';
        case community_1.SubmissionStatus.AcceptedForEditorial:
            return isAr ? 'مقبول للتحرير والنشر' : 'Accepted for Editorial';
        case community_1.SubmissionStatus.Rejected:
            return isAr ? 'مرفوض' : 'Rejected';
        default:
            return status;
    }
}
/**
 * Format library rights status
 */
function formatRightsStatus(status, isAr) {
    switch (status) {
        case library_1.LibraryRightsStatus.Unknown:
            return isAr ? 'غير محدد / قيد الفحص' : 'Unknown / Pending Verification';
        case library_1.LibraryRightsStatus.ReviewRequired:
            return isAr ? 'يتطلب مراجعة حقوقية' : 'Review Required';
        case library_1.LibraryRightsStatus.PermissionRequired:
            return isAr ? 'يتطلب تصريح رسمي' : 'Permission Required';
        case library_1.LibraryRightsStatus.PermissionGranted:
            return isAr ? 'تم استلام التصريح والترخيص' : 'Permission Granted';
        case library_1.LibraryRightsStatus.OpenPubliclyAvailable:
            return isAr ? 'متاح للعامة والمطالعة' : 'Open / Publicly Available';
        case library_1.LibraryRightsStatus.Restricted:
            return isAr ? 'مقيد / استخدام داخلي' : 'Restricted';
        case library_1.LibraryRightsStatus.NotRedistributable:
            return isAr ? 'غير مسموح بإعادة التوزيع' : 'Not Redistributable';
        default:
            return status;
    }
}
/**
 * Format audit change values with domain awareness
 */
function formatAuditValue(field, value, isAr) {
    if (value === null || value === undefined || value === '') {
        return isAr ? 'غير محدد (فارغ)' : 'Not set (empty)';
    }
    if (typeof value === 'boolean') {
        if (field === 'isActive') {
            return value ? (isAr ? 'نشط' : 'Active') : (isAr ? 'معطل' : 'Inactive');
        }
        return value ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No');
    }
    const strVal = String(value);
    // Field-specific formatter routing
    if (field === 'role' && Object.values(admin_1.AdminRole).includes(strVal)) {
        return (0, userFormatters_1.getRoleLabel)(strVal, isAr);
    }
    if (field === 'workflowState' || field === 'fromState' || field === 'toState') {
        return formatWorkflowState(strVal, isAr);
    }
    if (field === 'rightsStatus') {
        return formatRightsStatus(strVal, isAr);
    }
    if (field === 'status' && Object.values(community_1.SubmissionStatus).includes(strVal)) {
        return formatSubmissionStatus(strVal, isAr);
    }
    return strVal;
}
/**
 * Localized human-readable label for common audit fields
 */
function formatFieldName(field, isAr) {
    const fieldMap = {
        workflowState: { ar: 'حالة سير العمل', en: 'Workflow State' },
        rightsStatus: { ar: 'حالة حقوق النشر', en: 'Rights Status' },
        role: { ar: 'الدور والصلاحية', en: 'Role & Authority' },
        isActive: { ar: 'حالة النشاط', en: 'Account Status' },
        name: { ar: 'الاسم الكامل', en: 'Full Name' },
        email: { ar: 'البريد الإلكتروني', en: 'Email Address' },
        level: { ar: 'المستوى الأكاديمي', en: 'Course Level' },
        deliveryMode: { ar: 'نمط التدريب', en: 'Delivery Mode' },
        status: { ar: 'الحالة التشغيلية', en: 'Status' },
        executionState: { ar: 'حالة المعالجة', en: 'Execution State' },
        findingsCount: { ar: 'عدد الملاحظات المرصودة', en: 'Findings Count' },
        titleAr: { ar: 'العنوان بالعربية', en: 'Arabic Title' },
        titleEn: { ar: 'العنوان بالإنجليزية', en: 'English Title' },
        summaryAr: { ar: 'الملخص بالعربية', en: 'Arabic Summary' },
        summaryEn: { ar: 'الملخص بالإنجليزية', en: 'English Summary' },
        bodyAr: { ar: 'نص المحتوى بالعربية', en: 'Arabic Content Body' },
        bodyEn: { ar: 'نص المحتوى بالإنجليزية', en: 'English Content Body' },
    };
    if (fieldMap[field]) {
        return isAr ? fieldMap[field].ar : fieldMap[field].en;
    }
    return field;
}
/**
 * Canonical ISO Timestamp Formatter for localized display
 */
function formatAuditTimestamp(isoString, isAr) {
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) {
            return { date: isoString, time: '', full: isoString };
        }
        const dateOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        };
        const timeOptions = {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
        };
        const dateStr = d.toLocaleDateString(isAr ? 'ar-SD' : 'en-US', dateOptions);
        const timeStr = d.toLocaleTimeString(isAr ? 'ar-SD' : 'en-US', timeOptions);
        return {
            date: dateStr,
            time: timeStr,
            full: `${dateStr} — ${timeStr}`,
        };
    }
    catch {
        return { date: isoString, time: '', full: isoString };
    }
}
//# sourceMappingURL=auditFormatters.js.map