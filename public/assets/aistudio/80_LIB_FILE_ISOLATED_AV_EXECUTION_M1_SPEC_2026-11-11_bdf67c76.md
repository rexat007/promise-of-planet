# 80 — وعد الكوكب / LIB-FILE-ISOLATED-AV-EXECUTION-M1

**نوع الحزمة:** وحدة تنفيذ متوسطة **مجمّعة**: إطلاق عامل فحص معزول + فحص AV حقيقي + إيصال نتيجة خاصة + حالة الواجهة. **ليست وحدة عقود تمهيدية جديدة.**  
**المستودع:** `rexat007/promise-of-planet`  
**Pinned GitHub main عند التحرير:** `49afd448bc55e46aa91af8a242eeafb2ee8d1e61`  
**الوضع:** `SPECIFIED_NOT_IMPLEMENTED` — لا يوجد دليل على نشر عامل فحص حي.  
**السلف:** `LIB-FILE-ISOLATED-INSPECTION-REQUEST-01`، Push متحقق، بصمات 8/8؛ سجل الطلب immutable بحالة `RECORDED_NOT_DISPATCHED`.

## 1. القرار: تقدم فعلي بدلاً من وحدات لا تنتهي

تنفَّذ أربع خطوات مترابطة داخل وحدة واحدة لأنها تشترك في الصلاحيات، ملف `libraryAdminHandlers.ts`، عميل الطلب، ولوحة المراجعة:

1. **DISPATCH** خادمي مقيد لطلب فحص مسجل سابقًا، ولا يثق بمسار/بيانات من المتصفح.
2. **WORKER** داخل Cloud Run Job خاص وغير عام يفتح **جيل GCS محددًا** ويحسب SHA-256 كاملًا ثم يشغّل **ClamAV الحقيقي** على ملف PDF/DOCX المحجور؛ لا يُسمح بماكيت «تم الفحص» في بيئة الإنتاج.
3. **RESULT** إيصال فحص AV خاص، مُرقّم ومُقيَّد بالطلب والنسخة، مع حفظ اسم/إصدار الماسح وتاريخ قاعدة التوقيعات والحكم التقني المحدود.
4. **STATUS** في اللوحة الحالية بالعربية/الإنجليزية، مع GET للتحقق، لا واجهة جديدة ولا أزرار مكررة.

**فاصل سلامة قطعي:** نتيجة AV «لم يُكتشف تهديد» ليست شهادة سلامة كلية ولا تطهيرًا ولا فحصًا عميقًا لبنية PDF؛ تظل الوثيقة محجورة، ولا يتغير `isSanitized/isVerifiedSafe/isRightsApproved/isPublished/isReadyForPeia` من `false`، ولا تُصدر روابط تحميل. نحتاج لاحقًا إلى تطهير/تحقق مستقل قبل اعتماد نشر وتحميل الوثيقة. لا استدعاء PEIA ولا مساس بالحقوق.

## 2. بيئة التنفيذ المثبتة والافتراضات الممنوعة

من GitHub عند المرجع الثابت:

- رفع المكتبة الخاص يستخدم دلوًا مخصصًا: `promiseofplanet-bb325-library-quarantine`، ومصدر الإيصال المعتمد `LibraryQuarantineInternalReceipt` يحوي `storagePath`, `generation`, `sha256`, `byteSize`, `format`, `state`, `updatedAt`. لا تُؤخذ هذه القيم من العميل.
- `library_quarantine_isolated_inspection_requests` يخزن سجلًا **لا يتغير** به طلب `requestId` حتمي `${receiptId}_${sourceRevision}_${safetyCaseRevision}`، وأعلام `dispatched:false`, `scanPerformed:false`، ويجب أن يظل **كما هو** بعد إضافة حالة تشغيل منفصلة.
- `verifyQuarantineBinarySafetyChainSnapshots` هو مدقق السلسلة المنشور، ولا يجوز نسخه برواية مبسطة.
- `manageLibraryDocuments` مُصدّر من `functions/src/index.ts`، ويفوض الأفعال داخل `libraryAdminHandlers.ts`.
- ملفات GitHub Actions موجودة لوظائف Firebase، **لكن لا يوجد في المصدر دليل على Cloud Run Job AV منشور أو IAM/Artifact Registry مهيأ له**. لا تفترض أن وجود حساب نشر Firebase يثبت صلاحيات Run Job.
- `firestore.rules` ينتهي بقاعدة رفض عام؛ لا تُضف قواعد وصول من العميل لمجموعات النتائج. Admin SDK يتجاوز قواعد Firestore، ولذلك تعتمد السلطة على خدمة الخادم وIAM.

