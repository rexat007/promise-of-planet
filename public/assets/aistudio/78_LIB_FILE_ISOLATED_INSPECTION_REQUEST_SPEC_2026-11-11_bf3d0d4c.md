# 78 — وعد الكوكب / LIB-FILE-ISOLATED-INSPECTION-REQUEST-01
## المواصفة الهندسية: تسجيل طلب فحص معزول قابل للتتبع دون تشغيل الفحص

**تاريخ المواصفة:** 2026-11-11  
**المستودع:** `rexat007/promise-of-planet`  
**GitHub `main` المثبت:** `5adedd70eb4b86f07dd53c0d02d6c46b8c7fff2d`  
**الوضع:** `SPECIFIED_NOT_IMPLEMENTED` — لا تغييرات على المستودع من هذه المواصفة.  
**الوحدة السابقة:** `LIB-FILE-BINARY-SAFETY-CASE-R1`، `PUSH_VERIFIED / 8_OF_8_MATCH / TEMPORARY_SPEC_FOLDER_EXCEPTION_ACCEPTED`؛ مراجعة المستخدم البصرية وتفعيل الخدمة والنشر لا تزال مستقلة.

## 1. القرار والحدود

توجد بنية موثقة لرفع الملفات إلى حجر خاص، ومراجعتها بشريًا، وربط بياناتها بمسودة كتالوج `qcat-` وتسجيل حالة سلامتها البشرية. **لكن لم يثبت وجود عامل AV/CDR أو محلل PDF معزول ينتج أدلة أمنية موثوقة**؛ وفق العقود الحالية يظل DOCX عند `DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION`، وPDF عند `PDF_REQUIRES_ISOLATED_PARSER`، وأعلام الأمان والنشر الخمسة false.

**النتيجة الوظيفية الجديدة المحدودة:** يمكّن Owner بشريًا من **تسجيل طلب إحالة محدد النسخة لفحص معزول مستقبلي** من نافذة السلامة الحالية؛ يحفظ الخادم سجل طلب واحدًا غير قابل للتحرير لكل نسخة مصدر + نسخة سجل سلامة، ويمكن قراءته والتحقق من وجوده، لكنه **لا ينفذ الفحص، لا يرسل مهمة إلى عامل، لا يقرأ GCS، لا يحوّل حالة الطلب إلى RUNNING/SUCCESS، ولا يمنح أي شهادة أمان أو تصريح نشر.**

يجب أن تعرض الواجهة العبارة الصريحة: **«تم تسجيل طلب الفحص فقط — لم يُرسل إلى عامل فحص ولم يبدأ أي فحص تقني»** (والنظير الإنجليزي). لا يُطلق اسم "فحص ناجح" أو "قيد الفحص" على طلب مجرد.

**لماذا الآن؟** هذه وحدة مهمة منضبطة قبل أي عامل معزول: تثبت هوية النسخة والقرار البشري والإيصال الذري؛ وعندما يُقرر لاحقًا بناء عامل فحص مستقل، لن يستطيع بدء عمله من بيانات واجهة غير مثبتة. إنشاء هذا السجل لا يعني تفويضًا تلقائيًا للعامل لاحقًا؛ يجب وضع سياسة Worker مستقلة في الوحدة التالية، مع إعادة إثبات GCS generation/SHA256 والصلاحيات في وقت التنفيذ.

## 2. النطاق وحدود الملفات

**MODIFY (2 فقط):**
1. `functions/src/library/libraryAdminHandlers.ts` — عمليتا GET/RECORD داخل `manageLibraryDocuments` وبوابة إصدار جديدة Default OFF.
2. `src/components/library/LibraryQuarantineBinarySafetyCasePanel.tsx` — مساحة ثانوية موجزة لتسجيل الطلب والتحقق من حالته في اللوحة الحالية؛ لا صفحة أو Modal جديد.

**ADD (6 فقط):**
1. `functions/src/library/libraryQuarantineIsolatedInspectionRequestContract.ts`
2. `functions/src/library/firestoreLibraryQuarantineIsolatedInspectionRequestStore.ts`
3. `functions/src/library/libraryQuarantineIsolatedInspectionRequestService.ts`
4. `src/services/libraryQuarantineIsolatedInspectionRequestClient.ts`
5. `scripts/runLibraryQuarantineIsolatedInspectionRequestBackendTests.ts`
6. `scripts/runLibraryQuarantineIsolatedInspectionRequestClientTests.ts`

