import type { Category, ContentType, UrgencyLevel, RelationType, SourceType } from '../../types';

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
