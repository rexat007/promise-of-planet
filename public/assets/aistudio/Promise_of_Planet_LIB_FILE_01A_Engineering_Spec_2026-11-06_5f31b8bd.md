# Promise of Planet — LIB-FILE-01A
## مواصفة وحدة فحص القبول الأولي لملفات المكتبة PDF/DOCX

**التاريخ:** 2026-11-06  
**المستودع:** `rexat007/promise-of-planet`  
**مرجع GitHub المثبت:** `1233c8c20777a143917db0cdd90730dbfc086f64`  
**الحالة:** SPECIFIED / NOT IMPLEMENTED  
**طريقة العمل:** Google AI Studio ينفذ التغييرات المحلية؛ المالك يراجع Google AI Studio GitHub Sync ويقبل ثم يرفع يدويًا. لا Push أو Deploy ضمن هذه الوحدة.

## 1. نتيجة مراجعة المصدر

- `functions/src/shared/libraryContract.ts`، Git blob `cfb0849c0418ba7b075f7de49c3debe668adc724`: حقلا `LibraryIntakeRecord.url` و`normalizedUrl` إلزاميان، و`SubmitLibraryIntakeInput.url` إلزامي. `LibraryDocumentVersion.referenceUrl` خارجي اختياري. لا توجد هوية معيارية لملف ثنائي مرفوع.
- `functions/src/library/libraryApplicationService.ts`، Git blob `32b54a8946f3749c18b21ab7f4d0fb4c21b2ebcf`: `submitIntake` يستدعي `normalizeIntakeUrl(input.url)`، ثم يحفظ سجل مرجع خارجي بحالة `PendingReview`. صلاحية المرسل `Create` أو `Edit`؛ هذا ليس مسار رفع ملفات.
- `functions/src/library/firestoreLibraryRepository.ts`: deduplication الحالي يعتمد بصمة `normalizedUrl` داخل `library_intake_urls`؛ لا يجوز حقن رابط وهمي أو مسار GCS فيه.
- `functions/src/library/libraryAdminHandlers.ts`، Git blob `e8711ca2c4430fa4ea53d1e5c1005890ef33a479`: `extractAuthoritativeLibraryIntakeSnapshotInput` يغذي PEIA بـ`title`, `notes`, و`suppliedExcerpt` إن كان محفوظًا، ويضبط `inputBasis` إلى `MetadataOnly` أو `SuppliedExcerptAndMetadata`. **لا يوجد إثبات بأن النص هو كامل PDF/DOCX مستخرج آليًا.**
- `functions/src/news/editorialBinaryInspector.ts`، Git blob `529d035c0d1fa13347168303de54d1ac0a815a0f`: يوجد فحص PDF أولي لأدلة حقوق الصور، مع تحذير صريح أن الفحص الهيكلي/الاستدلالي ليس تعقيمًا كاملًا. لا يُعاد وصف هذا المسار بأنه «فحص أمان مكتبة» ولا يُستعمل لتجاوز سياسة حقوق المكتبة.
- `functions/src/news/editorialNewsImageUploadEndpoint.ts`، Git blob `2db26ba041c5d313f5c7d22ef328757a4a37ae55`: يقدم مثالًا على مصادقة بشرية وحدود حجم ونقل ثنائي، لكن المسار مخصص لأصول الصور؛ لا يعاد استخدامه لملفات المكتبة بتغيير اسم MIME فقط.
- `src/components/library/AdminLibraryManagement.tsx` و`src/services/libraryAdminClient.ts` يعتمدان على رابط خارجي ولا يملكان معًا مسار رفع ثنائي خاص بالمكتبة.
- `peia-worker/src/localAnalysisRuntime.ts`: يدعم مهام `LibraryIntake` القائمة؛ لا تقرأ هذه الوحدة ملفات PDF أو DOCX ولا تعدّل بروتوكول العامل.

مرجع نص مباشر (قراءة فقط، مثبت بالـCommit):
- https://raw.githubusercontent.com/rexat007/promise-of-planet/1233c8c20777a143917db0cdd90730dbfc086f64/functions/src/shared/libraryContract.ts
- https://raw.githubusercontent.com/rexat007/promise-of-planet/1233c8c20777a143917db0cdd90730dbfc086f64/functions/src/library/libraryApplicationService.ts
- https://raw.githubusercontent.com/rexat007/promise-of-planet/1233c8c20777a143917db0cdd90730dbfc086f64/functions/src/library/libraryAdminHandlers.ts
- https://raw.githubusercontent.com/rexat007/promise-of-planet/1233c8c20777a143917db0cdd90730dbfc086f64/functions/src/news/editorialBinaryInspector.ts