**0 DELETE**، ولا نقل/إعادة تسمية أو تثبيت حزم. بقية ملفات المستودع `READ ONLY` بما فيها `functions/src/index.ts`, `.env*`, `firebase.json`, Storage/Firestore rules, `functions/package.json`, `package.json`, `libraryApplicationService.ts`, upload endpoint, storage adapter، ومتاجر العقود والحقوق والمواءمة والنشر. لا Firebase CLI ولا نشر ولا Push أو PR بواسطة Studio.

**الاستثناء المؤقت المقصود من المالك:** ملفات مواصفات `.md` التي يضعها Studio **فقط** داخل `public/assets/aistudio/` لا تُعد وحدها انحرافًا يوقف العمل أو Push، وتُسرد منفصلة عن نطاق الكود. لا تنشئ شيفرة أو secrets في هذا المجلد، ولا تحذفه/تنظفه الآن. يُجرد المجلد ويُنظف دفعة واحدة قرب نهاية المشروع بعد إثبات عدم وجود اعتماد تشغيلي. وجوده في `public` يعني احتمال إتاحة المحتويات علنًا عند النشر؛ لا تدخل فيه بيانات حساسة.

## 3. العقود الثابتة والسلطة

### 3.1 Release gates / principal

- خادميًا: إضافة `POP_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED`، Default OFF، مع التحقق المتسلسل من البوابات الأربعة الموجودة للـBinary Safety (`REVIEW_WORKBENCH`, `HUMAN_CASE_REVIEW`, `CATALOG_HANDOFF`, `BINARY_SAFETY_CASE`). الرفض يتم قبل AdminRepository أو Firestore/GCS، `ISOLATED_INSPECTION_REQUEST_NOT_RELEASED`.
- الواجهة: `VITE_LIBRARY_ISOLATED_INSPECTION_REQUEST_ENABLED` Default OFF ومع بوابات Binary Safety الحالية. ممنوع تعديل أي `.env` أو تفعيل العلم بهذه الوحدة.
- GET وRECORD: `AdminRole.Owner` نشط وبشري وصلاحية `AdminPermission.Review` ومسؤولية مجال Library، اعتمادًا على `request.auth` والخادم، وليس `request.data`. لا صلاحية للمنسقين أو AI، ولا إضافة Role جديد أو مساواة وجود token claims بالصلاحية. أعد استعمال نمط التحقق الموثوق في `LibraryQuarantineBinarySafetyCaseService`، لكن لا تكرر منطق الصلاحيات بشكل متساهل.
- مدخلات caller GET: `{action:'getQuarantineIsolatedInspectionRequest', receiptId}` فقط. مدخلات RECORD: `{action:'recordQuarantineIsolatedInspectionRequest', receiptId, expectedSafetyCaseRevision, acknowledgedHumanCaseRevision, confirmation:'RECORD_INSPECTION_REQUEST_ONLY'}` فقط. رفض أي حقل إضافي/symbol أو id/عدد غير صالح قبل البيانات. **لا** قبول path, generation, sha256, bucket, URL, verdict أو bytes من العميل.

### 3.2 شروط أهلية الطلب

السجل لا ينشأ إلا إن:
1. الإيصال `Quarantined` وفق المدقق الرسمي `verifyReceiptAndDraftEligibleForHumanReviewCase`، به `receipt.generation` محقق وفق عقد receipt وغير فارغ، و`receipt.sha256`, `format`, `byteSize`, `updatedAt` من **السجل الخادمي**؛ لا اختبار GCS هنا ولا افتراض أن شهادة تخزين قديمة تعادل فحص ملف.
2. السلسلة الحالية صالحة عبر **`verifyQuarantineBinarySafetyChainSnapshots`** الموجودة: receipt, review draft, human case, catalog handoff, qcat draft, alignment overlay إن وجد, binary safety case.
3. يوجد Binary Safety Case معتمدة المصدر `isCaseCurrent === true` و`requiresFreshEvidence === false`، و`disposition === 'ISOLATED_ASSESSMENT_REQUIRED'` فقط. يمنع `EXTERNAL_REPORT_NOT_VERIFIED` و`DO_NOT_PROCESS`، أو حالة غياب السجل أو اختلاف المراجعة البشرية.
4. `expectedSafetyCaseRevision` يطابق النسخة الحية، و`acknowledgedHumanCaseRevision` يطابق النسخة البشرية **الفعالة**، والتأكيد الحرفي مستقل عن checkbox الحالي لإقرار حالة Binary Safety نفسها؛ لا يسمح بطلب نسخة مجمدة/متقادمة.
5. يمنع جميع حالات `HOLD`/`CONFLICT` قبل كتابة واحدة. لا تعدل Binary Safety Case نفسها ولا ملف الكتالوج ولا حالة الحجر.

