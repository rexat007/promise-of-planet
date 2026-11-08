# LIB-FILE-REVIEW-01B — Durable, server-only quarantine review draft linkage

**STATUS:** `SPECIFIED — NOT IMPLEMENTED — NOT ACCEPTED` · **Repository:** `rexat007/promise-of-planet` · **Pinned remote baseline:** `08501a44c5f68d9d414b090cfc8294c7d7889288` · **Last accepted:** `LIB-FILE-REVIEW-01A/R1`.

## الغرض وحدود السلطة
أنشئ **مسودة مراجعة داخلية دائمة واحدة لكل receiptId**، لا أصل مكتبة منشور، بعد التحقق من إيصال `Quarantined` الحالي وGCS generation-pinned readback، ثم تثبيت ارتباط المصدر بمراجعة نسخته داخل Firestore transaction CAS. لا تضف زرًا أو endpoint أو نشرًا أو قرار سلامة/حقوق/PEIA. لا تخلط مسودة الحجر بـ`LibraryIntakeRecord` المرجعي ذي `url` إلزامي.

**تحذير دقيق:** فحص GCS قبل معاملة Firestore لا يجعل التخزين نفسه جزءًا من المعاملة الذرية؛ لا تدّعِ أن كائن GCS لا يمكن تغييره بعد القراءة. يجب إعادة readback عند أي استخدام لاحق لمحتوى الملف، ولا يطلق هذا العقد bytes أو URL مطلقًا.

## المصدر المقبول المثبت GitHub — READ ONLY
| path | Git blob SHA-1 |
|---|---|
| `functions/src/library/libraryQuarantineReviewDraftContract.ts` | `0aeb565c7f83876dd3c2bfb5b214e9f85d9a0153` |
| `functions/src/library/libraryQuarantineReceiptContract.ts` | `4b4d5f32e5903def3a3b0dcdecd45e38083f91bb` |
| `functions/src/library/firestoreLibraryQuarantineReceiptStore.ts` | `d9f4114222851c62c25574efbb0ffbeeb5c355e2` |
| `functions/src/library/gcsLibraryQuarantineStorageAdapter.ts` | `4bca554dd00a5e2efc739cc166175cc63327c5ad` |
| `functions/src/library/libraryQuarantineRecoveryCoordinator.ts` | `c2105cb5c12fc27e258943374313ad9b1f1c0e9d` |
| `functions/src/library/libraryQuarantineAdminReadService.ts` | `fc59ce7350c24ee76f5bd0d6b358196ce48ebc45` |
| `functions/src/library/libraryUploadBinaryAdmission.ts` | `c479007641d799afb145436bf91e661a7c2d5611` |
| `scripts/runLibraryQuarantineReviewDraftContractTests.ts` | `6bc6b8e1181da7b6aab0a0f87fe394776a62093f` |
| `scripts/runLibraryQuarantineRecoveryCoordinatorTests.ts` | `bcab57160a4f58e896ea12c0a9d6cd0be1626787` |
| `package.json` | `34cb668d837d342c9b5367461cca2ad9dd8a18e7` |

النصوص البنيوية المطلوبة من المصدر الفعلي: `LibraryQuarantineReceiptStore.getReceiptById`, `validatePersistedLibraryQuarantineReceiptEnvelope`, `areLibraryQuarantineReceiptsEqual`, `toSanitizedLibraryQuarantineAdminReceiptDto`, `GcsLibraryQuarantineStorageAdapter.verifyExistingQuarantineObject`, `TrustedStorageReadbackAttestation`, `assessLibraryQuarantineReviewCandidate`. الفحص الصامت SHA لملفات Studio المحلية إلزامي؛ **لا يُطلب من Studio تنزيل شيء من GitHub**. إذا اختلفت أو ظهرت تغييرات محلية غير معروفة: **STOP**.