**مهم لـStudio:** لا تفترض جلب GitHub. اقرأ ملفات مساحة Studio المحلية أولًا وتحقق من البصمات. الروابط مرجعية مباشرة وليست تعليمات لجلب تلقائي. عند أي عدم مطابقة، STOP دون كتابة.

## 2. قرار البناء

المسار الشامل المستهدف:

1. استقبال رابط خارجي (الحالي، دون تغيير) **أو** رفع ملف ثنائي خاص (جديد).
2. قبول مبدئي للملف: الصيغة والحجم والبصمة، ثم فحص أعمق مستقل قبل التخزين/الإرفاق النهائي.
3. حفظ **أصل الملف خاصًا** في Cloud Storage عبر endpoint خادمي مصادق عليه؛ لا رابط عام تلقائيًا ولا قبول بحقوق النشر.
4. إيصال محفوظ بهوية أصل ومصدر وتحقق من البصمة، ثم ربطه بسجل استقبال أو نسخة وثيقة بمرجع معياري، مع إبقاء سجلات URL القديمة قابلة للقراءة.
5. استخراج نص آمن وموثق من PDF/DOCX في خدمة خادمية منفصلة، مع `extractionStatus`, `sourceSha256`, `extractorVersion`, عدد الأحرف/الصفحات إن توافرت، ونسبة الثقة/القصور. PDF المصوّر أو المشفر دون نص يظل `EXTRACTION_UNAVAILABLE`، لا تخلق له نصًا تخمينيًا.
6. استخدام النص **بعد إثبات مصدره وإصداره** لإنشاء مهمة PEIA استرشادية، دون تسمية النص المستخرج آليًا `suppliedExcerpt` على نحو يضلّل مصدره، ودون إدعاء قراءة الوثيقة كاملة إن لم يحدث ذلك.
7. المراجعة البشرية للحقوق والمحتوى والملخص والترجمة قبل النشر.

ننفذ كل نقطة بوحدة منفصلة. **الوحدة الحالية 01A هي فحص القبول الأولي فقط، بلا تخزين أو كتابة Firestore أو واجهة.** الغرض منع إدخال بنية ثنائية غير مقيدة في خطوة الرفع اللاحقة.

## 3. وحدة LIB-FILE-01A — الحدود الصارمة

**الملفات المسموح كتابتها (جديدة فقط):**
- `functions/src/library/libraryUploadBinaryAdmission.ts`
- `scripts/runLibraryUploadBinaryAdmissionTests.ts`

**عقد الدالة المقترح:**

`assessLibraryUploadBinaryCandidate({ originalFilename, claimedMimeType, bytes })`

- مدخل `bytes` هو `Buffer | Uint8Array` من جهة الخادم في الاستخدام المستقبلي، وليس حجمًا مصرحًا به من العميل.
- تقرير رفض محدد مع `reasonCode` **أو** تقرير `PENDING_DEEP_INSPECTION` يتضمن `format: 'PDF'|'DOCX'`, `sizeBytes` الفعلي، `sha256` المحسوب من البايتات، ومعلومات الاسم وMIME المعلنين. **لا تسمِّ هذا مرفقًا آمنًا أو مخزنًا أو مصرحًا بنشره.**
- سقف قبول أولي محافظ **15,000,000 بايت** في هذه الوحدة؛ يمكن تغييره فقط بقرار مستقل بعد مراجعة حدود endpoint/التخزين.
- اسم ملف عربي أو إنجليزي مقبول، مع رفض مسارات، فواصل `/` و`\\`، محارف التحكم والتوجيه الخفي، الأسماء الفارغة/شديدة الطول، نهايات المسافة والنقطة، والامتدادات الخطرة أو الملتبسة.
- الصيغ المرحلية: `.pdf`، `.docx` فقط. ارفض `.doc` و`.docm` و`.zip` وما شابه بوضوح. دع دعم `.doc` القديم لقرار مستقل.
- MIME المعلن ليس دليلاً؛ ارفض تعارض MIME الصريح، واسمح بحالة empty/`application/octet-stream` فقط للانتقال إلى فحص أعمق (لا تعتمدها بصفتها مطابقة).
- تحقق مبدئي من بايتات PDF `%PDF-` وبنيته التمهيدية المقتضبة، ومن علامة ZIP المحلية لمرشح DOCX. لا تعتبر علامة `PK` إثباتًا أن الحاوية DOCX سليمة، أو أنها خالية من zip bomb أو ماكرو أو علاقات خارجية.
- احسب SHA-256 من البايتات الفعلية بعد فحص الحدود، وليس من قيمة يرسلها العميل.
- لا تحلّل مستندًا إلى نص ولا تُنزل تبعية جديدة ولا تعدّل `editorialBinaryInspector.ts` أو أي عقد حالي.