### 3.3 هوية الطلب والبيانات

مستودع خاص مستقل: `library_quarantine_isolated_inspection_requests`.

- معرف حتمي مثل `${receiptId}_${sourceRevision}_${safetyCaseRevision}`؛ يجب التحقق من طول/حروف ID واتساقه مع الوثيقة. لا تستخدم Date.now/UUID لمفتاح طلب نسخة محددة.
- السجل الثابت append-only يضم بالضبط وبمخطط مغلق: `schemaVersion:1`, `requestId`, `receiptId`, `documentId:qcat-<receiptId>`, `sourceRevision`, `sourceUpdatedAt`, `sourceSha256` **private**, `sourceGeneration` **private**, `sourceByteSize`, `sourceFormat`, `deepInspectionStatus`, `safetyCaseRevision`, `effectiveHumanCaseRevision`, `catalogUpdatedAt`, `requestedBy`, `requestedAt`, `state:'RECORDED_NOT_DISPATCHED'`, `dispatched:false`, `scanPerformed:false`, `sanitized:false`, `isVerifiedSafe:false`, `isPublished:false`, `isReadyForPeia:false`.
- جميع حقول المصدر الخفية من Firestore receipt الموثق فقط. لا تخزّن `storagePath` أو bucket أو raw bytes ولا تنشئ Signed URL.
- لا توجد حالة `RUNNING` أو `PASSED` أو `FAILED` أو كائن attestation في هذه الوحدة. الطلب immutable: إنشاء `tx.create` فقط؛ لا `tx.set/update`، ولا delete أو أي writer آخر.
- DTO المنقح للواجهة: `requestId`, `receiptId`, `documentId`, `sourceRevision`, `safetyCaseRevision`, `effectiveHumanCaseRevision`, `requestedAt`, `state:'RECORDED_NOT_DISPATCHED'`، و`scanPerformed:false`, `dispatched:false`, `isVerifiedSafe:false`, `isPublished:false`, `isReadyForPeia:false`. **لا** sourceSha256/sourceGeneration/sourceByteSize/storagePath/token/URL/createdBy. جميع الحقول المسموحة صريحة؛ رفض persisted/DTO مفاتيح زائدة أو posture true.

### 3.4 Firestore والقراءات/الكتابات

- GET يقوم بعد التحقق من Gate/RBAC بقراءة سلسلة Binary Safety الحالية (7 point reads، دون query) وطلب النسخة المحددة (point read ثامن)، ويرد `NOT_RECORDED | RECORDED | HOLD`؛ إن كان سجل نسخة قديمة موجودًا فلا يعرضه باعتباره السجل الحالي. لا حقل خاص في الرد.
- RECORD: داخل **معاملة واحدة** `db.runTransaction`، اقرأ أولًا 7 مستندات السلسلة + فتحة requestID (8 `tx.get` كلها قبل الكتابة)، ثم تحقق من provenance/القفل/التطابق/المدخلات. عند عدم وجود طلب، `tx.create(requestRef, validatedRecord)` **كتابة واحدة فقط**. إذا كان الطلب موجودًا وكان مطابقًا للمخطط والمصدر وكل الحدود immutable، أرجع `ALREADY_RECORDED` بلا أي كتابة؛ إذا كان فاسدًا أو مختلفًا ⇒ HOLD بلا كتابة.
- مصدر receipt قد يتبدل بين GET سابق ومعاملة RECORD: إعادة تحقق داخل callback mandatory؛ لا تثق بسجل readback خارج transaction. و`sourceGeneration` هو GCS generation الذي سجله receipt؛ سيتم **إعادة التحقق فعليًا من GCS بواسطة العامل المعزول المستقبلي** قبل أي فتح، وليس هنا.
- `writeStagedInAnyAttempt` يُعلن خارج transaction callback ويضبط قبل `tx.create`. إذا خرج خطأ بعد احتمال staging بأي محاولة ⇒ `UNKNOWN / requestRecorded:null` مع GET-only reconciliation ولا إعادة إرسال تلقائية؛ قبل staging ⇒ HOLD/CONFLICT بحسب السبب. تغلق ثغرة المعاملات المعاد تنفيذها.
- `ALREADY_RECORDED` حالة idempotency حقيقية من نسخة محفوظة مطابقة، بلا تعديل، ولا تعني dispatch أو scan. احظر أي collection query/unbounded read أو Storage I/O، وحافظ على zero writes لسائر المسارات. لا logging للمعلومات الخاصة أو نص الاستثناء الخام.

