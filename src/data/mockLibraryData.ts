import { WorkflowState } from '../types/workflow';
import type { 
  LibraryDocument, 
  LibraryOrganization, 
  LibrarySource 
} from '../types/library';

export const MOCK_ORGANIZATIONS: LibraryOrganization[] = [
  {
    id: 'org-1',
    nameAr: 'وزارة البيئة والتنمية المستدامة',
    nameEn: 'Ministry of Environment & Sustainable Development',
    type: 'Ministry',
    countryRegionAr: 'مصر والمنطقة العربية',
    countryRegionEn: 'Egypt & Arab Region',
    websiteUrl: 'https://eeaa.gov.eg'
  },
  {
    id: 'org-2',
    nameAr: 'برنامج الأمم المتحدة للبيئة (UNEP)',
    nameEn: 'United Nations Environment Programme (UNEP)',
    type: 'InternationalBody',
    countryRegionAr: 'عالمي / إقليمي',
    countryRegionEn: 'Global / Regional',
    websiteUrl: 'https://unep.org'
  },
  {
    id: 'org-3',
    nameAr: 'وزارة التغير المناخي والبيئة',
    nameEn: 'Ministry of Climate Change & Environment',
    type: 'Ministry',
    countryRegionAr: 'الإمارات العربية المتحدة',
    countryRegionEn: 'United Arab Emirates',
    websiteUrl: 'https://moccae.gov.ae'
  },
  {
    id: 'org-4',
    nameAr: 'مركز بحوث المياه والحوكمة البيئية',
    nameEn: 'Water Governance & Environmental Research Center',
    type: 'ResearchCenter',
    countryRegionAr: 'السودان وحوض النيل',
    countryRegionEn: 'Sudan & Nile Basin',
    websiteUrl: 'https://wgerc.org'
  },
  {
    id: 'org-5',
    nameAr: 'أمانة اتفاقية الأمم المتحدة الإطارية بشأن التغير المناخي (UNFCCC)',
    nameEn: 'UNFCCC Secretariat',
    type: 'InternationalBody',
    countryRegionAr: 'دولات متعددة الأطراف',
    countryRegionEn: 'Multilateral Global',
    websiteUrl: 'https://unfccc.int'
  }
];

export const MOCK_SOURCES: LibrarySource[] = [
  {
    id: 'src-1',
    organizationId: 'org-1',
    sourceNameAr: 'الجريدة الرسمية - الوقائع المصرية',
    sourceNameEn: 'Official Gazette - Egyptian Facts',
    sourceUrl: 'https://gazette.gov.eg/laws/2020/202',
    sourceType: 'OfficialGazette',
    verificationStatus: 'Verified'
  },
  {
    id: 'src-2',
    organizationId: 'org-2',
    sourceNameAr: 'المستودع الرقمي لبرنامج الأمم المتحدة للبيئة',
    sourceNameEn: 'UNEP Digital Knowledge Repository',
    sourceUrl: 'https://wedocs.unep.org/handle/20.500.11822/41200',
    sourceType: 'InstitutionalArchive',
    verificationStatus: 'Verified'
  },
  {
    id: 'src-3',
    organizationId: 'org-3',
    sourceNameAr: 'بوابة التشريعات والسياسات البيئية الاتحادية',
    sourceNameEn: 'Federal Environmental Legislation Portal',
    sourceUrl: 'https://moccae.gov.ae/en/laws-and-policies',
    sourceType: 'GovernmentPortal',
    verificationStatus: 'Verified'
  },
  {
    id: 'src-4',
    organizationId: 'org-4',
    sourceNameAr: 'المجلة العربية للعلوم البيئية والموارد المائية',
    sourceNameEn: 'Arab Journal of Environmental Sciences & Water Resources',
    sourceUrl: 'https://ajeswr.org/archive/2025/vol12',
    sourceType: 'AcademicJournal',
    verificationStatus: 'PendingVerification'
  },
  {
    id: 'src-5',
    organizationId: 'org-5',
    sourceNameAr: 'قاعدة بيانات القرارات والمقررات الدولية UNFCCC Document Treaty Registry',
    sourceNameEn: 'UNFCCC Treaty Registry & Decisions Database',
    sourceUrl: 'https://unfccc.int/documents/decisions-2024',
    sourceType: 'InstitutionalArchive',
    verificationStatus: 'Verified'
  }
];

