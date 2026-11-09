# وعد الكوكب — LIB-FILE-CATALOG-HANDOFF-01
**مواصفة حزمة تنفيذ متكاملة: نقل المراجعة البشرية إلى مسودة سجل مكتبة داخلية مع حواجز نشر مستقلة**  
**التاريخ:** 2026-11-09  
**Repository:** `rexat007/promise-of-planet`  
**PINNED_BASELINE_SHA:** `f001cdcfca481d7781b43dcd4c70781970388baf`  
**المصدر:** سجل GitHub المرفوع؛ تغيرات Studio غير المرفوعة مصدرها Studio وحده.  
**الوضع:** SPEC / NOT_IMPLEMENTED؛ لا إذن Push أو Firebase deployment.

## 1. الدافع المثبت وهدف التسليم
آخر نسخة GitHub تتضمن رفع ملفات الحجر، مراجعة الإيصالات، مسودات مراجعة داخلية، وسجل مراجعة بشرية `IN_REVIEW | NEEDS_INFORMATION | METADATA_RECORDED | NOT_SUITABLE`. لا توجد بعد آلية تربط السجل البشري المكتمل بمسودة `LibraryDocument` تحريرية بصورة آمنة. ويستخدم `PublicLibraryRepository` حاليًا معيار `workflowState === Published`، فيما يسمح مسار `LibraryApplicationService.transitionWorkflow` بالوصول لحالة `Published` عبر الصلاحيات المعتادة؛ لذلك **ممنوع** تكوين مستند مرتبط بحجر خاص دون حاجز إضافي يمنع انتقاله إلى النشر.

**هدف الحزمة الواحدة:** يختار المراجع البشري الذي يملك Review+Create سجلًا حالته `METADATA_RECORDED`، ويكمل البيانات المرجعية اللازمة (لا قيم مُختلقة)، ثم ينشئ **مسودة مكتبة داخلية فقط** من نوع `LibraryDocument` بعلاقة إثبات أصل مستقلة ومُدققة، دون نسخ الملف أو كشف رابط تخزينه. بعد الإنشاء تُعرض المسودة في قسم الوثائق الإدارية، لكنها لا تظهر في المكتبة العامة ولا يمكن اعتماد حقوقها أو نشرها عبر المسار العام قبل بوابة سلامة وحقوق مستقبلية منفصلة.

## 2. قائمة السماح الحصرية — 11 ملف كود
**MODIFY (6):**
- `functions/src/library/libraryAdminHandlers.ts`
- `functions/src/library/libraryApplicationService.ts`
- `functions/src/library/publicLibraryRepository.ts`
- `src/components/library/AdminLibraryManagement.tsx`
- `src/components/library/LibraryQuarantineHumanReviewModal.tsx`
- `scripts/runLibraryQuarantineReviewDraftCallableBridgeTests.ts`

**ADD (5):**
- `functions/src/library/libraryQuarantineCatalogHandoffService.ts`
- `src/services/libraryQuarantineCatalogHandoffClient.ts`
- `src/components/library/LibraryQuarantineCatalogHandoffPanel.tsx`
- `scripts/runLibraryQuarantineCatalogHandoffBackendTests.ts`
- `scripts/runLibraryQuarantineCatalogHandoffClientTests.ts`

**PROTECTED / READ-ONLY:** كل الملفات خارج القائمة أعلاه، وبالأخص الملفات المرجعية التالية:
- `functions/src/library/libraryQuarantineHumanReviewCaseContract.ts`
- `functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore.ts`
- `functions/src/library/libraryQuarantineHumanReviewService.ts`
- `src/services/libraryQuarantineHumanReviewClient.ts`
- `functions/src/library/firestoreLibraryRepository.ts`
- `functions/src/library/libraryValidator.ts`
- `functions/src/shared/libraryContract.ts`
- `functions/src/shared/workflowContract.ts`
- `functions/src/index.ts`
- `functions/src/library/libraryQuarantineReviewDraftCallableBridge.ts`
- `src/services/libraryAdminClient.ts`
- `package.json`

إضافة ملف مواصفة لواجهة Studio داخل `public/assets/aistudio` غير مطلوبة؛ إذا أنشأها Studio، يجب إظهارها كملف إضافي ضمن التقرير وإيقاف Push إلى أن يوافق المالك على النطاق. ممنوع إزالة/نقل ملفات، تثبيت حزم، تغير `package.json`، تنظيف مجلدات، تشغيل `rm -rf`، إنشاء نشر/Secrets/CLI، أو تعديل GIS والتبرعات.

