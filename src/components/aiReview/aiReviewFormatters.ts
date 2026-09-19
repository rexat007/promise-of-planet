import { 
  AIReviewTargetType, 
  AIReviewCategory, 
  AIReviewSeverity, 
  AIFactualFlag, 
  AIReviewExecutionState 
} from '../../types/aiReview';
import { INITIAL_MOCK_NEWS } from '../../data/mockNewsData';
import { MOCK_LIBRARY_DOCUMENTS } from '../../data/mockLibraryData';
import { MOCK_TRAINING_COURSES } from '../../data/mockTrainingData';
import { MOCK_CITIZEN_SUBMISSIONS } from '../../data/mockCommunityData';

export interface ResolvedReviewTarget {
  targetType: AIReviewTargetType;
  targetId: string;
  title: string;
  sourceUpdatedAt: string;
  isAvailable: boolean;
  domainWorkflowStatus?: string;
  categoryLabel?: string;
}

/**
 * Resolves target identity against canonical domain collections without mutating or duplicating records.
 */
export function resolveReviewTarget(
  targetType: AIReviewTargetType, 
  targetId: string, 
  isAr: boolean
): ResolvedReviewTarget {
  switch (targetType) {
    case AIReviewTargetType.News: {
      const newsItem = INITIAL_MOCK_NEWS.find(n => n.id === targetId);
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
    case AIReviewTargetType.LibraryDocument: {
      const doc = MOCK_LIBRARY_DOCUMENTS.find(d => d.id === targetId);
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
    case AIReviewTargetType.TrainingCourse: {
      const course = MOCK_TRAINING_COURSES.find(c => c.id === targetId);
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
    case AIReviewTargetType.CitizenSubmission: {
      const sub = MOCK_CITIZEN_SUBMISSIONS.find(s => s.id === targetId);
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
export function getTargetTypeLabel(type: AIReviewTargetType, isAr: boolean): string {
  switch (type) {
    case AIReviewTargetType.News:
      return isAr ? 'خبر بيئي' : 'Environmental News';
    case AIReviewTargetType.LibraryDocument:
      return isAr ? 'وثيقة مكتبة' : 'Library Document';
    case AIReviewTargetType.TrainingCourse:
      return isAr ? 'مسار تدريبي' : 'Training Course';
    case AIReviewTargetType.CitizenSubmission:
      return isAr ? 'بلاغ مواطن' : 'Citizen Submission';
    default:
      return type;
  }
}

/**
 * Localized human-readable label for operational review categories.
 */
export function getCategoryLabel(category: AIReviewCategory, isAr: boolean): string {
  switch (category) {
    case AIReviewCategory.Completeness:
      return isAr ? 'اكتمال المحتوى' : 'Completeness';
    case AIReviewCategory.Clarity:
      return isAr ? 'الوضوح والصياغة' : 'Clarity & Formulation';
    case AIReviewCategory.SourceReferenceQuality:
      return isAr ? 'جودة المصادر والمراجع' : 'Source & Reference Quality';
    case AIReviewCategory.PossibleInconsistency:
      return isAr ? 'احتمال عدم اتساق' : 'Possible Inconsistency';
    case AIReviewCategory.MetadataCompleteness:
      return isAr ? 'اكتمال البيانات الوصفية' : 'Metadata Completeness';
    case AIReviewCategory.RightsConcern:
      return isAr ? 'ملاحظات حقوق النشر' : 'Rights & Licensing Concern';
    case AIReviewCategory.LanguagePresentation:
      return isAr ? 'العرض اللغوي' : 'Language Presentation';
    default:
      return category;
  }
}

/**
 * Localized human-readable label for attention severity levels.
 */
export function getSeverityLabel(severity: AIReviewSeverity, isAr: boolean): string {
  switch (severity) {
    case AIReviewSeverity.Info:
      return isAr ? 'معلوماتي / استرشادي' : 'Informational';
    case AIReviewSeverity.Warning:
      return isAr ? 'تنبيه تدقيق' : 'Warning';
    case AIReviewSeverity.ReviewRecommended:
      return isAr ? 'يُنصح بالمراجعة البشرية' : 'Review Recommended';
    default:
      return severity;
  }
}

/**
 * Localized human-readable label for optional factual flags.
 */
export function getFactualFlagLabel(flag: AIFactualFlag, isAr: boolean): string {
  switch (flag) {
    case AIFactualFlag.NeedsReview:
      return isAr ? 'يلزم تدقيق بشري' : 'Needs Human Review';
    case AIFactualFlag.PossibleInconsistency:
      return isAr ? 'احتمال تباين في البيانات' : 'Possible Data Inconsistency';
    case AIFactualFlag.SourceCheckSuggested:
      return isAr ? 'يُقترح التحقق من المصدر' : 'Source Check Suggested';
    default:
      return flag;
  }
}

/**
 * Localized human-readable label for execution state.
 */
export function getExecutionStateLabel(state: AIReviewExecutionState, isAr: boolean): string {
  switch (state) {
    case AIReviewExecutionState.Completed:
      return isAr ? 'مكتمل' : 'Completed';
    case AIReviewExecutionState.Pending:
      return isAr ? 'قيد المعالجة' : 'Pending';
    case AIReviewExecutionState.Failed:
      return isAr ? 'تعذر التدقيق' : 'Failed';
    default:
      return state;
  }
}
