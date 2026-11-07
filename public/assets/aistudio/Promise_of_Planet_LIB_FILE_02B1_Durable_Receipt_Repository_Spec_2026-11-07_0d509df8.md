# وعد الكوكب — LIB-FILE-02B1
## مواصفة تأسيس المستودع الدائم لإيصالات الحجر الخاص

**الحالة:** SPEC_ONLY — لم تُنفَّذ.

**المستودع:** `rexat007/promise-of-planet`  
**مرجع GitHub المثبت:** `3c514e0e26d28094ccb0e50aaf4d6848dff134c8`  
**سلسلة الاعتماد:** LIB-FILE-01A VERIFIED → LIB-FILE-01B VERIFIED_WITH_COMPATIBILITY_DEBT → LIB-FILE-02A VERIFIED.

## 1. القرار والنطاق

الوحدة 02B1 تنشئ طبقة **حفظ/استرجاع دائمة للإيصال** في Firestore، قابلة للاختبار بواسطة تبعية محقونة ومخزن تجريبي. لا تكتب في Firebase الحقيقي ولا ترفع أي مستند ولا تنشر أي Endpoint. الوحدة منفصلة عن 02B2 الخاصة بالتخزين الفعلي في Google Cloud Storage وربط دورة حياة الإيصال.

**قائمة السماح (إنشاء فقط):**
- `functions/src/library/firestoreLibraryQuarantineReceiptStore.ts`
- `scripts/runLibraryQuarantineReceiptStoreTests.ts`

المساران غير موجودين في مرجع GitHub المثبت. كل الملفات الأخرى قراءة فقط.

## 2. أدلة المصدر

| المرجع | بصمة Git blob SHA-1 | سبب الرجوع إليه |
|---|---|---|
| `functions/src/library/libraryQuarantineReceiptContract.ts` | `4b4d5f32e5903def3a3b0dcdecd45e38083f91bb` | هوية الإيصال والحالات والتحقق |
| `scripts/runLibraryQuarantineReceiptContractTests.ts` | `c4d36b366dd5ab72eaeaf9af46c79f22217ff3c1` | عقود 02A والاختبارات |
| `functions/src/news/firestoreEditorialBinaryIntakeSessionStore.ts` | `027efedf05779e1758b55793c2f2302b511cb4fb` | مرجع لحقن معاملات Firestore لا لإعادة استخدام نطاق الأخبار |
| `functions/src/library/firestoreLibraryRepository.ts` | `afba4876b6d736424bd0b344df1db9a5e1417327` | نمط Firestore في المكتبة |
| `functions/src/library/libraryUploadBinaryAdmission.ts` | `ea289629676addb05d89250e7f1599b71c5fb3d0` | قبول 01A |
| `functions/src/library/libraryUploadDeepStructure.ts` | `7e6ba463502bc8d6c796378d6b381cdaaf01c60e` | فحص 01B |
| `storage.rules` | `d77548e6b505d8db3858634cc2937937393a9864` | منع الوصول الافتراضي لمسار الحجر، لا صلاحيات تخزين تشغيلية |

## 3. نموذج التخزين

مجموعة مستقلة: `library_quarantine_receipts`؛ مفتاح المستند هو `receiptId` المعتمد فقط. مخطط Envelope ثابت للإصدار الأول:

- `schemaVersion: 1`
- `revision: positive safe integer`, يبدأ من 1 ويزيد 1 في كل تعديل حقيقي
- `receipt`: إيصال `LibraryQuarantineInternalReceipt` بعد فحص `validateLibraryQuarantineInternalReceipt`
- `state`: نسخة مشتقة متماثلة مع `receipt.state` للفهرسة المستقبلية (لا تثق بحالة مستقلة)

لا تخزّن بايتات الملفات أو مفاتيح وصول أو روابط موقعة أو بيانات مُستمدة من متصفح غير موثوق. في هذه الوحدة يجب أن تبقى الـEnvelope داخل خدمة الخادم وحدها، ولا تصبح واجهة عامة للعميل.

## 4. واجهة التخزين المقيدة

