import type { NewsItem } from '../types/news';
import { WorkflowState, WorkflowAction } from '../types/workflow';

export const INITIAL_MOCK_NEWS: NewsItem[] = [
  {
    id: 'news-sudan-101',
    titleAr: 'ارتفاع مناسيب النيل الأزرق وتنبيهات لمزارعي ولاية سنار وضفاف النيل',
    titleEn: 'Blue Nile Water Levels Rise: Flood Alert Issued for Sennar Farmers',
    summaryAr: 'سجلت محطات الرصد الهيدرولوجي بمدينة الدمازين زيادة تدريجية في مناسيب النيل الأزرق، مع دعوات فنية للمزارعين لتأمين طلمبات الري والمزروعات المتاخمة للضفاف.',
    summaryEn: 'Hydrological monitoring stations in Damazin recorded a gradual increase in Blue Nile water levels, prompting advisory warnings for riverside agricultural infrastructure.',
    bodyAr: `أعلنت الإدارة العامة للموارد المائية بوزارة الري والموارد المائية عن تدفقات مائية مرتفعة عبر النيل الأزرق نتيجة الهطول الغزير للأمطار بالهضبة الإثيوبية.

    وأكد الباحثون في محطة رصد سنار أن مناسيب المياه اقتربت من منسوب الفيضان الموسم الإعتيادي، مما يقتضي اتخاذ الحيطة في تنظيم عمل الجسور الترابية والترع الرئيسية بالمنشورات الزراعية.

    وتشمل الخطة التنفيذية نشر فرق التقييم الميداني لمراقبة حركة الطمى والرواسب في خزان سنار ومجمع مجمع الرصيرص لتفادي الانسدادات في قنوات الري.`,
    bodyEn: `The Directorate General of Water Resources issued an updated hydrological bulletin noting elevated Blue Nile inflows resulting from intense rainfall in the Ethiopian plateau catchment basin.

    Hydrological assessors at the Sennar station confirmed that discharge rates are nearing seasonal flood thresholds, necessitating proactive structural checks on earthen dikes and irrigation canal sluices.

    Field evaluation teams have been dispatched to monitor silt loading and sediment accumulation near Sennar and Roseires dams to maintain channel flow efficiency.`,
    author: 'د. معتز عبد القادر (خبير هيدرولوجيا)',
    category: 'الموارد المائية والنيل',
    tags: ['النيل الأزرق', 'الفيضانات', 'سنار', 'الري الزراعي'],
    sources: ['وزارة الري والموارد المائية السودانية', 'هيئة الأرصاد الجوية - الدمازين'],
    featuredImage: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&q=80&w=800',
    workflowState: WorkflowState.Published,
    createdAt: '2026-09-10T08:30:00Z',
    updatedAt: '2026-09-14T11:20:00Z',
    history: [
      {
        id: 'tr-news-101-3',
        fromState: WorkflowState.Approved,
        toState: WorkflowState.Published,
        action: WorkflowAction.Publish,
        actorName: 'سارة المحمود (المالك العام)',
        actorRole: 'Owner',
        timestamp: '2026-09-14T11:20:00Z',
        comment: 'تم الاعتماد النهائي والنشر للمنصة العامة.',
      },
      {
        id: 'tr-news-101-2',
        fromState: WorkflowState.InReview,
        toState: WorkflowState.Approved,
        action: WorkflowAction.Approve,
        actorName: 'م. أحمد خالد (مدير التدريب)',
        actorRole: 'TrainingManager',
        timestamp: '2026-09-12T14:15:00Z',
      },
      {
        id: 'tr-news-101-1',
        fromState: WorkflowState.Draft,
        toState: WorkflowState.InReview,
        action: WorkflowAction.SubmitForReview,
        actorName: 'د. معتز عبد القادر',
        actorRole: 'ContentEditor',
        timestamp: '2026-09-10T08:30:00Z',
      },
    ],
  },
  {
    id: 'news-sudan-102',
    titleAr: 'مبادرة حماية الشعاب المرجانية وأشجار المانجروف بالبحر الأحمر أوفشور بورتسودان',
    titleEn: 'Red Sea Coral Reef & Mangrove Protection Project Launched in Port Sudan',
    summaryAr: 'إطلاق مسح بيئي شامل لمحمية "سنقنيب" ودنقناب بالتعاون مع جامعة البحر الأحمر لحصر تأثير المتغيرات الحرارية على المستعمرات المرجانية.',
    summaryEn: 'Comprehensive marine ecological survey launched at Sanganeb and Dungonab marine parks to measure thermal stress impacts on coral colonies.',
    bodyAr: `بدأت الفرق العلمية بمعهد علوم البحار بجامعة البحر الأحمر تنفيذ برنامج الرصد الميداني للمناطق الساحلية قرب بورتسودان لحماية أشجار المانجروف والحيويات البحرية.

    تعتبر غابات المانجروف خط الدفاع الأول للساحل ضد التآكل والنحر، كما توفر حضانات طبيعية لصغار الأسماك والكائنات البحرية ذات القيمة الاقتصادية والبيئية العالية.

    يتضمن المشروع تركيب أجهزة استشعار حرارية تحت الماء لقياس التغيرات الدقيقة في درجة حرارة سطح البحر وتسجيل ظاهرة ابيضاض المرجان.`,
    bodyEn: `Scientific research teams from the Marine Sciences Institute at Red Sea University commenced field monitoring along coastal stretches near Port Sudan to safeguard mangrove habitats and marine fauna.

    Mangrove stands serve as critical coastal defenses against wave erosion while offering vital nursery grounds for ecologically and economically significant fish species.

    The initiative installs submerged thermal sensors to log micro-fluctuations in sea surface temperatures and track coral bleaching indicators.`,
    author: 'د. ليلى عثمان (باحثة بيئة بحرية)',
    category: 'البيئة البحرية والتنوع الحيوي',
    tags: ['البحر الأحمر', 'بورتسودان', 'سنقنيب', 'المانجروف'],
    sources: ['جامعة البحر الأحمر - معهد علوم البحار', 'جمعية حماية البيئة البحرية'],
    featuredImage: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&q=80&w=800',
    workflowState: WorkflowState.Approved,
    createdAt: '2026-09-12T10:00:00Z',
    updatedAt: '2026-09-15T09:45:00Z',
    history: [
      {
        id: 'tr-news-102-2',
        fromState: WorkflowState.InReview,
        toState: WorkflowState.Approved,
        action: WorkflowAction.Approve,
        actorName: 'م. أحمد خالد',
        actorRole: 'TrainingManager',
        timestamp: '2026-09-15T09:45:00Z',
        comment: 'تقرير علمي متكامل ومستوف للشروط البيئية.',
      },
      {
        id: 'tr-news-102-1',
        fromState: WorkflowState.Draft,
        toState: WorkflowState.InReview,
        action: WorkflowAction.SubmitForReview,
        actorName: 'د. ليلى عثمان',
        actorRole: 'ContentEditor',
        timestamp: '2026-09-12T10:00:00Z',
      },
    ],
  },
  {
    id: 'news-sudan-103',
    titleAr: 'تقييم أثر حزام الأحزمة الشجرية لمكافحة التصحر وزراعة الهشاب بولاية القضارف',
    titleEn: 'Impact Assessment of Acacia Gum Shelterbelts Against Desertification in Gadarif',
    summaryAr: 'دراسة ميدانية تظهر انخفاض معدلات زحف الرمال بنسبة 18% في المزارع المحمية بحزم أرجاد الهشاب والصمغ العربي بالقضارف.',
    summaryEn: 'Field study reveals an 18% reduction in sand encroachment across agricultural zones protected by Acacia senegal (Gum Arabic) shelterbelts in Gadarif.',
    bodyAr: `كشف تقرير أعدته الهيئة القومية للغابات بولاية القضارف عن نتائج ايجابية لاستزراع أحزمة شجرية متكاملة حول المشاريع المطرية والمناطق الزراعية.

    أوضحت البيانات التحليلية أن استخدام أشجار الهشاب المنتجة للصمغ العربي يسهم في تثبيت التربة وزيادة نسبة خصوبتها العضوية إلى جانب توفير مصدر دخل مستدام للمجتمعات المحلية.

    تسعى الخطة الحالية إلى توسعة الحزام الشجري ليشمل الشريط الحدودي المتاخم لمناطق الزحف الصحراوي الشمالية.`,
    bodyEn: `A technical evaluation published by the National Forests Corporation in Gadarif State demonstrated marked ecological benefits from establishing integrated tree belts around rainfed agricultural schemes.

    Data indicates that cultivating Hashab trees (Acacia senegal) stabilizes topsoil and enhances organic fertility while generating sustainable livelihood income via Gum Arabic harvesting.

    Current expansion plans aim to extend the forestry shelterbelt along northern fringes vulnerable to active sand dune migration.`,
    author: 'مهندس عثمان عبد الرحيم (استشاري غابات)',
    category: 'التصحر والغطاء النباتي',
    tags: ['القضارف', 'الصمغ العربي', 'التصحر', 'الهشاب'],
    sources: ['الهيئة القومية للغابات - القضارف'],
    featuredImage: 'https://images.unsplash.com/photo-1516214104703-d870798883c5?auto=format&fit=crop&q=80&w=800',
    workflowState: WorkflowState.InReview,
    createdAt: '2026-09-14T15:10:00Z',
    updatedAt: '2026-09-14T15:10:00Z',
    history: [
      {
        id: 'tr-news-103-1',
        fromState: WorkflowState.Draft,
        toState: WorkflowState.InReview,
        action: WorkflowAction.SubmitForReview,
        actorName: 'عثمان عبد الرحيم',
        actorRole: 'ContentEditor',
        timestamp: '2026-09-14T15:10:00Z',
      },
    ],
  },
  {
    id: 'news-sudan-104',
    titleAr: 'مراجعة خيارات تدوير النفايات البلاستيكية وإدارة المكب الرئيسي بالخرطوم',
    titleEn: 'Review of Plastic Waste Recycling Initiatives & Dump Site Management in Khartoum',
    summaryAr: 'مقترح فني لإعادة تأهيل منظومة جمع وإدارة النفايات الصلبة بالخرطوم وإدخال تقنيات الفرز الأولي في الأحياء.',
    summaryEn: 'Technical proposal aiming to overhaul solid waste collection infrastructure in Khartoum and introduce neighborhood-level source segregation.',
    bodyAr: `يتناول هذا التقرير وضع المكب الرئيسي ومعالجة مخلفات المواد البلاستيكية أحادية الاستخدام في المناطق الحضرية.

    تتضمن التوصيات تفعيل آلية التشجيع المالي للمبادرات الشبابية في إعادة التدوير، وربط الجمعيات البيئية بمراكز البحوث التطبيقية لتصنيع مواد البناء البديلة.`,
    bodyEn: `This technical review addresses urban solid waste challenges and disposal practices targeting single-use plastics in Khartoum metropolitan areas.

    Recommendations advocate financial incentive programs for youth-led recycling startups and research partnerships for alternative eco-building materials.`,
    author: 'م. آمنة المحجوب',
    category: 'الاستجابة والطوارئ البيئية',
    tags: ['الخرطوم', 'التدوير', 'النفايات الصلبة'],
    sources: ['المجلس الأعلى للبيئة والموارد الطبيعية'],
    workflowState: WorkflowState.ChangesRequested,
    createdAt: '2026-09-13T12:00:00Z',
    updatedAt: '2026-09-15T16:30:00Z',
    history: [
      {
        id: 'tr-news-104-2',
        fromState: WorkflowState.InReview,
        toState: WorkflowState.ChangesRequested,
        action: WorkflowAction.RequestChanges,
        actorName: 'مراجعة الحقوق والمحتوى',
        actorRole: 'RightsReviewer',
        timestamp: '2026-09-15T16:30:00Z',
        comment: 'يرجى تدقيق الإحصائيات الخاصة بكميات النفايات المجمعة وتضمين مصادر إضافية معتمدة.',
      },
      {
        id: 'tr-news-104-1',
        fromState: WorkflowState.Draft,
        toState: WorkflowState.InReview,
        action: WorkflowAction.SubmitForReview,
        actorName: 'آمنة المحجوب',
        actorRole: 'ContentEditor',
        timestamp: '2026-09-13T12:00:00Z',
      },
    ],
  },
  {
    id: 'news-sudan-105',
    titleAr: 'تحليل موجات الجفاف وتقلبات الأرصاد الجوية في ولاية شمال كردفان',
    titleEn: 'Rainfall Variability & Drought Sensitivity Analysis in North Kordofan',
    summaryAr: 'مسودة تقرير استقصائي يحادث خبراء الأرصاد في الأبيض لتوثيق التحولات المناخية وتأثيرها على الموسم الزراعي.',
    summaryEn: 'Draft investigative piece interviewing meteorologists in El Obeid on climate trends impacting traditional farming seasons.',
    bodyAr: `تعد ولاية شمال كردفان من المناطق الهشة بيئياً تجاه تذبذب الأمطار الموسمية. يسلط التقرير الضوء على التقنيات المحلية المتبعة في حصاد مياه الأمطار.`,
    bodyEn: `North Kordofan remains highly sensitive to seasonal rainfall fluctuations. The draft documents traditional rain-harvesting techniques utilized by local farmers.`,
    author: 'د. طارق الريح',
    category: 'المناخ والطقس',
    tags: ['شمال كردفان', 'الأبيض', 'الجفاف', 'المناخ'],
    sources: ['محطة الأرصاد الجوية - الأبيض'],
    workflowState: WorkflowState.Draft,
    createdAt: '2026-09-16T09:15:00Z',
    updatedAt: '2026-09-16T09:15:00Z',
    history: [],
  },
];
