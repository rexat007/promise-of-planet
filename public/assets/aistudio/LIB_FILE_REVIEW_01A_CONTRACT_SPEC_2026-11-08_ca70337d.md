# LIB-FILE-REVIEW-01A — عقد مرشح مراجعة ملف محجور (PURE, INTERNAL)

**STATUS:** `SPECIFIED / NOT_IMPLEMENTED / NOT_ACCEPTED`. **Pinned remote base:** `4b8c40dedb268c10782cd90a097261af81163481`. **وحدة واحدة صغيرة فقط.**

## المشكلة والهدف
يوجد Inbox إداري read-only لإيصالات الحجر، ولكن نوع `LibraryIntakeRecord` القديم يستعمل URL خارجيًا إلزاميًا ولا يصلح لتمثيل كائن GCS خاص. المطلوب تأسيس **عقد TypeScript نقي، غير متصل بالتخزين أو API أو UI** لإعداد *مرشح* لمراجعة داخلية مرتبطة بإيصال مثبت. **لا يتيح اعتماد الملف أو نشره أو قراءته ثنائيًا**.

## مصدر الحقيقة والمراجع الدقيقة
- `functions/src/library/libraryQuarantineReceiptContract.ts`: `LibraryQuarantineReceiptState`, `SanitizedLibraryQuarantineAdminReceiptDto`، flags posture، Git blob `4b4d5f32e5903def3a3b0dcdecd45e38083f91bb`.
- `functions/src/library/firestoreLibraryQuarantineReceiptStore.ts`: `LibraryQuarantinePersistedReceiptEnvelope`, schema version/revision، Git blob `d9f4114222851c62c25574efbb0ffbeeb5c355e2`.
- `functions/src/library/libraryQuarantineAdminReadService.ts`: admin list sanitized DTO مع revision، Git blob `fc59ce7350c24ee76f5bd0d6b358196ce48ebc45`.
- `functions/src/shared/libraryContract.ts`: `LibraryIntakeRecord`, `SubmitLibraryIntakeInput` URL-based، blob `cfb0849c0418ba7b075f7de49c3debe668adc724`.
- `package.json` SHA `34cb668d837d342c9b5367461cca2ad9dd8a18e7`; test runner precedent `scripts/runLibraryQuarantineAdminReadTests.ts` blob `9d2812b4374f5fb207a872869e2f7dab088e7a8f`.

## قائمة السماح الحصرية — إنشاء ملفين فقط
1. `functions/src/library/libraryQuarantineReviewDraftContract.ts` — CREATE.
2. `scripts/runLibraryQuarantineReviewDraftContractTests.ts` — CREATE.

**كل ما عدا ذلك READ ONLY** بما فيه functions index/handlers/repositories/rules, admin UI, lockfiles, workflow/actions, source specs. لا package install، لا `.git`/Git CLI/remote fetch، لا `bun.lock`/Oxlint، لا Firebase CLI، لا Push/Deploy.

## عقد البيانات المقترح (لا تخلطه بالكيانات العامة)
- تعريف `LibraryQuarantineReviewCandidate` داخلي، readonly، `candidateKind: 'QUARANTINE_PRIVATE_REVIEW_CANDIDATE'`, `decision: 'PENDING_HUMAN_REVIEW'`, `receiptId`, `sourceRevision`, `sourceUpdatedAt`, `sourceSha256`, `sourceByteSize`, `sourceFormat`, `uploaderUid`، و`sourceOriginalFilename` بعد تنقيح آمن، دون `storagePath`, `generation`, download URL أو private GCS metadata.
- API نقي `assessLibraryQuarantineReviewCandidate(input)` يستهلك **نسخة موثوقة محددة المصدر** من `SanitizedLibraryQuarantineReceiptListItemDto` (revision + adminReceipt)؛ يرفض أي input غير صالح بدلالة reason code بلا side effects، ويعيد candidate فقط عند التحقق الكامل. يجب توثيق أن sanitized DTO وحده ليس تفويضًا أمنيًا أو freshness guarantee؛ مرحلة التخزين التالية تعيد Firestore/GCS readback خادميًا قبل CAS.
- شروط التأهل: receiptId lowercase hex 32، revision صحيح وموجب، state EXACT `Quarantined`، hasVerifiedStorageWrite=true، isQuarantinedPrivateOnly=true، reconciliationRequired=false، reconciliationReason=null، rejectionReasonCode=null، `isSanitized/isVerifiedSafe/isRightsApproved/isPublished/isReadyForPeia` جميعها false، sha256 lowercase hex 64، byteSize ضمن 1..15,000,000، format PDF/DOCX مع MIME/extension وdeepInspectionStatus مطابق، updatedAt >= createdAt بصيغة ISO UTC، owner UID غير فارغ، filename مضبوط.
- رفض: `Reserved/WritePending/NeedsReconciliation/Rejected`، corrupt/mismatched flags، revision/sha/bytes/formats/owner/ISO invalid، candidates ذات حقول داخلية أو URL أو storagePath/generation في الكائن المدخل إذا كشفها الفاحص، وعدم التساهل مع bytes أو HTML. قم بإرجاع codes مستقرة مختصرة دون التسريب.
- candidate حتمي وقابل للمقارنة مع النسخة؛ لا يوجد إنشاء سجل Firestore، ولا انتقال state، ولا self-approval أو receipt mutation. يمكن أن ينتج نفس candidate عدة مرات عند نفس المدخل؛ إذا اختلف revision أو hash ينتج candidate مختلفًا أو رفضًا، ولا يدّعي CAS.

## حدود التصميم الصريحة
- لا تلقَّح قيم canonical حقوق/سلامة false على أنها true؛ عقد المراجعة يعلن صراحة أنها **غير متحققة**.
- لا ربط بـ`LibraryIntakeRecord.url` أو fake URLs. لا entitlement عبر frontend؛ أي client-supplied candidate غير موثوق في B التالية.
- لا parser PDF، sanitizer DOCX، قراءة binary، previews، PEIA auto queue، public URLs أو تنزيل.
- إن احتاج التكامل أي تعديل existing file أو import غير متاح أو ثغرة تمنع تنفيذ عقد pure: **STOP_REQUIRES_DESIGN_DECISION** قبل الكتابة.

## فحوص قبول قابلة للتحقق
1. Valid Quarantined PDF وDOCX تولّد candidate ثابتًا ويخلو serialized JSON من private path/generation/URL/bytes.
2. جميع حالات receipt الأخرى HOLD، و`NeedsReconciliation` ممنوع حتى لو ادّعت flags أخرى.
3. corrupt revision/receipt ID/hash/byteSize/format/MIME/deepInspectionStatus/timestamps/UID/flags/extra secret keys = rejection.
4. تغيير revision أو sha بين عينتين لا يُفهم على أنه إدخال صالح لنفس النسخة، ولا تستعمل أي cache غير مضمون.
5. 0 Firestore/GCS/API calls، 0 write/delete، 0 upgrade/publish/rights mutation، 0 updates to prior sources. تشغيل tests via existing tsx؛ التقرير يذكر command وexit وcount وSHA للملفين.
6. Google AI Studio GitHub Sync ينحصر في 2 Added، 0 Modified، 0 Deleted؛ STOP لمراجعة المالك.

**نتيجة ممكنة:** `LIB_FILE_REVIEW_01A_CONTRACT_IMPLEMENTED_PENDING_OWNER_REVIEW` أو `STOP_REQUIRES_DESIGN_DECISION`. لا ادّعاء بأن المراجعة البشرية أو الربط الدائم أصبح جاهزًا.
