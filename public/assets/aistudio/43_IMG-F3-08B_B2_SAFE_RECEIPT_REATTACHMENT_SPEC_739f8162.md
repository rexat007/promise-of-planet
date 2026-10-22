# IMG-F3-08B/B2 — Safe Append-only Receipt Reattachment

**STATUS:** `SPECIFIED — NOT IMPLEMENTED — NOT ACCEPTED`; تاريخ 22 أكتوبر 2026.
**Repo:** `rexat007/promise-of-planet`؛ pinned baseline `3d96cf912cfc8ba61dd17f8b2edcedf393fa3c48`.
**Parent:** `d53c2119d919d5e1b95536e15f2c177f45832653`. **Last accepted unit:** IMG-F3-08B/B1 READ_ONLY.

## الهدف المرتبط بالإطلاق
إعادة إلحاق إيصال GCS مفقود لكائن image مملوك/صحيح في جلسة Firestore نشطة بطريقة *append-only CAS*؛ لا تنظيف ولا حذف للملف، ولا استدعاء UI/endpoint. الهدف هو تقليص نافذة orphan دون خطر فقد صورة صحيحة، وبعدها نقيس أثره على مسار رفع الأخبار.

## مصدر الحقيقة وعقود الشيفرة
- `functions/src/news/editorialBinaryIntakeService.ts` SHA blob `61c13c7878112a6a0cd075df094478449c97d5b2`: `IntakeSessionStore.updateSession(session, expectedRevision)`، و`TrackedIntakeStorageObject`، statuses.
- `functions/src/news/firestoreEditorialBinaryIntakeSessionStore.ts` `027efedf05779e1758b55793c2f2302b511cb4fb`: transaction revision CAS مع invariant immutable fields.
- `functions/src/news/gcsEditorialBinaryStorageAdapter.ts` `4bc2c40dd72c4bd3d8c09b349958db7a8e291e9e`: `readMetadata`; لا calls للحذف في B2.
- `functions/src/news/editorialUntrackedImageObjectDiscovery.ts` `69db080f657b7d142483ca5e37035fcfad0fd6e2`: bounded 18 candidate paths / strict ownership / conflicts.
- `functions/src/news/editorialImageReceiptRecoveryReadback.ts` `7346015df16461f881f3f8c5907ad93d12f4a7e4`: `inspectEditorialImageReceiptRecovery` read-only classification؛ **ليست إذن تعديل**.
- `functions/src/news/editorialImageAssetRepository.ts` `e83b6bd42c00558b0d8c2147f8d17e64a7e1a965`: `getById` للـcanonical registry؛ حالات FOUND/NOT_FOUND، أخطاء القراءة HOLD.

## نطاق تعديل Studio في هذه الخطوة (ملفان جديدان فقط)
1. `functions/src/news/editorialImageReceiptReattachment.ts` (CREATE).
2. `functions/src/news/editorialImageReceiptReattachment.test.ts` (CREATE).

**كل ملف موجود READ ONLY.** لا تعديلات على العقود/الأصول المقبولة، packages/locks، Firebase rules/index/endpoint/UI/Actions أو docs. فشل أي preflight SHA أو حاجة lease/contract/تعديل status خارج الملفين → STOP.

