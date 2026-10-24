import { useState, useEffect, useRef, useCallback, useId } from "react";
import Uppy, { type UppyFile } from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import ImageEditor from "@uppy/image-editor";
import ar_SA from "@uppy/locales/lib/ar_SA.js";

import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import "@uppy/image-editor/css/style.min.css";

import {
  X,
  Upload,
  Crop,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  Check,
  Layout,
  Image as ImageIcon,
  FileCheck,
} from "lucide-react";

import {
  ALLOWED_NEWS_IMAGE_MIME_TYPES,
  type AllowedNewsImageMimeType,
  MAX_NEWS_IMAGE_UPLOAD_BYTES,
  type NewsImageBinaryFileLike,
  type NewsImageMetadataFormInput,
  validateNewsImageSelectionAndMetadata,
} from "../../../services/newsAdminClient";

import {
  ALLOWED_EDITORIAL_IMAGE_WIDTHS,
  type EditorialImageWidthV2,
  type EditorialImageLayoutV2,
} from "./editorialImageExtension";

/* =========================================================================
 * ARCHITECTURAL CONTRACT REQUIREMENT FOR D2-D2B3
 * =========================================================================
 * Requirement:
 * When editorial usage intent is "both" (article body inline + cover featuredImage),
 * downstream save orchestration in D2-D2B3 must prefer ONE canonical binary intake
 * and reuse the single verified assetId if current featuredImage persistence and
 * public serving contracts explicitly permit referencing the same asset record.
 * If contracts do NOT permit this reuse, execution must halt with:
 * STOP_REQUIRES_DESIGN_DECISION
 * before integrating the "both" action.
 * No silent duplicate intake or separate upload identity may be created.
 * ========================================================================= */
export const EDITORIAL_USAGE_INTEGRATION_CONTRACT_NOTE =
  "D2-D2B3: When usage is 'both', prefer one canonical binary intake and reuse the verified asset if current featuredImage persistence and serving contracts explicitly permit it. If they do not, STOP_REQUIRES_DESIGN_DECISION before integrating the 'both' action. No silent duplicate upload.";

export type EditorialUsageIntent = "inline" | "cover" | "both";

export interface PreparedEditorialImage {
  readonly file: File;
  readonly metadata: NewsImageMetadataFormInput;
  readonly usage: EditorialUsageIntent;
  readonly inlineFormatting?: {
    readonly width: EditorialImageWidthV2;
    readonly layout: EditorialImageLayoutV2;
  };
  readonly mimeType: AllowedNewsImageMimeType;
  readonly sizeBytes: number;
}

export interface EditorialInlineImageModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (prepared: PreparedEditorialImage) => void;
  readonly lang?: "ar" | "en";
  readonly dir?: "rtl" | "ltr";
  readonly readOnly?: boolean;
  readonly busy?: boolean;
  readonly initialUsage?: EditorialUsageIntent;
  readonly initialWidth?: EditorialImageWidthV2;
  readonly initialLayout?: EditorialImageLayoutV2;
}

export interface CanonicalFileNormalizationResult {
  readonly ok: boolean;
  readonly file?: File;
  readonly mimeType?: AllowedNewsImageMimeType;
  readonly errorAr?: string;
  readonly errorEn?: string;
  readonly errors: readonly string[];
}

const PROHIBITED_FILENAME_PATTERNS: readonly RegExp[] = [
  /https?:\/\//i,
  /gs:\/\//i,
  /file:\/\//i,
  /ftp:\/\//i,
  /data:/i,
  /blob:/i,
  /javascript:/i,
  /vbscript:/i,
  /editorial_images\/private/i,
  /editorial_intake_quarantine/i,
];

/**
 * Normalizes any valid input binary into a canonical File with guaranteed MIME-extension alignment,
 * strict size boundaries, and full NewsImageBinaryFileLike compliance.
 */
