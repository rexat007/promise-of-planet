# وعد الكوكب — IMG-F3-04 | مواصفة التنفيذ المعتمدة

**التاريخ:** 2026-10-21  
**الحالة:** السياسات ونطاق الملفات معتمدان من المالك؛ التنفيذ **لم يبدأ**؛ لا Push ولا Deploy.  
**المرجع:** تقرير Source Gate الصادر من Google AI Studio للمساحة المحلية (القراءة فقط)، وعقود IMG-F3-03 المقبولة. هذه الوثيقة توجيه هندسي؛ برومبت التنفيذ هو أمر Studio المباشر.

## 1. القرار المعتمد

- إنشاء سجل دائم متخصص لأدلة حقوق الصور: `editorial_image_rights_evidence/{evidenceId}`.
- قائمة سماح **ثلاثة ملفات حصراً**: عقد الأدلة الجديد، خدمة مراجعة الحقوق القائمة، واختباراتها القائمة.
- الإدخال/الإلغاء من خلال حدود خادمية داخلية مصادق عليها، ولا نشر API أو رفع مستندات أو اتصال إنتاجي.
- السجل يؤكد **وجود وصف دليل مسجل وربطه بالصورة وحالته ومصدر تسجيله الإداري**؛ لا يثبت صحة مستند قانوني أو تطابق بايتاته، حتى لو تضمنت البيانات SHA-256.

## 2. الحالة المرجعية — بصمات Google AI Studio المحلية

| الملف | Git blob SHA-1 المتوقع |
|---|---|
| `functions/src/news/editorialImageRightsReviewService.ts` | `42a722d5ef5f36a45be30a81855c900fa2992bc3` |
| `src/services/editorialImageRightsReviewService.test.ts` | `d310309817d2fbad323a00ef3a70350ce647e8bd` |
| `functions/src/news/editorialImageAssetRepository.ts` | `e83b6bd42c00558b0d8c2147f8d17e64a7e1a965` |
| `functions/src/news/firestoreEditorialImageAssetRepository.ts` | `97e74f6d6eebfc8f38ae3c3e82fd172085cb1990` |
| `functions/src/shared/editorialImageAssetContract.ts` | `39d89e007f21b94b59c504b0f577d84ab372859d` |
| `functions/src/types/editorialImageAsset.ts` | `af587a23fc7699eae77074ac67a5f49107384171` |
| `functions/tsconfig.json` | `eb3212ee4cd1c4acaa70618850e9c0fa0346dbf6` |

تحقق من البصمات في مساحة Studio **قبل أي كتابة**. GitHub ليس مرجع التغييرات المحلية غير المرفوعة، ولا يُطلب من Studio جلب محتوى GitHub.

## 3. قائمة السماح الملزمة

1. **CREATE** `functions/src/news/editorialImageRightsEvidenceContract.ts`
2. **EDIT** `functions/src/news/editorialImageRightsReviewService.ts`
3. **EDIT** `src/services/editorialImageRightsReviewService.test.ts`

يمنع تعديل العقود المقبولة، قواعد Firebase، وظائف التسجيل في `functions/src/index.ts`، إعدادات TypeScript، الحزم أو أي ملف رابع. توقف عند ضرورة توسيع النطاق.

## 4. عقد الأدلة — حد أدنى

`EditorialImageRightsEvidenceRecord`: `evidenceId`, `assetId`, `status: 'Active' | 'Revoked'`, `sourceKind` (قائمة مغلقة مستندة للتقرير: SignedLicenseAgreement, PhotographerWrittenRelease, AgencyContractRecord, PublicDomainArchivalRecord, EditorialExceptionMemo), `sourceReference`, `summary`, `artifactSha256?` (64 lowercase hex), `recordedByUid`, `recordedAtIso`, وحقول الإلغاء الاختيارية `revokedByUid`, `revokedAtIso`, `revocationReason`. يجب اعتماد التحقق الصارم من المفاتيح والتواريخ والسلاسل، واتساق الحقول اللازمة لكل حالة، والنسخ الدفاعية. لا URLs موقعة ولا رموز وصول. لا إدخال بيانات تجريبية ضمن كود الإنتاج.

لا يكفي اختيار `evidenceId` جديد لإثبات وثيقة جديدة؛ يشترط وجود سجل فعلي **مُنشأ بعد القرار السابق** ومربوط بالأصل، بحالة `Active`، وإسناد هوية من قام بتسجيله من مصدر خادمي موثوق. وجود السجل لا يحسم الصحة القانونية.