مصادر التشغيل الرسمية:  
Cloud Run Jobs execution/overrides: https://docs.cloud.google.com/run/docs/execute/jobs  
Cloud Run REST jobs.run (يتطلب `run.jobs.runWithOverrides` عند overrides): https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run  
ClamAV Docker/قواعد التوقيع والذاكرة: https://docs.clamav.net/manual/Installing/Docker.html  
Cloud Storage generation-bound downloading: https://docs.cloud.google.com/storage/docs/streaming-downloads

**لا نشر أو تعديل IAM أو إنشاء موارد Cloud داخل Studio.** أنشئ مسار GitHub Actions يدويًا ببوابة `workflow_dispatch` و`verify-only` افتراضيًا؛ تفعيل deploy في نفس المسار يتطلب موافقة مستقلة من المالك، وفحص IAM/التكلفة وArtifact Registry قبل التشغيل. لا تكتب أسرارًا أو مفاتيح خدمة داخل الملفات.

## 3. حجم الوحدة وقائمة سماح صارمة

### MODIFY — ثلاثة ملفات

1. `functions/src/library/libraryAdminHandlers.ts`: عمليتا `dispatchQuarantineAvInspection` و`getQuarantineAvInspectionStatus`، بوابة server **سادسة** `POP_LIBRARY_AV_EXECUTION_ENABLED` = OFF افتراضيًا؛ تحقّق من البوابات الخمس السابقة قبل أي DB/Run API. إعادة استعمال تحقق Owner البشري النشط Review + مسؤولية Library.
2. `src/services/libraryQuarantineIsolatedInspectionRequestClient.ts`: عميل محمي للعمليتين، DTO مغلق، Fail-Closed وGET-only بعد `UNKNOWN`، وVite flag `VITE_LIBRARY_AV_EXECUTION_ENABLED` = OFF.
3. `src/components/library/LibraryQuarantineBinarySafetyCasePanel.tsx`: مساحة صغيرة ضمن قسم الطلب الحالي: تشغيل فحص AV (عند توافر البوابات فقط)، حالة الانتظار والتشغيل والنتيجة، زر تحقق قراءة فقط. التسمية العربية واضحة؛ لا زر نشر أو تنزيل.

### ADD — ثمانية ملفات

4. `functions/src/library/libraryQuarantineAvExecutionContract.ts`: ledger DTO/storage schema + strict validation.
5. `functions/src/library/libraryQuarantineAvExecutionService.ts`: authority/Firestore transactions + lifecycle + private status + Worker CAS.
6. `functions/src/library/libraryQuarantineAvJobInvoker.ts`: Cloud Run Jobs v2 invoker قابل للحقن/الاختبار مع credential server-only؛ لا API key؛ يفشل إذا job/region/IAM غير مهيأين.
7. `functions/src/library/libraryQuarantineAvWorker.ts`: **منفذ ClamAV فعلي**، readback خاص من GCS مع generation/sha256/size، temp bounded، scanner subprocess، writes لنتيجة ledger فقط، cleanup.
8. `functions/library-av-worker.Dockerfile`: حاوية worker محددة النسخ (لا `latest`)، حزم ClamAV/تعريفاتها وقواعد fail-closed، مستخدم غير root، entrypoint للـworker فقط.
9. `scripts/runLibraryQuarantineAvExecutionBackendTests.ts`: عقد، عمليات Firestore، dispatch/worker/scan outcomes، no-public-release.
10. `scripts/runLibraryQuarantineAvExecutionClientTests.ts`: gates/RBAC/DTO/panel states/UNKNOWN/RTL-LTR.
11. `.github/workflows/library-quarantine-av-job.yml`: `workflow_dispatch`، افتراضيًا BUILD+VERIFY فقط؛ `deploy` يظل مشروطًا بمدخل موافقة صريح وفحوص IAM/التكلفة وإذن المالك اللاحق، ولا يُشغَّل أو يُنشر الآن.

