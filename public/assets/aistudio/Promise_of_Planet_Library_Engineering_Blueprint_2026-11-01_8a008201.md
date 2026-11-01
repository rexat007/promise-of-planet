# وعد الكوكب — الوثيقة الهندسية الاسترشادية لمعمل المكتبة البيئية

**الإصدار:** 2026-11-01 — Architecture Reference / Advisory, **NOT an implementation mandate**  
**المستودع:** `rexat007/promise-of-planet`  
**مرجع المصدر المراجع:** `2d8df20598fb540c8bdcdd689b61972cc4c9f30e`  
**النطاق:** إدارة المكتبة، استيعاب المصادر، الفهرسة، المراجعة، المساعد الذكي؛ الحفاظ على نواة المكتبة الحالية.  
**الحالة:** SOURCE AUDITED / DESIGN PROPOSED / NO CHANGES AUTHORIZED.

## 1. سلطة هذه الوثيقة
هذه خريطة للفكرة وبدائل تنفيذها، **ليست قائمة أوامر ملزمة ولا ترخيصًا بتغيير كل الملفات أو إضافة كل المزايا**. تنفيذ Google AI Studio يبدأ فقط من برومبت منفصل بقائمة سماح محدودة، ويجوز للمصدر الفعلي والاختبارات كشف حل أفضل أو أصغر. التعارض مع العقود الحالية أو التحقق من المصدر يتطلب STOP ورفع توصية، وليس تجاوز العقود. ملفات GitHub المرفوعة هي مصدر النسخة المرفوعة، وStudio المحلي مصدر تغييراته غير المرفوعة.

## 2. الحقائق المثبتة — النسخة الحالية
فُحصت الملفات على المرجع المثبت. هذه حقائق من **المصدر** وليست تأكيد تشغيل إنتاجي:

| المكوّن | المسار | Git blob SHA-1 | النتيجة |
|---|---|---|---|
| الإدارة | `src/components/library/AdminLibraryManagement.tsx` | `e0ca1c0ca9386b2cf2e29dcf62cde2fe42d8371a` | تحميل سجلات خادمية، بحث ومرشحات نوع/حقوق/حالة، إنشاء وتحديث |
| محرر المستند | `src/components/library/LibraryDocumentEditorModal.tsx` | `41cd43433eddcf230c21d0a930aa0e1885e91221` | تبويبات وصف/محتوى/حقوق/دورة عمل/إصدارات |
| واجهة الجمهور | `src/components/library/PublicLibraryHub.tsx` | `43fbd859178c7dd58be1f9b94e6208257c20a439` | جلب المنشور فقط، بحث/مرشحات، رابط مصدر مضبوط؛ AI أمام الجمهور إرشادي وغير متصل |
| عقد البيانات | `functions/src/shared/libraryContract.ts` | `8e3edd227d4ce8d3a2734e168d70f976eb991517` | LibraryDocument / Source / Organization / Version / Rights / Public DTO |
| عميل الإدارة | `src/services/libraryAdminClient.ts` | `fbc57ccef72ffb8c974308550ad97cd7bbf5aecc` | callable لأفعال list/get/create/metadata/rights/workflow/version |
| خدمة الخادم | `functions/src/library/libraryApplicationService.ts` | `6b8c030e30d050aea8b9a258c5c467e9f06006b8` | بناء سجل Draft، ضبط الحقوق، انتقالات Draft→InReview→Approved→Published، إضافة إصدار |
| وظائف الخادم | `functions/src/library/libraryAdminHandlers.ts` | `c1690bf0fbfecd740d867b919589a08029664dec` | `manageLibraryDocuments` بتحقق صلاحيات، و`getPublicLibrary` |
| التحقق | `functions/src/library/libraryValidator.ts` | `bbe2061b278f9b4f3c296532b767d02acc115f72` | تحقق عقد وحصر الحقول |
| التخزين | `functions/src/library/firestoreLibraryRepository.ts` | `f24a01ac8a0ed2dda31385736f1ed04ca6752c1c` | Firestore مع معاملات إنشاء/تحديث |

