# وعد الكوكب — 69 / LIB-FILE-CASE-ALIGNMENT-01
## حزمة متكاملة: إعادة مواءمة النسخ البشرية مع مسودة الفهرس + إعادة مراجعة الحقوق + سلامة نتيجة المعاملة

**التاريخ:** 2026-11-10  
**المستودع:** `rexat007/promise-of-planet`  
**GitHub pinned HEAD:** `79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c`  
**الحالة:** `SPECIFIED_NOT_IMPLEMENTED`؛ لا Push أو Firebase deploy أو تفعيل أذونات.  
**الوحدة السابقة:** `LIB-FILE-RIGHTS-AND-READINESS-01` — commit verified `79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c`. `SOURCE_REVIEWED_WITH_DEBT`: اختبار Studio 14/14 حسب تقريره، بلا تحقق حي.  

## 1) النتيجة الوظيفية الواحدة

عندما يُعدِّل المراجع سجل `library_quarantine_human_review_cases/<receiptId>` بعد إنشاء `qcat-<receiptId>`، يوقف مسار الحقوق اليوم القرار باسم `SOURCE_CASE_VERSION_DRIFT_HOLD` ولا توجد وسيلة موثقة لرفع التعليق. **أضف إجراء مواءمة بشرية داخل نفس نافذة المراجعة/لوحة handoff**: يعرض اختلاف أربعة حقول بين المراجعة المحفوظة ومسودة الفهرس (العنوان AR/EN والملخص AR/EN)، ويتيح للمحرر المخوّل **تبنّي نص النسخة البشرية الحالية يدويًا** في مسودة الفهرس الداخلية فقط، مع مقارنة نسخ صارمة وإيصال مواءمة دائم وحدث تدقيق؛ ثم يجعل **قرار الحقوق السابق غير فعّال** إن كان مرتبطًا بمراجعة أقدم، إلى أن يصدر مراجع الحقوق قرارًا جديدًا بأدلة بشرية صريحة.

لا تمس إيصال الحجر أو GCS أو ملف PDF/DOCX، ولا تعدّل handoff الأصلي غير القابل للاستبدال، ولا تقل تلقائيًا إن الملف آمن/مطهّر/حقوقه معتمدة أو صالح للنشر. لا تنشر أي شيء.

**واقعة مصدر مثبتة:** `functions/src/library/firestoreLibraryQuarantineRightsDecisionStore.ts` يجعل `writeStagedInTransaction = false` داخل callback عند كل retry، وفي frontend رفض transport لطلب SAVE يُعرض كخطأ عادي بلا `UNKNOWN` hold. صحِّح **معهما** ضمن هذه الحزمة لضمان تصنيف أمين للالتزام غير المؤكد. لا تفتح وحدة منفصلة.

## 2) قائمة السماح الحصرية (8 MODIFY + 5 ADD، 0 DELETE)

### MODIFY (8)
1. `functions/src/library/libraryAdminHandlers.ts`
2. `functions/src/library/firestoreLibraryQuarantineRightsDecisionStore.ts`
3. `functions/src/library/libraryQuarantineRightsDecisionService.ts`
4. `src/services/libraryQuarantineRightsDecisionClient.ts`
5. `src/components/library/LibraryQuarantineRightsDecisionPanel.tsx`
6. `src/components/library/LibraryQuarantineCatalogHandoffPanel.tsx`
7. `scripts/runLibraryQuarantineRightsDecisionBackendTests.ts`
8. `scripts/runLibraryQuarantineRightsDecisionClientTests.ts`

### ADD (5)
- `functions/src/library/libraryQuarantineCatalogCaseAlignmentService.ts` (ADD؛ يجب التحقق من الغياب في GitHub baseline ومن غيابه محليًا؛ لا تستبدل ملفًا موجودًا)
- `src/services/libraryQuarantineCatalogCaseAlignmentClient.ts` (ADD؛ يجب التحقق من الغياب في GitHub baseline ومن غيابه محليًا؛ لا تستبدل ملفًا موجودًا)
- `src/components/library/LibraryQuarantineCatalogCaseAlignmentPanel.tsx` (ADD؛ يجب التحقق من الغياب في GitHub baseline ومن غيابه محليًا؛ لا تستبدل ملفًا موجودًا)
- `scripts/runLibraryQuarantineCatalogCaseAlignmentBackendTests.ts` (ADD؛ يجب التحقق من الغياب في GitHub baseline ومن غيابه محليًا؛ لا تستبدل ملفًا موجودًا)
- `scripts/runLibraryQuarantineCatalogCaseAlignmentClientTests.ts` (ADD؛ يجب التحقق من الغياب في GitHub baseline ومن غيابه محليًا؛ لا تستبدل ملفًا موجودًا)

