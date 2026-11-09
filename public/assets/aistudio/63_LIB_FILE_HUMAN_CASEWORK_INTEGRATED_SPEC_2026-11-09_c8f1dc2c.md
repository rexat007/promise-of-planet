# وعد الكوكب — LIB-FILE-HUMAN-CASEWORK-01
## مواصفة هندسية: ملف مراجعة بشرية فعلي لملفات المكتبة المحجورة

**التاريخ:** 2026-11-09  
**الحالة:** SPECIFIED / NOT IMPLEMENTED  
**المستودع:** `rexat007/promise-of-planet`  
**Baseline SHA الثابت:** `2eae8a78118b91cef75f22c53634a8ccfef8f37b`  
**الوحدة السابقة:** `LIB-FILE-WORKBENCH-01` — **GitHub source verified**، 4 ملفات جديدة + 2 تعديل + مواصفة؛ لا حذف.  
**هدف الحزمة:** وظيفة واحدة مكتملة نسبيًا (سجل مراجعة بشرية قابل للحفظ والتعديل والتدقيق)، **لا** خطوة شكلية جديدة.

## 1. النتيجة الوظيفية

يستطيع المراجع البشري المخوّل فتح إيصال `Quarantined` مرتبط بالفعل بمسودة `PENDING_HUMAN_REVIEW` من **نفس** صندوق إدارة المكتبة، فيرى بيانات الإيصال الإدارية المنقحة فقط، ويسجل عنوان الوثيقة عربيًا/إنجليزيًا، الجهة المُصدرة، موجزًا تحريريًا، ملاحظات إثبات المصدر، ملاحظات دليل الحقوق، وملاحظات المراجع؛ ويختار حالة **الفرز الأولي للبيانات**:

`IN_REVIEW | NEEDS_INFORMATION | METADATA_RECORDED | NOT_SUITABLE`.

يحفظ النظام السجل بصورة دائمة خاصة، مع نسخة مراجعة `revision` و`expectedRevision` لمنع الكتابات المتنافسة، وهوية المراجع الخادمية، وحدث تدقيق غير قابل للاستبدال لكل تعديل. تُعرض الحالة الحالية عند إعادة فتح النافذة/تحديثها. لا يسمح النظام بترقية أي حالة أمان أو حقوق أو نشر؛ `METADATA_RECORDED` تعني **اكتمال بيانات وصفية أولية فقط** ولا تعني فحص الملف أو اعتماده. لا تعرض ملفات PDF/DOCX الخام في المتصفح.

## 2. مصدر الحقيقة والتحقق قبل أي كتابة

GitHub main للنسخة المرفوعة، وStudio فقط للتعديلات المحلية غير المرفوعة. اقرأ الملفات الموجودة في Studio وقارن Git *blob SHA-1* (`sha1('blob '+length+'\0'+body)`) مع القيم التالية؛ لا تفترض وجود `.git` أو قدرة GitHub Sync على استرجاع الملفات. أي جلب مطلوب من GitHub يجب أن يستخدم **رابط HTTPS المباشر الكامل لكل ملف** المثبت عند الـcommit، مع HTTP 200، جسم كامل غير HTML، وSHA مطابق قبل أي كتابة. إن تعذّر إثبات التطابق: **STOP**. فُحصت SHA للملفات عبر موصل GitHub هنا؛ فحص HTTP للرابط الخام يظل **شرطًا على Studio عند الحاجة للجلب**، وليس مُدّعى أنه نجح لدينا.