**ثغرات مؤكدة من القراءة:**
- `AdminLibraryManagement` يستخدم `MOCK_ORGANIZATIONS` و`MOCK_SOURCES` لخيارات الجهات والمصادر، رغم وجود `organizationId` و`sourceId` في العقد. **وجود المعرفات لا يثبت وجود سجل مرجعي دائم متصل بها**.
- `PublicLibraryHub` لديه أزرار AI ترجع رسالة بعدم إتاحة الاستدعاء بدل تنفيذ توليد فعلي؛ لا يصح وصفها بأنها AI منتج.
- البحث الحالي في الواجهة العامة تصفية محلية للوثائق المجلبة، وليس بحثًا متقدمًا مفهرسًا مثبتًا أو استرجاعًا من مصادر خارجية.
- `LibraryDocumentVersion.referenceUrl` يدعم رابطًا، لكنه لا يثبت فحص HTTP الفعلي أو مراقبة تغيّر المصدر أو اكتشاف الروابط.
- مصدر الوثيقة وحقوق نشرها متمايزان عن حالتها التحريرية، وهي قاعدة يجب الحفاظ عليها.
- مراجعة الكود لا تثبت نشر وظائف المكتبة في الإنتاج أو سلامة بيانات Firestore الحالية. اختبارات تشغيل/صلاحيات مستهدفة مطلوبة عند التنفيذ.

## 3. الأرشيف — ما يُستفاد منه وما لا يُستنسخ
**المصدر:** `وعد-الكوكب-promise-of-planet.zip` ودراسة `Promise_of_Planet_Archived_Library_Architecture_Review_2026-11-01.md`.
- `ClimateLibrary.tsx`: بطاقات، نافذة تفصيل، البحث والتصفية المحلية.
- `PolicyHub.tsx`: طبقة تشبه مرصد السياسات؛ 12 سجلًا نموذجيًا؛ `un/int/reg/nat/sci`، ملخصات ونقاط رئيسية وعرض عربي/إنجليزي.
- `server.ts`: استدعاءات Gemini لتلخيص/ترجمة محتوى الوثائق؛ كود قديم غير مواءم ولا يُنقل كخادم جاهز.
- زر `AI Search` لم يكن موصولًا بتنفيذ فعلي؛ كثير من `downloadUrl` كانت `#`؛ لا يوجد خط إنتاج حفظ/اعتماد/نشر مثبت داخل المكتبة الأرشيفية.

**قاعدة النقل:** استلهم أنماط UX والحقول المعرفية؛ لا تنقل مصادر وهمية ولا API القديم ولا تخزن مخرجات AI كحقيقة منشورة.

## 4. مرجع مفتوح المصدر — التقييم والاختيار

### الاختيار الأول: Paperless-ngx — مرجع أنماط وخوارزميات إدارة المستندات
المصدر الرسمي: https://github.com/paperless-ngx/paperless-ngx  
الوثائق: https://docs.paperless-ngx.com/  
API: https://docs.paperless-ngx.com/api/

ميزات مثبتة في وثائقه: إدخال مستندات، OCR، تصنيف/وسوم/جهات/أنواع مستندات، حقول مخصصة، بحث نصي كامل، تصفية محفوظة، إصدارات وAPI، مع مساعد AI اختياري في الإصدارات الموثقة. **الاستفادة المطلوبة:** تصميم معمل استيعاب الوثيقة، تمييز مرحلة معالجة الملف، الفهرسة، سجل الحالة ومراجعة الوسوم/المقترحات، لا تبني Python/Django وخدمات تشغيل أخرى داخل Firebase تلقائيًا. افحص ترخيص أي كود قبل إعادة استخدامه؛ الاقتراح الحالي لا يتضمن نسخ كوده.

### بديل للمكتبة المؤسسية: Omeka S
https://omeka.org/s/ — https://omeka.org/s/docs/developer/api/rest_api/  
ملائم لقوالب الوصف الببليوغرافي والربط الدلالي للموارد ومجموعات العناصر وتصدير JSON-LD. **الاستفادة:** تصميم metadata متعدد الأبعاد والروابط المصدرية. ليس مبررًا لإدخال PHP/MySQL في المنصة.

### مرجع كبير عند التوسع: DSpace
https://github.com/DSpace/DSpace  
ملائم للمستودعات المؤسسية طويلة الأمد وواجهات الاسترجاع REST/OAI-PMH؛ يتطلب منظومة Java/Angular وقاعدة بيانات مختلفة، لذا لا نوصي بتشغيله كجزء من التطبيق الحالي.