### READ ONLY
كل الملفات المدرجة READ ONLY في §8، بما فيها `libraryQuarantineCatalogHandoffService.ts`, `libraryQuarantineRightsDecisionContract.ts`, `libraryApplicationService.ts`, `publicLibraryRepository.ts`, `LibraryQuarantineHumanReviewModal.tsx`, `index.ts`, وحزم الاختبار القديمة. لا تعديل `.env*`، لا `package.json` أو lockfile، ولا تثبيت/حذف/نقل جماعي، ولا GIS أو تبرعات/اشتراكات.

إن أثبت source inspection أن المهمة تتطلب تغيير ملف خارج القائمة: **STOP** مع path + code symbol + سبب موثّق؛ لا تتوسع تلقائيًا.

## 3) هوية المواءمة وصحة المصدر

- نموذج القراءة الأساسي المثبت: `receipt`, `reviewDraft`, `humanReviewCase`, `catalogHandoff`, `qcat document`. عاود التحقق server-side في كل **transaction** من identity/sourceSha256/revisions/timestamps/deep-inspection non-assurance flags، وحالة `Quarantined`, `PENDING_HUMAN_REVIEW`, `METADATA_RECORDED` والـ`qcat` المقفل `Draft + ReviewRequired + versions.referenceUrl ABSENT`.
- أبقِ handoff الأصلي في `library_quarantine_catalog_handoffs/<receiptId>` **immutable**. هو provenance anchor (original `caseRevision`/`caseUpdatedAt`)، وليس نسخة قابلة لإعادة الكتابة. لا تعِد تفسيره تلقائيًا.
- أضف **سجل overlay** خاصًا في `library_quarantine_catalog_case_alignments/<receiptId>`، يحوي `schemaVersion`, receiptId, documentId, sourceRevision, sourceUpdatedAt, sourceSha256 (private), originalHandoffCaseRevision, alignmentRevision, alignedHumanCaseRevision, alignedHumanCaseUpdatedAt, documentUpdatedAt, createdBy/At, updatedBy/At, جميع posture flags = false. Validators: حقول حصرية، snapshot مرتبط بالمصدر والـhandoff، أعداد صحيحة ≥1، ISO UTC دقيق، SHA256 صحيح، لا مرفق أو رابط، لا تزوير من العميل.
- حدث `library_quarantine_catalog_case_alignment_events/<receiptId>_<alignmentRevision>` append-only عبر `tx.create`، بنسخة المصدر والحالة، actorUid خادمي، fromCaseRevision/toCaseRevision, from/to catalogUpdatedAt، timestamps وسبب `HUMAN_CASE_METADATA_REALIGNED`. لا تعريض تفاصيل خاصة في DTO. السجل الأول revision=1، ثم 2…؛ لا حذف ولا overwrite.
- **Effective case binding:** عندما لا يوجد overlay، فهو أصل handoff (`handoff.caseRevision`, `handoff.caseUpdatedAt`). عندما يوجد overlay مُتحقق ومطابق لقيم qcat الحالية، فهو `alignedHumanCaseRevision` و`alignedHumanCaseUpdatedAt`. أي غياب overlay مع اختلاف النسخة = `NEEDS_REALIGNMENT`؛ أي overlay مع اختلاف النسخة/مصدر غير ثابت = HOLD بلا كتابة.
- لا تدّعي أن `sourceSha256` أو timestamps العامة دليل على سلامة binary. لا قراءة ثنائية أو GCS. مراجع الحقوق القديم يبقى قابلًا للتدقيق ولكنه **ليس تصريحًا فعالًا** بعد مواءمة نسخة جديدة.