**الاختبارات المطلوبة:** PDF أولي سليم/مرفوض؛ DOCX ZIP header أولي؛ zip مزيف؛ PDF مسمى DOCX والعكس؛ أنواع MIME متناقضة؛ `.doc` و`.docm`؛ حجم صفر والحجم الأقصى وما فوقه؛ أسماء عربية وآمنة وخطرة؛ byte checksum صحيح؛ `Uint8Array` offset؛ لا يوجد ناتج `VERIFIED`, `SANITIZED`, `PUBLISHED` أو URL من الدالة؛ شروط فشل مغلق.

**فحوص التنفيذ:** شغّل `scripts/runLibraryUploadBinaryAdmissionTests.ts` بأداة tsx المثبتة الموجودة فقط. شغّل فحص TypeScript الخاص بالدوال (`functions/tsconfig.json`) و`compile_applet` و`lint_applet` إن كانت الأدوات متاحة دون تثبيت. افصل أعطال baseline عن أعطال الوحدة، ولا تفسّر نجاح frontend build بأنه يكفي لإثبات صحة functions.

**ممنوعات:** لا تعدّل `LibraryIntakeRecord`, `SubmitLibraryIntakeInput`, Firestore collections, PEIA gateway/worker, rights/workflow, News, Training, ترجمة, Storage, routes, Firebase deploy, dependencies, أو GitHub. لا ترفع أي ملف تجريبي ولا تنشئ مهام حقيقية. لا Push أو نشر.

**شرط التوقف:** اختلاف SHA للمرجع المحلي المطلوب؛ تعذّر تكوين نتيجة `PENDING_DEEP_INSPECTION` صادقة وآمنة؛ الحاجة إلى تعديل ثالث خارج السماح؛ انزلاق التنفيذ إلى تخزين أو ترقية حالة الوثيقة؛ أو فشل اختبار مؤثر جديد.

**النتيجة المسموح الإعلان بها:** `LIB_FILE_01A_IMPLEMENTED_PENDING_OWNER_REVIEW` أو `STOP_*`. هذه الوحدة لا تعني `UPLOAD_READY` ولا `PEIA_LIBRARY_READY`.

## 4. الوحدات التالية — ليست مأذونة بالتنفيذ الآن

- **LIB-FILE-01B:** فحص حاوية DOCX وPDF بعمق أعلى مع حدود ZIP expansion وتعقيم/عزل قبل الثقة، واختبارات أمنية ملفية.
- **LIB-FILE-01C:** endpoint رفع خادمي مصادق + التخزين الخاص والإيصالات/التكرار/الفشل والاسترجاع؛ موافقة مستقلة على الملفّات والصلاحيات.
- **LIB-FILE-01D:** دمج نوع المصدر `ExternalUrl | UploadedAsset` بنمط متوافق مع legacy URL في Library Intake والمكتبة، مع فحوص عدم تسريب storage paths إلى العامة، ثم واجهة ملف/رابط متجاورة.
- **LIB-FILE-01E:** استخراج نص موثق ومحدود وإلحاق أصل النص بنسخة الملف + ربط PEIA بنسخة المصدر دون اختلاق أدلة خارجية؛ تجربة حقيقية بملف يختاره المالك، مع فحص الحق والنص والمراجعة البشرية.
- **TRANSLATION:** بعد إثبات معالجة المكتبة وPEIA، بناء خدمة الترجمة المشتركة وفق مواصفة منفصلة؛ لا تغيّر هذه الوحدة شروط المحتوى الثنائي.

## 5. حارس قبول المستخدم

لا قبول للوحدة عند مجرد نجاح البناء: يلزم تقرير Studio ببصمات ما بعد الكتابة، الاختبارات المستهدفة، عدد ملفات Sync (الجديد فقط)، وصفر ملفات خارج قائمة السماح. المالك يراجع ويقبل ويضغط Push بنفسه. لا نشر Firebase دون قرار منفصل.