export const MOCK_LIBRARY_DOCUMENTS: LibraryDocument[] = [
  {
    id: 'doc-201',
    titleAr: 'قانون تنظيم إدارة المخلفات وحماية البيئة رقم 202 لسنة 2020',
    titleEn: 'Waste Management & Environmental Protection Law No. 202 of 2020',
    originalTitle: 'قانون رقم 202 لسنة 2020 بشأن تنظيم إدارة المخلفات',
    documentType: 'Law',
    organizationId: 'org-1',
    sourceId: 'src-1',
    geographyAr: 'جمهورية مصر العربية',
    geographyEn: 'Arab Republic of Egypt',
    publicationDate: '2020-10-13',
    language: 'ar',
    summaryAr: 'تشريع رسمي ملزم يحدد إطار تنظيم إدارة المخلفات بأنواعها (الصلبة، الخطرة، البلدية) وتطبيق مبدأ الملوث يدفع، مع إنشاء جهاز تنظيم إدارة المخلفات.',
    summaryEn: 'Binding statutory law establishing the comprehensive framework for solid and hazardous waste management, applying the polluter-pays principle.',
    topicsAr: ['إدارة المخلفات', 'التشريعات البيئية', 'الاقتصاد الدائري', 'التلوث'],
    topicsEn: ['Waste Management', 'Environmental Law', 'Circular Economy', 'Pollution Control'],
    environmentalDomains: ['WasteManagement', 'PollutionControl', 'LawAndPolicy'],
    rightsStatus: 'OpenPubliclyAvailable',
    rightsNotesAr: 'تشريع حكومي رسمي منشور بالجريدة الرسمية، متاح للمعاينة والاقتباس التوثيقي مع الإشارة إلى المصدر.',
    rightsNotesEn: 'Official government legislation published in the gazette. Available for public viewing with source citation.',
    workflowState: WorkflowState.Published,
    workflowHistory: [
      {
        id: 'hist-1',
        fromState: WorkflowState.Approved,
        toState: WorkflowState.Published,
        action: 'publish',
        actorName: 'Abbass Abdelhalim',
        actorRole: 'Owner',
        timestamp: '2025-01-15T10:00:00Z',
        comment: 'تم اعتماد الوثيقة الرسمية ونشرها بالمكتبة المعرفية.'
      }
    ],
    legalStatusDescriptionAr: 'قانون نافذ ومسجل رسمياً بالجريدة الرسمية (العدد 41 مكرر أ) ويعمل بأحكامه وتعديلاته التنفيذية.',
    legalStatusDescriptionEn: 'Statutory law currently in force published in Official Gazette Issue No. 41.',
    authorMetadataAr: 'مجلس النواب - جمهورية مصر العربية',
    authorMetadataEn: 'House of Representatives - Egypt',
    createdAt: '2025-01-10T08:30:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    versions: [
      {
        id: 'ver-201-1',
        documentId: 'doc-201',
        versionNumber: '1.0',
        publishedDate: '2020-10-13',
        changeDescriptionAr: 'النص الأصلي الصادر بالجريدة الرسمية',
        changeDescriptionEn: 'Original text published in Official Gazette'
      }
    ]
  },
  {
    id: 'doc-202',
    titleAr: 'تقرير التقييم الإقليمي لحالة التنوع البيولوجي والنظم المنظومية في البحر الأحمر',
    titleEn: 'Regional Assessment Report on Biodiversity & Ecosystem Status in the Red Sea',
    originalTitle: 'UNEP Red Sea Biodiversity Status & Vulnerability Index 2024',
    documentType: 'InstitutionalReport',
    organizationId: 'org-2',
    sourceId: 'src-2',
    geographyAr: 'إقليم البحر الأحمر وخليج عدن',
    geographyEn: 'Red Sea & Gulf of Aden Region',
    publicationDate: '2024-11-20',
    language: 'bilingual',
    summaryAr: 'دراسة علمية ومؤسسية شاملة توثق تراجع الشعاب المرجانية وتأثير الانبعاثات والأنشطة البحرية على التنوع الحيوي الإقليمي.',
    summaryEn: 'Comprehensive institutional assessment documenting coral reef degradation and the impact of marine activities on regional biodiversity.',
    topicsAr: ['التنوع البيولوجي', 'النظم البحرية', 'الشعاب المرجانية', 'التغير المناخي'],
    topicsEn: ['Biodiversity', 'Marine Ecosystems', 'Coral Reefs', 'Climate Change'],
    environmentalDomains: ['Biodiversity', 'MarineProtection', 'ClimateImpact'],
    rightsStatus: 'ReviewRequired',
    rightsNotesAr: 'يتطلب فحص ملحق الصور والبيانات الخرائطية التأكد من قيود إعادة النشر التجارية لبرنامج UNEP.',
    rightsNotesEn: 'Requires review of copyright permissions regarding data visualization annexes before redistribution.',
    workflowState: WorkflowState.InReview,
    workflowHistory: [
      {
        id: 'hist-2',
        fromState: WorkflowState.Draft,
        toState: WorkflowState.InReview,
        action: 'submit_for_review',
        actorName: 'Sarah Ahmed',
        actorRole: 'ContentEditor',
        timestamp: '2025-02-01T14:20:00Z'
      }
    ],
    legalStatusDescriptionAr: 'تقرير تقييمي استرشادي غير ملزم قانوناً، يمثل مرجعاً علمياً للمؤسسات البيئية الوطنية.',
    legalStatusDescriptionEn: 'Non-binding advisory institutional report serving as a scientific reference.',
    authorMetadataAr: 'فريق خبراء برنامج الأمم المتحدة للبيئة (UNEP/PERSGA)',
    authorMetadataEn: 'UNEP/PERSGA Expert Panel',
    createdAt: '2025-02-01T12:00:00Z',
    updatedAt: '2025-02-01T14:20:00Z',
    versions: [
      {
        id: 'ver-202-1',
        documentId: 'doc-202',
        versionNumber: '1.0',
        publishedDate: '2024-11-20',
        changeDescriptionAr: 'الإصدار الأول الصادر عن UNEP',
        changeDescriptionEn: 'First official release by UNEP'
      }
    ]
  },
  {
    id: 'doc-203',
    titleAr: 'استراتيجية التنوع المناخي والحياد الكربوني الوطنية 2050',
    titleEn: 'National Climate Resilience & Net-Zero Strategy 2050',
    originalTitle: 'UAE National Net Zero by 2050 Strategic Initiative',
    documentType: 'PolicyPaper',
    organizationId: 'org-3',
    sourceId: 'src-3',
    geographyAr: 'دولة الإمارات العربية المتحدة',
    geographyEn: 'United Arab Emirates',
    publicationDate: '2023-05-15',
    language: 'bilingual',
    summaryAr: 'ورقة سياسات وطنية تحدد خارطة الطريق للوصول إلى الحياد الكربوني بحلول عام 2050 عبر التحول في قطاعات الطاقة والصناعة والنقل.',
    summaryEn: 'National policy document laying out the framework to achieve net-zero greenhouse gas emissions by 2050.',
    topicsAr: ['الحياد الكربوني', 'سياسات المناخ', 'الطاقة النظيفة', 'التنمية المستدامة'],
    topicsEn: ['Net Zero', 'Climate Policy', 'Clean Energy', 'Sustainable Development'],
    environmentalDomains: ['ClimatePolicy', 'EnergyTransition', 'Sustainability'],
    rightsStatus: 'PermissionGranted',
    rightsNotesAr: 'تم الحصول على إذن إعادة النشر المباشر من البوابة الحكومية الرسمية لغايات التوعية البيئية.',
    rightsNotesEn: 'Direct publication permission granted for environmental educational purposes.',
    workflowState: WorkflowState.Approved,
    workflowHistory: [
      {
        id: 'hist-3',
        fromState: WorkflowState.InReview,
        toState: WorkflowState.Approved,
        action: 'approve',
        actorName: 'Amna Al-Bashir',
        actorRole: 'RightsReviewer',
        timestamp: '2025-02-10T11:15:00Z'
      }
    ],
    legalStatusDescriptionAr: 'إطار سياسي واستراتيجي معتمد من مجلس الوزراء، يوجه الخطط التنموية الوطنية.',
    legalStatusDescriptionEn: 'Cabinet-approved strategic policy framework guiding national development.',
    authorMetadataAr: 'وزارة التغير المناخي والبيئة بالشراكة مع مجلس التغير المناخي',
    authorMetadataEn: 'Ministry of Climate Change & Environment',
    createdAt: '2025-02-05T09:00:00Z',
    updatedAt: '2025-02-10T11:15:00Z',
    versions: [
      {
        id: 'ver-203-1',
        documentId: 'doc-203',
        versionNumber: '1.0',
        publishedDate: '2023-05-15',
        changeDescriptionAr: 'الوثيقة الاستراتيجية الأصلية',
        changeDescriptionEn: 'Original strategic policy text'
      }
    ]
  },
  {
    id: 'doc-204',
    titleAr: 'دراسة تحليلات الجفاف وحوكمة المياه في حوض النيل الشرقي',
    titleEn: 'Drought Governance & Water Management Analysis in Eastern Nile Basin',
    originalTitle: 'Hydro-Climatic Stress & Community Adaptation Study 2025',
    documentType: 'ResearchStudy',
    organizationId: 'org-4',
    sourceId: 'src-4',
    geographyAr: 'السودان وإثيوبيا ومصر',
    geographyEn: 'Sudan, Ethiopia, Egypt',
    publicationDate: '2025-01-08',
    language: 'en',
    summaryAr: 'ورقة بحثية أكاديمية تطبق نماذج المناخ الهيدرولوجية لقياس شح المياه وفعالية السياسات المحلية المتخذة.',
    summaryEn: 'Peer-reviewed academic research applying hydrological climate modeling to measure water scarcity and local policy response.',
    topicsAr: ['حوكمة المياه', 'مخاطر الجفاف', 'التكيف المناخي', 'الأمن المائي'],
    topicsEn: ['Water Governance', 'Drought Risk', 'Climate Adaptation', 'Water Security'],
    environmentalDomains: ['WaterResources', 'DroughtManagement', 'Research'],
    rightsStatus: 'Restricted',
    rightsNotesAr: 'ورقة أصلية خاضعة لحقوق النشر الأكاديمية الخاصة بالمجلة، يسمح بنشر الملخص التوثيقي فقط دون نص البحث الكامل.',
    rightsNotesEn: 'Academic journal copyright restriction. Only abstract and structured metadata are authorized for public cataloging.',
    workflowState: WorkflowState.Draft,
    workflowHistory: [],
    legalStatusDescriptionAr: 'ورقة أكاديمية محكمة، لا تحمل صفة قانونية رسمية أو إلزام حكومي.',
    legalStatusDescriptionEn: 'Peer-reviewed academic study; holds no statutory legal weight.',
    authorMetadataAr: 'د. طارق علي ود. أمل عثمان - جامعة الخرطوم',
    authorMetadataEn: 'Dr. Tariq Ali & Dr. Amal Osman',
    createdAt: '2025-02-12T16:00:00Z',
    updatedAt: '2025-02-12T16:00:00Z',
    versions: [
      {
        id: 'ver-204-1',
        documentId: 'doc-204',
        versionNumber: '0.9',
        publishedDate: '2025-01-08',
        changeDescriptionAr: 'مسودة ملخص البحث المرفق للمراجعة',
        changeDescriptionEn: 'Abstract draft submitted for library cataloging'
      }
    ]
  },
  {
    id: 'doc-205',
    titleAr: 'مقررات وتوصيات مؤتمر الأطراف حول اتفاقيات التكيّف والخسائر والأضرار',
    titleEn: 'COP Decisions Framework on Climate Adaptation & Loss and Damage Fund',
    originalTitle: 'UNFCCC Decisions on Global Goal on Adaptation & Fund Operations',
    documentType: 'InternationalAgreement',
    organizationId: 'org-5',
    sourceId: 'src-5',
    geographyAr: 'دولات متعددة الأطراف (الأمم المتحدة)',
    geographyEn: 'Multilateral (United Nations)',
    publicationDate: '2024-12-18',
    language: 'en',
    summaryAr: 'مقررات دولية رسمية تفصل الآليات التشغيلية لصندوق الخسائر والأضرار وتحديد مؤشرات الهدف العالمي للتكيّف المناخي.',
    summaryEn: 'Official multilateral decisions detailing operational mechanisms for the Loss & Damage Fund and Global Goal on Adaptation.',
    topicsAr: ['اللاتفاقيات الدولية', 'التمويل المناخي', 'الخسائر والأضرار', 'التكيف'],
    topicsEn: ['International Treaties', 'Climate Finance', 'Loss and Damage', 'Adaptation'],
    environmentalDomains: ['InternationalLaw', 'ClimateFinance', 'GlobalPolicy'],
    rightsStatus: 'OpenPubliclyAvailable',
    rightsNotesAr: 'وثيقة اتفاقية دولية عامة صادرة عن الأمم المتحدة مهدات للجمهور لغايات البحث والتوثيق.',
    rightsNotesEn: 'Public UN treaty decision document accessible globally.',
    workflowState: WorkflowState.Approved,
    workflowHistory: [
      {
        id: 'hist-5',
        fromState: WorkflowState.InReview,
        toState: WorkflowState.Approved,
        action: 'approve',
        actorName: 'Mustafa Hassan',
        actorRole: 'Owner',
        timestamp: '2025-02-14T15:00:00Z'
      }
    ],
    legalStatusDescriptionAr: 'مقررات دولية صادرة عن مؤتمر الأطراف، ملزمة للدول الموقعة والمصادقة بحسب أطر المعاهدة.',
    legalStatusDescriptionEn: 'Multilateral Conference of Parties decisions binding under ratified international treaty framework.',
    authorMetadataAr: 'أمانة اتفاقية الأمم المتحدة الإطارية بشأن التغير المناخي UNFCCC',
    authorMetadataEn: 'UNFCCC Secretariat',
    createdAt: '2025-02-14T10:00:00Z',
    updatedAt: '2025-02-14T15:00:00Z',
    versions: [
      {
        id: 'ver-205-1',
        documentId: 'doc-205',
        versionNumber: '1.0',
        publishedDate: '2024-12-18',
        changeDescriptionAr: 'القرارات الرسمية المعتمدة في ختام المؤتمر',
        changeDescriptionEn: 'Official decisions adopted at the conclusion of COP'
      }
    ]
  }
];