**0 DELETE، دون تعديل `functions/package.json`, lockfiles, `functions/src/index.ts`, rules, `firebase.json`, `.env*`, upload/storage/receipt/safety/request contracts أو existing worker files.** يمكن استخدام حزم Firebase Admin وNode المبنية فعليًا في `functions`، لا تثبيت حزم جديدة داخل Studio. إذا تطلب التنفيذ بصورة غير قابلة للتجاوز تعديل ملف محمي/اعتماد مكتبة غير موجودة: **STOP وصرح بالعائق**، لا توسع النطاق صامتًا.

ملفات `.md` التي ينشئها Studio تلقائيًا داخل `public/assets/aistudio/` استثناء مؤقت مصرح به **يُجرد منفصلًا** عن 3M+8A؛ لا ترفع أسرارًا داخله ولا تحذفه الآن.

## 4. فواصل الخادم والنسخة والتزامن

### 4.1 Dispatcher — مسؤول بشري فقط

- GET حالة التشغيل: `{ action:'getQuarantineAvInspectionStatus', receiptId }`، لا private SHA/generation/path/bucket، يقرأ طلب النسخة الحالية والـledger برقم ID؛ بلا query عام.
- DISPATCH: `{ action:'dispatchQuarantineAvInspection', receiptId, requestId, confirmation:'START_REAL_ISOLATED_AV_SCAN' }`؛ لا `generation`, path, sha256, bucket, verdict, sourceFormat من العميل.
- Gate OFF => صفر اتصال بقاعدة البيانات/مخزن GCS/Run API. Owner بشري نشط + Review ومجال Library؛ رفض AI/claims غير موثوقة قبل القراءة.
- يعيد ضمن معاملة server الحقائق الحالية للإيصال/المراجعة/المواءمة/safety case والطلب `RECORDED_NOT_DISPATCHED` ويثبت النسخة: revision + `sha256`, `generation`, status وطلب immutable؛ لا dispatch لو stale، `DO_NOT_PROCESS`، لم تنشأ الحالة، حقوق غير مؤهلة، أو عدم تطابق.
- سجّل **نية تنفيذ واحدة** في `library_quarantine_av_executions/<requestId>` من الخادم، قبل استدعاء Cloud Run API؛ idempotency في المفتاح وتأكيد عدم وجود تنفيذ نشط/مكتمل لنفس requestId. **لا تعيد كتابة السجل الأصلي**. لا ثقة في أن `POST :run` قد نجح إذا وقع timeout؛ أرجع `DISPATCH_UNKNOWN` وGET-only ليراجعه المالك. لا retry تلقائي.
- إطلاق `jobs.run` عبر API مُصادق باستخدام هوية خدمة Cloud Functions وبـ`overrides` لا يحمل سوى `requestId` — `taskCount=1` وretries مضبوطة؛ اختبر صلاحية `run.jobs.runWithOverrides` قبل أي تمكين، دون افتراض IAM. لا تمرر path/sha/generation إلى Cloud Run overrides أو logs.
- في حالات `API_REJECTED` المعلومة بدقة: لا تدّعِ أنه أُرسل، وسجّل فشل التشغيل. في timeout/5xx/رد غير قابل للتحقق: `DISPATCH_UNKNOWN` وليس `NOT_DISPATCHED` المؤكد. لا تنتظر نتائج scan في Firebase callable.

### 4.2 Worker — فحص حقيقي محدود

