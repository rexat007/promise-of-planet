# 76 — Promise of Planet / LIB-FILE-BINARY-SAFETY-CASE-R1

**نوع الوثيقة:** مواصفة تصحيح مصدر منشور، لا إعادة بناء الوحدة ولا نشر إنتاجي  
**المستودع:** `rexat007/promise-of-planet`  
**Pinned GitHub main:** `932bec96eaa72401c6de1da64a3217fd9f2ca4f0`  
**الأصل:** `LIB-FILE-BINARY-SAFETY-CASE-01` بعد Push مطابق (2 modified + 7 added)، لكن مراجعة الشيفرة المنشورة أظهرت فروقات مع العقد الأصلي 73؛ الحالة `PUSH_VERIFIED / SOURCE_INTEGRITY_REMEDIATION_REQUIRED`.

## 1. الغرض والحقائق المؤكدة من مصدر GitHub

**المطلوب:** تصحيح موضعي متكامل يجعل سجل متابعة السلامة البشرية متسقًا مع سلسلة الحجر والإحالة والمواءمة، ومحميًا بمعاملة Firestore حقيقية ونتائج تحقق قابلة للإثبات. لا تضف أي ماسح AV أو محلل PDF أو CDR ولا تصدر اعتماد سلامة أو رابط ملف.

المواضع التي دُققت مباشرة في commit المثبت:

1. `functions/src/library/libraryQuarantineBinarySafetyCaseService.ts`، الدالة `perform7PointReads` تقرأ receipt/draft/case/handoff/qcat/alignment/safety خارج المعاملة (نحو L185–243)، ثم `saveQuarantineBinarySafetyCase` يشتق قرار الكتابة من تلك القراءة السابقة (نحو L372–514). هذا **ليس** تحققًا ذريًا من السلسلة أثناء الحفظ.
2. `functions/src/library/firestoreLibraryQuarantineBinarySafetyCaseStore.ts`، `saveBinarySafetyCaseAtomic` تقرأ فقط safety case + audit event داخل transaction ثم تنفذ `transaction.set(caseRef, caseRecord)` و`transaction.create(eventRef,eventRecord)` (نحو L63–110). العقد 73 يلزم **8 point reads كلها داخل المعاملة و2 writes create/update فقط، ممنوع tx.set**.
3. `LibraryQuarantinePersistedReceiptEnvelope` في `functions/src/library/firestoreLibraryQuarantineReceiptStore.ts` يحوي `{schemaVersion, revision, state, receipt}`؛ `LibraryQuarantineInternalReceipt` يحوي `format`, `updatedAt`, `sha256`, `deepInspectionStatus`, `state`, وأعلام الحماية. الخدمة الحالية تستعمل `envelope.updatedAt`, `envelope.sha256`, و`envelope.receipt.sourceFormat`، وهي ليست حقولًا بهذا العقد؛ الصحيح مقروء من `envelope.receipt` باستخدام المدققات الرسمية، وعدم استخدام `unknown` كقيمة بديلة للتنسيق.
4. الدالة تتجاهل فعليًا `acknowledgedHumanCaseRevision` الممررة عبر `libraryAdminHandlers.ts`. كما تثبت `catalogUpdatedAt` على `handoff.createdAt` بدل المسودة الفعلية بعد المواءمة. لا توجد إعادة تحقق صارمة من sourceSha256 والنسخة البشرية الفعالة والتواريخ و`Draft / ReviewRequired` قبل كل كتابة.
5. الحدث يسجل `eventId = bs-evt-<receiptId>-<revision>-<Date.now()>` مع أن مسار Firestore هو `<receiptId>_<revision>`؛ يجب حتمية هوية الحدث، ووجوده يُفحص قبل الكتابة، مع validation وفحص provenance وappend-only.
6. `libraryQuarantineBinarySafetyCaseContract.ts` يحقق مدخلات المحرر لكنه لا يقدّم تحققًا صارمًا لكل سجل persisted/event؛ يقرأ store بيانات خامًا `as` دون التثبت من مفاتيح أو حقول قد تسرّب أسرارًا/تغيّر flags.
7. `scripts/runLibraryQuarantineBinarySafetyCaseBackendTests.ts` فيه 3 اختبارات فقط، مع mock `transaction.set/create` لا يثبتان الكتابة؛ وبذرة receipt وهمية تضيف حقولًا خارج عقد envelope الحقيقي. لذلك نجاح 3/3 لا يثبت الضمانات الأصلية. بعض مخرجات العميل تُقبل بلا whitelist/strict DTO validation، والواجهة قد تعيد تعبئة evidence قديمة أو تسمح بحفظ دون إقرار نسخة أو مع تعديلات غير محفوظة في سجل المراجعة.

