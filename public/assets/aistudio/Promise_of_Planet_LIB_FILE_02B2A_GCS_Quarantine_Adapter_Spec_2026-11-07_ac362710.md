# وعد الكوكب — LIB-FILE-02B2A
## مواصفة محوّل التخزين المحجور للمكتبة — GCS Quarantine Adapter

**الحالة:** SPEC_READY / NOT_IMPLEMENTED  
**GitHub repository:** `rexat007/promise-of-planet`  
**Pinned baseline:** `4d0c5476c9cae6b89a7d0a4a3837610b4831184d`  
**تاريخ المواصفة:** 2026-11-07  
**وحدة التنفيذ:** `LIB-FILE-02B2A` — محوّل GCS خادمي مع حقن اعتماد واختبارات محلية؛ **لا تتصل الوحدة مباشرة بـ Firebase**.

## 1. السلطة والمشكلة

- `LIB-FILE-01A` يقبل PDF وDOCX قبولاً تمهيدياً، و`LIB-FILE-01B` يفحص بنية DOCX ويحافظ على PDF بحالة `PDF_REQUIRES_ISOLATED_PARSER`. **لا تعني أي من النتيجتين تعقيماً أو استعداداً للتحليل بواسطة PEIA.**
- `LIB-FILE-02A` ينشئ إيصالات `library/quarantine/<32-hex>/source.<pdf|docx>`، ويحدد حالات `Reserved`, `WritePending`, `Quarantined`, `NeedsReconciliation`, `Rejected`، ويتيح `TrustedStorageReadbackAttestation`.
- `LIB-FILE-02B1` يحفظ الإيصالات في `library_quarantine_receipts` مع إنشاء idempotent ومعاملات CAS. **حالة Firestore ليست إثباتاً لوجود الملف في GCS.**
- `functions/src/news/gcsEditorialBinaryStorageAdapter.ts` يحقق `ifGenerationMatch:0` ومطابقة ملكية لصور الأخبار، لكنه **يقيد المسارات بنطاقات الأخبار/الأدلة**، ولا يجوز تغييره للسماح بمسارات المكتبة.
- `storage.rules` لا تتيح للعميل مسار `library/quarantine` (منع افتراضي). صلاحيات Firebase Admin/Cloud IAM خارج قواعد Storage ويجب تقييمها مستقلاً عند الوصل التشغيلي. لا تنشئ هذه الوحدة أي صلاحية وصول جديدة.

## 2. مراجع المصدر المؤكدة — Git blob SHA-1

| المسار | SHA-1 | الدور |
|---|---|---|
| `functions/src/library/libraryUploadBinaryAdmission.ts` | `ea289629676addb05d89250e7f1599b71c5fb3d0` | القبول الأولي |
| `functions/src/library/libraryUploadDeepStructure.ts` | `7e6ba463502bc8d6c796378d6b381cdaaf01c60e` | فحص البنية |
| `functions/src/library/libraryQuarantineReceiptContract.ts` | `4b4d5f32e5903def3a3b0dcdecd45e38083f91bb` | الإيصال/المسار/الإثبات |
| `functions/src/library/firestoreLibraryQuarantineReceiptStore.ts` | `d9f4114222851c62c25574efbb0ffbeeb5c355e2` | مستودع Firestore وCAS |
| `functions/src/news/gcsEditorialBinaryStorageAdapter.ts` | `4bc2c40dd72c4bd3d8c09b349958db7a8e291e9e` | تصميم GCS الموحى به، للقراءة فقط |
| `storage.rules` | `d77548e6b505d8db3858634cc2937937393a9864` | حدود مسارات العميل |

## 3. حدود الوحدة

**إنشاء ملفين فقط:**

1. `functions/src/library/gcsLibraryQuarantineStorageAdapter.ts`
2. `scripts/runLibraryQuarantineGcsAdapterTests.ts`

**لا تعدّل** أي ملف قائم؛ لا تضف تصدير Firebase Function أو قاعدة تخزين أو مسار API. لا تغيّر صيغة الإيصال أو أسماء حالاته.

### عقد المحوّل

