# Promise of Planet — إعداد المشروع

## نظرة عامة

تم إنشاء هذا المشروع من الصفر باستخدام التقنيات التالية:

- **React** - مكتبة واجهة المستخدم
- **TypeScript** - لغة البرمجة ذات الأنواع الثابتة
- **Vite** - أداة البناء والتطوير السريع
- **Tailwind CSS** - إطار عمل CSS utility-first

## تاريخ الإنشاء

تم إنشاء المشروع في بيئة Qwen السحابية كمشروع جديد تمامًا من الصفر.

## البنية التقنية

### المتطلبات الأساسية

- Node.js (v18 أو أحدث)
- npm أو pnpm أو yarn

### التبعيات (Dependencies)

```json
{
  "react": "^19.x",
  "react-dom": "^19.x",
  "typescript": "^5.x",
  "vite": "^6.x",
  "tailwindcss": "^3.x",
  "postcss": "^8.x",
  "autoprefixer": "^10.x"
}
```

## التثبيت المحلي

لتشغيل المشروع على جهازك المحلي:

```bash
cd promise-of-planet
npm install
npm run dev
```

## البناء للإنتاج

```bash
npm run build
```

## التحقق من الأنواع (TypeScript)

```bash
npm run type-check
```

## ملاحظات هامة

1. **GitHub**: لم يتم ربط هذا المشروع بمستودع GitHub من خلال بيئة Qwen. سيتم الربط لاحقًا من الجهاز المحلي.

2. **اللغة والاتجاه**: تم ضبط المشروع لدعم اللغة العربية مع اتجاه RTL (من اليمين لليسار).

3. **الصفحة الابتدائية**: تحتوي على صفحة بسيطة جدًا للتأكد من عمل الإعدادات الأساسية.

4. **التصميم والوظائف**: لم يبدأ بعد تصميم المنصة الفعلية أو تطوير وظائفها. هذه المرحلة هي فقط لإعداد البيئة التقنية الأساسية.

## هيكل الملفات

```
promise-of-planet/
├── index.html          # ملف HTML الرئيسي (RTL + عربي)
├── package.json        # تبعيات المشروع
├── tsconfig.json       # إعدادات TypeScript
├── vite.config.ts      # إعدادات Vite
├── tailwind.config.js  # إعدادات Tailwind CSS
├── postcss.config.js   # إعدادات PostCSS
├── src/
│   ├── main.tsx        # نقطة الدخول
│   ├── App.tsx         # المكون الرئيسي
│   ├── App.css         # أنماط إضافية
│   └── index.css       # أنماط Tailwind والأساسية
├── PROJECT_SETUP.md    # هذا الملف
└── PROJECT_STATUS.md   # حالة المشروع
```