## 3. العقود والمصدر المعماري
### 3.1 هوية السجل والمستند
- استخدم معرّفًا ثابتًا وحيدًا: `documentId = 'qcat-' + receiptId` حيث `receiptId` هو 32 hex صغير فقط. احجز نمط `^qcat-[0-9a-f]{32}$` رسميًا؛ إعادة نفس الطلب لا تُنشئ مستندًا أو رابطًا ثانيًا.
- أنشئ `library_documents/<documentId>` وفق عقد `LibraryDocument` الحالي و`LibraryValidator.validateDocument` دون إضافة مفاتيح جديدة داخل وثيقة `LibraryDocument`.
- أنشئ علاقة أصل خاصة immutable في `library_quarantine_catalog_handoffs/<receiptId>` تشمل `schemaVersion`, `receiptId`, `documentId`, `sourceRevision`, `caseRevision`, `sourceSha256` **داخل الخادم فقط**، `createdBy`, `createdAt`، مع تثبيت معلومات النسخة. أنشئ حدث إثبات أولي append-only واحدًا `library_quarantine_catalog_handoff_events/<receiptId>` في نفس المعاملة. لا يخرج SHA أو UID أو مسار التخزين في DTO.
- `LibraryDocument`: `workflowState = Draft`, `rightsStatus = ReviewRequired`, `workflowHistory=[]`, `versions` نسخة أولى **بلا `referenceUrl`**، وعدم نسخ PDF/DOCX أو GCS generation أو signed URL. لا يساوي إنشاء مسودة اعتمـادًا حقوقيًا ولا أمنيًا.

### 3.2 بيانات يُدخلها المراجع صراحة
- لا يكفي `METADATA_RECORDED` لاستنتاج جميع حقول `LibraryDocument`. أنشئ نموذج إدخال إضافي/مدمج يطلب البيانات الناقصة: `titleAr`, `titleEn`, `summaryAr`, `summaryEn`, `documentType`, `organizationId`, `sourceId`, `geographyAr`, `geographyEn`, `publicationDate`, `language`, `topicsAr`, `topicsEn`, `environmentalDomains`, `legalStatusDescriptionAr`, `legalStatusDescriptionEn`؛ يجب التزام الصيغ والمجموعات المعرفة في العقد، ومنع HTML وروابط خاصة ومحتوى تحكم. يمكن اقتراح القيم الموجودة في **سجل المراجعة المحفوظ فقط** للمراجعة البشرية، بلا تخمين/ملء من AI.
- ينبغي أن تكون المؤسسة والمصدر موجودين في `library_organizations` و`library_sources`، و`source.organizationId === organizationId` و`source.verificationStatus === 'Verified'`. لا تُنشئ سجل جهة/مصدر في هذا المسار؛ إن لم توجد مراجع موثوقة، HOLD برسالة واضحة.
- المرجع البشري **يجب أن تكون حالته `METADATA_RECORDED`** مع `sourceEvidenceNotes` صالح غير فارغ؛ `NEEDS_INFORMATION` و`NOT_SUITABLE` و`IN_REVIEW` مرفوضة. يُطلب `expectedCaseRevision` من النسخة التي فتحها المستخدم.

### 3.3 حواجز تفويض وإطلاق
- `request.auth.uid` فقط من Firebase callable SDK، وقراءة `admins/<uid>`؛ فعليًا AdminUser نشط وبشر، Library domain، ولديه **كلتا** صلاحيتي `Review` و`Create`. لا تثق بـ `uid/role/permission/actor` من البيانات.
- عملية `createQuarantineCatalogDraft` وعملية `getQuarantineCatalogHandoff` داخل callable الحالي `manageLibraryDocuments` مع Payload ثابت بلا حقول إضافية، وفشل مغلق قبل أي I/O على حقول انتحال أو Symbol.
- إطلاق خادمي مشروط معًا بـ `POP_LIBRARY_REVIEW_WORKBENCH_ENABLED`, `POP_LIBRARY_HUMAN_CASE_REVIEW_ENABLED`, `POP_LIBRARY_CATALOG_HANDOFF_ENABLED` (قيمة النص `'true'` حرفيًا). إطلاق الواجهة مشروط بمقابلات `VITE_*` الثلاث، كلها معطلة افتراضيًا. لا تعديل `.env`.
- نفّذ `get` للاستعلام اليدوي عن نتيجة ملتبسة `UNKNOWN` بلا إعادة إرسال طلب الإنشاء. لا auto retry مطلقًا.