| المسار | SHA-1 (blob) | رابط المصدر الثابت |
|---|---|---|
| `functions/src/library/libraryAdminHandlers.ts` | `4827e7e6821bf2797a04ce7a99fcb23277e0ef81` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/functions/src/library/libraryAdminHandlers.ts` |
| `src/components/library/AdminLibraryManagement.tsx` | `6622e67c430b9df2c03b9f9b1456939565717391` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/src/components/library/AdminLibraryManagement.tsx` |
| `functions/src/library/libraryQuarantineReviewWorkbenchService.ts` | `2b6d8506a52d9be1f8ed6ba37662529f8d1f242a` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/functions/src/library/libraryQuarantineReviewWorkbenchService.ts` |
| `src/services/libraryQuarantineReviewWorkbenchClient.ts` | `854d289ac579e5f261f0855fc39575d759140838` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/src/services/libraryQuarantineReviewWorkbenchClient.ts` |
| `functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts` | `f481a24bda7dcbf7a63a12644e5b2d91b8626318` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts` |
| `functions/src/library/firestoreLibraryQuarantineReceiptStore.ts` | `d9f4114222851c62c25574efbb0ffbeeb5c355e2` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/functions/src/library/firestoreLibraryQuarantineReceiptStore.ts` |
| `functions/src/library/libraryQuarantineReceiptContract.ts` | `4b4d5f32e5903def3a3b0dcdecd45e38083f91bb` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/functions/src/library/libraryQuarantineReceiptContract.ts` |
| `functions/src/library/libraryQuarantineReviewDraftPersistenceService.ts` | `5709952519564cb118443fd6dd59ec9cff249bb1` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/functions/src/library/libraryQuarantineReviewDraftPersistenceService.ts` |
| `functions/src/library/libraryQuarantineReviewDraftCallableBridge.ts` | `1edb4f3dbfd58a2ebe0604c3b8412ef47e18b7ee` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/functions/src/library/libraryQuarantineReviewDraftCallableBridge.ts` |
| `functions/src/admin/firestoreAdminRepository.ts` | `cd118b4ea9da4d66bba8185055dbc7e31537a354` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/functions/src/admin/firestoreAdminRepository.ts` |
| `functions/src/shared/libraryContract.ts` | `cfb0849c0418ba7b075f7de49c3debe668adc724` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/functions/src/shared/libraryContract.ts` |
| `functions/src/index.ts` | `5a14cada5dad8e764f8cc3092f40c386f6b09616` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/functions/src/index.ts` |
| `src/services/firebase.ts` | `99950b76657d051f4500b3da91c289743d354496` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/src/services/firebase.ts` |
| `package.json` | `34cb668d837d342c9b5367461cca2ad9dd8a18e7` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/package.json` |
| `functions/package.json` | `420e933933f4f582a4ded415727152021faf5400` | `https://raw.githubusercontent.com/rexat007/promise-of-planet/2eae8a78118b91cef75f22c53634a8ccfef8f37b/functions/package.json` |

## 3. قائمة السماح الدقيقة — 9 ملفات برمجية

**MODIFY (2) — فقط في مواضع الربط المطلوبة:**
- `functions/src/library/libraryAdminHandlers.ts`
- `src/components/library/AdminLibraryManagement.tsx`

**ADD (7) — يجب إثبات غيابها محليًا قبل الإنشاء:**
- `functions/src/library/libraryQuarantineHumanReviewCaseContract.ts`
- `functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore.ts`
- `functions/src/library/libraryQuarantineHumanReviewService.ts`
- `src/services/libraryQuarantineHumanReviewClient.ts`
- `src/components/library/LibraryQuarantineHumanReviewModal.tsx`
- `scripts/runLibraryQuarantineHumanReviewBackendTests.ts`
- `scripts/runLibraryQuarantineHumanReviewClientTests.ts`

**كل ما عدا ذلك محمي READ-ONLY**: `functions/src/index.ts`، 01A/01B/01C، مكتبة الإدارة والرفع القائمة، الـPEIA، الأخبار والوسائط، إعدادات Firebase وFirestore rules، `package.json`، lockfiles، CI/deploy، التبرعات والاشتراكات. لا تثبيت حزم، لا حذف أو إعادة تسمية جماعية، لا `rm -rf`، لا Push، ولا Firebase CLI أو تغيير Secrets/Env. لا تضف ملف المواصفة إلى المستودع من تلقاء نفسك.

## 4. العقد الخادمي والتحرير البشري

**4.1 `libraryQuarantineHumanReviewCaseContract.ts`**
- `HumanReviewCase` ثابت المخطط وله `schemaVersion:1, receiptId, sourceRevision, sourceUpdatedAt, sourceSha256, draftSourceRevision, revision, status, titleAr, titleEn, issuingOrganization, summaryAr, summaryEn, sourceEvidenceNotes, rightsEvidenceNotes, editorialNotes, createdBy, createdAt, updatedBy, updatedAt`؛ حدد الحقول الاختيارية وقيود الطول بدقة قبل التنفيذ؛ جميع الحقول نصوص عادية فقط ولا تقبل HTML أو أسطر تحكم. لا تضف `storagePath`, `generation`, tokens, binary أو روابط تنزيل.
- لا تُقبل سوى الحالات الأربع المذكورة. `METADATA_RECORDED` تتطلب عنوانًا واحدًا على الأقل وملاحظات إثبات مصدر غير فارغة؛ `NEEDS_INFORMATION` و`NOT_SUITABLE` تتطلب تبريرًا واضحًا. لا توجد حالات `APPROVED/PUBLISHED/SAFE/RIGHTS_CLEARED`.
- أي واجهة عامة DTO لا تعيد `sourceSha256` ولا هوية `createdBy` أو بيانات خام؛ تعرض فقط بيانات التحرير المصرح بها/النسخة/الحالة. المخطط لا يتضمن أو يغير أعلام الأمان الخمسة، وتظل جميعها `false` في مسودة الحجر والإيصال.