**تنبيه:** هذه النتائج مبنية على قراءة المصدر؛ لم تُشغّل الاختبارات أو Firebase إنتاجيًا بصورة مستقلة. لا تدّعِ أن كل هذه الأخطاء ظهرت في تشغيل فعلي؛ هي مخالفات source-contract قابلة للفحص.

## 2. نطاق التعديل المسموح — ثمانية ملفات فقط، جميعها MODIFY

1. `functions/src/library/libraryQuarantineBinarySafetyCaseContract.ts`
2. `functions/src/library/firestoreLibraryQuarantineBinarySafetyCaseStore.ts`
3. `functions/src/library/libraryQuarantineBinarySafetyCaseService.ts`
4. `src/services/libraryQuarantineBinarySafetyCaseClient.ts`
5. `src/components/library/LibraryQuarantineBinarySafetyCasePanel.tsx`
6. `src/components/library/LibraryQuarantineHumanReviewModal.tsx`
7. `scripts/runLibraryQuarantineBinarySafetyCaseBackendTests.ts`
8. `scripts/runLibraryQuarantineBinarySafetyCaseClientTests.ts`

**0 ADD / 0 DELETE.** `functions/src/library/libraryAdminHandlers.ts` **READ ONLY**؛ يمرر حقل acknowledgement بالفعل ويملك Release Gate، لا توسّع النطاق إذا تبين خطأ يتطلب تعديله: **STOP** بمبرر دقيق وطلب قرار مستقل. كذلك كل الملفات التي لا تظهر في القائمة محمية، بما فيها `LibraryApplicationService`, `index.ts`, `firebase.*`, `.env*`, lockfiles, `public/assets/aistudio/` وFirestore rules. لا Push/Deploy/Feature flags تلقائيًا.

## 3. العقود المطلوبة

### 3.1 تحققات المصدر والتخزين

- GET: قراءة **7 point documents كحد أعلى** (receipt envelope, review draft, human review case, handoff, qcat document, catalog alignment overlay, binary safety record) **دون queries أو GCS أو كتابة**، مع استبعاد غير المخوّل قبل الوصول إلى بيانات المكتبة. استخدم المدققات الصارمة **الموجودة بالفعل** لسجلات المصدر ولا تنسخ شروطها بعشوائية.
- Persisted safety case/event: `schemaVersion`, `receiptId`, `documentId=qcat-<receiptId>`, `sourceRevision`, `sourceUpdatedAt=receipt.updatedAt`, `sourceSha256=receipt.sha256` (private فقط), `sourceFormat=receipt.format (PDF|DOCX)`, `deepInspectionStatus=receipt.deepInspectionStatus`, `effectiveHumanCaseRevision/UpdatedAt` من حالة case+alignment الفعالة، `catalogUpdatedAt=qcat.updatedAt`، `revision` موجب، timestamps monotonic، actor موثوق، صلاحية Owner+Review+active من الخادم، `disposition` الثلاثة فقط، نصوص مدققة، وأعلام posture الخمسة **false**. لا `storagePath`, `generation`, URL, raw binary, `receipt` raw في DTO.
- لا تقبل `case.status != METADATA_RECORDED`، receipt ليست `Quarantined`، source/draft/handoff provenance متعارضًا، qcat ليست `Draft + ReviewRequired` أو تحمل `referenceUrl`، alignment overlay مخالفة/متقادمة. إن كان case أحدث من overlay، **HOLD** حتى تكتمل مواءمة case؛ لا تصدر دليلًا للنسخة السابقة باعتباره current.
- إذا أظهر readback سجلًا سابقًا مع نسخة case أو timestamp أو qcat مختلفة: `STALE` تاريخيًا فقط؛ تجديد الأدلة قرار مستقل مع `acknowledgedHumanCaseRevision == effectiveHumanCaseRevision`. لا نسخ آلي للنصوص القديمة إلى الإدخال الجديد، ولا overwrite لسجل التاريخ. لا تقبل invalid persisted أو unknown keys بصمت.
- event ID deterministic: `<receiptId>_<revision>`، `tx.create` حتمًا، مع تدقيق مطابق للمسار، وحقول المصدر/التوقيت/الممثل والنسخة وحالة false. أحداث audit لا تُعدَّل.