- لا HTTP عام. Cloud Run **Job** خاص ببيانات معزولة وحساب خدمة أقل صلاحيات متاحة؛ مهمته ملف واحد. جلب requestId من متغير مدخل محدود بالشكل فقط؛ لا قبول path أو sha أو generation من runtime override.
- يبدأ بالتحقق من سجل الطلب immutable، وledger، وسلسلة Firestore الحالية وإصدار الملف. claim transaction CAS تمنع تشغيل فاحصين على نفس الطلب، ونسخة/التغير خارج الطلب تلزم `STALE_HOLD`. أعد فحص `receipt` بعد AV وقبل تسجيل نتيجة.
- اشتق `storagePath` من `LibraryQuarantineInternalReceipt`، وتأكد من المسار القانوني والدلو الثابت. استخدم GCS file handle مثبتًا بـ`receipt.generation`؛ تحقق من metadata (`generation`, size, content-type, metadata no-public-token) وسلسلة مصدر الإيصال، ثم اقرأ الملف **بالتوليد المحدد** مع حد bytes + timeout، واحسب SHA256 كاملًا وطابقه مع receipt/request؛ لا تقرأ كائنًا أحدث بالاسم نفسه.
- التخزين المؤقت داخل مساحة worker محدودة، بأسماء ثابتة ومقيدة امتدادًا (`input.pdf`/`input.docx`)، دون أي فتح للمستند في عملية الخادم الرئيسية، دون تفعيل macros أو تنفيذ مستند، لا رفع الملف/محتواه إلى Logging أو external services، حذف temp في `finally`.
- شغّل برنامج `clamscan`/`clamdscan` **المثبت فعليًا** ببيانات توقيع محدثة ضمن TTL محدد ومبرر. مخرجات clamscan: 0 = لم تُكتشف تهديدات في هذا الفحص، 1 = تهديد، >=2 أو timeout/قاعدة ناقصة/قديمة/فشل executable = فشل/UNKNOWN، **لا** PASS. اجمع `engineVersion`, `signatureVersion/updatedAt`, `scannedBytes`, `recordedAt` من تشغيل موثق؛ لا تثق في نصوص Console كحكم.
- قيود موارد: Cloud Run Job ذاكرة كافية (يفضل >=4GiB بعد إثبات بالاختبار)، مهلة محددة، retries 0 افتراضيًا، concurrency bounded=1، max file size from existing source contract. ClamAV قد يحتاج عدة GiB للبيانات؛ لا تستخدم إعدادات افتراضية منخفضة وتقول PASS.
- نتائج ledger: `AV_NO_THREAT_DETECTED`، `AV_THREAT_DETECTED`، `AV_SCAN_FAILED`، `STALE_HOLD`، `DISPATCH_UNKNOWN`، `RUNNING`؛ سجل نتيجة موثقة في Firestore بالـCAS. عند نتيجة 0 **لا ترفع** أي أعلام ثقة/نشر. لا تغيير في receipt/safety/request/qcat/rights/PEIA/public library. لو فشل تحديث حالة ledger بعد فحص فقد ينتج `UNKNOWN`؛ لا ترفع أي false-positive نجاح.
- append-only events للإجراءات الحاسمة من الخادم إذا أمكن دون نمط لا يضمن transaction، مع عدم الكشف عن SHA/path في DTO أو client.

### 4.3 واجهة المستخدم

- زر واحد لتشغيل الفحص فقط بعد أن يرى الـOwner سجل طلب صالحًا وقائمًا، مع تأكيد واضح: «سيتم إرسال الملف إلى فاحص AV معزول؛ نتيجة AV وحدها لا تسمح بنشر الملف».
- العرض: `لم يُرسل` → `إرسال غير مؤكد/قيد الإطلاق` → `الفحص يعمل` → `لم يُكتشف تهديد بواسطة AV` **أو** `رُصد تهديد` **أو** `تعذر الفحص`؛ لا تستخدم «آمن» أو «مطهَّر».
- `UNKNOWN` لا يُطلق إجراءً جديدًا ولا retry؛ زر تحقق قراءة فقط. تغيّر receipt أو حالة المراجعة أو وجود تعديلات بشرية غير محفوظة يقفل تشغيل الفاحص. RTL/LTR/mobile/dark mode، لا أزرار إضافية متكررة.

## 5. إثبات حقيقي واختبارات (ليس Mock نجاح كافيًا)

**اختبارات داخل Studio (بدون Docker/Cloud Run):**
1. Unit backend: gate OFF=zero network, owner/role, accepted/nonaccepted request, CAS dispatch intent, duplicate dispatch idempotency, dispatch API success/reject/uncertainty, never mutate immutable request, result ledger states, stale receipt/humanCase/GCS generation pre/post scan, complete source digest, metadata mismatch, no PDF parsing, no public read/download. Fake scanner injection may test interpretation, but لا تدّعي أنها ClamAV حقيقي.
2. Worker test: stub GCS stream / scanner process / fs temp؛ exit codes 0/1/2, timeout, size limit, missing sigs/stale DB, swapped generation, SHA mismatch, deletion, source change just before result; resource cap and zero public writes.
3. Client test: gates/RBAC, strict DTO no SHA/generation/path, state labels, no auto retry after UNKNOWN, one dispatch button, AR/EN RTL/LTR and receipt isolation.
4. Regression: 6+5 isolated inspection request، 6+5 binary safety R1، 7+6 catalog alignment، 8+6 rights، 11 upload component، `npx --no-install tsc --noEmit`, `compile_applet`, `lint_applet`, plus `functions npm run build` إن توفرت الاعتمادات المثبتة. أظهر الأكواد الفعلية، لا تعدل source خارج النطاق للمرور.

