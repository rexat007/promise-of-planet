# وعد الكوكب — IMG-F3-08: تدقيق التكامل الفعلي لرفع صور الأخبار

**التاريخ:** 2026-10-22  
**الوضع:** `READ_ONLY_AUDIT_COMPLETE — FIRST_BOUNDED_UNIT_PROPOSED — NO_IMPLEMENTATION`  
**Repository:** `rexat007/promise-of-planet`  
**Pushed authoritative HEAD:** `0799658cd5589ff47bbc93dbedde0918398761d5`  
**المصدر التنظيمي:** `Promise_of_Planet_Continuity_2026-10-22_IMG-F3-07_ACCEPTED.zip`، ولا سيما `31_IMAGE_UPLOAD_LAUNCH_INTEGRATION_GATE.md`، وIMG-F3-07 مقبولة في نطاق محرك مستقل.

## 1. خريطة التدفق المثبتة، والمواضع الغائبة

| المرحلة | المصدر الثابت | الحكم |
|---|---|---|
| واجهة تحرير الأخبار | `src/components/news/AdminNewsManagement.tsx` + `editor/RichTextEditor.tsx` | يدعمان مسودات وعنوان تمهيدي، متن عربي/إنجليزي، وسير عمل، ولا يتضمنان تحكماً فعالاً لإرسال صورة إلى backend. |
| محرر الصور التجريبي | `src/components/news/editor/sandbox/ImageEditorSandbox.tsx` | نموذج Uppy/Canvas مستقل، يكوّن object URLs محلية وبيانات اختبارية. يحتوي نسب/اعتمادات وصيغ تجريبية؛ **لا يُستنسخ إلى الإنتاج** ولا تُعتمد منه رخصة افتراضية. |
| نقل أخبار الإدارة | `src/services/newsAdminClient.ts` → callable `manageNews` | `saveDraft`, `listAll`, `getById`, `transitionWorkflow`، ولا يوجد فعل رفع بايتات. |
| الواجهة الخادمية للأخبار | `functions/src/news/newsAdminHandlers.ts`, `functions/src/index.ts` | `manageNews` و`getPublicNews` مسجلتان؛ لا يوجد endpoint مسجل لرفع الصور. |
| استقبال الصورة | `functions/src/news/editorialBinaryIntakeService.ts` | منظومة Saga مع صلاحيات بشرية، وثوابت حالات، وفحص أولي، لكن مسار المنتج الحالي ينسخ نفس bytes خمس مرات. لم يُربط. |
| معالج مشتقات حقيقي | `functions/src/news/editorialImageVariantProcessor.ts` | IMG-F3-07 المقبولة؛ خمسة ملفات WebP فعلية، 15MB/25MP، دون كتابة على GCS/Firestore؛ غير مربوط بالـSaga. |
| تخزين خاص | `functions/src/news/gcsEditorialBinaryStorageAdapter.ts` | `writeIfAbsent` باستخدام `ifGenerationMatch:0`، و`readMetadata`، وحذف مشروط بالجيل والملكية؛ لا يضمن بمفرده إيصالًا دائمًا قبل crash. |
| مخزن جلسات دائم | `functions/src/news/firestoreEditorialBinaryIntakeSessionStore.ts` | جلسات مع CAS وأثر حالات/تاريخ انتهاء؛ لا توجد عملية تنسيق ذرية مشتركة مع GCS. |
| سجل الصور وحقوقها | `functions/src/news/editorialImageAssetRepository.ts` و`editorialImageRightsReviewService.ts` | أصل خاص بحالة حقوق تبدأ `PendingReview` وانتقالات مراجعة بشرية مستقلة؛ لا يوجد تحقق موصول بتسليم صورة الخبر العامة. |
| الخبر المنشور | `functions/src/news/newsRepository.ts` و`publicNewsRepository.ts` | `featuredImage?: string`، وDTO العامة تنقل `featuredImage` كما هي للخبر Published دون مرجع `assetId` متحقق الحقوق في هذا المسار. |
| الرئيسية | `src/components/news/HomeNewsPreview.tsx` | يعرض الأخبار المنشورة عبر `getPublicNews` دون بديل mock؛ ليس دليلاً على وصول الصور الخاصة للعموم. |

