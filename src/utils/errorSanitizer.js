"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeError = sanitizeError;
const accountService_1 = require("../services/accountService");
/**
 * Normalizes any unknown exception or error string into a user-safe, localized SanitizedError.
 * Guarantees zero leakage of document paths, UIDs, stack traces, or raw backend diagnostic strings.
 */
function sanitizeError(error, language = 'ar') {
    const isAr = language?.startsWith('ar') ?? true;
    // 1. Check for known safe AccountError
    if (error instanceof accountService_1.AccountError || (error && typeof error === 'object' && error.name === 'AccountError')) {
        const code = error.code;
        switch (code) {
            case 'AUTH_UNAVAILABLE':
                return {
                    title: isAr ? 'المصادقة غير متوفرة' : 'Authentication Unavailable',
                    message: isAr
                        ? 'خدمة المصادقة غير متاحة حالياً. يرجى المحاولة لاحقاً.'
                        : 'Authentication service is currently unavailable. Please try again later.',
                    code,
                };
            case 'ACCOUNT_NOT_FOUND':
                return {
                    title: isAr ? 'الحساب غير موجود' : 'Account Not Found',
                    message: isAr
                        ? 'تعذر العثور على سجل الحساب المطلوب.'
                        : 'The requested account profile could not be found.',
                    code,
                };
            case 'ACCOUNT_ALREADY_EXISTS':
                return {
                    title: isAr ? 'الحساب موجود بالفعل' : 'Account Already Exists',
                    message: isAr
                        ? 'يوجد حساب مسجل بالفعل ببيانات الاعتماد هذه.'
                        : 'An account is already registered with these credentials.',
                    code,
                };
            case 'ACCOUNT_DATA_INVALID':
                return {
                    title: isAr ? 'بيانات غير صالحة' : 'Invalid Data',
                    message: isAr
                        ? 'بيانات ملف الحساب غير مستوفية للشروط المطلوبة.'
                        : 'Account profile data does not conform to required rules.',
                    code,
                };
            case 'ACCOUNT_PROVISIONING_FAILED':
                return {
                    title: isAr ? 'فشل إعداد الحساب' : 'Account Setup Failed',
                    message: isAr
                        ? 'تعذر إعداد ملف الحساب بشكل كامل.'
                        : 'Unable to complete account profile setup.',
                    code,
                };
        }
    }
    // 2. Fallback for any unknown, unhandled, or sensitive error
    return {
        title: isAr ? 'حدث خطأ غير متوقع' : 'An Unexpected Error Occurred',
        message: isAr
            ? 'تعذر إكمال العملية الحالية. يرجى إعادة المحاولة لاحقاً.'
            : 'Unable to complete the requested action. Please try again later.',
    };
}
//# sourceMappingURL=errorSanitizer.js.map