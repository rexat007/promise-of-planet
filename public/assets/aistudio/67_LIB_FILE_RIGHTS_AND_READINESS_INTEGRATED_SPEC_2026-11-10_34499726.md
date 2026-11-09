# وعد الكوكب — LIB-FILE-RIGHTS-AND-READINESS-01
## مواصفة حزمة متكاملة: قرار المراجعة الحقوقية البشرية، دفتر الأدلة، ومؤشرات جاهزية المكتبة الداخلية

**التاريخ:** 2026-11-10  
**Repository:** `rexat007/promise-of-planet`  
**PINNED_GITHUB_BASELINE:** `c7233fc18d6c6fe55e1016e657e14e0782e939de`  
**الحالة:** SPEC — NOT_IMPLEMENTED. لا Push أو نشر أو تفعيل بيئة مخوّل.  
**الحزمة السابقة:** `LIB-FILE-CATALOG-HANDOFF-01`, GitHub Push SHA `c7233fc...`, source-reviewed and closed; تظل المراجعة البصرية/الحية مستقلة.

## 1. النتيجة الوظيفية المطلوبة

بدل إنشاء خدمة أو زرين منفصلين، نفذ مسارًا متكاملًا داخل الإدارة: بعد إنشاء `qcat-<receiptId>` من المراجعة البشرية، يستطيع **مراجع الحقوق** المخوّل فتح قسم واحد داخل نافذة مراجعة الملف المحجور الحالية، وفحص معلومات المصدر، وإدخال الأدلة الحقوقية والقرار المحدد النطاق، ثم حفظ/تعديل القرار خادميًا بتضارب نسخة مضبوط، مع حدث تدقيق غير قابل للاستبدال، وقراءة حالته بعد كل حفظ.

يرى المحرر والمالك **مؤشر جاهزية واضح**: هل اكتملت أدلة الحقوق على مستوى البيانات الوصفية؟ هل الملف الثنائي آمن؟ هل يجوز نشره؟ الجواب الأخير يظل **لا** في هذه الحزمة، ويُعرض مانع واضح بدل أن يوحي النظام بأن اكتمال الحقوق يعني اعتماد الملف.

**حقائق المصدر التي تحكم التنفيذ:**
- `qcat-` مسودة `LibraryDocument` داخلية فقط: `Draft`, `ReviewRequired`, بلا `referenceUrl`؛ حماية مستقلة في `LibraryApplicationService` و`PublicLibraryRepository`.
- `LibraryCurator` في `ROLE_PERMISSIONS_MAP` يملك `Review` ولا يملك `ManageRights`؛ `RightsReviewer` يملك `Review + ManageRights` ولا يملك `Create`. لذلك لا تضع واجهة الحقوق داخل مكوّن لا يصل إليه إلا أصحاب `Create`.
- أحدث نسخة من ملف المراجعة البشرية قابلة للتغيير مستقلًا عن handoff؛ القرار الحقوقي **لا يعتمد ضمنيًا** نسخًا متعارضة ولا يغيّر handoff أو المستند. عند اختلاف مراجعة المصدر الحالية عن النسخة المرتبطة بالفهرس، أظهر `SOURCE_CASE_VERSION_DRIFT_HOLD` مع تعليمات إعادة المواءمة البشرية مستقبلًا؛ لا استرجاع ولا إعادة ربط تخميني.
- لا توجد في المصدر المثبت منظومة موثقة لتطهير PDF/DOCX أو اعتماد سلامة ثنائية. لا تخلق ضمان سلامة وهميًا؛ لا تعيد تعريف `isVerifiedSafe` أو `isSanitized`، ولا تستخدم نتيجة GCS metadata لإثبات سلامة محتوى ملف.

## 2. قائمة السماح — حزمة واحدة (10 ملفات برمجية)

**MODIFY (3):**
1. `functions/src/library/libraryAdminHandlers.ts` — عمليتا `getQuarantineRightsDecision` و`saveQuarantineRightsDecision` داخل callable القائم، بوابات الإطلاق وصلاحيات ManageRights.
2. `src/components/library/LibraryQuarantineHumanReviewModal.tsx` — لوحة الحقوق inline مستقلة عن CatalogHandoffPanel، لا نافذة متراكبة.
3. `scripts/runLibraryQuarantineReviewDraftCallableBridgeTests.ts` — تشديد assertion التسرب السابق ليشمل مفاتيح `generation`, `attestedGeneration`, `gcsGeneration`, `objectGeneration`, `metageneration` واسماء سرية مع إبقاء النص التفسيري `Generation-pinned` مسموحًا؛ بلا تعديل production لملف 01C.