## بروتوكول reattachment الوحيد المسموح
1. لا تعامل readback B1 القديم كمصدر قابل للتطبيق؛ ابدأ readback **fresh** داخل الاستدعاء، واسمح بالمتابعة فقط إذا `classification === CANONICAL_ABSENT_RECEIPT_REATTACHMENT_CANDIDATE` و`hasConflicts === false` و`canonicalStatus === NOT_FOUND`.
2. **Whitelist الحالات**: `Created` (quarantine only)، `Quarantined` و`PreliminarilyVerified` (quarantine only)، `Promoting` (quarantine أو private). امتنع عن حالات التسجيل/الاسترداد الغامض/المراجعة أو terminal (`Registering`, `Registered`, `NeedsReconciliation`, `CleanupPending`, `Completed`, `Failed`) لإزالة حاجة lease/design خارج النطاق. عدم توافق نوع الكائن مع الحالة = `HOLD`.
3. إقرأ جلسة Firestore حديثًا، وإعادة `getById` للأصل؛ يجب استمرار NOT_FOUND. افحص revision/status/identity وrequestFingerprint وكامل tracked receipt lists وflags مقارنة مع snapshot المقروء في B1. أي mismatch أو READ_ERROR => HOLD، لا كتابة.
4. لكل untracked candidate بحد أقصى 18 أعد `readMetadata(candidatePath)` مباشرة؛ تحقق من وجود الكائن وبصمة SHA256 والحجم وMIME وetag والـgeneration وownership/assetId/intakeId/uploaderUid والـnamespace والمسار exact match. التغيّر => HOLD. **لا readBytes أو bucket listing.** العدد الإجمالي المتوقع ≤36 metadata queries (18 discovery + ≤18 fresh verify)؛ العدد مقصود ومعلن، لا توهم أنه 18 في B2.
5. ابن receipts من metadata الحية وحدها، دون الاعتماد على مسار caller؛ ألحقها بالقائمة المناسبة مرة واحدة، دون تعديل أي حقل آخر سوى `updatedAt` والـrevision التي يولدها Store CAS. لا تغير `status`, `canonicalRegistration*`, `registrationOutcomeUnknown`, `pendingCleanupObjects`, `lastError`, `rights`, `asset record`, `public URL`.
6. استخدم `updateSession(next, expectedRevision)` مرة واحدة على الأكثر، بنمط Firestore transaction CAS. إذا تغيّر revision بين الفحص والكتابة، فـ`STORAGE_CONFLICT`/`HOLD` بدون retry تلقائي أو قفز مرحلة. إذا فشل التحويل/الفحص لا تكتب شيئًا.
7. idempotency: إذا أعاد B1 الحالة `NO_OWNED_UNTRACKED_OBJECTS` بعد crash وقع عقب نجاح CAS وقبل استلام الرد، يجوز نتيجة `NO_OP_ALREADY_TRACKED` **فقط إذا كانت هناك receipts موجودة بالفعل وكانت metadata حيّة (المسار والـgeneration والملكية وSHA/etag/الحجم/MIME) مطابقة لجميع الإيصالات محل الطلب بعد القراءة الجديدة، وكانت canonical NOT_FOUND ولا توجد conflicts وتطابقت snapshot الجلسة**. عدم العثور على orphan وحده لا يثبت وصول أي receipt، ولا يُسمّى نجاحًا. بخلاف ذلك HOLD أو `NO_ACTIONABLE_RECEIPT`، بلا كتابة أو افتراض. لا تعيد استدعاء reconciliation ذات الحذف في هذه الوحدة.
8. امتنع صراحة عن GCS delete، Storage writes، canonical asset registration، right-approval/public delivery، أو status transition. لا تُسمِّ نجاح append-only أنه `CRASH_GAP_CLOSED` بالكامل.

## شروط السلامة
- قد يكتب عامل آخر إلى GCS بينما يتم التحقق؛ إذا حل محل object الجيل لاحقًا، تبقى الحماية المستقبلية بشرط generation ولا يُسمح للحذف هنا. لا تدّعِ crash-free end-to-end.
- لا تسرب paths أو byte content إلى واجهة عامة، ولا تسجّل private binary أو metadata سرية في logs. إدخال المستخدم لا يحدد object path.
- `NO_OP` ليس نجاحًا إذا فقدت المجموعة إحدى المشتقات أو تغيّرت metadata. الحالة القابلة للتصحيح تُسجل لتقييم لاحق، لا تنظيف.

## اختبارات B2 الإجبارية
- فقد إيصال quarantine وprivate في الحالات المسموحة؛ CAS revision+1، حفظ immutable fields وstatus، no deletion.
- idempotency repeated invocation وno-op for verified already-tracked؛ no duplicate lists.
- canonical FOUND / NOT_FOUND / READ_ERROR / transition between reads → correct HOLD.
- terminal Failed/Completed أو Registering/Registered/NeedsReconciliation/CleanupPending → HOLD.
- GCS metadata altered between discovery and last verification، foreign owner، namespace/sha/size/generation/etag mismatches → HOLD.
- conflicting duplicate tracked receipts، already-tracked same path different gen، CAS race/failure/worker crash before CAS → zero unsafe writes.
- إن حصل crash بعد CAS قبل reply، يعيد invocation no-op صحيح دون duplicate.
- آلية رقمية تثبت ≤36 metadata reads، مرة واحدة على الأكثر `updateSession`، 0 GCS delete و0 Firestore asset registration، zero private byte reads.
- Tests old nine suites (**180 reported**) + new tests، isolated strict TypeScript؛ full-build status مفصول لو بقي baseline errors.

## بوابة القرار والنشر
- التقرير النهائي: preflight/allowlist وGit blob SHA وcounts/exit codes، zero unintended changes، remaining blockers. لا Git CLI ولا `npm install` ولا Firebase CLI، لا Push/Deploy من Studio.
- لا ينتقل إلى mutation ثانية أو cleanup قبل مراجعة المستخدم لـGitHub Sync والمصدر وقبول صريح.
- **هذا design لا يطلب من Studio جلب GitHub**؛ إذا فشل فحص البصمات داخل Studio STOP دون كتابة، ولا تفترض أن رابط مسار نسبي يعمل.

**Outcome المتوقع:** `IMG-F3-08B_B2_APPEND_ONLY_RECEIPT_IMPLEMENTED_PENDING_REVIEW` أو `STOP_REQUIRES_DESIGN_DECISION`.