### 3.2 Transaction + UNKNOWN

- SAVE: **8 reads all inside one transaction**: السبع السابقة + event slot، وكل `tx.get` قبل أول write، ثم **2 writes بالضبط**: `tx.create` عند إنشاء safety record أو `tx.update` عند التجديد، وبعدها `tx.create` للحدث. لا `tx.set`, لا خارج المسارات الاثنين. CAS على expectedRevision + إقرار نسخة بشرية صحيحة + attested current chain؛ تحقق من الحقيقة داخل callback نفسه لا من outside snapshots. إن كان Firestore callback يعاد تلقائيًا، أعد القراءة والتحقق في كل محاولة.
- Track `writeStagedInAnyAttempt` **خارج** callback، مع تفعيل تحفظي قبيل أول write؛ بعد احتمالية كتابة غامضة وإخفاق، أعد `UNKNOWN/caseSaved:null` ولا `NOT_SAVED`. في `HOLD` أو `CONFLICT` قبل أي write، لا تستخدم UNKNOWN لمجرد فتح transaction أو تحميل store. لا تُسرّب رسائل SDK أو SHA أو paths إلى HTTP/UI.
- no-op/duplicate: CAS conflict أو idempotent readback آمن دون إنشاء أحداث مكررة، والحسم بنمط GET-only عند UNKNOWN؛ ممنوع auto retry من العميل. لا تستبدل أو تعيد فتح قرار حقوق CATALOG_METADATA_ONLY ولا تغيّر `qcat` أو receipt أو أي flags.

### 3.3 Client/UI

- Strict DTO validators للـGET وSAVE: رفض unexpected keys/symbols، مدخلات مزورة، بيانات file/secret، أعلام true، timestamps/revisions مغلوطة، أو response مشوّه. التحقق من readonly readiness `NOT_VERIFIED/NOT_PERFORMED/BLOCKED/Draft`، ومدخلات الرسائل بعد sanitization.
- في Modal مرر `receiptId` والنسخة/حالة التعديلات غير المحفوظة الموثوقة؛ اربط controller بجلسة `receiptId` جديدة عند تغيّر الإيصال (مثلاً React `key`) لمنع تسرب حالة سجل بين سجلين. لا يحفظ Binary Safety Panel في حالة unsaved human-case edits أو stale case أو `UNKNOWN`, حتى GET-only verify؛ أضف checkbox إقرار النسخة الحالية لعمليات إنشاء وتجديد الأدلة (لا تسمح بتجاوزها ببيانات caller). لا تعبئة تلقائية من evidence stale. ONE primary save button. عربية/إنجليزية، RTL/LTR، dark/light، responsive.
- Release Gates الأربع Default OFF وبداية التنفيذ الخادمي قبل Auth/Firestore/GCS. Owner فقط وفق `AdminRole.Owner + Review + isActive`; لا تعدل صلاحيات النظام الأخرى. ممنوع AV/CDR/signed URL/source access/publication/PEIA readiness.

## 4. الاختبارات ومعايير القبول

**الخادم:** استبدل mock غير الكافي بنموذج transaction يطبّق staging والـcommit atomically، ويكشف الكتابة قبل اكتمال جميع القراءات، ويسمح باختبارات retries/CAS/concurrent source drift، ويخزن records/events فعليًا في الذاكرة. استخدم بيانات seed مطابقة **للعقود الموثقة** لا حقولًا وهمية في envelope. الاختبارات الدنيا:

- Gates OFF → 0 AdminRepo/Firestore reads؛ Owner active Review يمر، غير Owner/AI/inactive أو token spoof يرفض.
- GET سبع قراءات point فقط، بيانات sanitized لا تحمل SHA/path/generation/URL.
- SAVE ثماني قراءات داخل callback قبل الكتابة، 2 create/update writes فقط، no set؛ إنشاء/تحديث 0→1→2 مع حدثين deterministic append-only وCAS صحيح.
- Drift بعد قراءة أولية لكن قبل transaction (receipt sha/revision/time, human case, qcat.updatedAt, overlay), source/receipt/quarantine mismatch، payload tampering، مخزن تالف، event collision، stale evidence → HOLD أو CONFLICT مع 0 writes.
- Unknown after staging including transaction retry with a later pre-write failure، no auto-retry by client؛ verify by GET only.
- `sourceFormat` PDF وDOCX الحقيقيان؛ zero mutation إلى qcat/rights/receipt/PEIA؛ public qcat remains hidden. No files or SDK auth secrets leaked.