**ADD (7):**
4. `functions/src/library/libraryQuarantineRightsDecisionContract.ts`
5. `functions/src/library/firestoreLibraryQuarantineRightsDecisionStore.ts`
6. `functions/src/library/libraryQuarantineRightsDecisionService.ts`
7. `src/services/libraryQuarantineRightsDecisionClient.ts`
8. `src/components/library/LibraryQuarantineRightsDecisionPanel.tsx`
9. `scripts/runLibraryQuarantineRightsDecisionBackendTests.ts`
10. `scripts/runLibraryQuarantineRightsDecisionClientTests.ts`

**READ ONLY:** `functions/src/library/libraryQuarantineCatalogHandoffService.ts`, `functions/src/library/libraryApplicationService.ts`, `functions/src/library/publicLibraryRepository.ts`, `functions/src/library/libraryQuarantineHumanReviewCaseContract.ts`, `functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore.ts`, `functions/src/library/libraryQuarantineHumanReviewService.ts`, `functions/src/library/libraryQuarantineReviewDraftCallableBridge.ts`, `src/services/libraryQuarantineCatalogHandoffClient.ts`, `src/components/library/LibraryQuarantineCatalogHandoffPanel.tsx`, `src/components/library/AdminLibraryManagement.tsx`, `functions/src/shared/adminContract.ts`, `functions/src/shared/libraryContract.ts`, `functions/src/index.ts`, `package.json`, `functions/package.json`, `src/services/firebase.ts`, وسائر الملفات غير المذكورة في قائمة السماح. لا حذف/تغيير مسار/تثبيت/نقل جماعي/تنظيف مجلدات.

إذا احتاج التنفيذ تغيير ملف محمي لسبب موثق، **STOP** وقدّم المانع والمقترح؛ لا تتجاوز قائمة السماح.

## 3. العقود والتخزين (لا اختلاق حقوق ولا ارتقاء لحالة النشر)

### 3.1 نطاق القرار

`rightsScope = 'CATALOG_METADATA_ONLY'` ثابت وغير قابل لتغييره بالعميل. الحالات المستقلة:
- `EVIDENCE_PENDING`: دليل غير مكتمل.
- `PERMISSION_REQUIRED`: يلزم تصريح أو مستند.
- `METADATA_USE_CLEARED`: مراجع حقوق بشرية مخوّل فحص أدلة موثقة وسمح **بالبيانات الوصفية فقط**؛ لا يعني السماح بتوزيع ملف PDF/DOCX.
- `RESTRICTED`: مقيد.
- `NOT_PERMITTED`: غير مسموح في هذا النطاق.

مدخلات بشرية plain text فقط: `decision`, `basis` (قيمة حصرية موثقة مثل `OFFICIAL_RECORD | OPEN_LICENSE | EXPLICIT_PERMISSION_METADATA | PUBLIC_DOMAIN | INTERNAL_ONLY | UNDETERMINED`), `evidenceReference` (مرجع/رقم تصريح/اسم الجهة دون روابط سرية), `evidenceNotes`, `reviewNotes`. حدود طول وتطبيع صارمة؛ لا HTML، لا تحكم اتجاه مخفي، لا `gs://`, storage paths, `javascript:`, `data:` أو رموز/حقول إضافية. قرار `METADATA_USE_CLEARED` يحتاج أساسًا غير `UNDETERMINED` ودليلًا نصيًا مرجعيًا وملاحظات تشرح نطاق الاستخدام بصورة قابلة للتحقق، لا مجرد نقرة قبول؛ إذا لم يتوافر ذلك `HOLD`.

### 3.2 وثائق Firestore (معرّف واحد لكل receipt)