### 3.4 معاملة واحدة وحماية السباق
- اجلب قراءة مستقلة موثقة للحقول قبل المعاملة إذا لزم لتشكيل النموذج؛ **القرار النهائي** داخل `runTransaction` واحدة فقط تقرأ بنقطة لكل من: receipt, linked review draft, human case, organization, source, target `library_documents/<documentId>`, handoff link, event — كل القراءات قبل أي كتابة. لا collection scans.
- التحقق مجددًا داخل المعاملة من `Quarantined`, receipt revision/digest, draft `PENDING_HUMAN_REVIEW`, case identity/case revision/status/source digest والتزام طابع النسخة. ترفض أي مصدر تغيّر أو خطأ في مخطط/flags.
- في الحالة الجديدة `tx.create` للوثيقة ولرابط الأصل ولحدث التدقيق الذري؛ **لا** `set` أو `update` يُلغي/يستبدل سجلًا سابقًا.
- عند إعادة الطلب: `IDEMPOTENT_EXISTING` فقط إن كانت علاقة الأصل والمستند موجودين ومتطابقين مع نفس receipt/case revision، والمستند لا يزال `Draft`, `ReviewRequired`, وبدون مراجع تخزين أو URLs، وإلا `CONFLICT/HOLD` دون كتابة.
- فشل قبل بدء المعاملة أو قبل جدولة أي كتابة: `NOT_CREATED` مع `documentCreated=false`. استثناء بعد جدولة الكتابة أو فقدان تأكيد commit: `UNKNOWN` مع `documentCreated=null`. لا تُحوّل المجهول إلى `false` أو إعادة تنفيذ تلقائية.
- لا كتابة إلى quarantine receipt/draft/case/events أو GCS أو `library_intake` أو PEIA، ولا رسائل حساسة إلى عميل الويب.

### 3.5 حاجز نشر إلزامي مستقل
- في `LibraryApplicationService`: امنع `create` العام عند تمرير ID محجوز، وامنع `transitionWorkflow`, `updateRights`, و`addVersion` على مستندات `^qcat-[0-9a-f]{32}$` لحين وجود مسار اعتماد سلامة وحقوق مستقل. `updateMetadata` يمكن أن يستمر داخل المسودة دون ترقية الحقوق أو الحالة.
- في `PublicLibraryRepository.listPublicDocuments`: استبعد بنحو مطلق المستندات ذات المعرّف المحجوز **حتى لو ظهر خطأ داخلي جعل workflowState=Published**؛ دفاع مستقل عن حاجز الخدمة.
- **ليس ضمن هذه الحزمة**: فحص سلامة PDF النهائي، تطهير الملف، عرض الملف الثنائي، توليد روابط تنزيل، المراجعة/اعتماد الحقوق، النشر العام، نقل الملفات بين buckets، تشغيل PEIA، المزامنة/النشر التلقائي.

## 4. الواجهة وتجربة الاستخدام
- استعمل نافذة `LibraryQuarantineHumanReviewModal` الحالية: زر إجرائي **واحد فقط** «نقل إلى مسودة المكتبة / Prepare library draft» يظهر بعد تحميل حالة `METADATA_RECORDED` وللدور المخوّل وبعد البوابات. لا تكرر زرًا في جدول إيصالات الحجر أو شاشة أخرى.
- `LibraryQuarantineCatalogHandoffPanel.tsx` نموذج داخلي داخل نافذة المراجعة، وليس Dialog متراكبًا. يستخدم قوائم المؤسسات والمصادر الحقيقية المقدمة من `AdminLibraryManagement`؛ يدعم RTL/LTR وdesktop/tablet/mobile، التركيز واسم الحقل، أخطاء محددة، قفل نقر مزدوج، إبطال الاستجابات عند تغيير المستخدم/إغلاق النافذة.
- عند النجاح، اعرض `documentId` الداخلي وصفة `Draft / Rights Review Required / No Attachment`؛ اسمح بتحديث قائمة الوثائق الإدارية للوصول للمسودة، دون انتقال تلقائي إلى عام/نشر.
- عند `UNKNOWN`: عرض تنبيه ثابت وزر «تحقق من المسودة / Verify draft» يجري `getQuarantineCatalogHandoff` فقط؛ لا ينفذ `create` ثانية. عند `CONFLICT`: اعرض سبب التعارض والنسخة الحالية دون الكتابة فوقها.

## 5. دين اختبار 01C ضمن الحزمة نفسها
الاختبار القديم `scripts/runLibraryQuarantineReviewDraftCallableBridgeTests.ts` يمنع أي ظهور لسلسلة الحروف `'generation'` في JSON حتى عندما تظهر في نص رسالة خطأ عامة آمنة `Generation-pinned`. هذا **إخفاق assertion واسع** وليس دليلًا بذاته على تسريب generation حقيقي.
- عدّل **الاختبار فقط** ليمنع مفاتيح `generation`, `attestedGeneration`, storage paths والقيم السرية الفعلية (الـ sentinel literals موجودة) دون رفض كلمة توضيحية في رسالة ثابتة.
- لا تعدل إنتاج `libraryQuarantineReviewDraftCallableBridge.ts`؛ أبقِ اختبارات sentinel كاملة. أثبت 01C 7/7 PASS بعد التصحيح.

