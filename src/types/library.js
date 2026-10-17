"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LibraryRightsStatus = exports.LibraryDocumentType = void 0;
/**
 * Environmental Library Document Types
 */
exports.LibraryDocumentType = {
    Law: 'Law', // قانون بيئي
    ExecutiveRegulation: 'ExecutiveRegulation', // لائحة تنفيذية
    Decision: 'Decision', // قرار وزاري/حكومي
    InstitutionalReport: 'InstitutionalReport', // تقرير مؤسسي
    PolicyPaper: 'PolicyPaper', // ورقة سياسات
    ResearchStudy: 'ResearchStudy', // دراسة بحثية/أكاديمية
    InternationalAgreement: 'InternationalAgreement', // اتفاقية دولية
};
/**
 * Independent Rights Status Model
 * Editorial Workflow approval does NOT automatically confer Rights Clearance.
 */
exports.LibraryRightsStatus = {
    Unknown: 'Unknown', // غير محدد / قيد التحقق
    ReviewRequired: 'ReviewRequired', // يتطلب مراجعة حقوقية
    PermissionRequired: 'PermissionRequired', // يتطلب إذن إعادة نشر
    PermissionGranted: 'PermissionGranted', // تم الحصول على إذن
    OpenPubliclyAvailable: 'OpenPubliclyAvailable', // متاح للعامة للمعاينة
    Restricted: 'Restricted', // مقيد / للاستخدام الداخلي
    NotRedistributable: 'NotRedistributable', // غير قابل للترويج/إعادة التوزيع
};
//# sourceMappingURL=library.js.map