**قرار:** Paperless-ngx هو مرجع سير عمل **المعمل الإداري** الأقرب؛ Omeka S مرجع وصف بيانات وDSpace مرجع مستودع طويل الأمد. الحفاظ على منظومة TypeScript/React/Firebase الحالية أولى من استبدالها.

## 5. الرؤية المستهدفة — معمليًا ثم علنيًا

`مصدر مرشح (رابط رسمي/رفع مصرح/بحث AI مقيد)` → `Inbox داخلي` → `تحقق مصدر وإصدار وحقوق` → `استخراج قابل للتدقيق` → `اقتراح AI للملخص والوسوم والتصنيفات والترجمة` → `مراجع بشري يصحح ويعتمد` → `دورة LibraryDocument الحالية` → `نشر سجل PublicLibraryDocument فقط` → `مراقبة المصدر والتحديث`.

**مبدآن لا يُتنازل عنهما:**
1. الذكاء الاصطناعي مساعد/مرشح لا ناشر ولا مصدرًا مستقلًا للحقيقة.
2. «الرابط العام متاح» ليس مساويًا لوجود حق إعادة استضافة ملفه؛ التفريق بين metadata/linking/hosting.

## 6. الوحدات المفاهيمية المرغوبة (ليست وحدات تنفيذ مفروضة)
- **Source registry:** جهة مصدرة، بلد، نوع الجهة، اسم ورابط رسمي، ثقة التحقق، حالة صحة الرابط وآخر مراجعة.
- **Acquisition inbox:** مرشح وثيقة من URL/رفع مرخص/اقتراح AI مع حالات Candidate, Verified, Rejected داخليًا (الأسماء مقترحة، لا إضافتها قبل مقارنة enum الموجود).
- **Extraction:** فحص النوع والحجم، PDF metadata، نص أصلي/تغطية صفحات، OCR اختياري محصور؛ حفظ البايتات بإذن فقط؛ حفظ checksum وإصدار/رابط المصدر.
- **Classification:** وثيقة قانون/قرار/بحث/اتفاقية (حقل documentType الحالي)؛ مجال بيئي environmentalDomains؛ **بُعد مستقل** نطاق الجهة UN/دولي/إقليمي/وطني/بحثي؛ جغرافيا، سنة، لغة، حقوق، موضوعات.
- **AI review workspace:** تلخيص عربي/إنجليزي، نقاط رئيسية، ترجمة، اقتراح بيانات ومصدر مرشح، درجة ثقة/سبب، اقتباسات مع رقم الصفحة أو مقطع/رابط؛ لا تقبل ادعاء رابط تم التحقق منه دون HTTP/بيانات موثقة. سجل model/version/promptHash/time/inputsHash ولا يُعرض ذلك للجمهور تلقائيًا.
- **Editorial handoff:** تظل `LibraryApplicationService` و`manageLibraryDocuments` والـworkflow/rights canonical authority؛ لا آلية نشر ثانية موازية.
- **Public catalogue:** البحث ثنائي اللغة والمرشحات متعددة الأبعاد والملخصات المعتمدة وروابط المصدر الدقيقة والنسخ المنشورة فقط.
- **Maintenance:** مراقبة تغير URL أو إصدار، إنشاء إشعار/مرشح تحديث إداري، لا استبدال تلقائي لسجل منشور.

## 7. تصميم بيانات استرشادي — قبل تعديل العقود
**لا تنشئ هذه الحقول مباشرة.** افحص التوافق وتخطيط الترحيل؛ الأفضل سجل ترشيحات داخلي منفصل عند الحاجة، بدل إضافة عشرات الحقول إلى `LibraryDocument` دفعة واحدة.