## 4. الواجهة العربية والإنجليزية

أضف إلى `LibraryQuarantineBinarySafetyCasePanel` قسمًا ثانويًا صغيرًا أسفل حالة السلامة، يظهر للـOwner عندما تتحقق البوابات والشرائط، ويعتمد حالة/نسخة Binary Safety التي جرى تحميلها. لا تنشئ Sidebar أو Modal جديدة، ولا تضف زرّي حفظ متشابهين.

- عنوان: «إحالة إلى فحص معزول — تسجيل فقط» / `Isolated inspection — record request only`.
- حالة واضحة: «لم يُسجّل طلب لهذه النسخة» أو «طُلب ولم يُرسل لعامل فحص». لا توهم المستخدم أن PDF/DOCX قد فُحص أو كان آمنًا.
- Checkbox مستقل بنص «أؤكد طلب الفحص لهذه النسخة؛ لا يعني هذا تشغيل الفحص أو اعتماده»، ولمسة أساسية واحدة ثانوية «تسجيل الطلب». اعرض رابط حالة GET فقط عند `UNKNOWN` (زر تحقق قراءة فقط) بلا auto resend.
- إذا حُفظت تعديلات المراجعة البشرية لاحقًا أو تبدل receiptId أو أصبح safety case stale: تخلص من session/acknowledgement وأعد GET؛ لا تحفظ مع unsaved human case edits أو `UNKNOWN`.
- شاشة عربية/إنجليزية RTL/LTR وDark/Light، جوال/تابلت/كمبيوتر، accessibility؛ لا تعرض حقول private، ولا روابط تحميل، ولا تكرر أسطر التحذير الأمني بلا ضرورة.

## 5. اختبارات القبول والتوقف

**`scripts/runLibraryQuarantineIsolatedInspectionRequestBackendTests.ts`:**
- Gate OFF يمنع أي Admin/Firestore/GCS وصول. Owner بشري فاعل Review فقط؛ رفض Curator/AI/inactive والتوكن المزيف.
- بيانات واقعية تتوافق مع عقود receipt + reviewDraft + humanCase + handoff + catalog + alignment + safety R1؛ لا Mock ببيانات غير صحيحة.
- GET 8 point reads/0 writes، RECORD 8 point reads داخل tx قبل أول كتابة ثم create واحدة. إثبات تخزين record فعليًا داخل transaction in-memory مع atomicity وretry simulation، لا mock writes فارغة.
- 0→1، نفس النسخة مرتين ⇒ 1 create فقط و`ALREADY_RECORDED`؛ اختلاف نسخة المصدر/كائن generation/حالة case أو disposition/إقرار/rights قيد التنفيذ ⇒ HOLD بدون writes.
- مصدر خادمي فقط، حفظ SHA+generation **private**، sanitized GET لا تسرب، منع forged keys، cross-receipt, missing generation, corrupted persisted, collision, drift between pre-read/tx, UNKNOWN after staged+retry.
- عدم الكتابة إلى receipt, qcat, rights, safety case, public library, PEIA؛ لا GCS read/write ولا dispatch.