export function normalizeCanonicalImageFile(
  rawInput: unknown,
  proposedFilename?: string
): CanonicalFileNormalizationResult {
  if (!rawInput || typeof rawInput !== "object") {
    const en = "Image binary file selection is required.";
    const ar = "يرجى اختيار ملف صورة صالح.";
    return { ok: false, errorEn: en, errorAr: ar, errors: [en] };
  }

  const fileLike = rawInput as Partial<NewsImageBinaryFileLike>;

  if (
    typeof fileLike.size !== "number" ||
    !Number.isFinite(fileLike.size) ||
    fileLike.size <= 0
  ) {
    const en = "Selected image file is empty.";
    const ar = "ملف الصورة المختار فارغ.";
    return { ok: false, errorEn: en, errorAr: ar, errors: [en] };
  }

  if (fileLike.size > MAX_NEWS_IMAGE_UPLOAD_BYTES) {
    const en = `Image file size exceeds the maximum limit of ${MAX_NEWS_IMAGE_UPLOAD_BYTES.toLocaleString(
      "en-US"
    )} bytes (15 MB).`;
    const ar = "حجم ملف الصورة يتجاوز الحد الأقصى المسموح به (15 ميجابايت).";
    return { ok: false, errorEn: en, errorAr: ar, errors: [en] };
  }

  const rawMime =
    typeof fileLike.type === "string" ? fileLike.type.trim().toLowerCase() : "";
  if (
    !rawMime ||
    !ALLOWED_NEWS_IMAGE_MIME_TYPES.includes(rawMime as AllowedNewsImageMimeType)
  ) {
    const en = "Only PNG, JPEG, and WebP images are supported.";
    const ar = "يُسمح فقط برفع صور بصيغة PNG أو JPEG أو WebP.";
    return { ok: false, errorEn: en, errorAr: ar, errors: [en] };
  }

  const mimeType = rawMime as AllowedNewsImageMimeType;

  const rawName =
    typeof fileLike.name === "string" && fileLike.name.trim()
      ? fileLike.name.trim()
      : typeof proposedFilename === "string" && proposedFilename.trim()
      ? proposedFilename.trim()
      : "editorial-image";

  if (
    rawName.length > 255 ||
    rawName.includes("/") ||
    rawName.includes("\\") ||
    rawName.includes("..") ||
    PROHIBITED_FILENAME_PATTERNS.some((p) => p.test(rawName))
  ) {
    const en = "Image filename is invalid or contains prohibited path segments.";
    const ar = "اسم ملف الصورة غير صالح أو يتضمن مسارات غير مسموح بها.";
    return { ok: false, errorEn: en, errorAr: ar, errors: [en] };
  }

  const lastDot = rawName.lastIndexOf(".");
  let baseName = lastDot > 0 ? rawName.slice(0, lastDot).trim() : rawName.trim();
  if (!baseName) {
    baseName = "editorial-image";
  }

  let canonicalExtension: string;
  if (mimeType === "image/jpeg") {
    const origExt =
      lastDot > 0 ? rawName.slice(lastDot + 1).toLowerCase() : "";
    canonicalExtension = origExt === "jpeg" ? "jpeg" : "jpg";
  } else if (mimeType === "image/png") {
    canonicalExtension = "png";
  } else {
    canonicalExtension = "webp";
  }

  const canonicalFilename = `${baseName}.${canonicalExtension}`;

  let canonicalFile: File;
  try {
    if (typeof File !== "undefined") {
      canonicalFile = new File([rawInput as Blob], canonicalFilename, {
        type: mimeType,
        lastModified: Date.now(),
      });
    } else {
      canonicalFile = Object.assign(rawInput as Blob, {
        name: canonicalFilename,
        type: mimeType,
        lastModified: Date.now(),
      }) as unknown as File;
    }
  } catch {
    canonicalFile = Object.assign(rawInput as Blob, {
      name: canonicalFilename,
      type: mimeType,
      lastModified: Date.now(),
    }) as unknown as File;
  }

  return {
    ok: true,
    file: canonicalFile,
    mimeType,
    errors: [],
  };
}