مصادر الشيفرة المثبتة: `https://github.com/rexat007/promise-of-planet/blob/0799658cd5589ff47bbc93dbedde0918398761d5/<relative-path>`، وتطبق بتبديل `<relative-path>` بالمسار المذكور في الجدول عند المراجعة البشرية (هذا تنسيق توثيقي للقارئ، **لا يستخدم لطلبات جلب داخل Studio**).

## 2. فجوة إيصال GCS: واقعة محددة

1. يسجل `ingestEditorialImageBinary` الجلسة في Firestore ثم ينفذ GCS `writeIfAbsent` لعزل الملف أو المشتقات.
2. إذا نجحت كتابة الكائن قبل حفظ `generation`/`created*Objects` في جلسة Firestore وانقطع العامل، تبقى معلوماته داخل metadata في GCS، لكن session لا تحصيها.
3. `reconcileIntake` الحالي يحذف فقط `createdPrivateObjects` و`createdQuarantineObjects` و`pendingCleanupObjects` المعروفة. قد يحوّل جلسة إلى `Failed` بينما يترك كائنًا آخر مملوكًا لها.
4. **قابلية محتملة للاكتشاف، تحتاج إثباتًا:** المسارات مشتقة حتميًا، وواجهة `readMetadata` تعيد `generation` و`createdByIntakeId` و`targetKind` و`assetId` و`uploaderUid` والـchecksum؛ يمكن البحث في **مجموعة مسارات محدودة معروفة**، دون list bucket أو مسح مفتوح.
5. **ليس مثبتًا كحل جاهز:** الاستكشاف وحده لا يقرر الحذف. قبل أي حذف، يجب قراءة التسجيل الكانوني، والتحقق من ملكية كائن بعينه وجيله، ومعالجة سباق عامل لا يزال يكتب، وCAS، واحتمال فقد جواب التسجيل بعد نجاحه. لا يجوز اعتبار `readMetadata` بديلًا عن إثبات محتوى bytes أو عن قفل/lease.

## 3. حدود نقل الملف والأمان

- استقبال ملف 15,000,000 bytes قد يُضخّم إلى نحو 20MB عند base64، إضافة إلى JSON والذاكرة؛ وثائق Firebase تُظهر حد **32MB** لطلب HTTP في Functions الجيل الثاني، لكن هذا **ليس تصريحًا** باختيار callable لنقل الملفات. يجب تصميم transport والتحقق من حد الحمولة الحقيقي والذاكرة والمصادقة قبل تنفيذه. مرجع: https://firebase.google.com/docs/functions/quotas
- Storage Rules الحالية تخص `branding/platform-logo` و`citizen_submissions`; لا تتضمن سماحًا عامًا لمسارات `editorial_images/private`، وهو مناسب افتراضيًا؛ استخدام Admin SDK يتطلب حماية خادمية لا اعتمادًا على قواعد عميل. ممنوع إصدار URL عام أو مخزّن في DTO قبل موافقة حقوق الصورة وربط أصل معتمد.
- الجهة الناشرة لخبر `Published` وحقوق صورة `Approved` حدّان مختلفان؛ لا يكفي نشر الخبر لإظهار الصورة.
- ميزة `featuredImage:string` الحالية لا تثبت ملكية/مرجع أصل صورة. ينبغي تحويل الخبر إلى اعتماد server-authoritative على `assetId` والتحقق من الحقوق قبل التسليم، بعقد منفصل لا بمجرد تعديل حقل النص.
- `ImageEditorSandbox` تجريبية وتستخدم URL محليًا ونسبًا افتراضية؛ ممنوع نقل بيانات النسبة أو الترخيص التجريبية إلى الإنتاج.
- المحرر المقترح بعد اعتماد التخزين: اختيار صورة، معاينة محلية مؤقتة واضحة، رفع محمي، ربط الأصل، عنوان بديل/شرح/اسم مصور/حقوق، وإظهار حالات فشل وحذف؛ عربي/إنجليزي RTL/LTR وتوافق جوال/تابلت/كمبيوتر وأقل عدد أزرار.