## 6. التحقق وقبول المالك
- Preflight / Postflight Git blob SHA-1 exact، مصفوفة 11 تغيير كحد أقصى مع zero delete والملفات المحمية دون لمس؛ أي اختلاف قبل التعديل => STOP.
- اختبارات Backend للأهلية والصلاحيات والنسخ والحالات والمصدر/المؤسسة، create/idempotent/stale/partial commit/UNKNOWN، readback، منع GCS، منع public publishing حتى لو غيّرت بيانات الاختبار إلى Published، وحماية reserved ID عبر طرق الخدمة العامة.
- اختبارات Client UI تشمل form data، double submit، تحديث Admin documents، AR/EN/RTL/LTR، mobile/tablet/desktop، changed-user/unmount, unavailable flags, UNKNOWN verify-only.
- إعادة تشغيل اختبارات casework/workbench/inbox/01B/01C/upload مع إثبات الأعداد وExit code؛ strict TypeScript, oxlint، `npm run build`, `npm run lint`، و`functions` TypeScript إذا كانت البيئة تدعمها دون تثبيت حزم.
- فحص Google AI Studio GitHub Sync يدويًا: 6 MODIFIED، 5 ADDED، 0 DELETED، 0 surprises. **Build success لا يساوي قبول مرئي أو صحة Sync.**
- يبقى `PENDING_SOURCE_VISUAL_AND_SYNC_REVIEW` إلى حين مراجعة GitHub والمستخدم. **لا Push، PR، merge، deploy، GitHub Actions trigger ولا Firebase CLI** بواسطة Studio.

## 7. مراجع المصدر المثبتة
تمت مراجعة الملفات التالية بموصل GitHub عند commit `f001cdcfca481d7781b43dcd4c70781970388baf`. **روابط raw تُقدَّم لـStudio ليختبر HTTP 200 + body بنفسه؛ لا تفترض أن Studio يستطيع جلبها.**

| مسار يُسمح بتعديله | Git blob SHA-1 الحالي |
|---|---|
| `functions/src/library/libraryAdminHandlers.ts` | `b3d374d5ef388229f9b6e130956bb99fedfa0287` |
| `functions/src/library/libraryApplicationService.ts` | `32b54a8946f3749c18b21ab7f4d0fb4c21b2ebcf` |
| `functions/src/library/publicLibraryRepository.ts` | `fee1a8d1a0809b8b5f248702744b78b905eece8d` |
| `src/components/library/AdminLibraryManagement.tsx` | `bd4dc3a6696d301a6ad65b2b6e2584603f58febd` |
| `src/components/library/LibraryQuarantineHumanReviewModal.tsx` | `068424ad6d984c8f65978db0fdf80cf9a7e684c1` |
| `scripts/runLibraryQuarantineReviewDraftCallableBridgeTests.ts` | `3c32ef07e26604a4e09e421c46979a4cdfdbc067` |

| المسار المحمي (قراءة فقط) | Git blob SHA-1 الحالي |
|---|---|
| `functions/src/library/libraryQuarantineHumanReviewCaseContract.ts` | `8fe5f352736faddd3f95c0a09106a79b7bec5c89` |
| `functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore.ts` | `41eeb81f9d8e903683074dc951b265cd4a54fc47` |
| `functions/src/library/libraryQuarantineHumanReviewService.ts` | `10a04e5bf90c4eb4ade07c21acf2038e86d70d99` |
| `src/services/libraryQuarantineHumanReviewClient.ts` | `f5931e7f3d3b46fd4d4d8aae0876021aef4f0667` |
| `functions/src/library/firestoreLibraryRepository.ts` | `afba4876b6d736424bd0b344df1db9a5e1417327` |
| `functions/src/library/libraryValidator.ts` | `bbe2061b278f9b4f3c296532b767d02acc115f72` |
| `functions/src/shared/libraryContract.ts` | `cfb0849c0418ba7b075f7de49c3debe668adc724` |
| `functions/src/shared/workflowContract.ts` | `f4eabd5c862c90586609f545d8cb9e19867d1ade` |
| `functions/src/index.ts` | `5a14cada5dad8e764f8cc3092f40c386f6b09616` |
| `functions/src/library/libraryQuarantineReviewDraftCallableBridge.ts` | `1edb4f3dbfd58a2ebe0604c3b8412ef47e18b7ee` |
| `src/services/libraryAdminClient.ts` | `bf5804a703614327e76845de4fe1b4c3958920b8` |
| `package.json` | `34cb668d837d342c9b5367461cca2ad9dd8a18e7` |

**حالة الملفات الخمسة الجديدة:** لم تكن موجودة في المرجع المثبت عند الفحص عبر GitHub connector؛ تحقق من غيابها في Studio قبل الإضافة.