export interface OptimizeImageResult {
  readonly ok: boolean;
  readonly file: File;
  readonly originalSizeBytes: number;
  readonly optimizedSizeBytes: number;
  readonly savingsPercent: number;
  readonly dimensions?: string;
  readonly wasCompressed: boolean;
  readonly errorAr?: string;
  readonly errorEn?: string;
}

/**
 * Browser-local image optimization helper using HTML Canvas.
 * Scales down dimensions if exceeding maxDim (1920px) while maintaining aspect ratio,
 * applies high-quality bicubic resampling, and generates a standards-compliant File.
 */
export async function optimizeImageBinaryForWeb(
  sourceBlobOrFile: Blob | File,
  options?: {
    maxDim?: number;
    quality?: number;
    targetMime?: AllowedNewsImageMimeType;
    fileName?: string;
  }
): Promise<OptimizeImageResult> {
  const maxDim = options?.maxDim ?? 1920;
  const quality = options?.quality ?? 0.82;
  const originalSizeBytes = sourceBlobOrFile.size;
  const originalName =
    (sourceBlobOrFile as File).name || options?.fileName || "editorial-image.jpg";

  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      ok: false,
      file: sourceBlobOrFile as File,
      originalSizeBytes,
      optimizedSizeBytes: originalSizeBytes,
      savingsPercent: 0,
      wasCompressed: false,
      errorEn: "Canvas optimization is not available in non-browser environment.",
      errorAr: "التحسين عبر المتصفح غير متاح في هذه البيئة.",
    };
  }

  let tempUrl: string | null = null;
  try {
    tempUrl = URL.createObjectURL(sourceBlobOrFile);
    const img = new Image();
    img.crossOrigin = "anonymous";

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () =>
        reject(new Error("Failed to load image for web optimization."));
      img.src = tempUrl!;
    });

    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    let targetW = origW;
    let targetH = origH;
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
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable.");
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const outMime = options?.targetMime || "image/jpeg";
    const compressedBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), outMime, quality);
    });

    if (!compressedBlob) {
      throw new Error("Failed to generate compressed image blob.");
    }

    const optimizedSizeBytes = compressedBlob.size;
    const dimensions = `${targetW}×${targetH}`;

    // If optimization yields smaller byte size, normalize and return the new binary
    if (optimizedSizeBytes < originalSizeBytes) {
      const savingsPercent = Math.round(
        ((originalSizeBytes - optimizedSizeBytes) / originalSizeBytes) * 100
      );
      const normalized = normalizeCanonicalImageFile(
        compressedBlob,
        originalName
      );
      if (!normalized.ok || !normalized.file) {
        throw new Error(
          normalized.errorEn || "Failed to normalize optimized image binary."
        );
      }
      return {
        ok: true,
        file: normalized.file,
        originalSizeBytes,
        optimizedSizeBytes,
        savingsPercent,
        dimensions,
        wasCompressed: true,
      };
    }

    // If original was already smaller or equal, keep the original normalized file
    const normOriginal = normalizeCanonicalImageFile(
      sourceBlobOrFile,
      originalName
    );
    return {
      ok: true,
      file: normOriginal.file || (sourceBlobOrFile as File),
      originalSizeBytes,
      optimizedSizeBytes: originalSizeBytes,
      savingsPercent: 0,
      dimensions: `${origW}×${origH}`,
      wasCompressed: false,
    };
  } catch (err) {
    return {
      ok: false,
      file: sourceBlobOrFile as File,
      originalSizeBytes,
      optimizedSizeBytes: originalSizeBytes,
      savingsPercent: 0,
      wasCompressed: false,
      errorEn: err instanceof Error ? err.message : String(err),
      errorAr: "حدث خطأ أثناء معالجة ضغط الصورة للويب.",
    };
  } finally {
    if (tempUrl) {
      URL.revokeObjectURL(tempUrl);
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Isolated, reusable production modal component for preparing article images (inline, cover, or both)
 * using the accepted crop, rotate, flip, web optimization, and metadata contracts.
 */
export function EditorialInlineImageModal({
  isOpen,
  onClose,
  onConfirm,
  lang = "ar",
  dir,
  readOnly = false,
  busy = false,
  initialUsage = "inline",
  initialWidth = "50%",
  initialLayout = "float-start",
}: EditorialInlineImageModalProps) {
  const isAr = lang === "ar";
  const effectiveDir = dir || (isAr ? "rtl" : "ltr");
  const modalId = useId();

  // Active prepared binary & metadata state
  const [activeFile, setActiveFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isCropperOpen, setIsCropperOpen] = useState<boolean>(false);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Optimization feedback
  const [optimizationStatus, setOptimizationStatus] = useState<string | null>(
    null
  );

  // Metadata form state
  const [altAr, setAltAr] = useState<string>("");
  const [altEn, setAltEn] = useState<string>("");
  const [captionAr, setCaptionAr] = useState<string>("");
  const [captionEn, setCaptionEn] = useState<string>("");
  const [photographerCredit, setPhotographerCredit] = useState<string>("");
  const [licensingInfo, setLicensingInfo] = useState<string>("");

  // Usage intent & inline formatting
  const [usage, setUsage] = useState<EditorialUsageIntent>(initialUsage);
  const [width, setWidth] = useState<EditorialImageWidthV2>(initialWidth);
  const [layout, setLayout] = useState<EditorialImageLayoutV2>(initialLayout);

  // Validation feedback
  const [validationError, setValidationError] = useState<string | null>(null);

  // DOM mount refs
  const dashboardContainerRef = useRef<HTMLDivElement | null>(null);
  const uppyInstanceRef = useRef<Uppy | null>(null);
  const ownedUrlsRef = useRef<Set<string>>(new Set());

  // Track owned object URLs for deterministic cleanup
  const registerOwnedUrl = useCallback((url: string) => {
    ownedUrlsRef.current.add(url);
    return url;
  }, []);

  const revokeAllOwnedUrls = useCallback(() => {
    ownedUrlsRef.current.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore any errors from external revoke
      }
    });
    ownedUrlsRef.current.clear();
  }, []);

  // Update active file & preview URL safely
  const updateActiveFileAndPreview = useCallback(
    (newFile: File) => {
      const normResult = normalizeCanonicalImageFile(newFile);
      if (!normResult.ok || !normResult.file) {
        setValidationError(
          isAr
            ? normResult.errorAr || "ملف الصورة غير صالح"
            : normResult.errorEn || "Invalid image file"
        );
        return;
      }

      const canonical = normResult.file;
      setActiveFile(canonical);

      if (typeof window !== "undefined" && typeof URL !== "undefined") {
        const nextUrl = registerOwnedUrl(URL.createObjectURL(canonical));
        setPreviewUrl(nextUrl);
      }

      setValidationError(null);
    },
    [isAr, registerOwnedUrl]
  );

  // Handle Uppy lifecycle
  useEffect(() => {
    if (!isOpen || !dashboardContainerRef.current) return;

    if (uppyInstanceRef.current) {
      uppyInstanceRef.current.destroy();
      uppyInstanceRef.current = null;
    }

    const uppy = new Uppy({
      id: `editorial-image-prep-${modalId}`,
      autoProceed: false,
      restrictions: {
        maxNumberOfFiles: 1,
        maxFileSize: MAX_NEWS_IMAGE_UPLOAD_BYTES,
        allowedFileTypes: [...ALLOWED_NEWS_IMAGE_MIME_TYPES],
      },
      locale: isAr ? (ar_SA as any) : undefined,
    });

    uppy.use(Dashboard, {
      id: "DashboardPlugin",
      inline: true,
      target: dashboardContainerRef.current,
      height: 280,
      width: "100%",
      hideProgressDetails: false,
      proudlyDisplayPoweredByUppy: false,
      theme: "light",
      note: isAr
        ? "اختر صورة واحدة بصيغة JPG أو PNG أو WebP (الحد الأقصى 15 ميجابايت)"
        : "Select one image (JPG, PNG, or WebP up to 15MB)",
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

    // Uppy event tracking
    uppy.on("file-added", (file: UppyFile<any, any>) => {
      const data = file.data as Blob | File;
      const initialNorm = normalizeCanonicalImageFile(data, file.name);
      if (initialNorm.ok && initialNorm.file) {
        updateActiveFileAndPreview(initialNorm.file);
        // Default altAr from clean base name if empty
        const cleanName = file.name.replace(/\.[^/.]+$/, "").trim();
        setAltAr((prev) => (prev ? prev : cleanName));
      } else {
        setValidationError(
          isAr
            ? initialNorm.errorAr || "الملف غير مدعوم"
            : initialNorm.errorEn || "Unsupported file format or size"
        );
      }
    });

    uppy.on("file-removed", () => {
      revokeAllOwnedUrls();
      setActiveFile(null);
      setPreviewUrl(null);
      setOptimizationStatus(null);
      setIsCropperOpen(false);
    });

    uppy.on("file-editor:start", () => {
      setIsCropperOpen(true);
    });

    uppy.on("file-editor:complete", (updatedFile: UppyFile<any, any>) => {
      setIsCropperOpen(false);
      if (updatedFile?.data) {
        const norm = normalizeCanonicalImageFile(
          updatedFile.data as Blob,
          updatedFile.name
        );
        if (norm.ok && norm.file) {
          updateActiveFileAndPreview(norm.file);
        }
      }
    });

    uppy.on("file-editor:cancel", () => {
      setIsCropperOpen(false);
    });

    uppyInstanceRef.current = uppy;

    return () => {
      uppy.destroy();
      uppyInstanceRef.current = null;
    };
  }, [isOpen, isAr, modalId, updateActiveFileAndPreview]);

  // Clean up component-owned object URLs on close or unmount
  useEffect(() => {
    if (!isOpen) {
      revokeAllOwnedUrls();
      setActiveFile(null);
      setPreviewUrl(null);
      setIsCropperOpen(false);
      setIsSubmitting(false);
      setOptimizationStatus(null);
      setValidationError(null);
    }
    return () => {
      revokeAllOwnedUrls();
    };
  }, [isOpen, revokeAllOwnedUrls]);

  // Trigger web optimization on active binary
  const handleOptimizeForWeb = async () => {
    if (!activeFile || isOptimizing || isCropperOpen || readOnly || busy) return;

    try {
      setIsOptimizing(true);
      setValidationError(null);
      const res = await optimizeImageBinaryForWeb(activeFile);
      if (res.ok) {
        updateActiveFileAndPreview(res.file);
        if (res.wasCompressed) {
          setOptimizationStatus(
            isAr
              ? `نجح التحسين! تم تقليل الحجم بنسبة ${res.savingsPercent}% (${formatBytes(
                  res.originalSizeBytes
                )} ← ${formatBytes(res.optimizedSizeBytes)})`
              : `Optimized! Reduced by ${res.savingsPercent}% (${formatBytes(
                  res.originalSizeBytes
                )} → ${formatBytes(res.optimizedSizeBytes)})`
          );
        } else {
          setOptimizationStatus(
            isAr
              ? `الملف مُحسّن بالفعل بحجم مثالي (${formatBytes(
                  res.originalSizeBytes
                )})`
              : `File is already optimized (${formatBytes(
                  res.originalSizeBytes
                )})`
          );
        }
      } else {
        setValidationError(
          isAr
            ? res.errorAr || "تعذر إكمال تحسين الصورة"
            : res.errorEn || "Image optimization failed"
        );
      }
    } catch (err) {
      setValidationError(
        err instanceof Error ? err.message : "Optimization failed"
      );
    } finally {
      setIsOptimizing(false);
    }
  };

  // Form submission / confirmation handler
  const handleConfirm = () => {
    if (
      !activeFile ||
      isCropperOpen ||
      isSubmitting ||
      isOptimizing ||
      readOnly ||
      busy
    ) {
      return;
    }

    const metadataInput: NewsImageMetadataFormInput = {
      altAr: altAr.trim(),
      altEn: altEn.trim() || undefined,
      captionAr: captionAr.trim() || undefined,
      captionEn: captionEn.trim() || undefined,
      photographerCredit: photographerCredit.trim() || undefined,
      licensingInfo: licensingInfo.trim() || undefined,
    };

    const validation = validateNewsImageSelectionAndMetadata(
      metadataInput,
      activeFile
    );
    if (!validation.valid) {
      setValidationError(
        isAr
          ? validation.errorAr || "يرجى التحقق من بيانات الصورة"
          : validation.errorEn || "Please verify image metadata requirements"
      );
      return;
    }

    const norm = normalizeCanonicalImageFile(activeFile);
    if (!norm.ok || !norm.file || !norm.mimeType) {
      setValidationError(
        isAr
          ? norm.errorAr || "ملف الصورة غير متوافق"
          : norm.errorEn || "Image file is invalid"
      );
      return;
    }

    // Set submission lock
    setIsSubmitting(true);

    const preparedResult: PreparedEditorialImage = {
      file: norm.file,
      metadata: metadataInput,
      usage,
      inlineFormatting:
        usage === "cover"
          ? undefined
          : {
              width,
              layout,
            },
      mimeType: norm.mimeType,
      sizeBytes: norm.file.size,
    };

    onConfirm(preparedResult);
    onClose();
  };

  const handleCancel = () => {
    revokeAllOwnedUrls();
    onClose();
  };

  if (!isOpen) return null;

  const canConfirm =
    Boolean(activeFile) &&
    !isCropperOpen &&
    !isSubmitting &&
    !isOptimizing &&
    !readOnly &&
    !busy &&
    altAr.trim().length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`modal-title-${modalId}`}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      dir={effectiveDir}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-gray-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50/80">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-800 rounded-lg">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <h2
                id={`modal-title-${modalId}`}
                className="text-lg font-bold text-gray-900"
              >
                {isAr
                  ? "إعداد صورة المادة التحريرية"
                  : "Prepare Editorial News Image"}
              </h2>
              <p className="text-xs text-gray-500">
                {isAr
                  ? "القص والتدوير والتحسين وتحديد موقع الاستخدام والبيانات التحريرية"
                  : "Crop, rotate, optimize, and specify metadata for inline or cover usage"}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="editorial-image-modal-close-btn"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
            title={isAr ? "إغلاق" : "Close"}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Image Selection, Cropping & Optimization (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                <Upload className="w-4 h-4 text-emerald-600" />
                {isAr ? "ملف الصورة الميدانية" : "Field Image File"}
              </label>
              {activeFile && (
                <span className="text-xs text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full font-medium">
                  {formatBytes(activeFile.size)} • {activeFile.type}
                </span>
              )}
            </div>

            {/* Uppy Dashboard Mount Area */}
            <div
              ref={dashboardContainerRef}
              data-testid="editorial-image-uppy-dashboard"
              className="border border-gray-200 rounded-xl overflow-hidden min-h-[280px] bg-gray-50 shadow-inner"
            />

            {/* Cropper In-Progress Warning */}
            {isCropperOpen && (
              <div
                data-testid="editorial-cropper-active-warning"
                className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2.5 text-xs text-amber-900 font-medium animate-pulse"
              >
                <Crop className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  {isAr
                    ? "محرر القص والتدوير مفتوح حالياً. يرجى الضغط على حفظ التعديل أو إلغائه من لوحة التحكم قبل التأكيد."
                    : "Image editor is open. Please save or cancel cropping in the panel before confirming."}
                </span>
              </div>
            )}

            {/* Active Binary Actions & Web Optimization */}
            {activeFile && (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={altAr || (isAr ? "معاينة داخلية للصورة" : "Internal image preview")}
                      data-testid="editorial-internal-preview-thumb"
                      className="w-10 h-10 object-cover rounded-lg border border-gray-200 shadow-2xs shrink-0"
                    />
                  ) : (
                    <FileCheck className="w-4 h-4 text-emerald-600" />
                  )}
                  <div className="text-xs">
                    <span className="font-semibold text-gray-800 block truncate max-w-[220px]">
                      {activeFile.name}
                    </span>
                    <span className="text-gray-500">
                      {formatBytes(activeFile.size)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="editorial-optimize-web-btn"
                  onClick={handleOptimizeForWeb}
                  disabled={
                    isOptimizing || isCropperOpen || readOnly || busy || isSubmitting
                  }
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition-colors shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Sparkles
                    className={`w-3.5 h-3.5 ${
                      isOptimizing ? "animate-spin text-emerald-600" : ""
                    }`}
                  />
                  {isOptimizing
                    ? isAr
                      ? "جاري التحسين..."
                      : "Optimizing..."
                    : isAr
                    ? "تحسين الصورة للويب"
                    : "Optimize for Web"}
                </button>
              </div>
            )}

            {optimizationStatus && (
              <div
                data-testid="editorial-optimization-feedback"
                className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2"
              >
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{optimizationStatus}</span>
              </div>
            )}
          </div>

          {/* Right Column: Editorial Usage, Formatting & Metadata (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Editorial Usage Selector */}
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl flex flex-col gap-2.5">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                {isAr ? "موقع استخدام الصورة" : "Editorial Image Usage"}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      id: "inline",
                      labelAr: "ضمن النص",
                      labelEn: "Article Body",
                      descAr: "داخل المقال",
                      descEn: "Inline body",
                    },
                    {
                      id: "cover",
                      labelAr: "غلاف فقط",
                      labelEn: "Cover Only",
                      descAr: "واجهة الخبر",
                      descEn: "Featured",
                    },
                    {
                      id: "both",
                      labelAr: "كلاهما معاً",
                      labelEn: "Body & Cover",
                      descAr: "نص + غلاف",
                      descEn: "Both uses",
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`editorial-usage-${item.id}-btn`}
                    onClick={() => setUsage(item.id)}
                    className={`p-2.5 rounded-lg border text-center transition-all ${
                      usage === item.id
                        ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                        : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <span className="text-xs font-bold block">
                      {isAr ? item.labelAr : item.labelEn}
                    </span>
                    <span
                      className={`text-[10px] block opacity-80 ${
                        usage === item.id ? "text-emerald-100" : "text-gray-400"
                      }`}
                    >
                      {isAr ? item.descAr : item.descEn}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Inline Formatting Controls (Width & Layout) */}
            {usage !== "cover" && (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl flex flex-col gap-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-gray-700 uppercase tracking-wide">
                  <Layout className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{isAr ? "تنسيق العرض والمحاذاة" : "Width & Flow Layout"}</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-600 block mb-1">
                      {isAr ? "عرض الصورة:" : "Width:"}
                    </label>
                    <select
                      data-testid="editorial-width-select"
                      value={width}
                      onChange={(e) =>
                        setWidth(e.target.value as EditorialImageWidthV2)
                      }
                      className="w-full text-xs p-2 border border-gray-300 rounded-lg bg-white text-gray-800"
                    >
                      {ALLOWED_EDITORIAL_IMAGE_WIDTHS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-600 block mb-1">
                      {isAr ? "المحاذاة والتفاف النص:" : "Layout Flow:"}
                    </label>
                    <select
                      data-testid="editorial-layout-select"
                      value={layout}
                      onChange={(e) =>
                        setLayout(e.target.value as EditorialImageLayoutV2)
                      }
                      className="w-full text-xs p-2 border border-gray-300 rounded-lg bg-white text-gray-800"
                    >
                      <option value="float-start">
                        {isAr ? "عائم في البداية (يمين)" : "Float Start (Left)"}
                      </option>
                      <option value="float-end">
                        {isAr ? "عائم في النهاية (يسار)" : "Float End (Right)"}
                      </option>
                      <option value="block-center">
                        {isAr ? "كتلة في المنتصف" : "Block Center"}
                      </option>
                      <option value="block-full">
                        {isAr ? "عرض كامل للصفحة" : "Full Width Block"}
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Metadata Fields */}
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  {isAr ? "النص البديل بالعربية (مطلوب) *" : "Arabic Alt Text (Required) *"}
                </label>
                <input
                  type="text"
                  data-testid="editorial-alt-ar-input"
                  value={altAr}
                  onChange={(e) => setAltAr(e.target.value)}
                  maxLength={500}
                  placeholder={
                    isAr
                      ? "وصف دقيق لمحتوى الصورة لذوي الإعاقة ومحركات البحث"
                      : "Accurate description in Arabic"
                  }
                  className="w-full text-xs p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  {isAr ? "النص البديل بالإنجليزية (اختياري)" : "English Alt Text (Optional)"}
                </label>
                <input
                  type="text"
                  data-testid="editorial-alt-en-input"
                  value={altEn}
                  onChange={(e) => setAltEn(e.target.value)}
                  maxLength={500}
                  placeholder="Accurate description in English"
                  className="w-full text-xs p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">
                    {isAr ? "التعليق بالعربية" : "Arabic Caption"}
                  </label>
                  <input
                    type="text"
                    data-testid="editorial-caption-ar-input"
                    value={captionAr}
                    onChange={(e) => setCaptionAr(e.target.value)}
                    maxLength={1000}
                    placeholder={isAr ? "شرح توضيحي أسفل الصورة" : "Caption in Arabic"}
                    className="w-full text-xs p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">
                    {isAr ? "التعليق بالإنجليزية" : "English Caption"}
                  </label>
                  <input
                    type="text"
                    data-testid="editorial-caption-en-input"
                    value={captionEn}
                    onChange={(e) => setCaptionEn(e.target.value)}
                    maxLength={1000}
                    placeholder="Caption in English"
                    className="w-full text-xs p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">
                    {isAr ? "المصور / جهة الصورة" : "Photographer / Credit"}
                  </label>
                  <input
                    type="text"
                    data-testid="editorial-credit-input"
                    value={photographerCredit}
                    onChange={(e) => setPhotographerCredit(e.target.value)}
                    maxLength={255}
                    placeholder={isAr ? "مثال: فريق وعد الكوكب" : "e.g. Promise of Planet"}
                    className="w-full text-xs p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">
                    {isAr ? "بيانات الترخيص" : "Licensing Info"}
                  </label>
                  <input
                    type="text"
                    data-testid="editorial-license-input"
                    value={licensingInfo}
                    onChange={(e) => setLicensingInfo(e.target.value)}
                    maxLength={255}
                    placeholder="CC-BY 4.0"
                    className="w-full text-xs p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                  />
                </div>
              </div>
            </div>

            {/* Validation Error Alert */}
            {validationError && (
              <div
                data-testid="editorial-modal-validation-error"
                className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-xs text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{validationError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50/80">
          <button
            type="button"
            data-testid="editorial-modal-cancel-btn"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors shadow-2xs"
          >
            {isAr ? "إلغاء" : "Cancel"}
          </button>

          <button
            type="button"
            data-testid="editorial-modal-confirm-btn"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>
              {isSubmitting
                ? isAr
                  ? "جاري التأكيد..."
                  : "Confirming..."
                : isAr
                ? "تأكيد إعداد الصورة"
                : "Confirm Image Preparation"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
