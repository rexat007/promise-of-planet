import { useState, useEffect, useRef } from "react";
import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import ImageEditor from "@uppy/image-editor";
import Compressor from "@uppy/compressor";
import ar_SA from "@uppy/locales/lib/ar_SA.js";
import { useEditor, EditorContent } from "@tiptap/react";
import { getSandboxTiptapExtensions, SandboxLocaleContext } from "./imageEditorSandboxExtensions";

import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import "@uppy/image-editor/css/style.min.css";

import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Heading2,
  Heading3,
  Heading4,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Undo,
  Redo,
  Image as ImageIcon,
  Trash2,
  Sparkles,
  Eye,
  FileEdit,
  Code,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Maximize2,
  Sliders,
  Info,
  Zap,
} from "lucide-react";

export interface EditorialImageAsset {
  id: string;
  name: string;
  originalSize: number;
  compressedSize: number;
  dimensions?: string;
  previewUrl: string;
  alt: string;
  caption: string;
  credit: string;
  license: string;
  optimizationStatus?: string;
  createdAt: number;
}

interface ImageEditorSandboxProps {
  onExit?: () => void;
}

const SAMPLE_ARABIC_ARTICLE = {
  title: "مبادرة واحات الأمل: استعادة الغطاء النباتي وإعادة تأهيل النظم البيئية",
  kicker: "تقرير استقصائي بيئي",
  content: `
    <h2>إحياء الأراضي المتدهورة عبر تقنيات الحصاد المائي</h2>
    <p>تشهد المناطق الجافة في الشرق الأوسط وشمال أفريقيا تسارعاً غير مسبوق في وتيرة التصحر وندرة الموارد المائية. ومن هذا المنطلق، انطلقت مبادرة مجتمعية بيئية تهدف إلى زراعة نصف مليون شجرة محلية ملائمة للمناخ الصحراوي خلال السنوات الثلاث القادمة، معتمدة على تقنيات الري الذكي والحصاد السطحي لمياه الأمطار الموسمية.</p>
    <p>أكد باحثون في البيئة الصحراوية أن التكيف مع التغير المناخي لا يتطلب فقط حلولاً هندسية كبرى، بل يعتمد بالأساس على استعادة الذاكرة الزراعية المحلية وتوظيف النباتات الأصيلة مثل الغاف والسدر والطلح، والتي تمتلك قدرة فريدة على حبس الكربون ومقاومة الجفاف الممتد.</p>
    <blockquote>«إن استعادة شجرة واحدة في بيئة قاحلة تعني حماية التربة وتوفير ملاذ للتنوع البيولوجي المهدد.» — من بيان فريق المبادرة الميداني</blockquote>
    <h3>نتائج المرحلة الأولى في المحميات التجريبية</h3>
    <p>أظهرت القياسات الميدانية نجاح المرحلة الأولى بنسبة إنبات تجاوزت 82% في المواقع الستة المختارة. وقد شارك في عمليات الغرس أكثر من 400 متطوع ومتطوعة من المجتمعات المحلية، مما عزز الشعور بالمسؤولية التشاركية تجاه صون الموارد الطبيعية وضمان استدامتها للأجيال القادمة.</p>
  `,
};