- `library_quarantine_rights_decisions/<receiptId>` سجل حاضر وحيد مع `schemaVersion`, `receiptId`, `documentId = qcat-<receiptId>`, `revision` (بدءًا من 1), `sourceRevision`, `sourceUpdatedAt`, `sourceSha256` **داخلي فقط**, `draftSourceRevision`, `catalogHandoffCaseRevision`, `currentHumanCaseRevision`, `rightsScope`, `decision`, `basis`, `evidenceReference`, `evidenceNotes`, `reviewNotes`, `createdBy`, `createdAt`, `updatedBy`, `updatedAt`; الخمس flags الأمنية جميعها false عند استخدامها.
- `library_quarantine_rights_decision_events/<receiptId>_<revision>` حدث append-only لكل حفظ، `CREATED | UPDATED`، actor server-derived، previousRevision، والبيانات المرجعية/decision، مع validation. لا overwrite.
- DTO إداري strict sanitized: لا `sourceSha256`, `createdBy`, `updatedBy`, actorUid, bucket, generation, storagePath, referenceUrl, signedUrl, downloadToken أو raw bytes. لا تنسخ عقد Firestore الخام إلى العميل.
- `get` يعيد `READY` وسجل الحقوق المنقّح أو `null` + `currentRevision: 0`، وحالة مؤشرات ثابتة `binarySafety: 'NOT_VERIFIED'`, `fileSanitization: 'NOT_PERFORMED'`, `publication: 'BLOCKED'`, `catalogWorkflow: 'Draft'`; `HOLD` إذا المصدر غير موثوق أو غير مرتبط.
- `save` يعيد `SAVED | CONFLICT | HOLD | UNKNOWN`, وفي `UNKNOWN` قيمة `decisionSaved: null`؛ لا `false` تخميني أو إعادة تلقائية. عند CONFLICT يعيد latest sanitized decision/revision بدون overwrite.

### 3.3 التأهيل الخادمي ومعاملة واحدة

تحقق من `request.auth.uid` من Firebase SDK وحده، اقرأ `admins/<uid>` على الخادم فقط، `isActive` وhuman not AI/automation، domain Library أو RightsReviewer، و`AdminPermission.ManageRights` **و** `AdminPermission.Review` فعليتان؛ Owner/RightsReviewer مسموحان إذا تحققت الصلاحيات، LibraryCurator غير مسموح دون ManageRights (لا تخلط دور الناشر مع مراجع الحقوق).

قبل أي I/O ضَع release gates الخادمية الأربعة بالحرف `'true'`:
- `POP_LIBRARY_REVIEW_WORKBENCH_ENABLED`
- `POP_LIBRARY_HUMAN_CASE_REVIEW_ENABLED`
- `POP_LIBRARY_CATALOG_HANDOFF_ENABLED`
- `POP_LIBRARY_RIGHTS_DECISION_ENABLED` (الجديد)

فشل أي gate = `RIGHTS_DECISION_NOT_RELEASED`, قبل القراءة/الكتابة. الـClient gates تناظرها `VITE_*` الأربعة، كلها disabled افتراضيًا، دون تعديل `.env`.

عند القراءة/القرار: اجلب docs **بنقطة فقط**: receipt, review draft, current human review case, catalog handoff, qcat document, current rights decision؛ وعند الحفظ target audit event أيضًا. لا collection scans. تأكد من invariants بواسطة validators الموجودة `verifyReceiptAndDraftEligibleForHumanReviewCase`, `validatePersistedLibraryQuarantineHumanReviewCase`, `validatePersistedLibraryQuarantineCatalogHandoff`, `validatePersistedCatalogDraftDocument`, ومطابقة receiptId/digest/revision/format، وجود qcat/receipt/handoff والتطابق الكامل. تأكد `Draft + ReviewRequired + no attachment/URL` قبل أي قرار.

**Source version drift:** إن كان `humanCase.revision !== handoff.caseRevision` أو timestamp الهوية الأصلية غير مطابق، **HOLD** ولا قرار/كتابة؛ واجهة توضح أن الحزمة الحالية لا تعيد مواءمة نسخ الفهرس تلقائيًا. لا تطلب من Studio اختراع reconciliation أو تعديل handoff.