| المجموعة | مقترح حقول/علاقات | القيد |
|---|---|---|
| Source record | stable sourceId, organizationId, sourceCanonicalUrl, verifiedAt, verificationMethod | لا اعتبار `MOCK_SOURCES` مصدرًا حقيقيًا |
| Candidate | candidateId, originalUrl, discoveryMethod, receivedAt, sourceEvidence, reviewState | خاص بالإدارة، لا وصول عام |
| Extracted evidence | documentHash, mime, pageRef, textSpan, extractedAt, extractionTool | لا اقتباسات مختلقة؛ حقوق ملف محفوظة |
| AI suggestion | candidateId, fieldName, proposedValue, evidenceRefs, modelId, runTime, reviewerDecision | سهل الرفض والتعديل، لا يخزن كحقيقة معتمدة |
| Classification | documentType, environmentalDomains, orgScope, geography, language, year | تجنب خلط نوع المستند بنطاق الجهة |
| Link status | normalizedUrl, httpStatus, redirectTarget, lastCheckedAt, accessTerms | HTTP فشل = تعليق لا تخمين |
| Publication | canonical LibraryDocument id, versions, rightsStatus, workflowState, history | خاضع للعقود القائمة وموافقة بشرية |

**تجنب التكرار:** normalized canonical URL + DOI/ISSN/رقم قرار عند وجوده + hash المحتوى عند السماح باستخراجه؛ كل مؤشر مساعد وليس قرينة نهائية منفردة.

## 8. سياسات البحث وجلب الروابط
- قوائم مصادر رسمية سودانية/إقليمية/دولية يحددها مسؤول المكتبة، ونطاقات قابلة للضبط؛ المصادر المقترحة لا تصبح موثوقة تلقائيًا.
- تمييز URL الفهرس عن URL الملف وعن رابط النسخة/القرار، ومعالجة إعادة التوجيه دون السماح بـSSRF أو نطاقات داخلية/عناوين خاصة/metadata endpoints.
- rate limits, bounded timeouts, retry budget, الحجم، فحص MIME، حد عدد النتائج، تخزين نتيجة فحص الرابط؛ لا تنفيذ جلب لا محدود.
- حقوق الاستخدام قبل التخزين الدائم، وسياسات robots/شروط الاستخدام قبل الزحف، والتحقق من حالة PDF الأصلية.
- بحث داخلي أولي عن metadata المنشور دون محرك جديد؛ البحث النصي الكامل/الدلالي مرحلة لاحقة مشروطة بحجم مكتبة فعلي وقياس جودة.

## 9. ضوابط AI
- تنفذ الاستدعاءات من الخادم بمفتاح آمن وحدود تكلفة ومعدل طلب لكل دور؛ لا مفتاح AI في المتصفح.
- تمييز Extracted fact / Inferred classification / Suggested summary / Unverified link.
- المصدر الذي لم يرفع أو لا يمكن قراءة نصه لا يجوز وصف مخرجاته بأنها «ملخص للوثيقة كاملة»؛ يمكن إنشاء مقترح وصف مبني على metadata وموسوم.
- حماية من prompt injection في PDF والصفحات؛ النص الخارجي بيانات لا تعليمات.
- شاشة مقارنة «المصدر — المقترح — تحرير المراجع»، مع نسخة قبل/بعد، مسار تدقيق، وزر اعتماد محدد.
- لا AI auto publish ولا قرار حقوق تلقائي ولا نسخ محتوى محمي دون إذن.

## 10. الصلاحيات والحقوق والنشر
- خادم `manageLibraryDocuments` مصدر سلطة الصلاحيات، لا عناصر الواجهة.
- Review/Approve/Publish/ManageRights صلاحيات متمايزة؛ لا جمعها لمجرد وجود دور إداري عام.
- `rightsStatus` مستقل عن `workflowState`، وللنشر حواجز تحقق حقوق وإسناد المصدر.
- `PublicLibraryDocument` يبقى منزوع حقول المراجعة الداخلية/الأدلة الخاصة/مفاتيح API.
- لا ترفع ملفات أو تستخدم وصلة تنزيل إلا بعد موافقة حقوق واضحة؛ عرض رابط المصدر قد يكون أنسب من التخزين.
- سجلات audit لمصدر/حقوق/تصنيف/تحرير/قرار، لا محو النسخ السابقة.

