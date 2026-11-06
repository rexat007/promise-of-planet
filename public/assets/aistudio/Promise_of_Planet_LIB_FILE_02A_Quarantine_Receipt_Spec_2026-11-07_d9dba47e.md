# وعد الكوكب — LIB-FILE-02A
## Private Quarantine Identity & Durable Receipt Contract — Engineering Specification

**الحالة:** SPEC_READY / NOT_IMPLEMENTED  
**المستودع:** `rexat007/promise-of-planet`  
**مرجع المصدر المثبت:** `e9a9adf9eedcf621bb4c0f9602f669044debbbbb`  
**النطاق:** مواصفة عقد إيصالات الحجر الخاص ومسار التخزين **دون أي عمليات تخزين أو رفع فعلية**.

## 1. الأدلة المصدرية

| المسار | Git blob SHA-1 | الملاحظة |
|---|---|---|
| `functions/src/library/libraryUploadBinaryAdmission.ts` | `ea289629676addb05d89250e7f1599b71c5fb3d0` | الفحص الأولي PDF/DOCX: `PENDING_DEEP_INSPECTION` فقط |
| `functions/src/library/libraryUploadDeepStructure.ts` | `7e6ba463502bc8d6c796378d6b381cdaaf01c60e` | DOCX فُحص بنيويًا لكنه غير معقم؛ PDF يحتاج محللًا معزولًا |
| `functions/src/shared/libraryContract.ts` | `cfb0849c0418ba7b075f7de49c3debe668adc724` | `LibraryIntakeRecord` حاليًا رابط إلزامي |
| `functions/src/library/firestoreLibraryRepository.ts` | `afba4876b6d736424bd0b344df1db9a5e1417327` | يقوم بتوثيق روابط الاستقبال الحالية |
| `functions/src/news/editorialBinaryIntakeService.ts` | `c905d500df376e546b71e6a091d1624890f39542` | نموذج مرجعي: مخزن/إيصال متين، ربط ملكية، استرداد الإخفاقات |
| `functions/src/news/gcsEditorialBinaryStorageAdapter.ts` | `4bc2c40dd72c4bd3d8c09b349958db7a8e291e9e` | كتابة GCS مشروطة `ifGenerationMatch:0` وفحص metadata |
| `storage.rules` | `d77548e6b505d8db3858634cc2937937393a9864` | لا توجد قاعدة سماح لمكتبة الوثائق؛ لا تضف مسار وصول مباشر |
| `functions/src/shared/adminContract.ts` | `f895313b46de7f1f55d3d0e1cc1aca4fc9e7391d` | أدوار وصلاحيات الإدارة |
| `functions/tsconfig.json` | `eb3212ee4cd1c4acaa70618850e9c0fa0346dbf6` | بناء Functions الرسمي يتم في GitHub Actions |

**الدليل التشغيلي:** Workflow `AUTH-03A` #15 ناجح على هذا الـCommit؛ لا يعني نشر Firebase.

## 2. قرار التجزئة

- **LIB-FILE-02A (هذه الوحدة):** عقد صارم للحجر والإيصال، هوية تخزين داخلية، انتقالات الحالة القابلة للاسترداد، وDTO إداري منقّى؛ كود pure فقط واختبارات؛ لا Firebase أو GCS.
- **LIB-FILE-02B:** طبقة التخزين الخاص والإيصالات المتينة باستخدام GCS/Firestore، اعتماد متزامن على قراءة metadata وكتابة مشروطة وآلية استرداد؛ بنطاق جديد بعد قبول 02A.
- **LIB-FILE-02C:** HTTP endpoint مصرح له فقط وواجهة إدخال الملف مع الحالة وإعادة القراءة؛ لا تخزين في روابط عامة.
- **LIB-FILE-02D وما بعدها:** فحص/تعقيم PDF وDOCX، استخراج النص في مسار معزول، ثم وصل السجل الحقيقي بمهام PEIA بعد تصريح قبول مستقل.

## 3. العقد المطلوب للوحدة 02A

**المسارات الحصرية التي يجوز إنشاؤها:**

1. `functions/src/library/libraryQuarantineReceiptContract.ts`
2. `scripts/runLibraryQuarantineReceiptContractTests.ts`

لا يُعدّل أي ملف قديم ولا تُضاف حزمة.

### 3.1 الهوية ومسار الحجر