**اختبارات CI/الحياة — بوابة قبول الوحدة نفسها، ليست وحدة جديدة:**
- GitHub Actions `verify_only` يبني صورة worker بالاعتمادات الفعلية، يثبت وجود ClamAV وقواعد توقيع محددة ويفشل إذا مفقودة. صورة محددة النسخة؛ تجنب `latest`. تهيئة `freshclam` موثوقة ومراقبة عمر التوقيعات؛ إذا لم تثبت أحدث قاعدة ضمن TTL لا تُشغّل.
- بعد موافقة المالك الصريحة، وفحص Cloud Run Job / IAM least privilege / billing / dedicated bucket settings، تشغيل اختبار حقيقي بمعيار <https://www.eicar.org/download-anti-malware-testfile/> داخل بيئة معزولة، ثم ملف PDF/DOCX نظيف يملكه المالك. EICAR اختبار كشف وليس تنفيذ برمجيات ضارة. لا تسجّل PASS إلا بعد ظهور ClamAV version/signatures، النتيجة والـCAS والـFirestore readback.
- `SOURCE_IMPLEMENTED` ممكن قبل CI، لكن `AV_RUNTIME_ACCEPTED` ممنوع دون Cloud Run live tests؛ قبول الـPush لا يساوي قبول العامل التشغيلي. عند عجز Studio عن Docker، يصنف `CI_REQUIRED` ويكمل الكود دون تمويه.

## 6. قيود التنفيذ وبروتوكول الاستلام

- لا إعادة تصميم منظومة الحجر ولا واجهة library جديدة؛ لا تعديلات GIS/Donations/News/Media ولا ملفات منفصلة لغرض شكلي.
- لا تحميل حزم/CLI أو تشغيل Docker Cloud resources في Studio، لا `rm -rf`, no Git CLI presumed, no auto push, no Firebase deploy.
- راجع preflight 3 MODIFIED عبر HTTPS raw URL+SHA-1 لكل ملف. 8 ADDED يجب أن تعطي HTTP 404 على **المرجع المثبت** وتكون غير موجودة محليًا؛ لا تعتبر مسار الملف المحتمل «مرجعًا» صالحًا للجلب.
- **Stop** إذا كان `main` تغيّر عن المرجع، أو ملف محلي unpushed، أو احتجت تعديل ملف إضافي. اقرأ `functions/src/library/libraryQuarantineIsolatedInspectionRequestContract.ts`, `firestore...RequestStore.ts`, `firestore...BinarySafetyCaseStore.ts`, `libraryQuarantineReceiptContract.ts`, `gcs...Adapter.ts`, `functions/tsconfig.json`, `functions/package.json`, workflow الحالي: كلها READ ONLY، بصماتها مثبتة في برومبت 81.
- عند نجاح التنفيذ: جرد GitHub Sync **3 Modified + 8 Added + 0 Deleted كود**؛ ملفات `public/assets/aistudio/*.md` المؤقتة تُذكر منفصلة ولا تمنع وحدها القبول، ما لم تحتوِ أسرارًا أو تعليمات نشر خطرة. لا Push حتى فحص المالك ثم Push يدوي، وبعده مراجعة مصدر مجددًا.

## 7. خط النهاية بعد M1 — وحدتان متوسطتان فقط (قابلة للدمج عند ثبوت سلامة النطاق)

- **M2 — المعالجة/التطهير الحقيقي PDF/DOCX داخل العامل نفسه** مع ملف مشتق آمن منفصل وقابل للتحقق وسلسلة أدلة؛ دمج خطوات PDF وDOCX المتشابهة إن كانت المكتبات والتشغيل مدعومين فعلًا، وإلا تجزئة حسب الخطر التقني فقط. لا تأخذ `AV_NO_THREAT_DETECTED` مسوغًا تلقائيًا.
- **M3 — الاعتماد البشري النهائي + مراجعة الحقوق + النشر العام + العرض والتنزيل** من النسخة المطهرة المعتمدة فقط، مع عدم كشف الأصول المحجورة. دمج واجهة القراءة ومسار التنزيل والمراجعة عندما تشترك في الملفات دون توسيع أخطار الإنتاج.

**لا توجد «وحدات عقود قبل العمال» بعد M1.** عند عائق أمني حقيقي يُوثق السبب والتبعية قبل طلب قرار المالك، لا تبدأ وحدة جديدة تلقائيًا.
