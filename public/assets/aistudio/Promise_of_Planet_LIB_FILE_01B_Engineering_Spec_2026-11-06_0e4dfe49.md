# وعد الكوكب — LIB-FILE-01B: DOCX ZIP/OOXML Structural Gate

**الحالة:** مواصفة مقترحة للتنفيذ — لم تُنفذ بعد.

**GitHub source baseline:** `rexat007/promise-of-planet` @ `1e29a916cf58fc2b05f9b8829737849c7c0a1d51`.

## 1. السند المصدرى

- `functions/src/library/libraryUploadBinaryAdmission.ts` — Git blob SHA-1 `ea289629676addb05d89250e7f1599b71c5fb3d0`. الدالة `assessLibraryUploadBinaryCandidate` تُرجع `REJECTED` أو `PENDING_DEEP_INSPECTION` ولا تمنح ثقة أمنية أو تخزينًا. سقف الملف 15,000,000 بايت.
- `scripts/runLibraryUploadBinaryAdmissionTests.ts` — Git blob SHA-1 `f394d0beb24da9404b3b9b0cd5838fd7507f2248`. اختبارات أولية 13/13 حسب تنفيذ Studio، وبناء Functions ناجح في GitHub Actions #12.
- `functions/src/shared/libraryContract.ts` — `cfb0849c0418ba7b075f7de49c3debe668adc724`. سجل `LibraryIntakeRecord` ما زال مبنيًا على URL؛ لا يجوز إنشاء رابط اصطناعي للملف.
- `functions/src/library/libraryApplicationService.ts` — `32b54a8946f3749c18b21ab7f4d0fb4c21b2ebcf`. `submitIntake` يتحقق من الرابط ويمنع التكرار.
- `functions/src/library/libraryAdminHandlers.ts` — `e8711ca2c4430fa4ea53d1e5c1005890ef33a479`. لقطة PEIA تأتي من سجل الاستقبال المثبت، ولا تصل إلى بايتات ملف مرفوع حاليًا.
- `functions/src/news/editorialBinaryInspector.ts` — `529d035c0d1fa13347168303de54d1ac0a815a0f`. فحوص PDF فيها تمهيدية ولا تستبدل العزل/التنقية.
- `functions/package.json` — `420e933933f4f582a4ded415727152021faf5400`. لا توجد مكتبة ZIP/PDF تحليلية معتمدة صراحة، ويُحظر تثبيت حزم دون قرار.
- `functions/tsconfig.json` — `eb3212ee4cd1c4acaa70618850e9c0fa0346dbf6`. مسار البناء المعتمد يستخدم TypeScript 5 في GitHub Actions.

## 2. حدود الوحدة

**الغاية:** إنشاء بوابة نقية خادمية لفحص الهيكل الداخلي لحاويات DOCX، فقط بعد نجاح مرحلة 01A، دون تخزين أو رفع أو استخراج نصوص أو دمج PEIA. بالنسبة لـPDF: الإقرار الصريح بالحاجة إلى محلل PDF معزول وعدم ترقيته إلى حالة جاهزة.

**قائمة السماح للكتابة:**
1. `functions/src/library/libraryUploadDeepStructure.ts` — ملف جديد فقط.
2. `scripts/runLibraryUploadDeepStructureTests.ts` — ملف جديد فقط.

**القراءة فقط:** جميع الملفات المصدرية أعلاه. ممنوع تغيير العقود، المكتبة، الأخبار، العامل، الواجهة، إعدادات المشروع، `package.json`، الاختبارات السابقة أو ملفات النشر.

## 3. تصميم واجهة الوحدة

مثال مبدئي للواجهة (للتكييف مع مصدر الحقيقة، وليس للنسخ الأعمى):

```ts
inspectLibraryUploadDeepStructure({ originalFilename, claimedMimeType, bytes }):
  | { status: 'REJECTED'; reasonCode: string; format?: 'PDF'|'DOCX' }
  | { status: 'DOCX_STRUCTURE_CHECKED_PENDING_SANITIZATION'; format: 'DOCX'; sha256: string; deepInspectionNotes: readonly string[]; isVerifiedSafe: false; isStored: false; isReadyForPeia: false }
  | { status: 'PDF_REQUIRES_ISOLATED_PARSER'; format: 'PDF'; sha256: string; isVerifiedSafe: false; isStored: false; isReadyForPeia: false }
```