## 4) عملية مواءمة ذرية ومقيّدة

### APIs في `manageLibraryDocuments` (إضافة داخل callable الموجود)

`getQuarantineCatalogCaseAlignment`: payload **فقط** `{ action:'getQuarantineCatalogCaseAlignment', receiptId }`؛ يحتاج AdminUser بشري نشط مع Library responsibility و`Review + Create`, من `request.auth.uid` فقط.

`alignQuarantineCatalogCase`: payload **فقط** `{ action:'alignQuarantineCatalogCase', receiptId, expectedCaseRevision, expectedCatalogUpdatedAt, expectedAlignmentRevision, confirmation:'APPLY_CASE_METADATA' }`. كل الأرقام safe integers، timestamp يثبت optimistic concurrency. لا تمرير actor/uid/role/status/content/private path/flags من العميل. server copies only 4 editorial text fields from **authoritative saved** `humanReviewCase`. لا أخذها من caller input.

**Release gates:** القديمة الثلاث `POP_LIBRARY_REVIEW_WORKBENCH_ENABLED`, `POP_LIBRARY_HUMAN_CASE_REVIEW_ENABLED`, `POP_LIBRARY_CATALOG_HANDOFF_ENABLED` + الجديدة `POP_LIBRARY_CASE_ALIGNMENT_ENABLED`. كلّها string literal `'true'`, disabled by default, guarded before DB and auth lookups; UI flags الأربعة النظيرة تبدأ بـ`VITE_` وتنتهي `_ENABLED`، الجديدة `VITE_LIBRARY_CASE_ALIGNMENT_ENABLED`. استمر استخدام Rights gate المستقلة لقرار الحقوق، لا تقللها.

### معاملة واحدة

`runTransaction` بنمط read-all-before-write لثمانية مواضع كحد أقصى عند APPLY: receipt, draft, case, handoff, qcat document, alignment document, target alignment event, current rights decision (الأخير **قراءة فقط** لإثبات حالة عدم صلاحية الحقوق عند الحاجة؛ لا تحوّل نتيجته إلى موافقة). لا collection scans ولا GCS. قارن:

1. receipt/draft/handoff/qcat provenance validation وposture flags؛ `METADATA_RECORDED` humanCase محفوظ ومطابق receipt، ومراجعة أحدث من الأصل.
2. `expectedCaseRevision`, `expectedCatalogUpdatedAt`, `expectedAlignmentRevision` ↔ live snapshots؛ أي فرق => `CONFLICT` مع sanitized current metadata/revisions، دون overwrite.
3. إن كان الـqcat أو overlay غير سليم، أو status لم يعد eligible، أو النص العربي/الإنجليزي الجديد يخالف LibraryValidator، فـ HOLD **لا تخمين ولا ترجمة تلقائية**.
4. إذا كانت النسخة فعليًا مواءمة والنصوص الأربعة متطابقة، أرجع `ALREADY_ALIGNED` read-only دون حدث جديد. لا تسمح بإعادة استخدام stale confirmation لتعديل مستند آخر.
5. بخلاف ذلك، جهّز نسخة qcat كاملة مع **تغيير 4 حقول نصية فقط + `updatedAt`**، وحافظ على originalTitle/documentType/organizationId/sourceId/geography/publicationDate/language/topics/domains/legalStatus/rightsNotes/createdAt/versions كما هي؛ `workflowState=Draft`, `rightsStatus=ReviewRequired`, `workflowHistory=[]`, `versions` دون `referenceUrl`؛ validate complete doc. اكتب `tx.update` على qcat *وليس* `tx.set`؛ `tx.create` أو `tx.update` على overlay وفق CAS، و`tx.create` لحدث alignment الجديد. **3 writes فقط**. لا كتابة إلى rights decisions أو أصل handoff أو إيصال الحجر.
6. النتائج `ALIGNED | ALREADY_ALIGNED | CONFLICT | HOLD | UNKNOWN`، وبعد staging + فقدان إثبات commit = `UNKNOWN/alignmentSaved:null` بلا auto-retry. بعد success اقرأ حالة الخادم من جديد. `ALREADY_ALIGNED` ليس تصريح حقوق.