**4.2 `firestoreLibraryQuarantineHumanReviewCaseStore.ts`**
- مجموعتا Firestore خاصتان: `library_quarantine_human_review_cases/<receiptId>` و`library_quarantine_human_review_events/<receiptId>_<revision>` (اسم حدث حتمي). `GET` نقطة واحدة فقط، لا فحص مجموعة مفتوح.
- حفظ داخل **معاملة واحدة**: اقرأ `library_quarantine_receipts/<receiptId>`، و`library_quarantine_review_drafts/<receiptId>`، والسجل الحالي، وحدث النسخة المقصودة **قبل أي كتابة**. تحقق من سلامة الإيصال/المسودة والأهلية والتطابق مع المصدر والنسخة والـSHA؛ ممنوع حفظ فرز لإيصال غير `Quarantined` أو بلا مسودة صحيحة.
- `expectedRevision=0` للإنشاء؛ وبعدها يساوي النسخة المسجلة. تعارض النسخ يوقف الكتابة دون overwrite. أنشئ حدث تدقيق جديدًا غير قابل للاستبدال (`create`) لكل تعديل، ولا تحدث/تحذف حدثًا سابقًا. يسمح `update` بسجل الحالة نفسه فقط عند صحة CAS.
- لا كتابة إلى receipt أو reviewDraft أو GCS أو `library_documents` أو `library_intake` أو PEIA. إذا ضاعت نتيجة commit، الرد `UNKNOWN` و`caseSaved:null`، وليس `false` كاذبة؛ إعادة القراءة/المحاولة اليدوية فقط.

**4.3 `libraryQuarantineHumanReviewService.ts` و`libraryAdminHandlers.ts`**
- وظيفتان عبر **نفس** `manageLibraryDocuments` callable الحالية؛ بلا export جديد في `index.ts`:
  - `{action:'getQuarantineHumanReviewCase',receiptId}` — قراءة حالة السجل ومعلوماته المنقحة فقط.
  - `{action:'saveQuarantineHumanReviewCase',receiptId,expectedRevision,input}` — حفظ التحكيم البشري الأولي فقط مع جواب `SAVED | CONFLICT | HOLD | UNKNOWN` دقيق.
- المصدر الوحيد لهوية `uid` هو `request.auth` الخاص بـFirebase Functions SDK، ثم `FirestoreAdminRepository.getAdminByUid(uid)`؛ تحقق من حساب نشط بشري، مسؤولية Library، وصلاحية `AdminPermission.Review` لكل الإجرائين. ممنوع الاعتماد على `uid/role/auth` المرسلة في `data`.
- شرط إطلاق خادمي مستقل `POP_LIBRARY_HUMAN_CASE_REVIEW_ENABLED === 'true'` **بالإضافة** إلى شرط workbench الموجود؛ الافتراضي false ويجب أن يسبق أي قراءة Firestore/GCS/مراجعة صلاحيات أو كتابة. لا تغير متغيرات البيئة داخل Studio.
- رموز أخطاء وملاحظات ثابتة بلا رسائل خام أو مسارات تخزين أو أسماء مستندات حساسة في الأخطاء. لا إعادة محاولة آلية عند `UNKNOWN`.

## 5. عميل وواجهة واحدة موجودة

**`src/services/libraryQuarantineHumanReviewClient.ts`**: استدعاء `manageLibraryDocuments` عبر Firebase SDK وpayload المحدد حصريًا، تحقق صارم من الـDTO والحالات والنسخ ورفض الحقول الإضافية والتسريب؛ لا Firestore/GCS مباشرة من المتصفح. تعطيل افتراضي `VITE_LIBRARY_HUMAN_CASE_REVIEW_ENABLED !== 'true'`؛ أبقِ شرط workbench الأصلي، لا تفعّل أي خيار من الكود.