**العميل والواجهة:** strict DTO validation، Owner only، four flags, controlled receipt switching, dirty-case lock, explicit case acknowledgement, fresh evidence after stale case, conflict, UNKNOWN verify-only, no duplicate submits, AR/EN render without URL; maintain prior tests and 11/11 upload component regression.

**تشغيل مستهدف:**

```text
npx --no-install tsx scripts/runLibraryQuarantineBinarySafetyCaseBackendTests.ts
npx --no-install tsx scripts/runLibraryQuarantineBinarySafetyCaseClientTests.ts
npx --no-install tsx scripts/runLibraryQuarantineCatalogCaseAlignmentBackendTests.ts
npx --no-install tsx scripts/runLibraryQuarantineCatalogCaseAlignmentClientTests.ts
npx --no-install tsx scripts/runLibraryQuarantineRightsDecisionBackendTests.ts
npx --no-install tsx scripts/runLibraryQuarantineRightsDecisionClientTests.ts
npx --no-install vitest run src/components/library/LibraryQuarantineUploadIntegration.test.tsx
npx --no-install tsc --noEmit
```

ثم build/compile_applet/lint_applet المتاحة بلا تثبيت. فرق TypeScript baseline السابق `TS6133` في `libraryApplicationService.ts` (الأسماء الأصلية actor) **دين قائم بحدود الإثبات**؛ اذكره منفصلًا ولا تعدّل الملف خارج القائمة لإخفائه. إن ظهرت أخطاء جديدة في ملفات الوحدة => BLOCK. لا تدّعِ نجاح build إذا exit !=0. يلزم GitHub Sync **8 Modified بالضبط، 0 Added/Deleted، لا ملفات إضافية**، قبول بصري من المالك لاحقًا، ثم Push يدوي فقط بعد قرار قبول.

## 5. Manifest المصدر: GitHub ref ثابت (مراجعة محلية وHTTPS)

الملفات الـ8 المسموح تعديلها عند بداية الوحدة يجب أن تطابق بصمات Git blob SHA-1 التالية في GitHub وألا يوجد عليها تعديل محلي سابق غير مفحوص؛ أي اختلاف => STOP. التفاصيل وروابط كل ملف في البرومبت 77.

| المسار | blob SHA-1 قبل التنفيذ |
|---|---|
| `functions/src/library/libraryQuarantineBinarySafetyCaseContract.ts` | `af8ea2bdb53d36b12b1f067cfd879e8eb951410d` |
| `functions/src/library/firestoreLibraryQuarantineBinarySafetyCaseStore.ts` | `41afdb2e373e4ac4cc6847afd388a8413d0744a9` |
| `functions/src/library/libraryQuarantineBinarySafetyCaseService.ts` | `ec883c0987409e54cea5f879f2d714255785a626` |
| `src/services/libraryQuarantineBinarySafetyCaseClient.ts` | `63b92ebb88f6b2bf470fd132ec9395005724ca0b` |
| `src/components/library/LibraryQuarantineBinarySafetyCasePanel.tsx` | `3b94b54ea768f2ab9141d12a33c23da28ac17f09` |
| `src/components/library/LibraryQuarantineHumanReviewModal.tsx` | `283b3db6f361d19d78e2fccfc214a246af7a58d0` |
| `scripts/runLibraryQuarantineBinarySafetyCaseBackendTests.ts` | `8cf829dbe459adbca7e1727ddaef570ce41e5d83` |
| `scripts/runLibraryQuarantineBinarySafetyCaseClientTests.ts` | `ac583f7367b2f832eda25376e3c82c8b604bce79` |

**استئناف عند نفاد حصة Studio:** أخرج في نفس الجلسة `LOCAL_RESUME_CHECKPOINT` من دون إنشاء ملف في المشروع. يذكر أي ملفات عدلت وأين توقفت وآخر اختبار وفشله، والخطوة التالية فقط. عند الاستئناف **لا** تعيد مقارنة الملفات المحلية المعدلة مع SHAs الأصلية لاعتبارها خاطئة، ولا تعيد كتابة العمل المنفذ.