- `createReceiptIfAbsent(receipt)` داخل معاملة: يقبل فقط `Reserved` صالحًا؛ عند وجود مستند متطابق تمامًا يعود بلا كتابة، والتصادم في الهوية/المحتوى يفشل مغلقًا.
- `getReceiptById(receiptId)` قراءة واحدة محددة: يتحقق من صحة المفتاح، ومخطط Envelope، والتطابق مع `doc.id`؛ لا يصلح السجل الفاسد أو يتجاهله.
- `compareAndSwapReceipt({receiptId, expectedRevision, expectedCurrentReceipt, nextReceipt})`: معاملة تقرأ السجل أولًا، ثم تتحقق من التطابق الحرفي للسجل الجاري، والصلاحية والنطاق والحقول الثابتة، والانتقال المسموح، وتزايد الوقت، ثم تكتب `revision+1`. لا تعتمد على فحص خارج المعاملة.

لا تفترض أن صلاحيات Firestore Security Rules تحمي Admin SDK. استخدام هذه الطبقة يجب أن يكون من خدمة خادمية موثوقة لاحقًا، بعد تحقق الهوية والصلاحيات في حد استقبال منفصل. **اجتياز التحقق البنيوي لإيصال بحالة `Quarantined` لا يثبت وجود الملف أو أمانه**؛ إثبات التخزين الحقيقي يظل من اختصاص 02B2.

الانتقالات المسموحة من عقد 02A فقط: `Reserved → WritePending|Rejected`، `WritePending → Quarantined|NeedsReconciliation|Rejected`، `NeedsReconciliation → Quarantined|Rejected`. لا مسار للخروج من `Quarantined` أو `Rejected`، ولا يجوز رفع العلامات الأمنية `isSanitized/isVerifiedSafe/isRightsApproved/isPublished/isReadyForPeia` إلى `true`.

## 5. حالات الاختبار اللازمة

1. إنشاء `Reserved` ثم قراءة مطابقة.
2. تكرار إنشاء مطابق لا يؤدي إلى كتابة أخرى.
3. تكرار إنشاء متعارض يرفض.
4. ملف UID أو hash أو path أو format معدّل يرفض.
5. إنشاء غير `Reserved` يرفض.
6. التنافس على نفس revision: واحدة فقط تُقبل، والأخرى تعارض دون overwrite.
7. نقص مستند أو عدم تطابق `doc.id` أو فساد `schemaVersion/revision/state/receipt` يرفض بوضوح.
8. انتقالات الحالات القانونية وغير القانونية؛ الرتابة الزمنية والحقول الثابتة.
9. القراءة بمفتاح غير صالح ترفض؛ لا قائمة شاملة أو scan غير محدود.
10. أخطاء معاملات Firestore تعيد فشلًا واضحًا دون نجاح متوهم.
11. لا وصول شبكة أو Firebase حقيقي في الاختبارات؛ استخدام Fake Firestore transaction بذاكرة.
12. لا تعديل لعقود 01A/01B/02A، ولا كتابة Cloud Storage، ولا نشر أو PEIA.

## 6. بوابات القبول

- مطابقة SHA-1 المرجعية قبل الإنشاء وغياب الملفين.
- اختبارات 02B1 وإظهار الحالات السلبية وCAS.
- عدم تغيير الملفات القائمة.
- فحص TypeScript حيث تسمح البيئة، ثم `AUTH-03A` على GitHub بعد الـPush اليدوي. لا تعديل للإعدادات ولا تثبيت حزم لحل اختلاف TypeScript 6/5 داخل Studio.
- التزام نطاق GitHub Sync وبيان أي نسخة مواصفة تلقائية منفصلة.
- لا Push/Deploy من Studio.

## 7. تأجيل صريح

02B2: إنشاء GCS object مشروط `ifGenerationMatch:0`؛ سجلات ما قبل/بعد الكتابة في Firestore؛ قراءة بيانات GCS الموثوقة والتطابق؛ `NeedsReconciliation` عند فشل غير محسوم؛ لا تسريب مسارات أو فتح قواعد وصول للعامة؛ لا تعديل لمستندات المكتبة المنشورة أو PEIA. 02B3: حدود HTTP/RBAC والتدفق الفعلي بعد قبول 02B2. سند PDF المعزول وDOCX sanitizer لاحقًا قبل استخلاص النص.