## 11. تصميم الواجهة — مبادئ
- Sidebar إداري قليل الخيارات: «الوثائق»، «وارد المصادر»، «مراجعة AI» يمكن تبويبها داخل الإدارة الحالية، لا إنشاء واجهة إدارة موازية.
- شاشة الوثيقة: «الوصف»، «المصدر والتحقق»، «الحقوق»، «التحليل المقترح»، «الإصدارات»، «دورة النشر» بالقدر الذي يبرره حجم التنفيذ.
- بطاقة مرشح تُظهر حالة تحقق المصدر وصلاحية الرابط، لا فقط عنوانًا وهميًا.
- واجهة عامة لا تقدم أزرار AI شكلية؛ إما فعل آمن مثبت أو عرض الملخص التحريري المعتمد بلا إيحاء بذكاء آني.
- Arabic RTL / English LTR؛ هاتف/تابلت/كمبيوتر؛ أقل قدر من التكرار.

## 12. الاختبارات ومعايير القبول المستقبلية
1. Source not verified → لا اعتماد ولا نشر ولا رابط تنزيل موهوم.
2. Rights Unknown/Restricted/NotRedistributable → حظر استضافة ملف عام غير مأذون.
3. Candidate AI → لا يصبح `Published` دون موافقات بشرية.
4. Cross-role abuse →  permission-denied لكل عملية محررة دون صلاحية.
5. Version provenance → تعديل/نسخة لا يمحو تاريخ المصدر والقرار.
6. Search Arabic/English, filters cross-domain, zero-state, responsive.
7. Duplicate same URL/hash → تنبيه مراجعة، لا تضاعف أعمى.
8. AI output with missing evidence or hostile prompt → لا يقدم حقيقة مؤكدة.
9. Public DTO لا يسرب notes/internal data/private URLs.
10. build + tests + GitHub Sync + اختبار بصري حقيقي؛ لا يعادل build النجاح المرئي.

## 13. ترتيب التنفيذ المقترح (لا يعني بدءه تلقائيًا)
**وحدة 0: Read-only gap/evidence scan** للمصادر الوهمية ودورة حقوق النشر وتبعيات الواجهة الحقيقية وصحة الـcallables.  
**وحدة 1: Source registry & verified link intake** مبنية على المصدر الحالي وبحد أدنى من الملفات، ثم قبول بصري.  
**وحدة 2: إعداد وصف وتصنيف مدعوم بأدلة، إدخال يدوي أولًا**.  
**وحدة 3: AI suggestions behind admin human review** بعد اعتماد آلية المصدر وتحديد التكلفة والمزود.  
**وحدة 4: إصدار المكتبة العامة بالبحث/مرشحات موثوقة**.  
**وحدة 5: مراقبة التحديث وروابط المصادر** عند الحاجة الفعلية.

تُحدد الوحدات وملفاتها النهائيّة في برومبتات لاحقة بناءً على التقرير الفعلي، لا وفق هذه القائمة مباشرة. لا تصنع عشرات الملفات أو تنقل إطار Paperless داخل React/Firebase.

## 14. سياسة Google AI Studio الملزمة للبرومبتات اللاحقة
لكل ملف مطلوب من GitHub: رابط raw مباشر مثبت بمرجع commit، اسم مستودع، المسار، Git blob SHA-1، HTTP200/full-body non-HTML + مطابقة Studio-local. فشل واحد = STOP قبل الكتابة. لا تفترض Git داخل Studio. قائمة سماح دقيقة؛ لا ملفات جديدة/حذف خارجها؛ لا npm install ولا rm -rf. تقرير اختبارات ونطاق GitHub Sync. المستخدم يقبل بصريًا ويعمل Push بنفسه؛ Firebase عبر GitHub Actions بعد الإذن، لا CLI في Studio.

## 15. سجل تحقق وروابط المصادر
- GitHub pinned: https://github.com/rexat007/promise-of-planet/tree/2d8df20598fb540c8bdcdd689b61972cc4c9f30e
- Paperless-ngx: https://docs.paperless-ngx.com/ , https://docs.paperless-ngx.com/api/ , https://github.com/paperless-ngx/paperless-ngx
- Omeka S: https://omeka.org/s/ , https://omeka.org/s/docs/developer/api/rest_api/
- DSpace: https://github.com/DSpace/DSpace
- أرشيف المشروع ودراسته: `وعد-الكوكب-promise-of-planet.zip` و`Promise_of_Planet_Archived_Library_Architecture_Review_2026-11-01.md`

**النتيجة:** CURRENT_LIBRARY_SOURCE_AUDITED / OSS_REFERENCE_RESEARCHED / ADVISORY_BLUEPRINT_COMPLETE / CODE_UNCHANGED.