## نطاق التنفيذ المنفصل عن المواصفات
**Allowlist CODE — إنشاء ثلاثة ملفات فقط (تحققت من غيابها عند baseline):**
1. `functions/src/library/firestoreLibraryQuarantineReviewDraftStore.ts` — NEW: مخصص للـpoint lookup والمعاملة الذرية فقط، لا مسح collection.
2. `functions/src/library/libraryQuarantineReviewDraftPersistenceService.ts` — NEW: خدمة خادمية داخلية محقونة الاعتماديات، غير موصولة بواجهة أو callable.
3. `scripts/runLibraryQuarantineReviewDraftPersistenceTests.ts` — NEW: اختبارات mocks حقيقية للمعاملة وGCS/fail-closed.

**DOCUMENTATION:** المواصفة المرفقة وثيقة مشروع طبيعية؛ يمكن إبقاء نسخة مسماة واضحة منها داخل `public/assets/aistudio/` وفق سياسة المشروع، **لكنها ليست تصريحًا بكتابة ملفات إضافية عشوائية**. لا تعديلات إلى ملفات مصدر/اختبارات سابقة أو config/rules/index/workflows أو locks أو docs غير محددة. لا تثبيت حزم أو إنشاء مجلدات ضخمة أو `rm -rf`.

## عقد التنفيذ الأمني الإلزامي
1. **Internal-only authority:** لا API أو `functions/src/index.ts` ولا React/Network wiring. يجب أن تأتي هوية المراجع وأهليته من سياق خادمي موثوق، وليس من `boolean` أو دور/UID يعلنه العميل؛ صمّم حدودًا محقونة صريحة لـauthorization وامنَع أي قراءة GCS أو كتابة إذا لم تُحسم الصلاحية. إذا لم يمكن إثبات تفويض موثوق دون تعديل ملفات خارج قائمة السماح فـ`STOP_REQUIRES_DESIGN_DECISION`، ولا تستخدم bypass.
2. **No trusted client candidate:** لا تقبل DTO/candidate/hash/path/generation/rights من caller. الإدخال الأدنى المعتمد `receiptId` فقط من السياق الموثوق. استخدم `getReceiptById` للحصول على `envelope` سليم وحالي ثم `adminReceiptDto` الخادمي، واستدعِ `assessLibraryQuarantineReviewCandidate({revision: envelope.revision, adminReceipt: dto})`. `NeedsReconciliation` وكل حالة غير `Quarantined` = HOLD قبل GCS.
3. **GCS readback:** استدعِ `verifyExistingQuarantineObject({receipt: persistedReceipt, verifiedAtIso})` من الـadapter المسموح بعد ضبط الوقت والتحقق من المسار المستنبط. النجاح وحده `EXISTING_VERIFIED` أو نتيجة `ok: true` مرتبطة بالبصمة الفعلية؛ تحقق من `attestedReceiptId`, `attestedUploaderUid`, `attestedStoragePath`, `attestedFormat`, `attestedContentType`, `attestedByteSize`, `attestedSha256`, `attestedGeneration` مقابل كل الحقول الموثوقة في receipt. اختلاف/غموض/خطأ => HOLD، بلا سجل جديد. لا تتجاوز metadata الخصوصية أو تُظهر attestation/canonical path.
4. **Firestore atomic source guard:** بعد تحقق GCS، نفّذ transaction واحدة فقط عبر injected Firestore database: point-read مصدر `library_quarantine_receipts/<receiptId>` ثم نقطة المسودة `library_quarantine_review_drafts/<receiptId>` **قبل أي write**. أعد التحقق من envelope الحالي schema/revision/state ومحتواه باستخدام `validatePersistedLibraryQuarantineReceiptEnvelope` و`areLibraryQuarantineReceiptsEqual` مقارنة بالـsnapshot الأول، وأن generation لم تتغير؛ أي تغيير => `STALE_SOURCE_HOLD` وzero writes. قراءة المصدر ضمن نفس المعاملة يجب أن تجعل أي كتابة منافسة تؤثر عليه سبب conflict/abort، دون overwrite/forced retry.
5. **Create once / idempotency:** لا تنشئ إلا إذا draft doc مفقود، عبر `transaction.create` بشرط uniqueness، وابتعد عن `transaction.set` الذي يكتب فوق موجود. معاملة مراجعة المسودة نفسها لا تعدّل receipt؛ zero receipt writes. وثيقة المسودة بقائمة مفاتيح محددة (schemaVersion, receiptId, sourceRevision, sourceUpdatedAt, sourceSha256, format, uploaderUid, reviewState=`PENDING_HUMAN_REVIEW`, non-assurance false flags, createdBy, createdAt) فقط، دون GCS path/generation/bytes/URL/rights-approval. إذا الوثيقة موجودة، أعد `IDEMPOTENT_EXISTING` **فقط بعد** validation كامل وتطابق source identity/version وحالة عدم الاعتماد؛ اختلافها HOLD بلا كتابة. إذا حدث crash بعد commit وقبل reply، إعادة المحاولة fresh يجب أن تُعيد idempotent، لا مسودات مكررة.
6. **No publication:** لا تحول الحالات ولا تُنتج `LibraryDocument`/`LibraryIntakeRecord`، ولا approve/reject حقيقي ولا download/preview ولا PEIA. `Quarantined` و`PENDING_HUMAN_REVIEW` ليست أحكام أمان. لا GCS write/delete ولا Firestore receipt CAS mutation ولا Firebase deploy.
7. **Bounded budgets:** لكل استدعاء قراءة مصدر أولية ≤1؛ GCS verify ≤1؛ Firestore transaction ≤1 بمحاولات تنفيذ محلية غير متكررة من الخدمة؛ داخل المعاملة نقطتا قراءة فقط + على الأكثر draft create واحد. انتبه إلى أن Firestore SDK قد يعيد تشغيل callback داخليًا عند التعارض؛ أي idempotency يجب إثباته في test/fault injection، ولا تدّعِ سقفًا مطلقًا لعدد callback invocations دون ضبط الـSDK. لا تتسبب retries داخل service.
8. **Errors/redaction:** كل فشل استرداد GCS أو store أو CAS/parse/ownership/authorization HOLD دون إرجاع raw private path/generation/attestation/binary أو رمي خطأ حاويًا لها. عمليات fail-closed تُسجّل رمزًا محدودًا فقط.