استعمل DTOs منقحة حصرية (الحقلان الخاصان `sha256`, actorUid, storagePath, generation, bucket, signedUrl, raw bytes ممنوعة). فرق النصوص الأربعة فقط ظاهر مع حالات التقدم؛ لا مرفق/preview/download. استعمل `sourceRevision` و`documentUpdatedAt` للعرض عند الحاجة دون كشف `sourceSha256`.

## 5) ربط الحقوق مع المواءمة دون إلغاء الأدلة السابقة

في `firestoreLibraryQuarantineRightsDecisionStore.ts` وسّع `verifyQuarantineRightsChainSnapshots` لاستقبال overlay snapshot بالتحقق من عقده؛ الـGET يصير **7 point reads** بدل 6، والـSAVE **8** بدل 7 (الحدث الحقوقي هو القراءة الثامنة). اختبر العدادات؛ لا scans. عند اختلاف latest humanCase عن effective aligned case: حافظ على `SOURCE_CASE_VERSION_DRIFT_HOLD`.

إذا كانت المواءمة الحالية صحيحة ولكن سجل الحقوق السابق يشير إلى `currentHumanCaseRevision` أقدم، فلا تعامل `METADATA_USE_CLEARED` القديم كنافذ؛ أرجع `READY` مع `rightsDecisionIsCurrent:false`, `requiresFreshHumanRightsReview:true`, `effectiveCaseRevision` الحالي، وقدّم التاريخ القديم فقط **بشارة Previous / Not Effective**. القرار القديم لا يُحذف ولا ينقلب تلقائيًا إلى رفض أو إذن جديد.

بعد المواءمة يجب أن يستطيع Owner/RightsReviewer إنشاء **revision حقوق جديد** عبر CAS باستخدام `expectedRevision` وإقرار مستقل `acknowledgedHumanCaseRevision` مطابق للنسخة الفعالة، وحقول القرار/الأدلة **يدخلها مراجع الحقوق من جديد** (لا تعبئة تلقائية من قرار قديم stale ولا click-to-reapprove). احتفظ بـ`catalogHandoffCaseRevision` في سجل الحقوق كمرجع الـhandoff الأصلي، واجعل `currentHumanCaseRevision` هو النسخة الفعالة الجديدة؛ تظل `rightsScope = CATALOG_METADATA_ONLY` وposture false. اختبارات الرسائل وحقول DTO strict في العميل.

إذا كان قرار الحقوق القديم **موافقًا** والمواءمة جرت، يجب أن تظهر واجهة الحفظ وتحجب أي تلميح بـ«موافق صالح» حتى يصدر قرار جديد؛ وكون قرار حقوق حديث `METADATA_USE_CLEARED` **لا يزيل** حاجز نشر qcat أو قيود الملف المحجور.

## 6) إصلاح سلامة نتيجة المعاملة متعددة المحاولات والنقل

- مصدر مثبت: store الحقوق يعيد `writeStagedInTransaction = false` في بداية callback لكل محاولة. استبدله بتتبع `writeStagedInAnyAttempt` **خارج callback دون تصفير**، وأي exception بعد أن staged أي محاولة write يعيد `UNKNOWN / decisionSaved:null` إذا لم توجد أدلة قاطعة على عدم الالتزام؛ لا تصف transaction commit غير محسوم بـ `HOLD/NOT_SAVED` بناءً على محاولة لاحقة فقط.
- أصلح أيضًا حالة **نجاح commit ثم فشل تحويل saved DTO** في `libraryQuarantineRightsDecisionService.ts`: إرجاع `HOLD/NOT_SAVED` خطأ؛ ارجع `UNKNOWN/null` مع إمكانية التحقق read-only.
- `src/services/libraryQuarantineRightsDecisionClient.ts` و`LibraryQuarantineRightsDecisionPanel.tsx`: بعد خروج طلب SAVE من العميل، أي network/timeout/malformed-success جواب غير مؤكد يجب أن يظهر `UNKNOWN` hold مع زر `Verify decision` يستخدم GET فقط. الاستثناءات المؤكدة قبل الإرسال (input validation/feature OFF) وحدها يجوز وصفها `NOT_SAVED`. لا تُعد المحاولة تلقائيًا. عزل حساب/جلسة بعد الإغلاق.
- اختبر **retry multi-attempt**: محاولة أولى stages ثم فقدان التأكيد، محاولة ثانية prewrite abort، نتيجة لا يمكنها الادعاء `NOT_SAVED`. اختبر المسار العادي prewrite/HOLD، CAS conflict، النجاح، وفشل response validation بعد الالتزام.

