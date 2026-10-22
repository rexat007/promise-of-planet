# وعد الكوكب — IMG-F3-07
## مواصفة مقيدة: محرك معالجة صور حقيقي كشرط لإصلاح رفع صور الأخبار
**التاريخ:** 2026-10-22  
**الحالة:** `SPEC_READY / OWNER_AUTHORIZED_SHARP_FOR_UPLOAD_FIX / IMPLEMENTATION_NOT_STARTED`  
**المستودع:** `rexat007/promise-of-planet`  
**مرجع GitHub المعتمد:** `71e4d883b9ac6fb5c42dbcc19d2ba074b35cf7d4`

## 1. تفسير موافقة المالك وحدودها
الموافقة على إدخال `sharp` **مشروطة بصلته بحل مشكلة رفع الصور اللازمة لإطلاق المنصة**. الشرط محقق: الخدمة القديمة `editorialBinaryIntakeService.ts` تنشئ 5 أسماء لمشتقات صور ولكن بايتات جميعها نسخ من الملف الأصلي، ولا تفك وتعيد ترميز البكسلات. محرك الصور الحقيقي شرط لازم لمعالجة صور الأخبار، **لكنه ليس وحده كافيًا لتشغيل الرفع من لوحة التحرير**.

هذه الوحدة تنفذ محركًا خادميًا منعزلًا وقابلًا للاختبار فقط. لا ترخّص تعديل الخدمة المقبولة F3-05/F3-06، ولا الربط الإنتاجي، ولا رفع Firebase، ولا نشر الفهرس. الخطوة الوظيفية التالية بعد قبول المحرك: ربط آمن بعملية رفع الصور وحفظ نتائج المشتقات في GCS والمراجع في السجل التحريري، بعد تصميم معالجة نافذة انقطاع GCS ↔ Firestore. لا يُفعّل زر رفع صور إنتاجي قبل اجتياز هذه الحدود.

## 2. مصدر الحقيقة وحالة المشروع
- IMG-F3-06: `OWNER_ACCEPTED_CLOSED`، بلا إنتاج. Baseline ثابت أعلاه.
- GitHub هو مرجع النسخة المرفوعة؛ Google AI Studio مرجع التعديلات المحلية غير المرفوعة. **لا يفترض** إمكان Git في Studio أو تنزيل GitHub من مسارات.
- آخر تقرير Studio قبل هذه الوحدة: 134/134 اختبارات في ست مجموعات؛ لم يُعَد تشغيلها هنا.
- ليست هناك صور مزيفة، أو fallback وهمي، أو تخطي مراجعة حقوق الاستخدام.

| مرجع | Git blob SHA-1 الموثق |
|---|---|
| `functions/package.json` | `2b4278978141a9091ad90684aba1b6857c5f9bb4` |
| `functions/package-lock.json` | `fa1838b5b47529c5c70ccc5b7d21c47e8510cbbe` |
| `functions/src/news/editorialBinaryInspector.ts` | `8c1dbb8431de693af710c219c06538e2212107de` |
| `functions/src/news/editorialBinaryIntakeService.ts` | `61c13c7878112a6a0cd075df094478449c97d5b2` |
| `functions/src/shared/editorialImageAssetContract.ts` | `39d89e007f21b94b59c504b0f577d84ab372859d` |
| `functions/src/types/editorialImageAsset.ts` | `af587a23fc7699eae77074ac67a5f49107384171` |
| `functions/src/news/gcsEditorialBinaryStorageAdapter.ts` | `4bc2c40dd72c4bd3d8c09b349958db7a8e291e9e` |
| `src/services/editorialPersistentBinaryAdapters.test.ts` | `77da131248a8ae641c7b3de0465bbe9e03f5bb18` |
| `app/applet/.oxlintignore` | `6c0d0f5ea142a0cdfc37fdc59451358ea4873e91` |
| `app/applet/.oxlintrc.json` | `58fc9f117568bca7a93b4ad87bc3e37dfdfeff7e` |

## 3. قائمة السماح الحصرية
**CREATE**
1. `functions/src/news/editorialImageVariantProcessor.ts`
2. `src/services/editorialImageVariantProcessor.test.ts`

**MODIFY**
3. `functions/package.json` — إضافة `"sharp": "0.35.5"` كتبعيات تشغيل (dependencies) فقط؛ لا إضافة أي حزمة أخرى يدويًا.
4. `functions/package-lock.json` — بواسطة npm داخل مجلد functions وبالتغييرات اللازمة لهذه التبعية فقط، مع حزمها المنقولة والاختيارية ذات الصلة.

