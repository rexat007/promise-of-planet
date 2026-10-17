"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveReviewTarget = resolveReviewTarget;
exports.getTargetTypeLabel = getTargetTypeLabel;
exports.getCategoryLabel = getCategoryLabel;
exports.getSeverityLabel = getSeverityLabel;
exports.getFactualFlagLabel = getFactualFlagLabel;
exports.getExecutionStateLabel = getExecutionStateLabel;
const aiReview_1 = require("../../types/aiReview");
const mockNewsData_1 = require("../../data/mockNewsData");
const mockLibraryData_1 = require("../../data/mockLibraryData");
const mockTrainingData_1 = require("../../data/mockTrainingData");
const mockCommunityData_1 = require("../../data/mockCommunityData");
/**
 * Resolves target identity against canonical domain collections without mutating or duplicating records.
 */
function resolveReviewTarget(targetType, targetId, isAr) {
    switch (targetType) {
        case aiReview_1.AIReviewTargetType.News: {
            const newsItem = mockNewsData_1.INITIAL_MOCK_NEWS.find(n => n.id === targetId);
            if (newsItem) {
                return {
                    targetType,
                    targetId,
                    title: isAr ? newsItem.titleAr : newsItem.titleEn,
                    sourceUpdatedAt: newsItem.updatedAt || newsItem.createdAt,
                    isAvailable: true,
                    domainWorkflowStatus: newsItem.workflowState,
                    categoryLabel: isAr ? 'الأخبار والتقارير' : 'News & Reporting',
                };
            }
            break;
        }
        case aiReview_1.AIReviewTargetType.LibraryDocument: {
            const doc = mockLibraryData_1.MOCK_LIBRARY_DOCUMENTS.find(d => d.id === targetId);
            if (doc) {
                return {
                    targetType,
                    targetId,
                    title: isAr ? doc.titleAr : doc.titleEn,
                    sourceUpdatedAt: doc.publicationDate || '2020-01-01',
                    isAvailable: true,
                    domainWorkflowStatus: doc.workflowState,
                    categoryLabel: isAr ? 'المكتبة المعرفية' : 'Knowledge Library',
                };
            }
            break;
        }
        case aiReview_1.AIReviewTargetType.TrainingCourse: {
            const course = mockTrainingData_1.MOCK_TRAINING_COURSES.find(c => c.id === targetId);
            if (course) {
                return {
                    targetType,
                    targetId,
                    title: isAr ? course.titleAr : course.titleEn,
                    sourceUpdatedAt: course.updatedAt || course.createdAt,
                    isAvailable: true,
                    domainWorkflowStatus: course.workflowState,
                    categoryLabel: isAr ? 'المسارات التدريبية' : 'Training & Courses',
                };
            }
            break;
        }
        case aiReview_1.AIReviewTargetType.CitizenSubmission: {
            const sub = mockCommunityData_1.MOCK_CITIZEN_SUBMISSIONS.find(s => s.id === targetId);
            if (sub) {
                return {
                    targetType,
                    targetId,
                    title: sub.title,
                    sourceUpdatedAt: sub.updatedAt || sub.submittedAt,
                    isAvailable: true,
                    domainWorkflowStatus: sub.status,
                    categoryLabel: isAr ? 'صحافة المواطن' : 'Citizen Journalism',
                };
            }
            break;
        }
    }
    // Graceful fallback when target record is unavailable or deleted
    return {
        targetType,
        targetId,
        title: isAr ? 'المحتوى المستهدف غير متوفر أو تم حذفه' : 'Target content unavailable or removed',
        sourceUpdatedAt: '',
        isAvailable: false,
        categoryLabel: isAr ? 'غير محدد' : 'Unknown',
    };
}
/**
 * Localized human-readable label for target domain types.
 */
function getTargetTypeLabel(type, isAr) {
    switch (type) {
        case aiReview_1.AIReviewTargetType.News:
            return isAr ? 'خبر بيئي' : 'Environmental News';
        case aiReview_1.AIReviewTargetType.LibraryDocument:
            return isAr ? 'وثيقة مكتبة' : 'Library Document';
        case aiReview_1.AIReviewTargetType.TrainingCourse:
            return isAr ? 'مسار تدريبي' : 'Training Course';
        case aiReview_1.AIReviewTargetType.CitizenSubmission:
            return isAr ? 'بلاغ مواطن' : 'Citizen Submission';
        default:
            return type;
    }
}
/**
 * Localized human-readable label for operational review categories.
 */
function getCategoryLabel(category, isAr) {
    switch (category) {
        case aiReview_1.AIReviewCategory.Completeness:
            return isAr ? 'اكتمال المحتوى' : 'Completeness';
        case aiReview_1.AIReviewCategory.Clarity:
            return isAr ? 'الوضوح والصياغة' : 'Clarity & Formulation';
        case aiReview_1.AIReviewCategory.SourceReferenceQuality:
            return isAr ? 'جودة المصادر والمراجع' : 'Source & Reference Quality';
        case aiReview_1.AIReviewCategory.PossibleInconsistency:
            return isAr ? 'احتمال عدم اتساق' : 'Possible Inconsistency';
        case aiReview_1.AIReviewCategory.MetadataCompleteness:
            return isAr ? 'اكتمال البيانات الوصفية' : 'Metadata Completeness';
        case aiReview_1.AIReviewCategory.RightsConcern:
            return isAr ? 'ملاحظات حقوق النشر' : 'Rights & Licensing Concern';
        case aiReview_1.AIReviewCategory.LanguagePresentation:
            return isAr ? 'العرض اللغوي' : 'Language Presentation';
        default:
            return category;
    }
}
/**
 * Localized human-readable label for attention severity levels.
 */
function getSeverityLabel(severity, isAr) {
    switch (severity) {
        case aiReview_1.AIReviewSeverity.Info:
            return isAr ? 'معلوماتي / استرشادي' : 'Informational';
        case aiReview_1.AIReviewSeverity.Warning:
            return isAr ? 'تنبيه تدقيق' : 'Warning';
        case aiReview_1.AIReviewSeverity.ReviewRecommended:
            return isAr ? 'يُنصح بالمراجعة البشرية' : 'Review Recommended';
        default:
            return severity;
    }
}
/**
 * Localized human-readable label for optional factual flags.
 */
function getFactualFlagLabel(flag, isAr) {
    switch (flag) {
        case aiReview_1.AIFactualFlag.NeedsReview:
            return isAr ? 'يلزم تدقيق بشري' : 'Needs Human Review';
        case aiReview_1.AIFactualFlag.PossibleInconsistency:
            return isAr ? 'احتمال تباين في البيانات' : 'Possible Data Inconsistency';
        case aiReview_1.AIFactualFlag.SourceCheckSuggested:
            return isAr ? 'يُقترح التحقق من المصدر' : 'Source Check Suggested';
        default:
            return flag;
    }
}
/**
 * Localized human-readable label for execution state.
 */
function getExecutionStateLabel(state, isAr) {
    switch (state) {
        case aiReview_1.AIReviewExecutionState.Completed:
            return isAr ? 'مكتمل' : 'Completed';
        case aiReview_1.AIReviewExecutionState.Pending:
            return isAr ? 'قيد المعالجة' : 'Pending';
        case aiReview_1.AIReviewExecutionState.Failed:
            return isAr ? 'تعذر التدقيق' : 'Failed';
        default:
            return state;
    }
}
//# sourceMappingURL=aiReviewFormatters.js.map