# وعد الكوكب — IMG-F3-06
## محولات التخزين الدائم وسجل استرداد استقبال الملفات

**الحالة:** SPECIFICATION READY / IMPLEMENTATION NOT STARTED / OWNER ACCEPTANCE PENDING  
**تاريخ المرجع:** 21 أكتوبر 2026  
**Repository:** `rexat007/promise-of-planet`  
**Pushed source anchor:** `11b2f7159075cbe57b0adcf5b125c78ae7ef87dc` (parent `afe25dd74068ae016bba7c11303f948ff146c34e`).

## 1. مصدر الحقيقة والقرارات الملزمة
- ما دفع إلى GitHub يُراجع بالـcommit المثبت؛ تغييرات Studio اللاحقة تُؤخذ من Studio المحلي فقط.
- IMG-F3-05 مقبول كوحدة داخلية فقط (112 اختبارًا حسب تقرير Studio)، وتطابق SHA-1 على GitHub مثبت؛ لا تعديله دون علة مؤكدة وموافقة جديدة.
- لا نشر/تسجيل callable، لا Firebase CLI، لا تغيير لقواعد Firebase أو `functions/src/index.ts`، لا رفع صور إلى الإنتاج.
- تبقى المواصفات تحت `public/assets/aistudio` مؤقتًا؛ لا تنظيف لها داخل هذه الوحدة.
- `bun.lock` ملف موجود في GitHub، غير مصرح بتعديله أو حذفه/إعادة توليده. `package-lock.json` و`package.json` خارج النطاق كذلك.
- **قرار دائم إضافي من المالك:** في نهاية **كل وحدة** تُراجع **جميع الوثائق الحية** في حزمة الاستمرارية (`00`…`18` ثم ما يُضاف)، وتحدّث الأجزاء المتأثرة؛ وتُسجل صراحةً مراجعة الأجزاء غير المتغيرة. يُحدث الفهرس، حالة الوحدات، القرارات، الخطة، سجل التغييرات، وmanifest البصمات وZIP. تبقى `history/` و`documents_contextualized/` سجلات تاريخية لا تُعاد كتابتها صامتًا. **لا يُسجل OWNER_ACCEPTED_CLOSED قبل بوابة الوثائق.** التحديث محفوظ كمرفق جديد ولا يعني تبديل مشروع ChatGPT آليًا.

## 2. الأساس الفعلي المقروء من GitHub

| الملف المرجعي | Git blob SHA-1 | المكوّن المثبت |
|---|---|---|
| `functions/src/news/editorialBinaryIntakeService.ts` | `61c13c7878112a6a0cd075df094478449c97d5b2` | واجهات `EditorialBinaryStorageAdapter`, `IntakeSessionStore`, `EditorialBinaryIntakeServiceOptions`، الحالات العشر و`reconcileExpiredIntakes` |
| `functions/src/news/editorialBinaryInspector.ts` | `8c1dbb8431de693af710c219c06538e2212107de` | فحص أولي فقط، لا فك بكسلات ولا تنظيف PDF كامل |
| `src/services/editorialBinaryIntakeService.test.ts` | `abb2e1795467c300b54396a7ba00082dae59ecef` | اختبار 15 سيناريو لاستقبال/استرداد في الذاكرة |
| `functions/src/news/editorialImageAssetRepository.ts` | `e83b6bd42c00558b0d8c2147f8d17e64a7e1a965` | `getById/createIfAbsent` للأصل القانوني |
| `functions/src/news/firestoreEditorialImageAssetRepository.ts` | `97e74f6d6eebfc8f38ae3c3e82fd172085cb1990` | مرجع Transactional Firestore Injection |
| `functions/src/news/editorialImageRightsReviewService.ts` | `beed9487636feaf918bed2dfc14c9013c17753f7` | تسجيل أدلة الحقوق وسياق المراجع البشري |