const SAMPLE_ENGLISH_ARTICLE = {
  title: "Oases of Hope Initiative: Restoring Native Canopy and Combating Aridification",
  kicker: "Special Environmental Investigation",
  content: `
    <h2>Reviving Degraded Lands Through Smart Micro-Catchment Systems</h2>
    <p>Across arid and semi-arid regions, the acceleration of land degradation poses an urgent threat to rural livelihoods and biodiversity. In response, a pioneering grassroots ecological initiative has launched to restore native vegetation by establishing sustainable water harvesting corridors and cultivating indigenous drought-resilient tree species.</p>
    <p>Ecological field scientists emphasize that adapting to climatic shifts requires honoring indigenous environmental knowledge. Species such as Prosopis and Acacia thrive on seasonal micro-catchments, stabilizing shifting dunes and forming vital microclimates that nurture understory flora and migratory fauna.</p>
    <blockquote>"Restoring a single native tree in an arid corridor anchors fragile topsoil and preserves ecological connectivity for vulnerable species." — Lead Field Ecologist</blockquote>
    <h3>Phase One Field Observations and Canopy Establishment</h3>
    <p>Field monitoring over the initial twelve-month cycle demonstrated an eighty-two percent sapling survival rate across six pilot watersheds. With over four hundred citizen volunteers directly involved in seed propagation and soil conditioning, the project demonstrates how communal stewardship reinforces ecological resilience.</p>
  `,
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function ImageEditorSandbox({ onExit }: ImageEditorSandboxProps) {
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const isAr = lang === "ar";
  const [activeTab, setActiveTab] = useState<"editor" | "preview" | "json">("editor");

  const [assets, setAssets] = useState<EditorialImageAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [featuredCover, setFeaturedCover] = useState<EditorialImageAsset | null>(null);

  // Selected image formatting controls inside editor
  const [selectedImageWidth, setSelectedImageWidth] = useState<string>("50%");
  const [selectedImageLayout, setSelectedImageLayout] = useState<"float-start" | "float-end" | "block-center" | "block-full">("float-start");
  const [customCaption, setCustomCaption] = useState<string>("");
  const [customCredit, setCustomCredit] = useState<string>("فريق وعد الكوكب / أرشيف المنصة");
  const [customAlt, setCustomAlt] = useState<string>("");

  // Optimization state
  const [optimizingAssetId, setOptimizingAssetId] = useState<string | null>(null);
  const [optimizationMessage, setOptimizationMessage] = useState<{
    type: "success" | "info" | "error";
    text: string;
  } | null>(null);

  const dashboardContainerRef = useRef<HTMLDivElement>(null);
  const uppyInstanceRef = useRef<Uppy | null>(null);

  // Initialize Tiptap editor
  const editor = useEditor({
    extensions: getSandboxTiptapExtensions(),
    content: isAr ? SAMPLE_ARABIC_ARTICLE.content : SAMPLE_ENGLISH_ARTICLE.content,
    editorProps: {
      attributes: {
        class: "prose max-w-none focus:outline-hidden min-h-[360px] p-4 text-gray-800 leading-relaxed",
        dir: isAr ? "rtl" : "ltr",
      },
    },
  });

  // Re-sync language dir and force editor view update without destroying document content or inserted images
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dirVal = isAr ? "rtl" : "ltr";
    if (editor.view?.dom) {
      editor.view.dom.setAttribute("dir", dirVal);
      // Force ProseMirror view & NodeViews to re-render with updated dir attribute
      editor.view.updateState(editor.view.state);
    }
  }, [lang, isAr]);

  // Setup Uppy with Dashboard, ImageEditor, and Compressor
  useEffect(() => {
    if (!dashboardContainerRef.current) return;

    if (uppyInstanceRef.current) {
      uppyInstanceRef.current.destroy();
      uppyInstanceRef.current = null;
    }

    const uppy = new Uppy({
      id: "img-f1-uppy-instance",
      autoProceed: false,
      restrictions: {
        maxFileSize: 12 * 1024 * 1024,
        allowedFileTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
      },
      locale: isAr ? (ar_SA as any) : undefined,
    });

    uppy.use(Dashboard, {
      id: "DashboardPlugin",
      inline: true,
      target: dashboardContainerRef.current,
      height: 340,
      width: "100%",
      hideProgressDetails: false,
      proudlyDisplayPoweredByUppy: false,
      theme: "light",
      note: isAr
        ? "اختر أو اسحب صور الخبر بصيغ JPG, PNG, WEBP (حجم أقصى 12 ميغابايت)"
        : "Select or drag article images (JPG, PNG, WEBP up to 12MB)",
    });

    uppy.use(ImageEditor, {
      id: "ImageEditorPlugin",
      target: Dashboard,
      cropperOptions: {
        viewMode: 1,
        background: false,
        autoCropArea: 0.9,
        responsive: true,
      },
      actions: {
        revert: true,
        rotate: true,
        granularRotate: true,
        flip: true,
        zoomIn: true,
        zoomOut: true,
        cropSquare: true,
        cropWidescreen: true,
        cropWidescreenVertical: true,
      },
    });

    uppy.use(Compressor, {
      id: "CompressorPlugin",
      quality: 0.82,
      maxWidth: 2200,
      maxHeight: 2200,
    });

    uppy.on("file-added", (file) => {
      const originalSize = file.size || 0;
      const objectUrl = URL.createObjectURL(file.data as Blob);
      const cleanName = file.name.replace(/\.[^/.]+$/, "");

      const newAsset: EditorialImageAsset = {
        id: file.id,
        name: file.name,
        originalSize,
        compressedSize: originalSize,
        previewUrl: objectUrl,
        alt: cleanName,
        caption: isAr ? `صورة توثيقية: ${cleanName}` : `Documentary image: ${cleanName}`,
        credit: isAr ? "تصوير: فريق وعد الكوكب" : "Photo: Promise of Planet Team",
        license: "CC-BY 4.0",
        createdAt: Date.now(),
      };

      setAssets((prev) => {
        if (prev.some((a) => a.id === file.id)) return prev;
        return [newAsset, ...prev];
      });
      setSelectedAssetId(file.id);
      setCustomAlt(newAsset.alt);
      setCustomCaption(newAsset.caption);
      setCustomCredit(newAsset.credit);
    });

    uppy.on("file-editor:complete", (updatedFile) => {
      if (!updatedFile) return;
      const newUrl = URL.createObjectURL(updatedFile.data as Blob);
      setAssets((prev) =>
        prev.map((a) =>
          a.id === updatedFile.id
            ? {
                ...a,
                previewUrl: newUrl,
                compressedSize: updatedFile.size || a.compressedSize,
              }
            : a
        )
      );
      if (featuredCover?.id === updatedFile.id) {
        setFeaturedCover((prev) => (prev ? { ...prev, previewUrl: newUrl } : null));
      }
    });

    uppyInstanceRef.current = uppy;

    return () => {
      uppy.destroy();
      uppyInstanceRef.current = null;
    };
  }, [lang, isAr]);

  const selectedAsset = assets.find((a) => a.id === selectedAssetId) || assets[0] || null;

  // Browser-local Canvas/Blob image optimization ("Optimize for Web" / "تحسين الصورة للويب")
  const handleOptimizeAsset = async (assetToOptimize: EditorialImageAsset) => {
    try {
      setOptimizingAssetId(assetToOptimize.id);
      setOptimizationMessage(null);

      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(isAr ? "تعذر تحميل ملف الصورة" : "Failed to load image file"));
        img.src = assetToOptimize.previewUrl;
      });

      const origW = img.naturalWidth;
      const origH = img.naturalHeight;

      // Rescale if exceeding 1920px max dimension while preserving aspect ratio
      let targetW = origW;
      let targetH = origH;
      const maxDim = 1920;
      if (targetW > maxDim || targetH > maxDim) {
        if (targetW > targetH) {
          targetH = Math.round((targetH * maxDim) / targetW);
          targetW = maxDim;
        } else {
          targetW = Math.round((targetW * maxDim) / targetH);
          targetH = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error(isAr ? "تعذر إنشاء سياق القماش" : "Canvas context unavailable");

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82);
      });

      if (!blob) throw new Error(isAr ? "فشل ضغط الصورة" : "Blob compression failed");

      const optSize = blob.size;
      const origSize = assetToOptimize.compressedSize || assetToOptimize.originalSize;

      if (optSize < origSize) {
        const newUrl = URL.createObjectURL(blob);
        const pct = Math.round(((origSize - optSize) / origSize) * 100);

        setAssets((prev) =>
          prev.map((a) =>
            a.id === assetToOptimize.id
              ? {
                  ...a,
                  previewUrl: newUrl,
                  compressedSize: optSize,
                  dimensions: `${targetW}×${targetH}`,
                  optimizationStatus: isAr
                    ? `مُحسّنة للويب: ${formatBytes(origSize)} ← ${formatBytes(optSize)} (-${pct}%) | ${origW}×${origH} ← ${targetW}×${targetH}`
                    : `Optimized: ${formatBytes(origSize)} → ${formatBytes(optSize)} (-${pct}%) | ${origW}×${origH} → ${targetW}×${targetH}`,
                }
              : a
          )
        );

        if (featuredCover?.id === assetToOptimize.id) {
          setFeaturedCover((prev) => (prev ? { ...prev, previewUrl: newUrl, compressedSize: optSize } : null));
        }

        setOptimizationMessage({
          type: "success",
          text: isAr
            ? `نجح تحسين الصورة للويب! الحجم: ${formatBytes(origSize)} ← ${formatBytes(optSize)} (وفرت ${pct}%) | الأبعاد: ${targetW}×${targetH}`
            : `Web optimization successful! Size: ${formatBytes(origSize)} → ${formatBytes(optSize)} (${pct}% savings) | Dimensions: ${targetW}×${targetH}`,
        });
      } else {
        setOptimizationMessage({
          type: "info",
          text: isAr
            ? `الصورة محسنة بالفعل: الحجم الحالي (${formatBytes(origSize)}) أصغر من نتيجة الضغط الجديدة (${formatBytes(optSize)}). تم الاحتفاظ بالنسخة الأصلية.`
            : `Image is already optimized: current size (${formatBytes(origSize)}) is smaller than newly processed output (${formatBytes(optSize)}). Retained original.`,
        });
      }
    } catch (err: any) {
      setOptimizationMessage({
        type: "error",
        text: isAr ? `فشل التحسين: ${err?.message || "خطأ غير معروف"}` : `Optimization failed: ${err?.message || "Unknown error"}`,
      });
    } finally {
      setOptimizingAssetId(null);
    }
  };

  // Insert image at cursor into Tiptap
  const handleInsertImageIntoArticle = (assetToInsert?: EditorialImageAsset) => {
    if (!editor) return;
    const target = assetToInsert || selectedAsset;
    if (!target) return;

    editor
      .chain()
      .focus()
      .insertContent({
        type: "editorialImage",
        attrs: {
          src: target.previewUrl,
          alt: customAlt || target.alt,
          title: customCaption || target.caption,
          caption: customCaption || target.caption,
          credit: customCredit || target.credit,
          width: selectedImageWidth || "50%",
          layout: selectedImageLayout || "float-start",
          alignment: selectedImageLayout || "float-start",
        },
      })
      .run();
  };

  // Update attributes on active image node in editor
  const handleUpdateActiveImageAttributes = (
    widthVal: string,
    layoutVal: "float-start" | "float-end" | "block-center" | "block-full"
  ) => {
    setSelectedImageWidth(widthVal);
    setSelectedImageLayout(layoutVal);
    if (editor) {
      editor.commands.updateAttributes("editorialImage", {
        width: widthVal,
        layout: layoutVal,
        alignment: layoutVal,
      });
    }
  };

  // Set selected as featured cover
  const handleSetFeaturedCover = (assetToCover?: EditorialImageAsset) => {
    const target = assetToCover || selectedAsset;
    if (!target) return;
    setFeaturedCover({
      ...target,
      alt: customAlt || target.alt,
      caption: customCaption || target.caption,
      credit: customCredit || target.credit,
    });
  };

  const handleRemoveAsset = (id: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
    if (featuredCover?.id === id) setFeaturedCover(null);
    if (selectedAssetId === id) setSelectedAssetId(null);
  };

  const ToolbarButton = ({
    onClick,
    icon: Icon,
    isActive,
    title,
  }: {
    onClick: () => void;
    icon: any;
    isActive?: boolean;
    title: string;
  }) => (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`p-1.5 rounded-md transition-colors cursor-pointer ${
        isActive
          ? "bg-emerald-100 text-emerald-800 font-bold"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      }`}
      title={title}
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="min-h-screen bg-gray-50 text-gray-900 font-sans pb-16"
    >
      {/* Top Prototype Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-700" />
              <span>IMG-F1 Prototype</span>
            </span>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-gray-900">
                {isAr
                  ? "محرر صور الأخبار التحريري (Uppy + Tiptap)"
                  : "WordPress-Style Editorial Image Editor (Uppy + Tiptap)"}
              </h1>
              <p className="text-xs text-gray-500">
                {isAr
                  ? "نموذج تحرير صور مستقل — تحسين ومعاينة حية ومحاذاة وإلغاء محلياً بدون تخزين سحابي"
                  : "Isolated offline development sandbox — Live resizing, web optimization, and text wrapping"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Language toggle */}
            <button
              onClick={() => setLang(isAr ? "en" : "ar")}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 cursor-pointer"
            >
              {isAr ? "English (LTR)" : "العربية (RTL)"}
            </button>

            {/* Exit sandbox */}
            {onExit && (
              <button
                onClick={onExit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer transition-colors shadow-xs"
              >
                {isAr ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}
                <span>{isAr ? "العودة للمنصة" : "Back to Platform"}</span>
              </button>
            )}
          </div>
        </div>

        {/* View mode switcher */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-t border-gray-100 flex items-center gap-1 py-1.5">
          <button
            onClick={() => setActiveTab("editor")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors ${
              activeTab === "editor"
                ? "bg-emerald-700 text-white shadow-xs"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <FileEdit className="w-3.5 h-3.5" />
            <span>{isAr ? "محرر التحرير والتنسيق" : "Editorial Workstation"}</span>
          </button>
          <button
            onClick={() => setActiveTab("preview")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors ${
              activeTab === "preview"
                ? "bg-emerald-700 text-white shadow-xs"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{isAr ? "معاينة القارئ (المقال العام)" : "Reader Preview"}</span>
          </button>
          <button
            onClick={() => setActiveTab("json")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors ${
              activeTab === "json"
                ? "bg-emerald-700 text-white shadow-xs"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>{isAr ? "فحص البنية والمخرجات (JSON)" : "Contract Inspector (JSON)"}</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* Editorial Workstation View */}
        {activeTab === "editor" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Uppy Dashboard & Local Asset Shelf */}
            <div className="lg:col-span-5 space-y-6">
              {/* Uppy Media Studio Box */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
                <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-emerald-700" />
                    <h2 className="text-sm font-bold text-gray-800">
                      {isAr ? "1. رفع واقتصاص الصور (Uppy)" : "1. Upload & Crop Images (Uppy)"}
                    </h2>
                  </div>
                  <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    {isAr ? "اقتصاص وتدوير" : "Crop & Rotate"}
                  </span>
                </div>
                <div className="p-4">
                  <div ref={dashboardContainerRef} className="rounded-lg overflow-hidden" />
                  <p className="text-[11px] text-gray-500 mt-2 flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span>
                      {isAr
                        ? "انقر على رمز القلم في لوحة Uppy لقص وتدوير أبعاد الصورة قبل الإدراج."
                        : "Click the pencil icon on any item inside Uppy to crop or rotate."}
                    </span>
                  </p>
                </div>
              </div>

              {/* Local Media Shelf & Optimization Controls */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-4">
                <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-2">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-emerald-700" />
                    <h3 className="text-sm font-bold text-gray-800">
                      {isAr ? "2. مكتبة الأصول وتحسين الويب" : "2. Media Shelf & Web Optimization"}
                    </h3>
                  </div>
                  <span className="text-xs text-gray-500 font-medium">
                    {assets.length} {isAr ? "صور متاحة" : "assets available"}
                  </span>
                </div>

                {/* Optimization Notification Banner */}
                {optimizationMessage && (
                  <div
                    className={`mb-3 p-2.5 rounded-lg text-xs leading-relaxed flex items-start gap-2 ${
                      optimizationMessage.type === "success"
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                        : optimizationMessage.type === "info"
                        ? "bg-blue-50 text-blue-800 border border-blue-200"
                        : "bg-red-50 text-red-800 border border-red-200"
                    }`}
                  >
                    <Zap className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{optimizationMessage.text}</span>
                  </div>
                )}

                {assets.length === 0 ? (
                  <div className="p-6 text-center border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-xs">
                    {isAr
                      ? "اختر صورة واحدة على الأقل من لوحة Uppy أعلاه لبدء الضغط والتنسيق والإدراج."
                      : "Upload at least one image using Uppy above to optimize and insert."}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Asset selector strip */}
                    <div className="flex items-center gap-2 overflow-x-auto pb-2">
                      {assets.map((asset) => (
                        <div
                          key={asset.id}
                          onClick={() => {
                            setSelectedAssetId(asset.id);
                            setCustomAlt(asset.alt);
                            setCustomCaption(asset.caption);
                            setCustomCredit(asset.credit);
                          }}
                          className={`relative group shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${
                            selectedAssetId === asset.id
                              ? "border-emerald-600 ring-2 ring-emerald-100"
                              : "border-gray-200 opacity-70 hover:opacity-100"
                          }`}
                        >
                          <img
                            src={asset.previewUrl}
                            alt={asset.name}
                            className="w-full h-full object-cover"
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveAsset(asset.id);
                            }}
                            className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            title={isAr ? "حذف من المكتبة" : "Remove from shelf"}
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Selected Asset Details & Optimization Control */}
                    {selectedAsset && (
                      <div className="space-y-3 bg-gray-50 p-3 rounded-lg border border-gray-100 text-xs">
                        {/* Size Metrics & Browser-Local Optimization Button */}
                        <div className="bg-white p-2.5 rounded-md border border-gray-200 flex flex-col gap-2">
                          <div className="flex items-center justify-between text-[11px] text-gray-600">
                            <span>
                              {isAr ? "الحجم الحالي:" : "Current Size:"}{" "}
                              <strong className="text-gray-900">
                                {formatBytes(selectedAsset.compressedSize || selectedAsset.originalSize)}
                              </strong>
                            </span>
                            {selectedAsset.dimensions && (
                              <span className="text-gray-500 font-mono text-[10px]">
                                {selectedAsset.dimensions}
                              </span>
                            )}
                          </div>

                          {selectedAsset.optimizationStatus && (
                            <p className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 font-mono">
                              {selectedAsset.optimizationStatus}
                            </p>
                          )}

                          {/* "Optimize for Web" / "تحسين الصورة للويب" Action */}
                          <button
                            type="button"
                            disabled={optimizingAssetId === selectedAsset.id}
                            onClick={() => handleOptimizeAsset(selectedAsset)}
                            className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs shadow-xs cursor-pointer transition-colors disabled:opacity-50"
                          >
                            <Zap className="w-3.5 h-3.5" />
                            <span>
                              {optimizingAssetId === selectedAsset.id
                                ? isAr
                                  ? "جاري تحسين الصورة للويب..."
                                  : "Optimizing for web..."
                                : isAr
                                ? "تحسين الصورة للويب (Optimize for web)"
                                : "Optimize for web"}
                            </span>
                          </button>
                        </div>

                        {/* Metadata fields */}
                        <div>
                          <label className="block font-semibold text-gray-700 mb-1">
                            {isAr ? "التعليق التوضيحي (Caption)" : "Caption"}
                          </label>
                          <input
                            type="text"
                            value={customCaption}
                            onChange={(e) => setCustomCaption(e.target.value)}
                            placeholder={isAr ? "وصف موجز للمشهد يظهر أسفل الصورة" : "Brief scene description"}
                            className="w-full px-2.5 py-1.5 rounded-md border border-gray-300 bg-white focus:ring-1 focus:ring-emerald-500 text-xs"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block font-semibold text-gray-700 mb-1">
                              {isAr ? "المصور / المصدر (Credit)" : "Credit / Source"}
                            </label>
                            <input
                              type="text"
                              value={customCredit}
                              onChange={(e) => setCustomCredit(e.target.value)}
                              placeholder={isAr ? "اسم المصور أو الوكالة" : "Photographer or agency"}
                              className="w-full px-2.5 py-1.5 rounded-md border border-gray-300 bg-white focus:ring-1 focus:ring-emerald-500 text-xs"
                            />
                          </div>

                          <div>
                            <label className="block font-semibold text-gray-700 mb-1">
                              {isAr ? "النص البديل (Alt text)" : "Alt Text (SEO)"}
                            </label>
                            <input
                              type="text"
                              value={customAlt}
                              onChange={(e) => setCustomAlt(e.target.value)}
                              placeholder={isAr ? "لإمكانية الوصول ومحركات البحث" : "Accessibility & SEO"}
                              className="w-full px-2.5 py-1.5 rounded-md border border-gray-300 bg-white focus:ring-1 focus:ring-emerald-500 text-xs"
                            />
                          </div>
                        </div>

                        {/* Default Width & Layout Selection */}
                        <div className="pt-2 border-t border-gray-200 space-y-2">
                          <div>
                            <label className="block font-semibold text-gray-700 mb-1">
                              {isAr ? "عرض وتنسيق الصورة المحددة:" : "Preset Width & Layout:"}
                            </label>
                            <div className="grid grid-cols-4 gap-1.5 mb-2">
                              {["25%", "50%", "75%", "100%"].map((w) => (
                                <button
                                  key={w}
                                  type="button"
                                  onClick={() => handleUpdateActiveImageAttributes(w, selectedImageLayout)}
                                  className={`py-1 rounded-md border text-xs text-center transition-colors cursor-pointer ${
                                    selectedImageWidth === w
                                      ? "bg-emerald-700 text-white border-emerald-700 font-bold"
                                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                                  }`}
                                >
                                  {w}
                                </button>
                              ))}
                            </div>

                            <div className="grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleUpdateActiveImageAttributes(selectedImageWidth, "float-start")}
                                className={`py-1 px-2 rounded-md border text-center transition-colors cursor-pointer ${
                                  selectedImageLayout === "float-start"
                                    ? "bg-emerald-700 text-white border-emerald-700 font-bold"
                                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                                }`}
                              >
                                <span className="block text-[11px]">
                                  {isAr ? "بداية (التفاف النص)" : "Float Start"}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateActiveImageAttributes(selectedImageWidth, "float-end")}
                                className={`py-1 px-2 rounded-md border text-center transition-colors cursor-pointer ${
                                  selectedImageLayout === "float-end"
                                    ? "bg-emerald-700 text-white border-emerald-700 font-bold"
                                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                                }`}
                              >
                                <span className="block text-[11px]">
                                  {isAr ? "نهاية (التفاف النص)" : "Float End"}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateActiveImageAttributes(selectedImageWidth, "block-center")}
                                className={`py-1 px-2 rounded-md border text-center transition-colors cursor-pointer ${
                                  selectedImageLayout === "block-center"
                                    ? "bg-emerald-700 text-white border-emerald-700 font-bold"
                                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                                }`}
                              >
                                <span className="block text-[11px]">
                                  {isAr ? "وسط (بدون التفاف)" : "Center (No Wrap)"}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateActiveImageAttributes(selectedImageWidth, "block-full")}
                                className={`py-1 px-2 rounded-md border text-center transition-colors cursor-pointer ${
                                  selectedImageLayout === "block-full"
                                    ? "bg-emerald-700 text-white border-emerald-700 font-bold"
                                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                                }`}
                              >
                                <span className="block text-[11px]">
                                  {isAr ? "عرض كامل" : "Full Width"}
                                </span>
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Insertion Action Buttons */}
                        <div className="pt-2 flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => handleInsertImageIntoArticle()}
                            className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs shadow-xs cursor-pointer transition-colors"
                          >
                            <ImageIcon className="w-3.5 h-3.5" />
                            <span>{isAr ? "إدراج الصورة في موضع المؤشر" : "Insert Image at Cursor"}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleSetFeaturedCover()}
                            className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg border border-emerald-700 text-emerald-800 hover:bg-emerald-50 font-medium text-xs cursor-pointer transition-colors"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                            <span>{isAr ? "تعيين كصورة غلاف رئيسية" : "Set as Featured Cover Image"}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Featured Cover & Interactive Tiptap Editor */}
            <div className="lg:col-span-7 space-y-4">
              {/* Featured Cover Slot */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Maximize2 className="w-4 h-4 text-emerald-700" />
                    <h3 className="text-sm font-bold text-gray-800">
                      {isAr ? "صورة الغلاف البارزة (Featured Cover)" : "Featured Cover Image"}
                    </h3>
                  </div>
                  {featuredCover && (
                    <button
                      onClick={() => setFeaturedCover(null)}
                      className="text-xs text-red-600 hover:text-red-700 cursor-pointer font-medium"
                    >
                      {isAr ? "إزالة الغلاف" : "Remove Cover"}
                    </button>
                  )}
                </div>

                {featuredCover ? (
                  <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-gray-900 group">
                    <img
                      src={featuredCover.previewUrl}
                      alt={featuredCover.alt}
                      className="w-full h-48 object-cover opacity-90"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-3 text-white">
                      <p className="text-xs font-semibold">{featuredCover.caption}</p>
                      <div className="flex items-center justify-between text-[11px] text-gray-300 mt-1">
                        <span>{featuredCover.credit}</span>
                        <span className="bg-black/50 px-2 py-0.5 rounded text-[10px]">{featuredCover.license}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 text-center border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-xs">
                    {isAr
                      ? "لم يتم تعيين صورة غلاف بعد. اختر صورة من لوحة الأصول واضغط 'تعيين كصورة غلاف رئيسية'."
                      : "No cover image set. Pick an asset from the shelf and click 'Set as Featured Cover Image'."}
                  </div>
                )}
              </div>

              {/* Tiptap Article Editor */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden flex flex-col">
                <div className="p-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <FileEdit className="w-4 h-4 text-emerald-700" />
                    <span className="text-sm font-bold text-gray-800">
                      {isAr ? "متن الخبر ومحرر النصوص (Tiptap)" : "Article Body Editor (Tiptap)"}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      if (editor) {
                        editor.commands.setContent(
                          isAr ? SAMPLE_ARABIC_ARTICLE.content : SAMPLE_ENGLISH_ARTICLE.content
                        );
                      }
                    }}
                    className="text-xs text-emerald-700 hover:text-emerald-800 font-medium cursor-pointer"
                  >
                    {isAr ? "إعادة تعيين النص التجريبي" : "Reset Sample Article"}
                  </button>
                </div>

                {/* Editor Top Toolbar */}
                {editor && (
                  <div className="border-b border-gray-200 p-2 flex flex-wrap gap-1 bg-white">
                    <ToolbarButton
                      onClick={() => editor.chain().focus().toggleBold().run()}
                      icon={Bold}
                      isActive={editor.isActive("bold")}
                      title="Bold"
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().toggleItalic().run()}
                      icon={Italic}
                      isActive={editor.isActive("italic")}
                      title="Italic"
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().toggleUnderline().run()}
                      icon={UnderlineIcon}
                      isActive={editor.isActive("underline")}
                      title="Underline"
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().toggleStrike().run()}
                      icon={Strikethrough}
                      isActive={editor.isActive("strike")}
                      title="Strike"
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().toggleLink({ href: "https://example.com" }).run()}
                      icon={LinkIcon}
                      isActive={editor.isActive("link")}
                      title="Link"
                    />
                    <div className="w-px h-5 bg-gray-200 my-auto mx-1" />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                      icon={Heading2}
                      isActive={editor.isActive("heading", { level: 2 })}
                      title="Heading 2"
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                      icon={Heading3}
                      isActive={editor.isActive("heading", { level: 3 })}
                      title="Heading 3"
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
                      icon={Heading4}
                      isActive={editor.isActive("heading", { level: 4 })}
                      title="Heading 4"
                    />
                    <div className="w-px h-5 bg-gray-200 my-auto mx-1" />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().toggleBulletList().run()}
                      icon={List}
                      isActive={editor.isActive("bulletList")}
                      title="Bullet List"
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().toggleOrderedList().run()}
                      icon={ListOrdered}
                      isActive={editor.isActive("orderedList")}
                      title="Numbered List"
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().toggleBlockquote().run()}
                      icon={Quote}
                      isActive={editor.isActive("blockquote")}
                      title="Blockquote"
                    />
                    <div className="w-px h-5 bg-gray-200 my-auto mx-1" />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().setTextAlign("left").run()}
                      icon={AlignLeft}
                      isActive={editor.isActive({ textAlign: "left" })}
                      title="Align Left"
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().setTextAlign("center").run()}
                      icon={AlignCenter}
                      isActive={editor.isActive({ textAlign: "center" })}
                      title="Align Center"
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().setTextAlign("right").run()}
                      icon={AlignRight}
                      isActive={editor.isActive({ textAlign: "right" })}
                      title="Align Right"
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().setTextAlign("justify").run()}
                      icon={AlignJustify}
                      isActive={editor.isActive({ textAlign: "justify" })}
                      title="Justify"
                    />
                    <div className="w-px h-5 bg-gray-200 my-auto mx-1" />
                    <ToolbarButton
                      onClick={() => handleInsertImageIntoArticle()}
                      icon={ImageIcon}
                      isActive={false}
                      title={isAr ? "إدراج صورة من الأصول" : "Insert Image"}
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().undo().run()}
                      icon={Undo}
                      title="Undo"
                    />
                    <ToolbarButton
                      onClick={() => editor.chain().focus().redo().run()}
                      icon={Redo}
                      title="Redo"
                    />
                  </div>
                )}

                {/* Editor Content Area */}
                <div className="p-4 flex-1 min-h-[420px] bg-white">
                  <SandboxLocaleContext.Provider value={{ lang, dir: isAr ? "rtl" : "ltr" }}>
                    <EditorContent editor={editor} />
                  </SandboxLocaleContext.Provider>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reader Preview Mode */}
        {activeTab === "preview" && (
          <div className="max-w-4xl mx-auto bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden p-6 sm:p-10">
            {/* Kicker & Title */}
            <div className="mb-6">
              <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 mb-2">
                {isAr ? SAMPLE_ARABIC_ARTICLE.kicker : SAMPLE_ENGLISH_ARTICLE.kicker}
              </span>
              <h1 className="text-2xl sm:text-4xl font-extrabold text-gray-950 leading-tight">
                {isAr ? SAMPLE_ARABIC_ARTICLE.title : SAMPLE_ENGLISH_ARTICLE.title}
              </h1>
              <div className="flex items-center gap-3 text-xs text-gray-500 mt-3 pt-3 border-t border-gray-100">
                <span className="font-semibold text-emerald-800">
                  {isAr ? "تحرير: وعد الكوكب" : "Promise of Planet Editorial"}
                </span>
                <span>•</span>
                <span>{new Date().toLocaleDateString(isAr ? "ar-EG" : "en-US")}</span>
              </div>
            </div>

            {/* Featured Cover */}
            {featuredCover && (
              <figure className="mb-8 rounded-xl overflow-hidden border border-gray-200 shadow-xs">
                <img
                  src={featuredCover.previewUrl}
                  alt={featuredCover.alt}
                  className="w-full h-auto max-h-[480px] object-cover"
                />
                <figcaption className="bg-gray-50 p-3 text-xs text-gray-600 flex flex-wrap justify-between items-center gap-2 border-t border-gray-200">
                  <span className="font-medium">{featuredCover.caption}</span>
                  <span className="text-gray-400 italic text-[11px]">
                    {featuredCover.credit} ({featuredCover.license})
                  </span>
                </figcaption>
              </figure>
            )}

            {/* Rendered HTML article body */}
            {editor && (
              <div
                dir={isAr ? "rtl" : "ltr"}
                className="prose max-w-none text-gray-800 leading-relaxed pop-reader-body"
                dangerouslySetInnerHTML={{ __html: editor.getHTML() }}
              />
            )}
          </div>
        )}

        {/* Contract & JSON Inspector */}
        {activeTab === "json" && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xs">
              <div className="flex items-center gap-2 mb-3 text-emerald-800">
                <ShieldCheck className="w-5 h-5" />
                <h2 className="text-base font-bold">
                  {isAr ? "فحص بنية البيانات ومخرجات المستند" : "Contract Inspector & Tiptap JSON Output"}
                </h2>
              </div>
              <p className="text-xs text-gray-600 mb-4">
                {isAr
                  ? "تتحقق هذه الشاشة من أن عقد الصور التحريرية تُنتج بيانات JSON نقية ومنظمة تتضمن معرّفات ومحاذاة وعرض وتعليقات توضيحية دون الإخلال بالمستندات القديمة أو تسريب استدعاءات Firebase."
                  : "Verifies that editorial image nodes generate clean, structured JSON containing caption, credit, alignment, and dimensions without corrupting historical structures."}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-xs font-bold text-gray-700 mb-2">Tiptap JSON Structure:</h3>
                  <pre className="bg-gray-900 text-emerald-400 p-4 rounded-lg text-xs overflow-x-auto max-h-[400px]">
                    {editor ? JSON.stringify(editor.getJSON(), null, 2) : "{}"}
                  </pre>
                </div>

                <div>
                  <h3 className="text-xs font-bold text-gray-700 mb-2">Clean HTML Output:</h3>
                  <pre className="bg-gray-900 text-cyan-300 p-4 rounded-lg text-xs overflow-x-auto max-h-[400px]">
                    {editor ? editor.getHTML() : ""}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Responsive Text Wrapping & Reader Layout Styles */}
      <style>{`
        /* Reader preview & Editor Float Layout Styles */
        [dir="rtl"] .pop-layout-float-start,
        [dir="rtl"] figure[data-layout="float-start"] {
          float: right;
          margin-left: 1.25rem;
          margin-right: 0;
          margin-bottom: 0.75rem;
          margin-top: 0.25rem;
        }

        [dir="rtl"] .pop-layout-float-end,
        [dir="rtl"] figure[data-layout="float-end"] {
          float: left;
          margin-right: 1.25rem;
          margin-left: 0;
          margin-bottom: 0.75rem;
          margin-top: 0.25rem;
        }

        [dir="ltr"] .pop-layout-float-start,
        [dir="ltr"] figure[data-layout="float-start"] {
          float: left;
          margin-right: 1.25rem;
          margin-left: 0;
          margin-bottom: 0.75rem;
          margin-top: 0.25rem;
        }

        [dir="ltr"] .pop-layout-float-end,
        [dir="ltr"] figure[data-layout="float-end"] {
          float: right;
          margin-left: 1.25rem;
          margin-right: 0;
          margin-bottom: 0.75rem;
          margin-top: 0.25rem;
        }

        .pop-layout-block-center,
        figure[data-layout="block-center"] {
          float: none !important;
          display: block !important;
          clear: both !important;
          margin-left: auto !important;
          margin-right: auto !important;
          margin-top: 0.75rem !important;
          margin-bottom: 0.75rem !important;
        }

        .pop-layout-block-full,
        figure[data-layout="block-full"] {
          float: none !important;
          display: block !important;
          clear: both !important;
          width: 100% !important;
          max-width: 100% !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
          margin-top: 0.75rem !important;
          margin-bottom: 0.75rem !important;
        }

        /* Mobile collapse for floating text wrapping (< 640px) */
        @media (max-width: 640px) {
          .editorial-image-node-wrapper,
          .pop-editorial-figure {
            float: none !important;
            width: 100% !important;
            max-width: 100% !important;
            margin-left: 0 !important;
            margin-right: 0 !important;
            margin-bottom: 1rem !important;
            clear: both !important;
          }
        }
      `}</style>
    </div>
  );
}

export default ImageEditorSandbox;