## 4. عوائق البناء والنشر المثبتة

- `functions/src/news/editorialBinaryInspector.ts:1451` يحوي متغير `canonicalExtension` غير المستخدم؛ Studio وثّق TS6133 في بناء Functions، وتأكد وجوده في GitHub. لا نعد البناء ناجحًا.
- Studio أبلغ عن TS1484/TS6133 في frontend baseline؛ **لا تتوفر هنا قائمة كاملة للأسطر التي فشلت**. لا يجوز تعديل عشوائي. يحتاج تقرير تشخيص مضبوط قبل تنفيذ إصلاح build منفصل.
- `firebase.json` يحتوي Firestore indexes وStorage rules، لكن نجاح الملفات المحلية لا يثبت نشر فهرس IMG-F3-06 أو جاهزية قواعد Storage أو IAM على المشروع الفعلي.
- `.github/workflows/firebase-functions-news-live.yml` ينشر `manageNews,getPublicNews` عند تشغيله يدويًا؛ لا نفترض أنه ينشر endpoint رفع لم يُكتب أصلًا. لا Firebase CLI من Studio ولا نشر إلا بإذن مستقل عبر GitHub Actions بعد استكمال شروطه.

## 5. مسار الإطلاق المصغر (كل خطوة بقبول مستقل)

1. **IMG-F3-08A — Receipt discovery proof:** ملف تنفيذ جديد + اختبار جديد، للعثور على كائنات صور مملوكة غير مسجلة في session عبر أسماء ثابتة و`readMetadata`. **قراءة فقط: لا Firestore mutations، لا GCS write/delete، ولا UI.** هذا شرط لتصميم recovery موثوق، وليس إصلاح orphan بحد ذاته.
2. **IMG-F3-08B — Durable crash recovery:** بعد قبول إثبات الاكتشاف، مواصفة محددة تدمج الاكتشاف ضمن CAS وقراءة التسجيل الكانوني والحماية من السباقات، مع اختبارات انقطاع/إعادة محاولة. يتطلب قرارًا مسبقًا لأي تعديل على خدمات IMG-F3-05/06 المقبولة.
3. **IMG-F3-08C — Upload + processor + asset link:** بعد ضمان recovery، توصيل النقل الخادمي والمشتقات إلى أصل خاص وربط news `assetId`، مع سحب الصلاحيات من الخادم وتدقيق الحقوق؛ دون نشر آلي.
4. **Release gates منفصلة:** إصلاحات البناء الضرورية بنطاق أصغر، اختبار Emulator وواجهة حقيقي، حقوق بشرية، قواعد/فهرس/IAM ومراجعة نشر GitHub Actions.

## 6. بوابة STOP

توقف إذا اختلفت بصمات baseline أو تغيرت شروط العقد، أو احتاج الإثبات إلى تعديل الملفات المقبولة أو توسيع الصلاحيات، أو احتاج جرد bucket/قراءة عشوائية، أو تعذر تمييز كائن مملوك من كائن آخر، أو صار إثبات الاكتشاف ذريعة لحذف/نشر أو claim بأن رفع الصور جاهز.

**نتيجة التدقيق:** `READ_ONLY_SOURCE_AUDIT_PASSED — UPLOAD_NOT_READY — FIRST_UNIT_SPECIFIED`. لم نكتب كودًا أو نختبر Firebase الحقيقي، ولا نعتبر IMG-F3-08 منفذة أو مقبولة.
