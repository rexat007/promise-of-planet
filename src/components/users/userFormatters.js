"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMISSION_METADATA = exports.ROLE_METADATA = void 0;
exports.getRoleLabel = getRoleLabel;
exports.getRoleBadgeClass = getRoleBadgeClass;
exports.getRoleDescription = getRoleDescription;
exports.getPermissionLabel = getPermissionLabel;
exports.getPermissionDescription = getPermissionDescription;
exports.getStatusLabel = getStatusLabel;
const admin_1 = require("../../types/admin");
exports.ROLE_METADATA = {
    [admin_1.AdminRole.Owner]: {
        role: admin_1.AdminRole.Owner,
        labelAr: 'المالك والمشرف العام',
        labelEn: 'Platform Owner',
        descAr: 'صلاحيات كاملة وغير مقيدة على كافة أقسام وإعدادات المنصة وإدارة المستخدمين.',
        descEn: 'Full unconstrained authority over all platform modules, settings, and access control.',
        badgeColorClass: 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-800',
        bgLightClass: 'border-rose-500/20 bg-rose-50/50 dark:bg-rose-950/20',
    },
    [admin_1.AdminRole.ContentEditor]: {
        role: admin_1.AdminRole.ContentEditor,
        labelAr: 'محرر الأخبار البيئية',
        labelEn: 'News Content Editor',
        descAr: 'تحرير وصياغة ومراجعة الأخبار والتقارير الصحفية الميدانية في الولايات.',
        descEn: 'Authoring, editing, and reviewing environmental news and regional reports.',
        badgeColorClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
        bgLightClass: 'border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-950/20',
    },
    [admin_1.AdminRole.LibraryCurator]: {
        role: admin_1.AdminRole.LibraryCurator,
        labelAr: 'أمين المكتبة المعرفية',
        labelEn: 'Library Curator',
        descAr: 'فهرسة وتصنيف ومراجعة الأوراق البحثية والكتب والخرائط البيئية.',
        descEn: 'Cataloging, classifying, and reviewing environmental research and publications.',
        badgeColorClass: 'bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300 border-teal-300 dark:border-teal-800',
        bgLightClass: 'border-teal-500/20 bg-teal-50/50 dark:bg-teal-950/20',
    },
    [admin_1.AdminRole.RightsReviewer]: {
        role: admin_1.AdminRole.RightsReviewer,
        labelAr: 'مراجع حقوق الملكية والرخص',
        labelEn: 'Rights & Licensing Reviewer',
        descAr: 'تدقيق التراخيص وحقوق الطبع والنشر للمطبوعات والوثائق المعرفية.',
        descEn: 'Auditing copyright, licenses, and distribution rights for library publications.',
        badgeColorClass: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800',
        bgLightClass: 'border-indigo-500/20 bg-indigo-50/50 dark:bg-indigo-950/20',
    },
    [admin_1.AdminRole.TrainingManager]: {
        role: admin_1.AdminRole.TrainingManager,
        labelAr: 'مدير البرامج والتدريب',
        labelEn: 'Training Program Manager',
        descAr: 'تخطيط المناهج واعتماد المسارات التدريبية وإصدار الشهادات الأكاديمية.',
        descEn: 'Curriculum planning, course approvals, and academic training administration.',
        badgeColorClass: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border-sky-300 dark:border-sky-800',
        bgLightClass: 'border-sky-500/20 bg-sky-50/50 dark:bg-sky-950/20',
    },
    [admin_1.AdminRole.Trainer]: {
        role: admin_1.AdminRole.Trainer,
        labelAr: 'مدرب ومحاضر بيئي',
        labelEn: 'Instructor & Trainer',
        descAr: 'إعداد المحاضرات ومسودات الدروس والتمارين التطبيقية للمتدربين.',
        descEn: 'Creating lesson drafts, practical assignments, and training materials.',
        badgeColorClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border-amber-300 dark:border-amber-800',
        bgLightClass: 'border-amber-500/20 bg-amber-50/50 dark:bg-amber-950/20',
    },
    [admin_1.AdminRole.CitizenModerator]: {
        role: admin_1.AdminRole.CitizenModerator,
        labelAr: 'مشرف صحافة المواطن',
        labelEn: 'Citizen Submissions Moderator',
        descAr: 'استقبال وفحص وتقييم مساهمات وبلاغات المواطنين البيئية الميدانية.',
        descEn: 'Reviewing and validating community reports and environmental observations.',
        badgeColorClass: 'bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-300 border-orange-300 dark:border-orange-800',
        bgLightClass: 'border-orange-500/20 bg-orange-50/50 dark:bg-orange-950/20',
    },
    [admin_1.AdminRole.AIAssistant]: {
        role: admin_1.AdminRole.AIAssistant,
        labelAr: 'محاكي تدقيق الذكاء الاصطناعي',
        labelEn: 'AI Review Simulator',
        descAr: 'هوية تدقيقية استشارية لفحص المحتوى ومراجعته دون صلاحيات اعتماد مباشرة.',
        descEn: 'Advisory audit simulation identity for inspecting content findings.',
        badgeColorClass: 'bg-violet-100 text-violet-800 dark:bg-violet-950/70 dark:text-violet-300 border-violet-300 dark:border-violet-800',
        bgLightClass: 'border-violet-500/20 bg-violet-50/50 dark:bg-violet-950/20',
    },
    [admin_1.AdminRole.Viewer]: {
        role: admin_1.AdminRole.Viewer,
        labelAr: 'مستعرض تقارير ومؤشرات',
        labelEn: 'Observer / Viewer',
        descAr: 'قراءة المؤشرات والتقارير العامة دون صلاحيات إنشاء أو تعديل للمحتوى.',
        descEn: 'Read-only access to overview dashboards and system analytical reports.',
        badgeColorClass: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700',
        bgLightClass: 'border-slate-500/20 bg-slate-50/50 dark:bg-slate-900/20',
    },
};
exports.PERMISSION_METADATA = {
    [admin_1.AdminPermission.View]: {
        permission: admin_1.AdminPermission.View,
        labelAr: 'عرض وقراءة',
        labelEn: 'View & Read',
        descAr: 'تصفح وقراءة لوحات التحكم والمحتويات والمؤشرات.',
        descEn: 'View dashboards, content, and system indicators.',
    },
    [admin_1.AdminPermission.Create]: {
        permission: admin_1.AdminPermission.Create,
        labelAr: 'إنشاء مسودة',
        labelEn: 'Create Draft',
        descAr: 'بدء وصياغة مسودات جديدة في الأخبار، المكتبة، والتدريب.',
        descEn: 'Draft new news items, library documents, or courses.',
    },
    [admin_1.AdminPermission.Edit]: {
        permission: admin_1.AdminPermission.Edit,
        labelAr: 'تعديل المحتوى',
        labelEn: 'Edit Content',
        descAr: 'تحديث النصوص والبيانات الفنية وتنفيذ التعديلات المطلوبة.',
        descEn: 'Modify content metadata, text bodies, and apply revisions.',
    },
    [admin_1.AdminPermission.Review]: {
        permission: admin_1.AdminPermission.Review,
        labelAr: 'فحص ومراجعة',
        labelEn: 'Review Content',
        descAr: 'فحص المسودات، بلاغات المواطنين، ومراجعة تقارير الذكاء الاصطناعي.',
        descEn: 'Review submitted drafts, citizen reports, and AI audits.',
    },
    [admin_1.AdminPermission.Approve]: {
        permission: admin_1.AdminPermission.Approve,
        labelAr: 'اعتماد رسمي',
        labelEn: 'Approve',
        descAr: 'الاعتماد النهائي للمحتوى التحريري والمناهج التعليمية للنشر.',
        descEn: 'Formally approve content and curricula for publishing.',
    },
    [admin_1.AdminPermission.Publish]: {
        permission: admin_1.AdminPermission.Publish,
        labelAr: 'نشر مباشر',
        labelEn: 'Publish Live',
        descAr: 'إطلاق المحتوى المعتمد ليصبح مرئياً للجمهور والباحثين.',
        descEn: 'Deploy approved items live to the public portal.',
    },
    [admin_1.AdminPermission.ManageRights]: {
        permission: admin_1.AdminPermission.ManageRights,
        labelAr: 'إدارة الرخص والحقوق',
        labelEn: 'Manage Rights',
        descAr: 'تحديد وتعديل تراخيص الملكية الفكرية وحقوق النشر للوثائق.',
        descEn: 'Manage copyright clearances and intellectual property licenses.',
    },
    [admin_1.AdminPermission.ManageUsers]: {
        permission: admin_1.AdminPermission.ManageUsers,
        labelAr: 'إدارة المستخدمين (RBAC)',
        labelEn: 'Manage Users (RBAC)',
        descAr: 'إدارة الهويات، تغيير الأدوار، وتعيين حالة الحسابات الإدارية.',
        descEn: 'Manage admin identities, assign roles, and toggle status.',
    },
    [admin_1.AdminPermission.ManageSettings]: {
        permission: admin_1.AdminPermission.ManageSettings,
        labelAr: 'إدارة الإعدادات والسجلات',
        labelEn: 'Manage Settings & Logs',
        descAr: 'التحكم في إعدادات المنصة، مفاتيح الـ API، وسجلات التدقيق.',
        descEn: 'Configure global settings, API integrations, and audit logs.',
    },
    [admin_1.AdminPermission.ViewReports]: {
        permission: admin_1.AdminPermission.ViewReports,
        labelAr: 'استعراض التقارير',
        labelEn: 'View Reports',
        descAr: 'الاطلاع على تحليلات المنصة، الاشتراكات، ومؤشرات الأداء.',
        descEn: 'Access system analytics, metrics, and subscription data.',
    },
};
function getRoleLabel(role, isAr) {
    return isAr ? exports.ROLE_METADATA[role].labelAr : exports.ROLE_METADATA[role].labelEn;
}
function getRoleBadgeClass(role) {
    return exports.ROLE_METADATA[role]?.badgeColorClass || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-300';
}
function getRoleDescription(role, isAr) {
    return isAr ? exports.ROLE_METADATA[role].descAr : exports.ROLE_METADATA[role].descEn;
}
function getPermissionLabel(perm, isAr) {
    return isAr ? exports.PERMISSION_METADATA[perm].labelAr : exports.PERMISSION_METADATA[perm].labelEn;
}
function getPermissionDescription(perm, isAr) {
    return isAr ? exports.PERMISSION_METADATA[perm].descAr : exports.PERMISSION_METADATA[perm].descEn;
}
function getStatusLabel(isActive, isAr) {
    if (isActive) {
        return isAr ? 'نشط' : 'Active';
    }
    return isAr ? 'معطل' : 'Inactive';
}
//# sourceMappingURL=userFormatters.js.map