**READ-ONLY**: جميع ملفات IMG-F3-05/06 المقبولة؛ الحقوق، السجلات، مسارات GCS، `functions/src/index.ts`، ملفات Firebase Rules وفهارسها و`firebase.json`، كامل `src/components`، root `package.json`, `package-lock.json`, `bun.lock`, ملفات Oxlint، docs under `public/assets/aistudio`, workflows. لا تعديل شامل أو نقل ملفات أو `rm -rf`.

## 4. الاعتماد على Sharp
- تم التحقق من `sharp@0.35.5` على npm ومن Node ≥ 20.9 والدعم الرسمي لـ Node 22.
- التنفيذ المقترح: `cd functions && npm install --save-exact sharp@0.35.5` **فقط بعد فحوص preflight**. لا تثبّت في root، ولا تستخدم Bun، ولا تُنشئ config موازية.
- يجب إثبات أن lock يتضمن تبعيات Sharp الاختيارية اللازمة لينكس الإنتاجية، دون تعطيل optional dependencies.
- يجب تشغيل `npm ci` داخل functions بصورة مقيّدة ومسموح بها إن أمكن، واختبار import/runtime native في نفس البيئة؛ إذا رفضت البيئة التثبيت أو فشلت تبعيات native، STOP دون بديل مزيف.
- فحص `functions/package.json` وحده غير كافٍ لإثبات جاهزية GitHub Actions Linux/Node 22؛ إذا تعذر اختبار منصة الاستضافة نفسها يسجَّل كقيد لاحق.

## 5. مواصفة محرك الصور المستقل
تصدير دالة واضحة مثل `processEditorialImageVariants(...)` تستقبل `assetId`, `binary: Buffer`, بيانات MIME والاسم المدّعى عند الحاجة، وتعيد **بالذاكرة فقط** خمس نتائج 
`{variantKey, storagePath, mimeType, width, height, sizeBytes, sha256Checksum, bytes}`، مع بيانات تدقيق من الفحص الأصلي. لا ترسل ملفات، ولا تكتب Firestore/GCS، ولا تُرجع public URL/token.

**سلسلة التحقق:**
1. تحقق من Buffer غير فارغ ≤15,000,000 بايت ومن `validateAssetId`.
2. مرّر الملف عبر `inspectEditorialImageBinary` المقبول (الكشف عن magic/MIME/الامتداد، SVG/GIF/PDF/AVIF/TIFF والمتحركة وغيرها حسب السياسة).
3. استخدم Sharp لفك الصورة فعليًا. لا تعتبر `metadata()` وحدها فك ترميز. ارفض frames >1، الصورة الغريبة، الأخطاء/التحذيرات، أو فشل قراءة البكسلات.
4. حافظ على اتجاه EXIF الصحيح بــ `autoOrient`، وعلى الشفافية، وتجنّب تمرير metadata: لا `withMetadata`, `keepExif`, `keepXmp`, `keepIptc`. اختبر إزالة EXIF/GPS/XMP/IPTC فعليًا قدر الإمكان.
5. أعد ترميز النتائج الخمس إلى `image/webp` ثابتة. أحجام العرض الأقصى المعتمدة *كمقترح تنفيذ أولي قابل للمراجعة*، بالترتيب: thumbnail 320; card 720; article_inline 1280; article_cover 1920; original_processed 2560 بكسل. الارتفاع يتبع النسبة، دون crop افتراضي، ودون تكبير، ودون تجاوز 10,000 محور أو 25,000,000 بكسل.
6. اشتق `storagePath` من `buildEditorialImageVariantStoragePath(assetId, variantKey, 'image/webp')` لا تركيب حر للمسار. اقلب المخرجات إلى Buffer مستقل لكل مشتقة، وأعد قياس `sha256Checksum`, bytes, dimensions, mime بعد إعادة ترميزها والتحقق من فك ترميز الناتج.
7. حد نتيجة كل مشتقة ≤15,000,000 بايت، ورصد إجمالي bytes للنتائج من دون تسرب خارج النطاق. اختبار رفض الدفعة كاملة عند فشل مشتقة واحدة. لا تُعِد 5 نسخ بايتية للأصل وتدّعي معالجتها.
8. استخدم `limitInputPixels: 25_000_000`, `unlimited: false`, `failOn: 'warning'`, `animated: false`, `pages: 1`, `timeout({seconds: 15})` لكل عملية decode/encode، وعالج timeout/unsupported/corrupt برفض صريح. تنفذ مشتقات الملف الواحد تسلسليًا لتجنب خمس عمليات فك متزامنة لنفس الصورة. لا تدّعي احتواء الذاكرة بدقة دون اختبارات على بيئة منفصلة.