**أشكال العقد الموجودة:**
- `EditorialBinaryStorageAdapter`: `writeIfAbsent`, `readMetadata`, `readBytes`, `deleteIfGenerationMatches`.
- `StorageObjectMetadata`: `storagePath`, `generation`, `etag`, `contentType`, `sizeBytes`, `sha256Checksum`, `createdAtIso`, `ownership`.
- `IntakeSessionStore`: `createSessionIfAbsent`, `getSessionById`, `updateSession(session, expectedRevision)`, `listSessionsForReconciliation({nowIso,limit})`.
- `EditorialBinaryIntakeSession`: `revision`, `expiresAt`, حالات `NeedsReconciliation/CleanupPending/Registered`، قوائم objects للمعاملة وحقول قرار التسجيل غير المؤكد.
- لا توجد في IMG-F3-05 محولات فعلية دائمة، ولا حاجة لإعادة كتابة هذه الواجهات.

المراجع العامة لاستراتيجية GCS فقط: [Google Cloud Storage preconditions](https://cloud.google.com/storage/docs/request-preconditions)، [حذف كائن بشروط generation](https://cloud.google.com/storage/docs/deleting-objects). `ifGenerationMatch=0` للإنشاء إن لم يكن موجودًا، وفشل 412 عند تعارض generation. يجب اختبار واجهة SDK الفعلية قبل التشغيل الإنتاجي.

## 3. النتيجة المطلوبة للوحدة
**تسليم محولين قابلين للحقن والاختبار للتعامل مع خدمات تخزين دائمة، دون تسجيل endpoints أو إنشاء بنية حية:**

1. **Firestore persistent session store:** Collection مقترحة `editorial_binary_intake_sessions/{intakeId}`، حفظ كامل لسجل الجلسة، مراجعة صارمة للعقد وإعادة بناء defensive copy. إنشاء إذا لم يوجد معاملة أو `create` مع حماية التزامن، تحديث بالـ`revision` المتوقع داخل Firestore transaction، الحفاظ على المستند وحالة عدم اليقين عند الانقطاع، استعلام reconciliation محدود العدد ومبني على حالات جاهزة أو `expiresAt <= nowIso` دون مسح غير محدود. لا استخدام `set(...,{merge:true})` يتجاوز فحص revision، ولا تجاهل لقائمة مفاتيح JSON أو حقول غير موثوقة. إذا احتاج الاستعلام إلى index أو بنية غير مصرّح بها، تُوثق الحاجة ويتوقف ربطه الإنتاجي.
2. **Cloud Storage adapter:** يعتمد حقن `Bucket`/`File` structurally، يتوافق مع الواجهة المعرّفة أعلاه، يكتب `Buffer` مع create-if-absent generation precondition وبصمة SHA-256 محققة، يخزن metadata الملكية، يرفض المسارات غير الخاصة أو التي لا تطابق namespace/asset/evidence، يستخدم generation الخام بلا تحويل عددي غير آمن، يعيد قراءة metadata وbytes بتحقق fail-closed من الحجم/البصمة. Delete conditional generation + owner intake؛ تحقّق الملكية **لا يحل مكان شرط generation على عملية الحذف نفسها**. 404/412 قابلة للتصنيف، أخطاء الشبكة أو الحالة الغامضة لا تُفسر على أنها نجاح حذف. لا download tokens، لا public URL، ولا signed URLs.
3. **اختبارات تكامل تعاقدية مع mocks دائمة في الذاكرة فقط:** عدة instances تتشارك نفس backing fake Firestore/GCS وتثبت استعادة حالات `NeedsReconciliation`, `CleanupPending`, and TTL sessions من instance جديد؛ وحماية الكتابة/الحذف عند تعارض revision أو generation؛ واختبار انقطاع بعد نجاح GCS وقبل تسجيل receipt في Firestore، وتمييزه بوضوح على أنه فجوة تحتاج تدبيرًا إضافيًا إذا تعذرت مصالحته بالمكونات المقبولة دون تعديلها.

**تنبيه أمني:** Firebase Storage وFirestore لا يقدمان معاملة ذرية مشتركة. محولات التخزين وحدها **لا تثبت** سلامة recovery كاملة بعد crash إذا حدث الانقطاع بين كتابة Storage وتسجيل generation receipt؛ إذا لم تغطِّ الأدوات القائمة النافذة بآلية قابلة للتحقق، أخرج تقرير `REQUIRES_FOLLOW_UP_DESIGN` وتوقف عن وصف هذه النافذة بأنها مغلقة. لا يجوز حذف كائن عند نتيجة Canonical commit غير مؤكدة دون read-back موثوق. لا تحتفظ ببايتات ثنائية داخل Firestore session document.

## 4. حدود الملفات — قائمة السماح (3 ملفات جديدة فقط)
1. `functions/src/news/firestoreEditorialBinaryIntakeSessionStore.ts` **CREATE**.
2. `functions/src/news/gcsEditorialBinaryStorageAdapter.ts` **CREATE**.
3. `src/services/editorialPersistentBinaryAdapters.test.ts` **CREATE**.

**ممنوع:** تعديل `editorialBinaryIntakeService.ts` أو inspector أو المستودعات المقبولة أو rules أو `functions/src/index.ts` أو package/lockfiles أو ملفات الواجهة أو الوثائق/الأرشيف المحلي في Studio. إن ظهر شرط تقني يمنع توفير محولين صالحين ضمن هذه القائمة: STOP ببيان دقيق، لا توسّع تلقائي.

## 5. الاختبارات والبوابات
- Preflight: تحقق blob SHA-1 المرجعي للملفات الستة أعلاه، وغياب الملفات الثلاثة الجديدة. تحقق أن Studio المحلي لم يُعدّل الملفات المرجعية منذ GitHub؛ في حال الخلاف STOP ولا استرجاع تخميني.
- Firestore: initial creation, idempotent read, stale-CAS conflict, two concurrent updates/creates, malformed persisted record, schema mismatches, time cutoff/bounded reconciliation, retry with fresh snapshot, crash/restart simulation across instances.
- GCS: exact-buffer SHA, owner/namespace binding, generation `0` for new object, preserve existing, conditional delete with actual generation, reject 412/owner mismatch, untrusted customMetadata/missing generation, simulated network unknown outcome, missing object idempotent, no URLs/tokens.
- End-to-end mock service (when feasible): existing `EditorialBinaryIntakeService` injected with persistent mock adapters; conditional read-back and protected cleanup.
- Gate: commands and exact exit codes for targeted Vitest and isolated TS compile; existing known full Functions TS5107 issue classified separately. No cloud/emulator execution claim without proof.
- Distinguish **ADAPTER_IMPLEMENTED**, **OFFLINE_TESTED**, **REAL_FIREBASE_INTEGRATION_NOT_VERIFIED**, **PRODUCTION_NOT_AUTHORIZED**.

## 6. شروط القبول والإغلاق — وثائق إلزامية
تقرير Studio وبصمات الملفات → مراجعة مصدر من GitHub فقط **بعد** Push يدوي مستقل (إن حصل)؛ وإلا مراجعة المخرجات المحلية المرسلة → موافقة المالك الصريحة → تحديث حزمة الاستمرارية عبر هذه المحادثة: مراجعة ملفات `00`–`18` كلها، تحديث الحالة والقرارات والنطاق وخارطة الطريق وقائمة الموانع والـchangelog، وإعادة إنشاء `FILE_MANIFEST_SHA256.json` وتحقق الأرشيف، مع إرفاق spec والتقرير النهائي. لا يُوصف التحديث بأنه استبدال تلقائي لمرفقات Project، ولا يغلق بدون رابط الحزمة المحدّثة.

**Final Gate for this document:** `READY_FOR_BOUNDED_STUDIO_IMPLEMENTATION`, **not** `IMPLEMENTED` or `ACCEPTED`.