- اعتماد محقون `bucket` مع أسطح معرّفة بوضوح: file.save(...), file.getMetadata(), وطريقة **قراءة بحد بايتات مضمون قبل تجميع النتائج**. تجنب `download()` غير المحدود الذاكرة؛ استخدم stream bounded أو واجهة injected متكافئة مع حد صارم 15,000,000 بايت وانقطاع مبكر عند تجاوزه.
- مدخل الكتابة **خادمي فقط**: إيصال مثبت بحالة `WritePending` و`Buffer | Uint8Array`، دون قبول `storagePath` أو `receiptId` منفصلين من متصفح. تحقق بـ `validateLibraryQuarantineInternalReceipt` وأعد `assessLibraryUploadBinaryCandidate`/`inspectLibraryUploadDeepStructure` على **البايتات نفسها** في بوابة الاتصال الفعلي أو هذه الوحدة إذا لزم، مع مطابقة `sha256` والحجم والنوع. لا تكتفِ بادعاء الخادم المستدعي إذا لم يثبت موثوقيته.
- استخدم **المسار الداخلي المشتق من الإيصال** فقط وشرط create-if-absent `ifGenerationMatch: 0`، بلا overwrite.
- عيّن MIME المسموح بدقة، `cacheControl: private, no-store, max-age=0` و`contentDisposition: attachment`، دون ACL عام أو download tokens أو signed URLs.
- ميتاداتا ملكية: receiptId, uploaderUid, sha256, format وquarantineState؛ تحقق من القيم قبل وبعد الكتابة.
- بعد الكتابة، **اقرأ metadata ثم بايتات الكائن بحد آمن واحسب SHA-256 من المحتوى المقروء فعلياً** مع تطابق الجيل/الحجم/المسار والمالك ومعلومات HTTP. لا تعتبر checksum مخزّناً في custom metadata إثباتاً وحده.
- رفض أي `firebaseStorageDownloadTokens` في metadata، وأي ACL عام ظاهر؛ إذا تعذر تحديد إعدادات خصوصية الحاوية/ IAM فلا تدعِ أن الكائن غير قابل للوصول على مستوى IAM. هذا يحتاج بوابة منفصلة في الاتصال الحقيقي.
- أعِد نجاحاً داخلياً مع `TrustedStorageReadbackAttestation` فقط بعد تطابق جميع القراءات. **هذا إثبات يستهلكه orchestrator موثوق لاحقاً، وليس تصريحاً للعميل أو تغييراً لحالة الإيصال/Firestore.**
- إن كان الكائن موجوداً مسبقاً: لا تعِد الكتابة. اقرأ وتحقق. أعد ExistingVerified فقط إن كانت هوية وبيانات الكائن متطابقة، وإلا Conflict/NeedsReconciliation.
- لأي فشل شبكة/timeout/قراءة بعد كتابة غير مؤكدة: أعد نتيجة `NeedsReconciliation` ببيانات تشخيصية منقحة، ولا تزل الكائن أو تعِد الكتابة أو تُولِّد معرفاً جديداً.
- ممنوع تحويل `Reserved` إلى `Quarantined` داخل المحوّل. المستودع يبقى غير متصل في 02B2A. لا قبول لأي attestation من HTTP input أو بيانات المستخدم.

## 4. اختبارات القبول

باستخدام fake bucket/file **ومسارات الإنتاج نفسها**:

1. نجاح write-if-absent عندما الإيصال `WritePending` والبايتات مطابقة؛ تطبيق ifGenerationMatch=0.
2. الرفض إذا مدخل السجل Reserved/Rejected أو بيانات مزيفة أو مسار خارج library/quarantine.
3. SHA-256 للبايتات الأصلية، بما فيها `Uint8Array` ذات `byteOffset` غير صفري.
4. الحجم/الهاش/جيل الكائن/المالك/نوع الملف/المسار مختلفة عند readback: fail closed.
5. `getMetadata` غير ناجح أو قراءة stream مقطوعة أو بطء/فشل بعد كتابة: NeedsReconciliation.
6. قراءة bytes تتجاوز 15,000,000 تُقطع مبكراً دون تجميع غير محدود.
7. object already exists مع تطابق تام = VerifiedExisting بلا كتابة، والتعارض = fail closed.
8. رفض download tokens، ACL عام ظاهر، وأي cacheControl غير خاص.
9. لا اختراع URL أو مسار عام أو ترقية إلى VerifiedSafe/Sanitized/ReadyForPeia.
10. لا استدعاءات Firebase Admin، Firestore أو الشبكة في الاختبارات؛ لا تعديل لقواعد Storage أو لمسارات صور الأخبار.
11. أعطال متزامنة/تعارض كتابة لا تخلق overwrite أو retry أعمى.
12. جميع أخطاء المحوّل والتقارير لا تحتوي على raw bytes أو credentials أو signed URLs.

## 5. مخرجات وتوقف

- الاختبارات الجديدة: PASS (عدد محدد).
- `compile_applet`/`lint_applet`: تقرير صريح.
- TypeScript Functions المحلي إن تعذر بسبب بيئة Studio: `ENVIRONMENT_BLOCKED`; لا تعدّل tsconfig، واعتمد GitHub Actions AUTH-03A بعد push.
- نطاق GitHub Sync: ملفان جديدان فقط، وأي نسخة مواصفة في `public/assets/aistudio/` تُذكر منفصلة.
- **STOP** إذا تطلب التنفيذ تعديل أي ملف قائم، أو إذا لم توجد قراءة مقيّدة الحجم، أو إذا لم يمكن التحقق من تطابق البايتات بعد الكتابة. لا تتساهل باستخدام metadata وحدها.

## 6. ما بعد الوحدة

`LIB-FILE-02B2B`: orchestrator خادمي يصل محوّل التخزين بمستودع إيصالات Firestore، ويطبق `Reserved -> WritePending -> Quarantined/NeedsReconciliation` بمعاملات CAS، وحظر إعادة الكتابة العمياء، واسترداد الحالة. تليه وحدة endpoint/صلاحيات/واجهة رفع، ثم التعقيم والمعالجة الآمنة واستخراج النص وربط PEIA. **لا نشر Firebase قبل اعتماد مسار تشغيلي كامل وبإذن منفصل.**