## 7) الواجهة والتجربة

- `LibraryQuarantineCatalogCaseAlignmentPanel` ضمن `LibraryQuarantineCatalogHandoffPanel` في نفس نافذة الإنسان؛ لا modal آخر ولا تبويبات جديدة. يظهر عند `handoffExists && humanCase.status === METADATA_RECORDED && Review+Create` وfeatures enabled. الإجراء الأساسي الوحيد `مراجعة الاختلافات ومواءمة المسودة / Review changes & align draft`، عرض side-by-side أو stacked للفروق الأربعة، تأكيد يدوي قبل APPLY؛ لا ملء حقول تخمينية ولا تعديل مخفي.
- بعد APPLY: حدّث حالة الفهرس بقراءة خادمية fresh، وأظهر تنبيهًا مستقلًا بأن حقوق البيانات الوصفية **تحتاج إعادة مراجعة** إذا كانت مرتبطة بالنسخة السابقة. لا تفرض على المستخدم فتح مودال ثاني؛ RightsReviewer منفصل وله صلاحية rights panel بدون Create.
- حقوق: عند stale decision اعرض `Previous rights decision — not effective for current case`, مع نموذج قرار **فارغ** وحقل إقرار بالنسخة الحالية قبل إعادة الحفظ. لا تعرضها «مصرح بها» لمجرد أن السابقة `METADATA_USE_CLEARED`.
- AR/EN، RTL/LTR، desktop/tablet/mobile، light/dark، keyboard/focus/contrast، أقل أزرار ممكنة. حالات HOLD/CONFLICT/UNKNOWN وsource drift واضحة، مع refresh read-only. خطأ أي عنصر لا يُظهر private storage information.

## 8) مصفوفة المصدر الموثّق (HTTPS لكل ملف)

تم التحقق من `main` بواسطة GitHub connector عند SHA أعلاه، ومن blob SHA-1 لكل ملف في هذا الجدول. على Studio استرداد **كل ملف مطلوب** من رابط HTTPS **مباشر كامل** كما في العمود الرابع، لا من مسار مجرد ولا من GitHub Sync ولا من `main` mutable. تحقق من `HTTP 200`, body غير HTML وغير فارغ، ثم blob SHA-1 بالشكل: `SHA1('blob ' + UTF8_BYTE_LENGTH + NUL + RAW_BYTES)` قبل الكتابة. اختبار hash على **raw bytes**، لا على نص أُعيد تنسيقه.