`expectedRevision=0` عند الإنشاء، وإلا يساوي السجل الحالي. معاملة واحدة بـ `runTransaction`: جميع قراءات refs قبل أول كتابة، ثم `tx.create` عند الإنشاء أو `tx.update` على **سجل القرار وحده** عند التحديث، و`tx.create` لحدث التدقيق دائمًا. لا `tx.set` ولا كتابة لأي collection خارج الحقوق والأحداث. احتفظ بالقرار القديم عند conflict. فشل قبل staging يؤكد `NOT_SAVED`; فشل بعد staging أو outcome غير مثبت يؤكد `UNKNOWN/null`.

لا تعتبر `METADATA_USE_CLEARED` موافقة على ملف؛ **لا** تعدل `LibraryDocument.rightsStatus`, `workflowState`, `versions`, quarantine flags أو الحاجز في `PublicLibraryRepository`. هذا عمل حقوقي للمعلومات الوصفية فقط. ملفات PDF/DOCX تظل في الحجر الخاص، دون عرض/download أو تحليل ثنائي آلي.

## 4. واجهة متكاملة داخل نافذة المراجعة الحالية

- `LibraryQuarantineRightsDecisionPanel` داخل `LibraryQuarantineHumanReviewModal` مباشرة، **ليس** داخل `LibraryQuarantineCatalogHandoffPanel` لأن RightsReviewer يفتقر إلى Create.
- يفتح تلقائيًا (أو عند زر واحد واضح) بعد أن تكون الحالة الخادمية محفوظة و`METADATA_RECORDED` ومصدر الفهرس موجودًا، للمصرّح بهما Owner / RightsReviewer؛ لا يعرض حقولًا محررة في حالة عدم التأهيل. إن لم يوجد handoff، بيّن «أنشئ مسودة المكتبة أولًا بواسطة المحرر المخوّل»، وليس اقتراح bypass.
- بيانات الحقوق لا تُملأ باستنتاج AI أو من metadata نص غير موثق؛ فقط سجل محفوظ أو إدخال بشر. أظهر حالة `publication: BLOCKED` و`binarySafety: NOT_VERIFIED` حتى بعد القرار الإيجابي. عرض زر حفظ واحد، وقفل double-click، تحديث بعد الحفظ من الخادم؛ `UNKNOWN` يُتيح «تحقق من القرار» get-only دون إعادة save.
- واجهة AR/EN، RTL/LTR، desktop/tablet/mobile، label صحيح، focus، contrast، رسائل HOLD/CONFLICT/UNKNOWN ودلالة واضحة عن حدود القرار.
- لا تكرر navigation/tab ولا تضف modal ثانيًا. لا تغير التصميم العام لأقسام المكتبة ولا الأزرار المنشورة.

## 5. دين اختبار 01C: تقوية فعلية لا تساهل

في `scripts/runLibraryQuarantineReviewDraftCallableBridgeTests.ts`, ابقِ السماح بالنص الآمن `Generation-pinned` فقط، لكن رفض **مفاتيح JSON** `generation`, `attestedGeneration`, `gcsGeneration`, `objectGeneration`, `metageneration` (case-insensitive), وأي `storagePath`, `bucketName`, `signedUrl`, `downloadToken` وغيرها حسب العقد. تحقق بـ fixtures للمفتاح في أي عمق؛ لا تقبل قيم secrets أو تغيّر producer. لا تستخدم `lower.includes('generation')` على كل النص لأن الكلمة في رسالة خطأ ثابتة ليست تسريبًا بذاتها.

## 6. اختبارات القبول

- اختبارات Backend: auth failures/RBAC (RightsReviewer/Owner yes, LibraryCurator without ManageRights no, inactive/AI no), 4 gates fail-closed before I/O, strict input, source/draft/case/handoff/doc consistency, source-version drift HOLD, no public URL or status escalation, 0/1/2 revisions, CAS conflict, audit events atomic append-only, uncertain commit, exact read/write bounds, cross-receipt isolation, raw error redaction, no GCS/network operations.
- اختبارات Client + UI: active rights reviewer despite no Create, hidden for inappropriate role, saved case and qcat prerequisites, bilingual/mobile, no guessed values, proper display of immutable publish/safety blocked indicators, stale get/save isolation, duplicate click, CONFLICT and UNKNOWN verify-only, release flags disabled fallback.
- Regression: Handoff Backend 8/8, Client 6/6, HumanCase 7/7+6/6, Workbench 6/6+5/5, Inbox 7/7, Draft persistence 7/7, 01C 7/7, upload integration 11/11; ensure no new failures or lost tests.
- `npx --no-install tsc --noEmit`, isolated strict TS for new functions, `npx --no-install oxlint` scoped, `npm run build`, `npm run lint`, `functions` TS if supported **without installing**; record exit codes. Build doesn't prove UI.
- Google AI Studio GitHub Sync: **3 MODIFIED + 7 ADDED + 0 DELETED**; no unknown files, no README/doc upload required. Owner visually reviews; owner alone pushes; no Firebase CLI, no GitHub Actions deployment, no Git operation assumptions.