## اختبارات قبول إلزامية
- create PDF وDOCX صحيحين عند تحقق admin/receipt/GCS/transaction، مع documentId ثابت وfields صارمة، zero receipt changes و0 leak.
- unauthorized human/unknown identity/AI principal ⇒ 0 storage probes، 0 writes. لا JWT/mock user-controlled `isAuthorized` كبرهان نهائي.
- كل حالات `Reserved`, `WritePending`, `NeedsReconciliation`, `Rejected` أو flags مزورة ⇒ HOLD.
- missing/corrupt source, inconsistent revision/hash/generation/owner/path/MIME/bytes/timestamps ⇒ HOLD؛ خصوصًا source edit بين GCS readback وFirestore transaction.
- idempotent exact existing؛ conflicting/stale existing HOLD، crash-before-commit/after-commit replay semantics.
- Firestore transaction conflict, double-invocation concurrency, GCS readback uncertain ⇒ no duplicate/dangerous write.
- 0 GCS write/delete, no API/UI calls, no public URL, no receipt mutation.
- اختبارات العقد 01A `7/7` المبلغة + اختبارات admin `7/7` وإضافة اختبارات B مع exit codes/TypeScript/build/lint منفصلة.
- قبل دفع Studio، المستخدم يفحص GitHub Sync: CODE 3 Added only، DOCS محددة ومعروفة إذا حُفظت، 0 unrelated modified/deleted.

## Stop conditions
إذا احتاج الحل تعديل GCS/Firestore accepted contracts، أو إنشاء قاعدة قواعد/فهرس/سيرفر/API/حقل جديد في receipt، أو لم تكن صلاحيات الإدارة الحقيقية قابلة للإثبات دون وصلات خارج allowlist، أو لم يمكن إثبات transaction source read وثباته: `STOP_REQUIRES_DESIGN_DECISION` **بدون كتابة تخمينية**. تقرير Studio يتضمن جميع SHA/bytes/test counts/exit codes وسلوك conflict/TOCTOU. **لا Push/Deploy**.

**Outcome:** `LIB_FILE_REVIEW_01B_IMPLEMENTED_PENDING_SOURCE_REVIEW` أو `STOP_REQUIRES_DESIGN_DECISION`؛ لا تعتبر نجاح build موافقة أو نشرًا.