| الوظيفة | المسار | Git blob SHA-1 | رابط HTTPS مباشر مثبت |
|---|---|---|---|
| MODIFY | `functions/src/library/libraryAdminHandlers.ts` | `5934df1c695ac6dfd77ede729f112887a0eb0d42` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/library/libraryAdminHandlers.ts` |
| MODIFY | `functions/src/library/firestoreLibraryQuarantineRightsDecisionStore.ts` | `ffcf2f76ee52a8272abe770e9b30b983049e4509` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/library/firestoreLibraryQuarantineRightsDecisionStore.ts` |
| MODIFY | `functions/src/library/libraryQuarantineRightsDecisionService.ts` | `d2cb328abee2744266a6cab9eeb0a77c8ab76fcc` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/library/libraryQuarantineRightsDecisionService.ts` |
| MODIFY | `src/services/libraryQuarantineRightsDecisionClient.ts` | `dd866be28565d3cde842b7a6e31ef6e9e3519e9d` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/src/services/libraryQuarantineRightsDecisionClient.ts` |
| MODIFY | `src/components/library/LibraryQuarantineRightsDecisionPanel.tsx` | `a02bc0da5c2a67b6645c8c4f466d9e856f2d9616` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/src/components/library/LibraryQuarantineRightsDecisionPanel.tsx` |
| MODIFY | `src/components/library/LibraryQuarantineCatalogHandoffPanel.tsx` | `59f41cfd7c7e5b9227c2a26c65b9972811c12110` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/src/components/library/LibraryQuarantineCatalogHandoffPanel.tsx` |
| MODIFY | `scripts/runLibraryQuarantineRightsDecisionBackendTests.ts` | `98144c037a543b1df31899e0dc95b727fe06fcd6` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/scripts/runLibraryQuarantineRightsDecisionBackendTests.ts` |
| MODIFY | `scripts/runLibraryQuarantineRightsDecisionClientTests.ts` | `48a26e391e1497632dfd1d22037e1a972df26cec` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/scripts/runLibraryQuarantineRightsDecisionClientTests.ts` |
| READ ONLY | `functions/src/library/libraryQuarantineCatalogHandoffService.ts` | `79e80cb3b9917ea9c0d3e15e23d5452235751b59` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/library/libraryQuarantineCatalogHandoffService.ts` |
| READ ONLY | `functions/src/library/libraryQuarantineHumanReviewCaseContract.ts` | `8fe5f352736faddd3f95c0a09106a79b7bec5c89` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/library/libraryQuarantineHumanReviewCaseContract.ts` |
| READ ONLY | `functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore.ts` | `41eeb81f9d8e903683074dc951b265cd4a54fc47` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore.ts` |
| READ ONLY | `functions/src/library/libraryQuarantineRightsDecisionContract.ts` | `b96652303ae516c2ba01f7f9d52e3c8875860f1f` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/library/libraryQuarantineRightsDecisionContract.ts` |
| READ ONLY | `src/components/library/LibraryQuarantineHumanReviewModal.tsx` | `3a6de94a3d52325bb88fd8a7140f51057050885e` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/src/components/library/LibraryQuarantineHumanReviewModal.tsx` |
| READ ONLY | `src/services/libraryQuarantineCatalogHandoffClient.ts` | `55a1d359c7b43768a69c7458fb7c2e24c41e929b` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/src/services/libraryQuarantineCatalogHandoffClient.ts` |
| READ ONLY | `functions/src/library/libraryApplicationService.ts` | `d9bcfa9db99a334a2743e1171cee9435d3a1559c` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/library/libraryApplicationService.ts` |
| READ ONLY | `functions/src/library/publicLibraryRepository.ts` | `c813162307663b6fe37dc84cba9c591193f34f33` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/library/publicLibraryRepository.ts` |
| READ ONLY | `functions/src/library/libraryValidator.ts` | `bbe2061b278f9b4f3c296532b767d02acc115f72` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/library/libraryValidator.ts` |
| READ ONLY | `functions/src/library/firestoreLibraryRepository.ts` | `afba4876b6d736424bd0b344df1db9a5e1417327` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/library/firestoreLibraryRepository.ts` |
| READ ONLY | `functions/src/shared/libraryContract.ts` | `cfb0849c0418ba7b075f7de49c3debe668adc724` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/shared/libraryContract.ts` |
| READ ONLY | `functions/src/shared/adminContract.ts` | `f895313b46de7f1f55d3d0e1cc1aca4fc9e7391d` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/shared/adminContract.ts` |
| READ ONLY | `functions/src/index.ts` | `5a14cada5dad8e764f8cc3092f40c386f6b09616` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/functions/src/index.ts` |
| READ ONLY | `package.json` | `34cb668d837d342c9b5367461cca2ad9dd8a18e7` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/package.json` |
| READ ONLY | `scripts/runLibraryQuarantineCatalogHandoffBackendTests.ts` | `309a891f84a4e5d38010622fd09f192c7f980bb5` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/scripts/runLibraryQuarantineCatalogHandoffBackendTests.ts` |
| READ ONLY | `scripts/runLibraryQuarantineCatalogHandoffClientTests.ts` | `3754ca8a3306bd9e287fcf28aeaf1a823e18fcfe` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/79a7d1aaa9c99bd9fd71a6ed85ab3ee25ab3d51c/scripts/runLibraryQuarantineCatalogHandoffClientTests.ts` |