**`LibraryQuarantineHumanReviewModal.tsx`** + ربطها في **`AdminLibraryManagement.tsx`**: زر واحد «فتح سجل المراجعة / Open review case» فقط للصفوف `Quarantined` التي حالتها `PENDING_HUMAN_REVIEW` وللمراجعين بصلاحية `Review`؛ لا نوافذ إضافية لرفع الملفات ولا صندوق ثانية. النافذة تعرض الحقول العربية والإنجليزية والملاحظات والقرار الأولي وحالة الحفظ والتعارض. `role=dialog` وإغلاق/هروب وإدارة تركيز أساسية، RTL/LTR، جوال 390px/تابلت/كمبيوتر، ليل/نهار؛ مفردات طبيعية وليست تسريبًا لأسماء حراس الكود. لا تعرض PDF/DOCX الخام، أو روابط GCS، أو زر نشر/موافقة حقوقية، أو زر «استعراض آمن» وهميًا.

حفظ يدوي فقط، قفل نقر مزدوج، عدم إظهار نجاح قبل نتيجة الخادم، `UNKNOWN` يوقف الحفظ ويعرض «تحقق من السجل» دون إعادة إرسال، وتحميل جديد بعد الحفظ/إعادة الفتح. إلغاء التحديثات المتأخرة عند تغيير المستخدم، إغلاق النافذة أو تسجيل الخروج. عند تعطيل العلم يبقى الـWorkbench القائم كما هو.

## 6. اختبارات قبول متكاملة — لا تقسيم إلى وحدات

شغّل ملفي الاختبارات الجديدين بأوامر:

```bash
npx --no-install tsx scripts/runLibraryQuarantineHumanReviewBackendTests.ts
npx --no-install tsx scripts/runLibraryQuarantineHumanReviewClientTests.ts
```

اختبارات حقيقية على fake Firestore معاملات وسلطة `request.auth` mock من SDK: إنشاء، تحديث متعاقب، فشل CAS، حقول ممنوعة، role غير مصرّح، إيقاف الإطلاق قبل أي قراءة، stale receipt/draft، فشل تأكيد commit => `UNKNOWN`، أحداث تدقيق غير قابلة للاستبدال، 0 GCS/receipt/draft writes، عدم تسريب، عدم تضارب المستخدمين، عمل الواجهة بالعربية والإنجليزية وتحت قفل التعطيل. شغّل أيضًا اختبارات Workbench السابقة (Backend 6/6، Client 5/5) واختبارات 01B/01C المحمية؛ إن أظهرت اختبارات قديمة تضاربًا حقيقيًا بسبب امتداد واجهة موجودة، **STOP** واذكر الموضع، ولا توسع النطاق تلقائيًا.

أوامر تحقق عامة: `npm run build`, `npm run lint`, فحص TypeScript المعزول و`git diff --check` فقط إذا كانت `.git` موجودة بالفعل. لا يُغني نجاح البناء عن مراجعة الواجهة أو GitHub Sync. صورة فعلية للواجهة وتقرير الملفات المنوية من المستخدم شرط قبول مرئي؛ اختبار sandbox لا يساوي نشر Firebase.

## 7. شروط STOP والتقرير النهائي

**STOP قبل الكتابة** إذا baseline Studio المحلي مختلف وغير قابل للتحقق، ملف جديد موجود أصلاً، يلزم تغيير ملف خارج القائمة، لا تتوافق أنواع `LibraryQuarantineReceipt` أو draft، أو يلزم تقديم/فتح ثنائي غير مطهَّر لتحقيق الحالة المطلوبة. لا تُصلح بالتخمين. **STOP قبل Push** عند خطأ اختبار، حذوفات غير مصرح بها، أو ملفات مستحدثة غير مقصودة.

التقرير المطلوب: جدول 9 ملفات فقط، SHA-1 قبل/بعد، اختبارات بأعداد وexit codes، أدوار متاحة/مرفوضة، ضمان عدم تغيير 01B/01C، وضع feature flags، نتيجة `GitHub Sync` (2 modified, 7 added, 0 deleted)، لقطات AR/EN والجوال/الكمبيوتر إن أمكن. **لا Push ولا PR ولا Firebase deployment** من Studio.

**نهاية الوحدة المطلوبة:** سجل فرز بشري محفوظ فعلًا داخل Firestore ومعروض في نافذة الإدارة، مع مؤشرات أن **الحقوق وفحص الثنائي والنشر ما زالت غير معتمدة**.
