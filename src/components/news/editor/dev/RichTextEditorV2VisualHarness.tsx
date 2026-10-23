import { useEffect, useMemo, useState } from "react";
import { RichTextEditor } from "../RichTextEditor";
import type {
  RichNewsDocumentWrapper,
  RichNewsDocumentWrapperV2,
} from "../../../../types/richNewsDocument";
import { ArrowLeft, ArrowRight, Code, Eye, Monitor, RotateCcw, Smartphone } from "lucide-react";

export const DEV_PREVIEW_ASSET_ID = "dev_fixture_asset_preview_01";
export const DEV_PRIVATE_PLACEHOLDER_ASSET_ID = "dev_fixture_asset_private_02";

const DEV_PREVIEW_SVG_MARKUP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 600" width="960" height="600">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f766e" />
      <stop offset="55%" stop-color="#14b8a6" />
      <stop offset="100%" stop-color="#d9f99d" />
    </linearGradient>
    <linearGradient id="dune" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#15803d" />
      <stop offset="100%" stop-color="#065f46" />
    </linearGradient>
  </defs>
  <rect width="960" height="600" fill="url(#sky)" />
  <circle cx="770" cy="140" r="56" fill="#fef08a" opacity="0.9" />
  <path d="M0 410 Q240 330 480 390 T960 365 L960 600 L0 600 Z" fill="url(#dune)" opacity="0.88" />
  <path d="M0 465 Q300 410 620 455 T960 440 L960 600 L0 600 Z" fill="#064e3b" />
  <g fill="#ecfdf5" font-family="system-ui, -apple-system, sans-serif">
    <text x="56" y="88" font-size="22" font-weight="700" letter-spacing="1.5">DEV-ONLY RUNTIME PREVIEW STREAM</text>
    <text x="56" y="126" font-size="17" opacity="0.92">assetId: dev_fixture_asset_preview_01 (Resolved via previewUrlsByAssetId, zero URL in document JSON)</text>
  </g>
</svg>`;

export const DEV_FALLBACK_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(DEV_PREVIEW_SVG_MARKUP)}`;