- معرف إيصال عشوائي صادر من الخادم فقط، بكثافة عشوائية لا تقل عن 128 بت؛ لا تستعمل filename أو URL أو user-provided path كهوية.
- صيغة مسار مقيدة مثل `library/quarantine/<server-receipt-id>/source.pdf` أو `source.docx`، وتبقى **داخلية للخادم وحده**.
- المسار لا يُعاد إلى العميل ولا يخرج في سجل الأخطاء أو الـDTO. لا رابط عام، ولا download token، ولا signed URL.
- لا تختلط هذه البنية مع namespaces الخاصة بصور الأخبار، ولا تُستخدم قواعد Storage لفتح قراءة عامة.

### 3.2 إيصال قابل للتدقيق

- الحقول الداخلية: `receiptId`, `uploaderUid`, `format`, `canonicalMimeType`, `originalFilename` (metadata فقط), `byteSize`, `sha256`, `storagePath`, `generation?`, `state`, `createdAt`, `updatedAt`.
- `sha256` و`byteSize` يأتيان فقط من الفحص على بايتات المصدر الحقيقي، وليس من بيانات مرسلة من المستخدم.
- status محجور واضح: `Reserved`, `WritePending`, `Quarantined`, `NeedsReconciliation`, `Rejected` (أو أسماء مكافئة مقيدة باختبارات).
- `Quarantined` يعني **حفظًا خاصًا فقط**، وليس `Sanitized`, `VerifiedSafe`, `RightsApproved`, `Published` أو `ReadyForPeia`.
- لا انتقال إلى `Quarantined` دون إثبات مطابق من طبقة تخزين خادمية مستقبلية: generation غير فارغ، تطابق SHA-256 والحجم والملكية والمسار.
- تخطيط لاسترداد النتيجة الملتبسة: لا حذف تلقائي ولا إعادة كتابة بهوية جديدة، بل `NeedsReconciliation` حتى قراءة metadata خادمية موثوقة.
- readback إداري منقّى يقتصر على معرف الإيصال والحالة والصيغة والحجم والبصمة/توقيتها وفق الحاجة؛ يستبعد storagePath, generation, credentials, raw bytes, signed URLs.
- حالات الانتقال تفشل مغلقة عند تبدل الهوية أو البصمة أو actor أو القيم المجهولة، وعند تغير الحالة غير المسموح.

### 3.3 حد الأمان للملف

- مع قبول 01A/01B، لا ترتفع أي علامة أمان أو نشر.
- `PDF_REQUIRES_ISOLATED_PARSER` و`DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION` **يمكن التخطيط لحجرهما الخاص**، لكن لا يجوز إطلاقهما للمستخدمين أو تمريرهما إلى PEIA.
- لا طلب تنزيل من متصفح المستخدم ولا إدراج `normalizedUrl` مزيف في سجلات المكتبة الحالية.

## 4. اختبارات القبول

اختبارات pure تغطي توليد المعرف والمسار، صيغ PDF/DOCX، منع traversal والبصمات غير المطابقة، اتساق الحالات وانتقالاتها، تكرار وإعادة المحاولة، حالات ambiguous result، DTO منقّى، الحفاظ على payload دون public URL أو readiness flags، وعدم أي طلب شبكة أو عملية كتابة.

الاختبارات القائمة 01A و01B تبقى دون تعديل؛ وبيئة Studio Typescript 6 قد تمنع بناء Functions الكامل. فحص البناء الحقيقي بعد الرفع عبر GitHub Actions `AUTH-03A` فقط.

## 5. ممنوعات وشرط توقف

لا تكتب إلى: `storage.rules`, `functions/src/index.ts`, `functions/src/library/*` القائمة، `functions/src/news/*`, `functions/src/peia/*`, `src/*`, عقود الحقوق، `package.json`, `tsconfig` أو lockfiles.

STOP إذا اختلفت SHA-1 أو وجدت الملفات المستهدفة مسبقًا أو احتاج العقد تعديل الملفات القديمة أو حزمًا جديدة. لا تستخدم Git ولا تطلب من Studio سحب محتوى GitHub بمسار فقط. لا Push ولا Deploy ولا رفع حقيقي في هذه الوحدة.

## 6. معايير القبول النهائية

- مطابقات البصمات السابقة.
- ملفان جديدان فقط.
- اختبارات جديدة ناجحة وتوثيق الدفعات وتكامل حالات الانتقال.
- بلا أي اعتماد أمني أو نشر أو صلاحية PEIA.
- لا ملف معدّل/محذوف غير مقصود في GitHub Sync، مع الإبلاغ عن مرايا Studio المعلومة منفصلة.
- قبول المستخدم ثم Push يدوي ثم تحقق المصدر و`AUTH-03A`، قبل 02B.