## 7. Pinned-source read-back manifest

GitHub pushed source `c7233fc18d6c6fe55e1016e657e14e0782e939de` was checked independently using GitHub connector. **Every file needed for read/write must be fetched by complete HTTPS URL**, validated HTTP 200, non-HTML, non-empty and `git blob SHA-1` (compute `SHA1('blob '+UTF8_bytes.length+'\0'+raw_bytes)`) before writing. The formula denotes a literal NUL byte, not two characters. `main` URL is mutable; do not substitute it for the pinned SHA.

| Path | Git blob SHA-1 | Role |
|---|---|---|
| `functions/src/library/libraryAdminHandlers.ts` | `9249889967b66efa1acc6a8cf6b4afbf84115629` | MODIFY |
| `src/components/library/LibraryQuarantineHumanReviewModal.tsx` | `47d7c4a715b9d8afa86904c749b8ce6ba17dc8c5` | MODIFY |
| `scripts/runLibraryQuarantineReviewDraftCallableBridgeTests.ts` | `aa8f4cf1162ee967c53bdabd7abc5c8a0a0bd0eb` | MODIFY |
| `functions/src/library/libraryQuarantineCatalogHandoffService.ts` | `79e80cb3b9917ea9c0d3e15e23d5452235751b59` | READ ONLY |
| `functions/src/library/libraryQuarantineHumanReviewCaseContract.ts` | `8fe5f352736faddd3f95c0a09106a79b7bec5c89` | READ ONLY |
| `functions/src/library/firestoreLibraryQuarantineHumanReviewCaseStore.ts` | `41eeb81f9d8e903683074dc951b265cd4a54fc47` | READ ONLY |
| `functions/src/library/libraryQuarantineHumanReviewService.ts` | `10a04e5bf90c4eb4ade07c21acf2038e86d70d99` | READ ONLY |
| `src/services/libraryQuarantineCatalogHandoffClient.ts` | `55a1d359c7b43768a69c7458fb7c2e24c41e929b` | READ ONLY |
| `src/components/library/LibraryQuarantineCatalogHandoffPanel.tsx` | `59f41cfd7c7e5b9227c2a26c65b9972811c12110` | READ ONLY |
| `src/components/library/AdminLibraryManagement.tsx` | `c75aa53829d4185641335de6e1e0780d0d759bd7` | READ ONLY |
| `functions/src/shared/adminContract.ts` | `f895313b46de7f1f55d3d0e1cc1aca4fc9e7391d` | READ ONLY |
| `functions/src/library/libraryApplicationService.ts` | `d9bcfa9db99a334a2743e1171cee9435d3a1559c` | READ ONLY |
| `functions/src/library/publicLibraryRepository.ts` | `c813162307663b6fe37dc84cba9c591193f34f33` | READ ONLY |
| `functions/src/index.ts` | `5a14cada5dad8e764f8cc3092f40c386f6b09616` | READ ONLY |
| `package.json` | `34cb668d837d342c9b5367461cca2ad9dd8a18e7` | READ ONLY |

**Raw URL rule for every manifest row:** `https://raw.githubusercontent.com/rexat007/promise-of-planet/c7233fc18d6c6fe55e1016e657e14e0782e939de/` + exact relative path. The execution prompt embeds the **full direct URL per file** so Studio does not have to infer or concatenate it.

**STOP** if any expected file is absent/mismatched, a newly added name already exists in Studio, an unpushed local change conflicts with baseline, GitHub Sync surprises, permissions/runtime security unsupported, or any test reveals unsafe publication. Stop without speculative restore. Studio changes are the sole authority for local unpushed content; never discard them as if GitHub represented them.
