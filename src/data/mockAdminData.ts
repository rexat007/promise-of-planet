import type { PlatformMetrics, QueueItem, OperationalAlert } from '../types/admin';

export const MOCK_PLATFORM_METRICS: PlatformMetrics = {
  totalNews: 142,
  totalLibraryItems: 68,
  totalCourses: 12,
  pendingReviewsCount: 9,
  awaitingApprovalCount: 4,
  activeDraftsCount: 15,
  flaggedCommunityItemsCount: 3,
};

export const MOCK_QUEUE_ITEMS: QueueItem[] = [
  {
    id: 'q-1',
    titleAr: 'دراسة مرجعية: التنوع الحيوي في غابات السنط السودانية',
    titleEn: 'Reference Study: Biodiversity in Sudanese Acacia Forests',
    contentType: 'LibraryItem',
    status: 'PendingReview',
    submittedBy: 'د. خالد يوسف (Library Curator)',
    submittedAt: '2026-09-15T14:30:00Z',
    category: 'Biodiversity',
  },
  {
    id: 'q-2',
    titleAr: 'خبر عاجل: انحسار مياه نهر الدندر خارج الموسم الطبيعي',
    titleEn: 'Breaking News: Water Recession in Dinder River Off-Season',
    contentType: 'News',
    status: 'AwaitingApproval',
    submittedBy: 'سارة أحمد (Content Editor)',
    submittedAt: '2026-09-16T08:15:00Z',
    category: 'Water',
  },
  {
    id: 'q-3',
    titleAr: 'دورة تدريبية: مبادئ الاستشعار عن بعد لرصد الجفاف',
    titleEn: 'Training Course: Remote Sensing Principles for Drought Monitoring',
    contentType: 'Course',
    status: 'Draft',
    submittedBy: 'د. طارق علي (Trainer)',
    submittedAt: '2026-09-12T11:00:00Z',
    category: 'Climate',
  },
  {
    id: 'q-4',
    titleAr: 'منشور مجتمعي علمي: رصد سلحفاة بحرية نادرة في البحر الأحمر',
    titleEn: 'Citizen Post: Rare Sea Turtle Sighted in Red Sea Coast',
    contentType: 'CommunityPost',
    status: 'PendingReview',
    submittedBy: 'أحمد البشير (Citizen)',
    submittedAt: '2026-09-15T18:45:00Z',
    category: 'Biodiversity',
  },
  {
    id: 'q-5',
    titleAr: 'مراجعة حقوق الملكية: فيلم وثائقي عن حيازة الأراضي بشرق السودان',
    titleEn: 'Rights Review: Land Tenure Documentary in Eastern Sudan',
    contentType: 'RightsAudit',
    status: 'Flagged',
    submittedBy: 'آمنة البشير (Rights Reviewer)',
    submittedAt: '2026-09-16T09:00:00Z',
    category: 'EnvironmentalPolicy',
  },
  {
    id: 'q-6',
    titleAr: 'مسودة تقرير: حوكمة المياه الجوفية في الحوض النوبي',
    titleEn: 'Draft Report: Groundwater Governance in the Nubian Sandstone Aquifer',
    contentType: 'LibraryItem',
    status: 'Draft',
    submittedBy: 'د. خالد يوسف (Library Curator)',
    submittedAt: '2026-09-14T10:30:00Z',
    category: 'Water',
  },
];

export const MOCK_OPERATIONAL_ALERTS: OperationalAlert[] = [
  {
    id: 'a-1',
    type: 'critical',
    messageAr: 'فشل مزامنة API مع يوتيوب لـ 3 مقاطع فيديو مدمجة في الأخبار',
    messageEn: 'YouTube API sync failure for 3 embedded news videos',
    timestamp: '2026-09-16T11:45:00Z',
  },
  {
    id: 'a-2',
    type: 'warning',
    messageAr: 'دورة "صحافة المناخ" تجاوزت الحد الأقصى للمسجلين (150 مشارك)',
    messageEn: '"Climate Journalism" course has exceeded maximum registration limit (150)',
    timestamp: '2026-09-16T10:30:00Z',
  },
  {
    id: 'a-3',
    type: 'info',
    messageAr: 'تحديث أسبوعي لنظام الفحص التلقائي للمقالات تم بنجاح',
    messageEn: 'Weekly content auto-verification rules updated successfully',
    timestamp: '2026-09-15T08:00:00Z',
  },
];