**`scripts/runLibraryQuarantineIsolatedInspectionRequestClientTests.ts`:** gates، Owner/RBAC، strict DTO validators، click lock، confirmation، GET-only recovery for UNKNOWN، عدم إعادة إرسال تلقائية، تبدل receipt، dirty human case lock، عدم تسرب روابط/متغيرات. Rendering للتكامل إن أمكن دون ملف اختبار ثالث.

**Regression:**
```
npx --no-install tsx scripts/runLibraryQuarantineIsolatedInspectionRequestBackendTests.ts
npx --no-install tsx scripts/runLibraryQuarantineIsolatedInspectionRequestClientTests.ts
npx --no-install tsx scripts/runLibraryQuarantineBinarySafetyCaseBackendTests.ts
npx --no-install tsx scripts/runLibraryQuarantineBinarySafetyCaseClientTests.ts
npx --no-install tsx scripts/runLibraryQuarantineCatalogCaseAlignmentBackendTests.ts
npx --no-install tsx scripts/runLibraryQuarantineRightsDecisionBackendTests.ts
npx --no-install vitest run src/components/library/LibraryQuarantineUploadIntegration.test.tsx
npx --no-install tsc --noEmit
```
ثم `compile_applet` و`lint_applet`، وbuild للخادم إن كانت متاحة بلا تثبيت. صنّف ما هو baseline وما هو جديد بالاختبار، ولا تحول إخفاقًا إلى نجاح بإعادة كتابة توقعات قديمة. اختبار البناء وحده لا يثبت صحة المرئي.

**ما يجب تسجيله في تقرير Studio:** baseline SHA والمقارنة المحلية، مصدر كل ملف، نتائج preflight والـ404 للملفات الجديدة، نتيجة كل اختبار وكود الخروج، عدد عمليات Firestore في الاختبارات، بصمات الملفات المحلية، جرد GitHub Sync (2 MODIFIED + 6 ADDED كود؛ أي .md مؤقتة في public/assets/aistudio معزولة ومعلنة)، تأكيد عدم نشر أو تفعيل flags، وقائمة المعوقات والديون. لا Push حتى يقبل المالك تقرير/صورة النطاق. إن لزم تعديل ملف محمي أو تبين سلوك معارض للعقد => **STOP** لا تعديل تخميني.

## 6. مصادر مثبتة — مرجع القراءة والاختبارات

- GitHub `main` عند إعداد المواصفة: `5adedd70eb4b86f07dd53c0d02d6c46b8c7fff2d` (متحقق عبر GitHub connector).
- `libraryQuarantineBinarySafetyCaseService.ts` يدعم RBAC + حفظ السجل الحالي، وليس تنفيذ فحص فعلي.
- `firestoreLibraryQuarantineBinarySafetyCaseStore.ts` يصدّر `verifyQuarantineBinarySafetyChainSnapshots` لإعادة استعماله داخل transaction جديدة.
- `libraryQuarantineReceiptContract.ts` يحتوي `receipt.format`, `receipt.sha256`, `receipt.generation`, `receipt.byteSize`, `receipt.state`.
- `functions/src/index.ts` يصدر بالفعل `manageLibraryDocuments`؛ لا حاجة لإضافة callable جديدة.
- `functions/package.json` لا يحتوي مضاد فيروسات أو مشغل فحص معزول مخصص. هذا **ليس دليلًا شاملًا** لعدم وجود عامل خارجي في بنية تحتية غير متاحة للمراجعة؛ لذا لا تدعي وجوده أو تشغيله.
- مرجع كل ملف ورابط HTTPS مباشر وبصمة SHA-1 موثقة في برومبت 79. يتحقق Studio من HTTP 200/body/blob SHA قبل أي كتابة، ولا يفترض Git CLI أو GitHub Sync كوسيلة جلب.

## 7. معيار الإغلاق

`REQUEST_CONTRACT_IMPLEMENTED / SOURCE_REVIEW_PENDING / RELEASE_GATE_OFF / INSPECTION_NOT_PERFORMED` بعد نجاح الاختبارات؛ ثم مراجعة GitHub Sync، قبول المستخدم، Push يدوي، مراجعة source بعد Push؛ وبعدها فقط إعداد وحدة منفصلة لتصميم العامل المعزول وتشغيله، بمراجعة Threat Model وService Account/IAM وGCS-generation fencing قبل أي AV/CDR/Parser أو تنزيل خاص.
