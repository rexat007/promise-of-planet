# وعد الكوكب — IMG-F3-06 | مواصفة تصحيح فهرس جلسات الاسترداد

**التاريخ:** 22 أكتوبر 2026  
**الحالة:** OWNER_APPROVED_DESIGN_CHANGE — IMPLEMENTATION_PENDING — UNPUSHED — UNDEPLOYED  
**المستودع:** `rexat007/promise-of-planet`  
**GitHub pushed baseline:** `769f7f1888b8b0ed74ab34d8bb0d3a438962f4a5`  
**مصدر التغييرات غير المرفوعة:** مساحة Google AI Studio المحلية فقط.

## 1. سبب التصحيح ومرجعيته

أظهرت مراجعة IMG-F3-06 أن الاستعلام المحدود عن الجلسات المنتهية بعد `limit` يمكن أن تحجبه سجلات `Completed`. نفّذ Studio تصحيحًا أوليًا محليًا بالاستعلام حسب `status`؛ لكن الاستعلام `where('status','==',status).limit(L)` لا يضمن الوصول إلى جلسة منتهية إذا سبقها أكثر من `L` جلسة **لم تنتهِ** من الحالة نفسها.

أعطى المالك موافقة صريحة على إضافة فهرس Firestore مركب يعالج هذا السبب. هذه الموافقة **لا تفوض Push أو Deploy أو تشغيل Firebase حقيقي**. المرجع المحلي غير المرفوع (بحسب تقرير Studio، يجب التحقق من بايتاته قبل الكتابة):

| Local file | Expected Git blob SHA-1 |
|---|---|
| `functions/src/news/firestoreEditorialBinaryIntakeSessionStore.ts` | `6806070551641d99001f194482316f5f8bc3f4ad` |
| `src/services/editorialPersistentBinaryAdapters.test.ts` | `0218ed6973e292235e34e492925a89d0baf3ab19` |

ومن النسخة المرفوعة يجب مطابقة:

| Pushed file | Expected Git blob SHA-1 |
|---|---|
| `firebase.json` | `8e63d6539278a8754a4149fab007b795c2a4201f` |
| `functions/src/news/gcsEditorialBinaryStorageAdapter.ts` | `4bc2c40dd72c4bd3d8c09b349958db7a8e291e9e` |
| `functions/src/news/editorialBinaryIntakeService.ts` | `61c13c7878112a6a0cd075df094478449c97d5b2` |

`firestore.indexes.json` غير موجود في شجرة الـcommit المرفوع ويجب التأكد من عدم وجوده/عدم تغيير محتواه محليًا قبل الإنشاء. ملفا Oxlint محميان.

## 2. قائمة السماح الحصرية

1. `functions/src/news/firestoreEditorialBinaryIntakeSessionStore.ts` — MODIFY.
2. `src/services/editorialPersistentBinaryAdapters.test.ts` — MODIFY.
3. `firestore.indexes.json` — CREATE، فقط إذا غائب محليًا.
4. `firebase.json` — MODIFY لإضافة `firestore.indexes` إلى المسار الصحيح مع حفظ جميع الحقول القديمة دون تغيير.

أي حاجة إلى ملف خامس، تغيير العقد المقبول، إضافة تبعية، أو تعديل قواعد الأمان تستوجب **STOP** دون تنفيذ توسع تخميني.

## 3. التصميم المفضل لاستعلامات الاسترداد

تُفصل الحالات إلى مجموعتين وفق العقد الحالي:

- **Direct actionable** دون شرط انتهاء: `NeedsReconciliation`, `CleanupPending`, `Registering`, `Registered`.
- **Expiry-gated**: `Created`, `Quarantined`, `PreliminarilyVerified`, `Promoting`. يجب أن يتضمن **استعلام Firestore ذاته** `where('status','==',status).where('expiresAt','<=', nowIso).orderBy('expiresAt','asc').limit(L)`، لا أن تُطبق `expiresAt` بعد `limit`.

للحالات المباشرة، يفضّل استعلام `where('status','==',status).orderBy('expiresAt','asc').limit(L)` لتطبيق حدود واضحة وترتيب ثابت، مستخدمًا الفهرس نفسه. امتناع طلب `nowIso` عن استرداد الحالات Expiry-gated مطابق لنطاق العقد الحالي. المعاملة مع `nowIso` غير الصالح يجب أن تفشل بوضوح لا أن تسقط الاستعلام بصمت.

الفهرس الجذري المرتقب:

```json
{
  "indexes": [
    {
      "collectionGroup": "editorial_binary_intake_sessions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "expiresAt", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

ربط Firebase: إضافة `"indexes": "firestore.indexes.json"` بجانب `"rules": "firestore.rules"` داخل `firebase.json` فقط. **هذا ملف تعريف لا يفعل الفهرس السحابي بمجرد Push.** يحتاج ذلك لاحقًا إلى مسار نشر مُصرّح به، مع التأكد من إنشاء الفهرس واكتمال حالته قبل ربط الاسترداد الحقيقي.

## 4. ضمانات ومخاطر يجب عدم تمويهها

- **الحدود:** `MAX_RECONCILIATION_LIMIT = 100`؛ لا يجري مسح غير محدود.
- **استقرار الاختيار:** ترتيب الجلسات بعد الدمج `expiresAt`, ثم `intakeId`؛ استعلامات فرعية `orderBy` وفي حالة الحاجة يكون tie-breaker آمنًا دون طلب فهارس إضافية. لو احتاج السلوك الفعلي مؤشر تقدم أو فهرسًا آخر يجب STOP وبيان الحاجة.
- **تقدم الدفعات:** يثبت الاختبار تجاوز 105 جلسات Created غير منتهية للوصول إلى جلسة Created منتهية، وتقدّم مجموعات أكبر من L مع انتقال الجلسات المعالجة إلى حالة نهائية. لا تدّع ضمان التقدم إذا ظلّت السجلات المختارة عالقة دون تغيير حالتها.
- **`Failed` مع `pendingCleanupObjects` غير فارغة:** يوجد اختلاف محتمل بين التسمية «terminal Failed» وبين كود `reconcileIntake` الذي يعيد معالجة Failed عندما توجد عناصر تنظيف معلقة. يجب فحص قابلية نشوء هذه الحالة في العقد والنسخ المقبولة. إن لم يمكن تغطيتها بفهرس/تمثيل دائم ضمن قائمة السماح فالتصرف الصحيح هو **STOP_WITH_DESIGN_BLOCKER**؛ لا تتركها مهملة ولا تضف أعمدة فهرسة مشتقة بدون قرار.
- **السجلات التالفة:** المحافظة على fail-closed دون كشف payload، والتحقق من التقاط عطب المستندات التي تسترجعها الاستعلامات. لا تدّع الكشف عن كل مستند تالف في مجموعة لا تُمسح بكاملها.
- **فجوة GCS orphan بعد الكتابة وقبل session receipt:** تبقى **OPEN / PRODUCTION BLOCKER**؛ لا تغيّر `EditorialBinaryIntakeService` المقبولة في هذه الوحدة.
- **مدى الاختبار:** لا تشغيل Firebase مباشر أو إثبات فهرس فعلي على مشروع سحابي؛ محاكاة وترجمة عقود فقط.

## 5. اختبارات القبول

1. 105 جلسات `Completed` قديمة ثم جلسة `Created` منتهية؛ تُسترجع الأولى المناسبة لا الـCompleted.
2. 105 جلسات `Created` غير منتهية ثم جلسة `Created` منتهية؛ تُسترجع المستحقة دون أن يشغل غير المستحق نافذة `limit`.
3. دفعات 120 جلسة منتهية مع محاكاة تغيير الحالات بعد المصالحة؛ تسلسل 50→50→20→0 وفق الحد والتحكم.
4. direct actionable حتى إن لم تنتهِ، expiry-gated لا تُرجع قبل موعدها.
5. `Completed` و`Failed` المكتملة لا تشغل نافذة النتائج؛ حالة `Failed` مع تنظيف معلق موثّقة بنتيجة مثبتة أو STOP.
6. إسناد `orderBy`, `where`, `limit` في fake Firestore بدقة، لا تجاهل فلاتر الاختبار.
7. استعلام فهرس وملف تعريف فهارس مطابقان وتغيير `firebase.json` محصور.
8. إسقاط السجلات التالفة ممنوع؛ تقارير `STORAGE_FAILURE` بلا بيانات حساسة.
9. ست مجموعات الاختبار السابقة — أساس 130/130 في تقرير Studio — مع الاختبارات الجديدة، وفحص TypeScript معزول.
10. لا تغييرات على GCS، Oxlint، العقود المقبولة، الملفات العامة، الحزم أو قواعد Firebase.

## 6. حالة المستودع والتوثيق

بعد التقرير: **لا قبول تلقائي ولا Push**. راجع GitHub Sync قائمة الأربع ملفات المقصودة فقط، ثم Push يدوي بعد موافقة المالك على النطاق. نفّذ تدقيق مصدر عن طريق GitHub بعد الرفع. لا تُغلق IMG-F3-06 قبل القبول الصريح وتحديث كل وثائق الاستمرارية وفهرس SHA-256 وZIP؛ أبقِ الوثائق التاريخية سليمة، وسياسة `bun.lock` والوثائق المؤقتة العامة دون تغيير.

## 7. مصادر خارجية للتحقق التقني

- Firebase, Firestore index overview: https://firebase.google.com/docs/firestore/query-data/index-overview
- Firebase, Index definition reference: https://firebase.google.com/docs/reference/firestore/indexes
- Firebase, Queries and compound index: https://firebase.google.com/docs/firestore/query-data/queries

**الوحدة مفتوحة، ولا نشر.**