## 5. حماية الصلاحية داخل المعاملة

تستمر المصادقة الأولية من `requestContext.auth.uid` و`AdminRepository`. وفي **كل** معاملة خادمية تؤثر في مراجعة الحقوق أو تقديم طلب مراجعة أو تسجيل/إلغاء دليل، تُقرأ `admins/{verifiedUid}` باستخدام `transaction.get` قبل أول كتابة وتستخدم الحالة **داخل المعاملة** لإعادة إثبات `isActive`, canonical role, `ManageRights`, منع دور AI، واستثناء الاعتماد الذاتي لـ`Owner` فقط. تستخدم بيانات الهوية والدور المعاملاتية في سجل القرار، لا نسخة قبل المعاملة.

اعمل ضمن واجهة Firestore الهيكلية المقبولة؛ تحقق من دعم الاختبارات ومحاكاة `collectionName` في mock. اختبر تبديل صلاحية المسؤول بين القراءة والالتزام، وإعادة تشغيل transaction callback. لا تدّع أن المحاكاة تعادل اختبار محاكي Firestore الحقيقي.

## 6. سياسة الأدلة والمتانة

- توفير عملية تسجيل خادمية داخلية للأدلة تربط السجل بأصل موجود، مع هوية مسجّل مستمدة من سياق موثوق وتوقيت خادمي، إنشاء فقط إذا لم يكن المعرّف موجوداً، وتوثيق مصدر الوصف. الإلغاء في عملية منفصلة مقيّدة بصلاحية `ManageRights` ومبرر وتاريخ وهوية، دون حذف سجل تاريخي.
- تحقق معاملي `get` من **كل** evidenceRef مطلوب للقرار/طلب المراجعة، قبل كتابة أي مستند؛ عدم وجوده، تعارض `assetId`، إلغاؤه، سوء البنية أو تأخر `recordedAtIso` = رفض فوري. كل كتابة تتبع القراءات.
- عند إعادة اعتماد `Rejected` أو `Revoked`، تتطلب المراجعة طلباً محفوظاً جديداً ودليلاً واحداً على الأقل **مسجلاً بعد القرار السابق** ومختلفاً عن المراجع السابقة، لا مجرد معرف غريب؛ يستهلك الطلب مرة واحدة ذرياً مع القرار والتدقيق.
- لا يتغير نموذج `EditorialImageAssetMetadata` أو حالات الحقوق الأربع أو سياسة السماح لـOwner بالاعتماد الذاتي.
- إذا كان ترتيب التحويل الحالي لا يتيح قراءة الدليل قبل كتابة الطلب أو القرار، يُصلح داخل الملف المسموح فقط، بلا تجاوز لإثبات البنية والحقوق.
- لا يُفسّر `artifactSha256` الاختياري كإثبات بصمة لمستند محفوظ فعلياً؛ لا توجد خدمة تحميل/فحص بايتات ضمن هذه الوحدة.

## 7. التحقق المطلوب

حالات صلاحية المسؤول المنتهية والمتغيرة خلال المعاملة، Owner ينخفض إلى RightsReviewer مع اعتماد ذاتي، أدلة غير مسجلة/ملغاة/تابعة لصورة أخرى/ذات تاريخ غير صحيح، طلب إعادة اعتماد بلا دليل جديد موثق، إعادة استخدام طلب، محاكاة إعادة transaction، فشل كتابة asset أو audit أو request create/consume، تضارب audit ID، والتأكد من عدم حدوث كتابة جزئية. تحقق من طرفي InMemory وmock Firestore، وضمان عزل النسخ، ونجاح الاختبارات القائمة دون إضعافها.

فحوص Vitest وTypeScript المعزولة لا تعني نجاح Functions الشامل. القيد المعروف `TS5107` لنسخة TypeScript في Studio يجب تسجيله منفصلاً دون تعديل الإعدادات أو تثبيت حزم.

## 8. بوابة التسليم

تقرير Studio: الملفات المعدلة فقط، البصمات قبل/بعد، ملخص الواجهات، الاختبارات وexit codes، تفاصيل التحقق من السباق والسجل، أي قيد غير محلول، إثبات عدم ربط وظائف عامة أو تشغيل Firebase. **حالة IMG-F3-04 بعد التنفيذ = بانتظار تدقيق المراجعة وقبول المستخدم**، دون Push أو Deploy.