export function createDevOwnedPreviewBlobUrl(): {
  url: string;
  revoke: () => void;
} {
  if (
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof Blob !== "undefined"
  ) {
    const blob = new Blob([DEV_PREVIEW_SVG_MARKUP], {
      type: "image/svg+xml;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    return {
      url: objectUrl,
      revoke: () => {
        if (typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(objectUrl);
        }
      },
    };
  }

  return {
    url: DEV_FALLBACK_DATA_URL,
    revoke: () => {},
  };
}

export function createDevArabicV2Fixture(): RichNewsDocumentWrapperV2 {
  return {
    schemaVersion: 2,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, dir: "rtl", textAlign: "right" },
          content: [
            {
              type: "text",
              text: "مبادرة واحات الأمل: استعادة الغطاء النباتي عبر تقنيات الحصاد المائي الذكي",
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { dir: "rtl", textAlign: "right" },
          content: [
            {
              type: "text",
              text: "فقرة تمهيدية قبل الصورة: تشهد الأقاليم الجافة وشبه الجافة تحولات بيئية متسارعة تستدعي تطوير حلول ميدانية تجمع بين المعرفة البيئية المحلية والتقنيات الحديثة لإدارة الموارد المائية الموسمية.",
            },
          ],
        },
        {
          type: "editorialImage",
          attrs: {
            assetId: DEV_PREVIEW_ASSET_ID,
            altAr: "منظر ميداني لمصاطب الحصاد المائي والأشجار المحلية في واحة تجريبية",
            altEn: "Field view of micro-catchment terraces and native trees in a pilot oasis",
            captionAr: "الشكل ١: موقع التجربة الميدانية الأول — صورة بمعاينة محلية نشطة ومحاذاة جانبية لاختبار التفاف النص العربي حول الكتلة.",
            captionEn: "Figure 1: Pilot site alpha — active local runtime preview with start-floated layout for text-wrap verification.",
            width: "50%",
            layout: "float-start",
          },
        },
        {
          type: "paragraph",
          attrs: { dir: "rtl", textAlign: "right" },
          content: [
            {
              type: "text",
              text: "فقرة طويلة بجانب الصورة لاختبار التفاف النص (Text Wrapping): أظهرت القراءات الهيدرولوجية الميدانية خلال المواسم الثلاثة الماضية أن إنشاء الأحواض الهلالية المتدرجة يسهم في رفع كفاءة احتجاز مياه الأمطار السطحية بنسبة تتجاوز سبعين بالمئة مقارنة بالأراضي المكشوفة غير المعالجة. وعندما تنمو جذور الأشجار المحلية مثل الغاف والسدر والطلح داخل هذه المصاطب، فإنها تشكل شبكة حيوية متماسكة تثبت التربة الرملية وتحد من انجراف الطبقة السطحية الغنية بالعناصر العضوية الدقيقة، مما يتيح عودة الغطاء العشبي الموسمي واستقرار النظم البيئية المصغرة حول كل شجرة مزروعة بشكل مستدام.",
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { dir: "rtl", textAlign: "right" },
          content: [
            {
              type: "text",
              text: "فقرة ثانية محاذية وبانسياب متصل: كما أكدت فرق الرصد البيئي أن التدرج في توزيع المسافات بين الأشجار يسمح بمرور التيارات الهوائية المعتدلة ويخفف من الإجهاد الحراري خلال أشهر الصيف، وهو ما ينعكس إيجاباً على معدلات بقاء الشتلات الحديثة في عامها الأول والثاني.",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 3, dir: "rtl", textAlign: "right" },
          content: [
            {
              type: "text",
              text: "نموذج الأصل المحمي بدون رابط معاينة (اختبار عنصر النائب الخاص)",
            },
          ],
        },
        {
          type: "editorialImage",
          attrs: {
            assetId: DEV_PRIVATE_PLACEHOLDER_ASSET_ID,
            altAr: "رسم توضيحي لمخطط توزيع الجذور ومستشعرات رطوبة التربة",
            altEn: "Diagram of root distribution and soil moisture telemetry sensors",
            captionAr: "الشكل ٢: أصل صوري ثانٍ بدون رابط معاينة في الخريطة المحلية لإثبات ظهور البطاقة النائبة للأصول الخاصة بأمان.",
            captionEn: "Figure 2: Secondary canonical image node without a preview map entry, demonstrating the private-asset placeholder.",
            width: "75%",
            layout: "block-center",
          },
        },
        {
          type: "paragraph",
          attrs: { dir: "rtl", textAlign: "right" },
          content: [
            {
              type: "text",
              text: "فقرة ختامية بعد الصور: تبرهن هذه التجربة التكاملية أن صون الموارد الطبيعية يبدأ من تصميم وحدات بيئية مرنة قابلة للقياس والتوسع دون الإخلال بالتوازن الحيوي للمنطقة.",
            },
          ],
        },
      ],
    },
  };
}

export function createDevEnglishV2Fixture(): RichNewsDocumentWrapperV2 {
  return {
    schemaVersion: 2,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2, dir: "ltr", textAlign: "left" },
          content: [
            {
              type: "text",
              text: "Oases of Hope Initiative: Restoring Native Canopy Through Micro-Catchment Engineering",
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { dir: "ltr", textAlign: "left" },
          content: [
            {
              type: "text",
              text: "Introductory paragraph before the image: Across arid and semi-arid watersheds, ecological restoration teams are combining traditional rainwater harvesting contours with targeted native reforestation to reverse topsoil loss.",
            },
          ],
        },
        {
          type: "editorialImage",
          attrs: {
            assetId: DEV_PREVIEW_ASSET_ID,
            altAr: "منظر ميداني لمصاطب الحصاد المائي والأشجار المحلية في واحة تجريبية",
            altEn: "Field view of micro-catchment terraces and native trees in a pilot oasis",
            captionAr: "الشكل ١: موقع التجربة الميدانية الأول — صورة بمعاينة محلية نشطة ومحاذاة جانبية لاختبار التفاف النص العربي حول الكتلة.",
            captionEn: "Figure 1: Pilot site alpha — active local runtime preview with start-floated layout for LTR text-wrap verification.",
            width: "50%",
            layout: "float-start",
          },
        },
        {
          type: "paragraph",
          attrs: { dir: "ltr", textAlign: "left" },
          content: [
            {
              type: "text",
              text: "Long wrapping paragraph beside the floated image: Multi-season hydrological telemetry across six pilot micro-catchments demonstrates that crescent-shaped earth bunds increase seasonal rainwater infiltration by more than seventy percent compared to untreated slopes. As deep-rooting indigenous species such as Prosopis cineraria and Acacia tortilis establish within these moisture pockets, their root networks stabilize shifting sediment, shelter beneficial mycorrhizal fungi, and create shaded microclimates that allow perennial native grasses to recolonize adjacent corridors naturally.",
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { dir: "ltr", textAlign: "left" },
          content: [
            {
              type: "text",
              text: "Follow-up paragraph continuing alongside and after the floated figure: Field ecologists further observed that spacing canopy clusters along natural contour intervals reduces surface wind velocity and lowers daytime soil temperature fluctuations during peak summer months.",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 3, dir: "ltr", textAlign: "left" },
          content: [
            {
              type: "text",
              text: "Unresolved Private Asset Node (Private-Asset Placeholder Verification)",
            },
          ],
        },
        {
          type: "editorialImage",
          attrs: {
            assetId: DEV_PRIVATE_PLACEHOLDER_ASSET_ID,
            altAr: "رسم توضيحي لمخطط توزيع الجذور ومستشعرات رطوبة التربة",
            altEn: "Diagram of root distribution and soil moisture telemetry sensors",
            captionAr: "الشكل ٢: أصل صوري ثانٍ بدون رابط معاينة في الخريطة المحلية لإثبات ظهور البطاقة النائبة للأصول الخاصة بأمان.",
            captionEn: "Figure 2: Secondary canonical image node without a preview map entry, demonstrating the private-asset placeholder.",
            width: "75%",
            layout: "block-center",
          },
        },
        {
          type: "paragraph",
          attrs: { dir: "ltr", textAlign: "left" },
          content: [
            {
              type: "text",
              text: "Concluding paragraph after both images: All canonical editorialImage nodes store only assetId and bilingual metadata while preview URLs remain strictly runtime-resolved via previewUrlsByAssetId.",
            },
          ],
        },
      ],
    },
  };
}

export function buildDevHarnessPreviewUrlsMap(
  isPrimaryPreviewEnabled: boolean,
  previewUrl: string = DEV_FALLBACK_DATA_URL
): Readonly<Record<string, string | undefined>> {
  if (!isPrimaryPreviewEnabled || !previewUrl) {
    return {};
  }
  return {
    [DEV_PREVIEW_ASSET_ID]: previewUrl,
  };
}

export interface RichTextEditorV2VisualHarnessProps {
  onExit?: () => void;
  initialLang?: "ar" | "en";
  initialPrimaryPreviewEnabled?: boolean;
  initialContainerMode?: "desktop" | "constrained-mobile";
  initialShowCanonicalJson?: boolean;
}

export function RichTextEditorV2VisualHarness({
  onExit,
  initialLang = "ar",
  initialPrimaryPreviewEnabled = true,
  initialContainerMode = "desktop",
  initialShowCanonicalJson = false,
}: RichTextEditorV2VisualHarnessProps) {
  const [activeLang, setActiveLang] = useState<"ar" | "en">(initialLang);
  const [isPrimaryPreviewEnabled, setIsPrimaryPreviewEnabled] = useState<boolean>(
    initialPrimaryPreviewEnabled
  );
  const [containerMode, setContainerMode] = useState<"desktop" | "constrained-mobile">(
    initialContainerMode
  );
  const [showCanonicalJson, setShowCanonicalJson] = useState<boolean>(
    initialShowCanonicalJson
  );

  const [arDoc, setArDoc] = useState<RichNewsDocumentWrapper | RichNewsDocumentWrapperV2>(
    () => createDevArabicV2Fixture()
  );
  const [enDoc, setEnDoc] = useState<RichNewsDocumentWrapper | RichNewsDocumentWrapperV2>(
    () => createDevEnglishV2Fixture()
  );
  const [ownedBlobUrl, setOwnedBlobUrl] = useState<string>(DEV_FALLBACK_DATA_URL);

  useEffect(() => {
    const owned = createDevOwnedPreviewBlobUrl();
    setOwnedBlobUrl(owned.url);
    return () => {
      owned.revoke();
    };
  }, []);

  const previewUrlsByAssetId = useMemo<Readonly<Record<string, string | undefined>>>(
    () => buildDevHarnessPreviewUrlsMap(isPrimaryPreviewEnabled, ownedBlobUrl),
    [isPrimaryPreviewEnabled, ownedBlobUrl]
  );

  const isAr = activeLang === "ar";
  const activeValue = isAr ? arDoc : enDoc;

  const handleEditorChange = (nextValue: RichNewsDocumentWrapper | RichNewsDocumentWrapperV2) => {
    if (isAr) {
      setArDoc(nextValue);
    } else {
      setEnDoc(nextValue);
    }
  };

  const handleResetFixture = () => {
    if (isAr) {
      setArDoc(createDevArabicV2Fixture());
    } else {
      setEnDoc(createDevEnglishV2Fixture());
    }
  };

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      data-testid="rich-text-editor-v2-visual-harness"
      className="min-h-screen bg-slate-100 text-slate-900 pb-16"
    >
      {/* Top Dev-Only Banner */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white border-b border-slate-800 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono uppercase tracking-wider text-amber-300 border-s-2 border-amber-400 ps-2.5">
              DEV-ONLY VISUAL HARNESS · IMG-F3-09/D2-C
            </span>
            <h1 className="text-sm sm:text-base font-bold text-white">
              {isAr
                ? "فحص القبول البصري لمحرر النصوص الإنتاجي (RichTextEditor V2)"
                : "Production RichTextEditor V2 Visual Acceptance Harness"}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="#img-f1-sandbox"
              className="text-xs text-slate-300 hover:text-white underline underline-offset-4 transition-colors"
            >
              {isAr ? "فتح مختبر الصور المرجعي (#img-f1-sandbox)" : "Compare with #img-f1-sandbox"}
            </a>

            {onExit && (
              <button
                type="button"
                onClick={onExit}
                data-testid="v2-visual-harness-exit"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 border border-slate-700 transition-colors"
              >
                {isAr ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}
                <span>{isAr ? "العودة للتطبيق" : "Exit Harness"}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-6 space-y-5">
        {/* Owner Inspection Controls Bar */}
        <section
          aria-label="Owner Inspection Controls"
          data-testid="v2-visual-harness-controls"
          className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* 1. Language / Direction Toggle */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">
                {isAr ? "اللغة والاتجاه:" : "Language & Direction:"}
              </span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                <button
                  type="button"
                  data-testid="harness-lang-ar"
                  onClick={() => setActiveLang("ar")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeLang === "ar"
                      ? "bg-teal-700 text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  العربية (RTL)
                </button>
                <button
                  type="button"
                  data-testid="harness-lang-en"
                  onClick={() => setActiveLang("en")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    activeLang === "en"
                      ? "bg-teal-700 text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  English (LTR)
                </button>
              </div>
            </div>

            {/* 2. Runtime Preview Map Toggle */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">
                {isAr ? "معاينة الصورة الأولى:" : "Primary Image Preview Map:"}
              </span>
              <button
                type="button"
                data-testid="harness-toggle-preview"
                onClick={() => setIsPrimaryPreviewEnabled((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  isPrimaryPreviewEnabled
                    ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                    : "bg-amber-50 text-amber-800 border-amber-300"
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>
                  {isPrimaryPreviewEnabled
                    ? isAr
                      ? "المعاينة المحلية مفعلة (Blob URL)"
                      : "Preview Available (Owned Blob URL)"
                    : isAr
                      ? "وضع النائب الخاص (بدون رابط معاينة)"
                      : "Private Placeholder Mode (Unresolved)"}
                </span>
              </button>
            </div>

            {/* 3. Constrained Container Width Selector */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">
                {isAr ? "عرض الحاوية (محاكاة):" : "Container Width:"}
              </span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                <button
                  type="button"
                  data-testid="harness-width-desktop"
                  onClick={() => setContainerMode("desktop")}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    containerMode === "desktop"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Monitor className="w-3.5 h-3.5" />
                  <span>{isAr ? "سطح مكتب (كامل)" : "Desktop Container"}</span>
                </button>
                <button
                  type="button"
                  data-testid="harness-width-mobile"
                  onClick={() => setContainerMode("constrained-mobile")}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                    containerMode === "constrained-mobile"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>
                    {isAr ? "حاوية ضيقة (390px)" : "Constrained Container (390px)"}
                  </span>
                </button>
              </div>
            </div>

            {/* Utility Controls: Reset Fixture & Inspect JSON */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="harness-reset-fixture"
                onClick={handleResetFixture}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{isAr ? "إعادة ضبط النموذج" : "Reset Fixture"}</span>
              </button>

              <button
                type="button"
                data-testid="harness-toggle-json"
                onClick={() => setShowCanonicalJson((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  showCanonicalJson
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                }`}
              >
                <Code className="w-3.5 h-3.5" />
                <span>{isAr ? "فحص JSON القانوني" : "Inspect V2 JSON"}</span>
              </button>
            </div>
          </div>

          {/* Explicit Technical Guidance Note on Container Simulation vs Browser Viewport */}
          <div
            data-testid="harness-responsive-note"
            className="text-xs text-slate-600 bg-slate-50 border-s-2 border-teal-600 ps-3 py-2 leading-relaxed"
          >
            {isAr ? (
              <>
                <strong>ملاحظة الفحص:</strong> انقر على أي صورة داخل المحرر أدناه لإظهار شريط الأدوات السياقي المدمج (الأحجام 25%–100%، المحاذاة والالتفاف، مقبض السحب، والحذف). وضع «حاوية ضيقة (390px)» يحاكي عرض العمود الأب فقط، بينما قاعدة طي الطفو التلقائي{" "}
                <code className="font-mono text-slate-800">@media (max-width: 639px)</code>{" "}
                تعتمد على عرض نافذة المتصفح الفعلي (&lt; 640px).
              </>
            ) : (
              <>
                <strong>Inspection Note:</strong> Click any image inside the production editor below to inspect its built-in contextual toolbar (25%–100% width presets, float/block alignment, drag handle, and delete). The <em>Constrained Container (390px)</em> toggle simulates a narrow parent column; actual CSS{" "}
                <code className="font-mono text-slate-800">@media (max-width: 639px)</code>{" "}
                float-collapse rules respond to real browser viewport width (&lt; 640px).
              </>
            )}
          </div>
        </section>

        {/* Real Production RichTextEditor Container */}
        <section
          data-testid="v2-visual-harness-editor-container"
          className={`mx-auto transition-all duration-200 ${
            containerMode === "constrained-mobile" ? "max-w-[390px]" : "max-w-4xl"
          }`}
        >
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 shadow-xs">
            <div className="mb-3 pb-2 border-b border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>
                {isAr
                  ? "المكون الفعلي: src/components/news/editor/RichTextEditor.tsx"
                  : "Component under test: src/components/news/editor/RichTextEditor.tsx"}
              </span>
              <span className="font-mono text-teal-700">
                schemaVersion: {activeValue.schemaVersion} · dir={isAr ? "rtl" : "ltr"}
              </span>
            </div>

            <RichTextEditor
              key={activeLang}
              value={activeValue}
              onChange={handleEditorChange}
              lang={activeLang}
              dir={isAr ? "rtl" : "ltr"}
              previewUrlsByAssetId={previewUrlsByAssetId}
            />
          </div>
        </section>

        {/* Optional Canonical V2 JSON Inspector */}
        {showCanonicalJson && (
          <section
            data-testid="v2-visual-harness-json-panel"
            dir="ltr"
            className="max-w-4xl mx-auto bg-slate-900 text-slate-100 rounded-xl p-4 border border-slate-800 overflow-x-auto"
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-xs text-slate-400 font-mono">
              <span>Canonical RichNewsDocumentWrapperV2 Payload (No URL / No Blob Leakage)</span>
              <span>schemaVersion: {activeValue.schemaVersion}</span>
            </div>
            <pre className="text-xs font-mono leading-relaxed">
              {JSON.stringify(activeValue, null, 2)}
            </pre>
          </section>
        )}
      </main>
    </div>
  );
}

export default RichTextEditorV2VisualHarness;