**نتائج مثبتة مشروطة:** حجم الصورة الصغير قد ينتج مشتقات لها نفس الأبعاد أو حتى نفس checksum؛ لا تطلب اختلاف bytes قسريًا. وعلى الصورة الكبيرة يجب أن تختلف أبعاد الصور لتثبت تحولًا حقيقيًا.

**عقد الأخطاء:** أخطاء محددة `INVALID_INPUT`, `UNSUPPORTED_IMAGE`, `CORRUPT_IMAGE`, `PROCESSING_FAILURE`, `OUTPUT_VALIDATION_FAILED` (أو أسماء متسقة وموثقة)، دون نشر بايتات الإدخال أو معلومات حساسة. لا تغطي حقائق المصدر حقوق النشر أو سلامة PDF.

## 6. اختبارات قبول هذه الوحدة
- عينات PNG/JPEG/WebP ثابتة مولدة داخل الاختبارات؛ اختبارات إنتاج وتحقق من ناتج WebP حقيقي، الأبعاد، النسب، SHA وbytes والمسارات لكل المفتاح الخمسة.
- Input كبير صالح ينتج أحجامًا مختلفة؛ Input صغير لا يكبر، وقد تتساوى أبعاده بين المشتقات.
- JPEG ذو اتجاه EXIF متغير وصورة metadata تحتوي معلومات حساسة تختبر التوجيه والإزالة، مع عدم إدخال بيانات GPS حقيقية للمستخدمين في fixture.
- Alpha في PNG محفوظ، ولا يُسمح برسوم متحركة.
- MIME أو امتداد مزيف، ترويسة صالحة ولكن pixel stream فاسد، oversized buffer/pixels، غير مدعوم، failure/timeout؛ رفض صريح دون إرجاع نجاح جزئي.
- جميع 134 اختبارًا سابقًا ضمن 6 suites يجب إعادة تشغيلها إضافة للاختبارات الجديدة وإيضاح العدد النهائي. لا تستخدم Fixtures وهمية لاختبار فك الترميز نفسه.
- فحص isolated strict TS وخطوة native import، و`npm ci` في functions على بيئة Node 22 إن أمكن. نجاح TypeScript ليس دليلًا كافيًا على pixel decoder أو بناء/نشر Functions. عيب TS5107 الأساسي لا يصلح خارج النطاق.
- التقرير النهائي يجب أن يذكر بوضوح: **processor_only / upload_not_wired / GCS_crash_gap_open / no_public_upload**.

## 7. شرط التوقف وحماية المشروع
إذا فشل تطابق بصمة أي ملف مسبق، أو كان Sharp مثبتًا مسبقًا بطريقة غير متوقعة، أو ظهر conflict أو ملف محذوف، أو استلزم الأمر تعديل IMG-F3-05/06 أو إضافة API جديد أو إصلاح cloud deploy، **STOP** دون تغيير خارج النطاق، وارفع تقريرًا. لا Git/Push/Deploy/Firebase CLI. لا تستعيد ملفًا من GitHub عبر اسم المسار؛ الفحص يعتمد على Studio المحلي وبصمات المرجع الموثقة.

## 8. مسار الإطلاق بعد هذه الوحدة
لا تُعلن المشكلة محلولة بعد إنشاء المحرك؛ يُنجَز مسار رفع الصور لاحقًا بعد: تصميم safe handoff لـ GCS/Firestore، وربط endpoint مأذون وصلاحيات البشر وحجم الملفات، وربط محرر الخبر وحقول الصورة، ثم اختبار حقيقي على Firebase وقبول مرئي/وظيفي. تُراجع أولويات هذه الأجزاء بحسب مانع الإطلاق. وعند القبول الصريح لــ IMG-F3-07 يجب مراجعة وتحديث **كل** وثائق الاستمرارية الحية، إعلان غير المتأثر، تحديث ledger والـmanifest SHA256 والتحقق من ZIP وإرفاق النسخة الجديدة.

## 9. مراجع عامة للتحقق
- https://www.npmjs.com/package/sharp
- https://sharp.pixelplumbing.com/install/
- https://sharp.pixelplumbing.com/api-constructor/
- https://sharp.pixelplumbing.com/api-resize/
- https://sharp.pixelplumbing.com/api-output/
- https://sharp.pixelplumbing.com/api-operation/