- تحقق مجددًا من بايتات المدخل عبر `assessLibraryUploadBinaryCandidate` من 01A؛ لا تعتمد على قرار أولي مرسل من العميل.
- DOCX: اقرأ ZIP Central Directory وأطواله وإزاحاته باستخدام bounds-check صارم. ارفض ZIP64، split/multi-disk، التشفير، الامتدادات غير المدعومة أو الغامضة، دخول ZIP خارج الحدود، duplicate/case-colliding entries، symlinks، absolute/traversal paths، وlocal/central filename/size/method mismatch.
- ميزانية وقائية للضغط: عدد entries، مجموع الأجزاء بعد الفك، حد لكل entry، ونسبة الضغط. فك فقط ملفات XML اللازمة بواسطة `node:zlib` وحدود الذاكرة/الناتج؛ لا تنفذ أو تشغل محتوى الملف.
- اختبر CRC-32 للأجزاء التي تُفك. ارفض أي تضارب بين القيم المحققة والمعلنة، والتداخل بين نطاقات entries.
- ابحث عن البنية الإلزامية: `[Content_Types].xml`، `_rels/.rels`، `word/document.xml` وتأكد من تعريف الجزء الرئيس وعلاقته، وفق فحص XML محافظ لا يقبل DTD أو كيانات خارجية أو علاقات خارجية أو ActiveX/OLE/macros/embedded objects.
- لا تصف الملف بأنه «منقّى» أو «آمن» أو «تمت قراءته كاملاً» استنادًا إلى هذا الفحص. عند عدم القدرة على إثبات العلاقة البنيوية اللازمة باستخدام المكتبات المسموحة، `STOP` بدلاً من التفسير بالتخمين أو قبول النص بالـregex وحده.
- PDF: لا تحاول كتابة PDF parser أو تنفيذ/فك تدفقات PDF في هذه الوحدة. إذا نجحت 01A فأعد `PDF_REQUIRES_ISOLATED_PARSER` فقط. ولا تعتبر هذه الحالة إذن تخزين أو نشر أو إدخال إلى PEIA.

## 4. اختبارات القبول

- نموذج DOCX صالح بملفات OOXML الأساسية ومعلومات central/local headers متطابقة + CRC صحيح؛ اختبار ملفات مضغوطة Stored وDeflate بحدود آمنة.
- رفض ZIP مزور يحوي فقط `[Content_Types].xml` (نموذج 01A لا يكفي).
- رفض central directory أو EOCD مزور، إزاحات/أحجام خارج الحدود، التداخل، الأسماء المتعارضة، ZIP64، multi-disk، التشفير، data-descriptor غير مدعوم، ZIP bombs، symlinks وpath traversal.
- رفض `vbaProject.bin`، ActiveX/OLE، روابط XML خارجية، DTD/ENTITY، محتوى أو root relationship مفقود أو متضارب.
- رفض تضارب CRC والتحويلات Unicode المشبوهة.
- الحفاظ على SHA-256 البايتات الفعلية للـBuffer/Uint8Array slice.
- PDF يبقى في `PDF_REQUIRES_ISOLATED_PARSER` بعد 01A، ولا ينتقل إلى جاهزية PEIA.
- تأكيد عدم وجود أي اتصال بشبكة أو Storage أو Firestore أو تعديل في حالة التحرير أو حقوق النشر أو منشورات الموقع.
- اختبار 01A القديم يظل كما هو، ثم اختبار 01B الجديد، وبناء الواجهة وLint حسب الإمكان. عدم نجاح `tsc -p functions/tsconfig.json` بواسطة TypeScript 6 الجذري يعتبر **ENVIRONMENT_BLOCKED** ويُرحّل التحقق الفعلي إلى CI، لا سببًا لتعديل `tsconfig`.

## 5. حواجز التوقف والنقل

`STOP` عند غياب المكتبات/القدرات اللازمة للتحقق البنيوي بأمان، أو تغير بصمات المصادر، أو توسع نطاق الكتابة، أو ظهور ملفات غير مقصودة خارج مرآة المواصفة المعروفة.

التسلسل التالي: قبول Studio لنطاق الملفين → Push يدوي → التحقق من SHA على GitHub → تشغيل `AUTH-03A Functions Build Verification` على commit الجديد → قبول 01B → تصميم تخزين مؤقت خاص مع إيصالات ومدخلات URL والملف كنوعين منفصلين → مسار فحص PDF معزول واستخراج نص مؤتمن → توصيل PEIA → مراجعة بشرية.

**لا deploy قبل تنفيذ طبقة تخزين مكتملة وتفويض المستخدم الصريح.**
