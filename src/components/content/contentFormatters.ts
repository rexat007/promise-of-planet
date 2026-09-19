import type { Category, ContentType, UrgencyLevel, RelationType, SourceType } from '../../types';
import { SubmissionStatus } from '../../types/community';

export function getCategoryLabel(category: Category, isArabic: boolean): string {
  const map: Record<Category, { ar: string; en: string }> = {
    Climate: { ar: 'المناخ والطقس', en: 'Climate & Weather' },
    Water: { ar: 'المياه والنيل', en: 'Water & Nile' },
    Biodiversity: { ar: 'التنوع الحيوي والحياة البرية', en: 'Biodiversity & Wildlife' },
    Pollution: { ar: 'التلوث والنفايات', en: 'Pollution & Waste' },
    Energy: { ar: 'الطاقة المتجددة', en: 'Renewable Energy' },
    Agriculture: { ar: 'الزراعة والأراضي', en: 'Agriculture & Land' },
    EnvironmentalPolicy: { ar: 'السياسات والتشريعات البيئية', en: 'Environmental Policy' },
  };
  const entry = map[category];
  return entry ? (isArabic ? entry.ar : entry.en) : category;
}

export function getCommunityCategoryLabel(categoryKey: string, isArabic: boolean): string {
  const map: Record<string, { ar: string; en: string }> = {
    water: { ar: 'الموارد المائية والنيل', en: 'Water Resources & Nile' },
    climate: { ar: 'المناخ والطقس', en: 'Climate & Weather' },
    desertification: { ar: 'التصحر والغطاء النباتي', en: 'Desertification & Vegetation' },
    marine: { ar: 'البيئة البحرية والتنوع الحيوي', en: 'Marine & Biodiversity' },
  };
  const entry = map[categoryKey];
  return entry ? (isArabic ? entry.ar : entry.en) : categoryKey;
}

export function getSubmissionStatusLabel(status: SubmissionStatus, isArabic: boolean): string {
  switch (status) {
    case SubmissionStatus.Received:
      return isArabic ? 'مستلم جديد' : 'Received';
    case SubmissionStatus.UnderReview:
      return isArabic ? 'قيد المراجعة' : 'Under Review';
    case SubmissionStatus.AcceptedForEditorial:
      return isArabic ? 'مقبول للتحرير' : 'Accepted for Editorial';
    case SubmissionStatus.Rejected:
      return isArabic ? 'مرفوض' : 'Rejected';
    default:
      return status;
  }
}

export function getContentTypeLabel(type: ContentType, isArabic: boolean): string {
  switch (type) {
    case 'News':
      return isArabic ? 'خبر صحفي' : 'News';
    case 'Report':
      return isArabic ? 'تحقيق واستقصاء' : 'In-Depth Report';
    case 'Video':
      return isArabic ? 'فيديو مرئي' : 'Video';
    default:
      return type;
  }
}

export function getUrgencyLabel(urgency: UrgencyLevel, isArabic: boolean): string {
  switch (urgency) {
    case 'Breaking':
      return isArabic ? 'عاجل' : 'Breaking';
    case 'Urgent':
      return isArabic ? 'هام' : 'Urgent';
    case 'Standard':
    default:
      return isArabic ? 'اعتيادي' : 'Standard';
  }
}

export function getRelationTypeLabel(relationType: RelationType, isArabic: boolean): string {
  switch (relationType) {
    case 'Embedded':
      return isArabic ? 'فيديو مدمج' : 'Embedded Video';
    case 'RelatedCoverage':
      return isArabic ? 'تغطية مرئية متصلة' : 'Related Visual Coverage';
    case 'SupportingMaterial':
      return isArabic ? 'مادة مرئية مساندة' : 'Supporting Media';
    default:
      return relationType;
  }
}

export function getSourceTypeLabel(sourceType: SourceType, isArabic: boolean): string {
  switch (sourceType) {
    case 'OfficialGovernment':
      return isArabic ? 'جهة حكومية رسمية' : 'Official Government';
    case 'UNReport':
      return isArabic ? 'تقرير أممي / وكالة دولية' : 'UN / International Report';
    case 'AcademicStudy':
      return isArabic ? 'دراسة أكاديمية وبحثية' : 'Academic Study';
    case 'FieldWitness':
      return isArabic ? 'شهادة وملاحظة ميدانية' : 'Field Observation / Witness';
    case 'IndependentMedia':
      return isArabic ? 'وسيلة إعلامية مستقلة' : 'Independent Media';
    case 'NGOReport':
      return isArabic ? 'منظمة مدنية غير حكومية' : 'NGO Report';
    default:
      return sourceType;
  }
}

export function formatDate(dateString?: string, isArabic = true): string {
  if (!dateString) return '';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString(isArabic ? 'ar-SD' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}