### الملفات الجديدة (تأكد من الغياب قبل الإنشاء)
- `functions/src/library/libraryQuarantineCatalogCaseAlignmentService.ts` (ADD؛ يجب التحقق من الغياب في GitHub baseline ومن غيابه محليًا؛ لا تستبدل ملفًا موجودًا)
- `src/services/libraryQuarantineCatalogCaseAlignmentClient.ts` (ADD؛ يجب التحقق من الغياب في GitHub baseline ومن غيابه محليًا؛ لا تستبدل ملفًا موجودًا)
- `src/components/library/LibraryQuarantineCatalogCaseAlignmentPanel.tsx` (ADD؛ يجب التحقق من الغياب في GitHub baseline ومن غيابه محليًا؛ لا تستبدل ملفًا موجودًا)
- `scripts/runLibraryQuarantineCatalogCaseAlignmentBackendTests.ts` (ADD؛ يجب التحقق من الغياب في GitHub baseline ومن غيابه محليًا؛ لا تستبدل ملفًا موجودًا)
- `scripts/runLibraryQuarantineCatalogCaseAlignmentClientTests.ts` (ADD؛ يجب التحقق من الغياب في GitHub baseline ومن غيابه محليًا؛ لا تستبدل ملفًا موجودًا)

## 9) اختبارات التحقق والإغلاق

- New backend integration tests: permissions Owner/Curator yes for alignment, RightsReviewer without Create denied; input unknown keys/claims rejected; all flags OFF default 0 DB reads; full 8-read/3-write bound; no GCS; qcat no referenceUrl; identity/version drift; invalid/missing overlays; revision 0→1→2; human case not `METADATA_RECORDED` blocked; update-time CAS; rollback on event collision; idempotent ALREADY_ALIGNED; source misbinding; audit append-only; unknown commit; no write to protected collections; old rights decision effectively stale.
- New client/UI tests: diff text four fields, no unsaved case edits, mobile AR/EN, no second modal, network UNKNOWN verify-only, session switch, duplicate-click lock, rights previous decision shown as historical until re-review, RBAC split.
- Existing rights backend/client tests update to prove read 7/save 8, normal 0/1/2 revisions and stale renewal, multi-attempt ambiguous after staged returns UNKNOWN, malformed success response, role matrix; preserve other prior assertions; never weaken a previous test silently.
- Required regressions unchanged in code: `npx --no-install tsx scripts/runLibraryQuarantineCatalogHandoffBackendTests.ts`, `...ClientTests.ts`, `...runLibraryQuarantineHumanReviewBackendTests.ts`, `...ClientTests.ts`, `...runLibraryQuarantineRightsDecisionBackendTests.ts`, `...ClientTests.ts`, `...runLibraryQuarantineReviewWorkbenchBackendTests.ts`, `...ClientTests.ts`, `...runLibraryQuarantineReviewDraftCallableBridgeTests.ts` (7/7), `...runLibraryQuarantineReviewDraftPersistenceTests.ts` (7/7), and upload integration Vitest. Do not silently skip failures.
- `npx --no-install tsc --noEmit`, `npm run build`, `npm run lint`, isolated functions TS check `cd functions && npx --no-install tsc --noEmit` if toolchain available. No unapproved install. Report code/test exits. Build does not prove visuals.
- GitHub Sync expected EXACT: 8 MODIFIED + 5 ADDED + 0 DELETED; if unexpected files, STOP and do not push. User visually tests AR/EN and desktop/mobile. User alone accepts and pushes. No deploy via Studio CLI or GitHub Actions without explicit separate decision.

## 10) STOP conditions

Any mismatch in known baseline bytes/hashes or Studio unpushed source; missing ability to fetch direct HTTPS; insufficient `transaction.update/create` contract; need to modify protected file; unexpected new/deleted files; inability to hold stale rights decision safely; cannot prove publication/binary quarantine guards; hidden tests become red. **STOP without speculative restore or write.**

**Completion state:** after Studio implementation `IMPLEMENTED_PENDING_GITHUB_SYNC_AND_VISUAL_ACCEPTANCE`, NOT `ACCEPTED` or `DEPLOYED`. No claims about live Firebase until separately verified.
