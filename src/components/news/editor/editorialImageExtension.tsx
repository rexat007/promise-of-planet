import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import {
  Trash2,
  AlignRight,
  AlignLeft,
  AlignCenter,
  Maximize,
  GripVertical,
  ShieldAlert,
  Image as ImageIcon,
} from "lucide-react";
import type {
  EditorialImageNodeAttrsV2,
  ImageLayoutV2 as EditorialImageLayoutV2,
  ImageWidthV2 as EditorialImageWidthV2,
} from "../../../types/richNewsDocument";

export type { EditorialImageLayoutV2, EditorialImageWidthV2 };

/* ==========================================
 * Constants & Validation Rules (V2 Canonical)
 * ========================================== */

export const ALLOWED_EDITORIAL_IMAGE_WIDTHS: readonly EditorialImageWidthV2[] = [
  "25%",
  "50%",
  "75%",
  "100%",
] as const;

export const ALLOWED_EDITORIAL_IMAGE_LAYOUTS: readonly EditorialImageLayoutV2[] = [
  "float-start",
  "float-end",
  "block-center",
  "block-full",
] as const;

export const ALLOWED_EDITORIAL_IMAGE_ATTR_KEYS = new Set<string>([
  "assetId",
  "altAr",
  "altEn",
  "captionAr",
  "captionEn",
  "width",
  "layout",
]);

export const FORBIDDEN_EDITORIAL_IMAGE_ATTR_KEYS = new Set<string>([
  "src",
  "publicUrl",
  "storagePath",
  "credit",
  "title",
  "alt",
  "alignment",
  "href",
  "style",
  "class",
]);

const SAFE_ASSET_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function containsForbiddenUrlOrStoragePattern(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return (
    lower.startsWith("blob:") ||
    lower.startsWith("data:") ||
    lower.startsWith("gs://") ||
    lower.includes("storage.googleapis.com") ||
    lower.includes("firebasestorage.googleapis.com")
  );
}

export interface EditorialImageAttrValidationResult {
  valid: boolean;
  errors: string[];
  attrs?: EditorialImageNodeAttrsV2;
}

/**
 * Validates candidate attributes strictly against the canonical V2 contract.
 * Unknown or malformed attributes fail closed.
 */
export function validateCanonicalEditorialImageAttrs(
  input: unknown
): EditorialImageAttrValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      errors: ["editorialImage attrs must be a non-null object."],
    };
  }

  const raw = input as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_EDITORIAL_IMAGE_ATTR_KEYS.has(key)) {
      errors.push(`Disallowed or unknown attribute "${key}" on editorialImage node.`);
    }
  }

  const assetId = raw.assetId;
  if (
    typeof assetId !== "string" ||
    !SAFE_ASSET_ID_REGEX.test(assetId) ||
    containsForbiddenUrlOrStoragePattern(assetId)
  ) {
    errors.push(
      "editorialImage assetId must be a non-empty path-safe string (1-128 chars)."
    );
  }

  const altAr = raw.altAr;
  if (
    typeof altAr !== "string" ||
    altAr.trim().length === 0 ||
    altAr.length > 500 ||
    containsForbiddenUrlOrStoragePattern(altAr)
  ) {
    errors.push(
      "editorialImage altAr must be a non-empty string up to 500 chars without embedded URLs or storage paths."
    );
  }

  const width = raw.width;
  if (
    typeof width !== "string" ||
    !ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(width as EditorialImageWidthV2)
  ) {
    errors.push("editorialImage width must be one of: 25%, 50%, 75%, 100%.");
  }

  const layout = raw.layout;
  if (
    typeof layout !== "string" ||
    !ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(layout as EditorialImageLayoutV2)
  ) {
    errors.push(
      "editorialImage layout must be one of: float-start, float-end, block-center, block-full."
    );
  }

  if (raw.altEn !== undefined && raw.altEn !== null) {
    if (
      typeof raw.altEn !== "string" ||
      raw.altEn.length > 500 ||
      containsForbiddenUrlOrStoragePattern(raw.altEn)
    ) {
      errors.push(
        "editorialImage altEn must be a string up to 500 chars without embedded URLs or storage paths."
      );
    }
  }

  if (raw.captionAr !== undefined && raw.captionAr !== null) {
    if (
      typeof raw.captionAr !== "string" ||
      raw.captionAr.length > 1000 ||
      containsForbiddenUrlOrStoragePattern(raw.captionAr)
    ) {
      errors.push(
        "editorialImage captionAr must be a string up to 1000 chars without embedded URLs or storage paths."
      );
    }
  }

  if (raw.captionEn !== undefined && raw.captionEn !== null) {
    if (
      typeof raw.captionEn !== "string" ||
      raw.captionEn.length > 1000 ||
      containsForbiddenUrlOrStoragePattern(raw.captionEn)
    ) {
      errors.push(
        "editorialImage captionEn must be a string up to 1000 chars without embedded URLs or storage paths."
      );
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const canonicalAttrs: EditorialImageNodeAttrsV2 = {
    assetId: assetId as string,
    altAr: altAr as string,
    width: width as EditorialImageWidthV2,
    layout: layout as EditorialImageLayoutV2,
  };

  if (typeof raw.altEn === "string") {
    canonicalAttrs.altEn = raw.altEn;
  }
  if (typeof raw.captionAr === "string") {
    canonicalAttrs.captionAr = raw.captionAr;
  }
  if (typeof raw.captionEn === "string") {
    canonicalAttrs.captionEn = raw.captionEn;
  }

  return {
    valid: true,
    errors: [],
    attrs: canonicalAttrs,
  };
}

/* ==========================================
 * Runtime Preview Context & Ownership-Safe URL Cleanup
 * ========================================== */

export interface EditorialImageLocaleContextValue {
  lang: "ar" | "en";
  dir: "rtl" | "ltr";
}

export const EditorialImageLocaleContext =
  createContext<EditorialImageLocaleContextValue>({
    lang: "ar",
    dir: "rtl",
  });

export interface EditorialImagePreviewContextValue {
  /**
   * Runtime-only mapping from canonical `assetId` to an authorized preview URL.
   * Never persisted into ProseMirror/Tiptap document attributes.
   */
  previewUrlsByAssetId: Readonly<Record<string, string | undefined>>;
}

export const EditorialImagePreviewContext =
  createContext<EditorialImagePreviewContextValue>({
    previewUrlsByAssetId: {},
  });

/**
 * Validates that a runtime preview URL is safe to render in an <img> tag.
 * Rejects executable schemes such as javascript:, vbscript:, or non-image data: URLs.
 */
export function isSafeRuntimePreviewUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:")
  ) {
    return false;
  }

  if (lower.startsWith("data:")) {
    return /^data:image\/(jpeg|jpg|png|webp|avif|gif|svg\+xml);/i.test(trimmed);
  }

  if (
    lower.startsWith("blob:") ||
    lower.startsWith("https://") ||
    lower.startsWith("http://") ||
    lower.startsWith("/")
  ) {
    return true;
  }

  return false;
}

export interface OwnedPreviewUrlRegistry {
  /**
   * Registers a temporary preview URL (e.g. `blob:`) created and owned by this session.
   * If a previous owned URL existed for the same assetId, it is revoked first.
   */
  registerOwnedPreviewUrl: (assetId: string, url: string) => void;
  /**
   * Associates a preview URL owned by an external caller/component.
   * Cleanup methods on this registry will NEVER revoke external URLs.
   */
  registerExternalPreviewUrl: (assetId: string, url: string) => void;
  /**
   * Revokes and removes the preview URL for a specific assetId ONLY if owned by this registry.
   * If the URL was registered as external, removes the mapping without revoking the underlying URL.
   */
  releaseAssetPreviewUrl: (assetId: string) => void;
  /**
   * Revokes all URLs explicitly owned by this registry and clears the map.
   * Never revokes URLs owned by other components.
   */
  revokeAllOwnedPreviewUrls: () => void;
  /**
   * Returns whether the current URL for `assetId` is owned by this registry.
   */
  isUrlOwned: (assetId: string) => boolean;
  /**
   * Returns a snapshot of the runtime `assetId -> previewUrl` mapping.
   */
  getPreviewMap: () => Record<string, string>;
}

/**
 * Creates an ownership-tracking runtime preview URL registry.
 * Ensures `URL.revokeObjectURL` is only called on URLs explicitly owned by this registry.
 */
export function createOwnedPreviewUrlRegistry(
  revokeFn: (url: string) => void = (url) => {
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(url);
    }
  }
): OwnedPreviewUrlRegistry {
  const urlsByAssetId = new Map<string, string>();
  const ownedUrls = new Set<string>();

  return {
    registerOwnedPreviewUrl(assetId: string, url: string) {
      if (!SAFE_ASSET_ID_REGEX.test(assetId) || !isSafeRuntimePreviewUrl(url)) {
        return;
      }
      const existing = urlsByAssetId.get(assetId);
      if (existing && existing !== url && ownedUrls.has(existing)) {
        revokeFn(existing);
        ownedUrls.delete(existing);
      }
      urlsByAssetId.set(assetId, url);
      ownedUrls.add(url);
    },

    registerExternalPreviewUrl(assetId: string, url: string) {
      if (!SAFE_ASSET_ID_REGEX.test(assetId) || !isSafeRuntimePreviewUrl(url)) {
        return;
      }
      const existing = urlsByAssetId.get(assetId);
      if (existing && existing !== url && ownedUrls.has(existing)) {
        revokeFn(existing);
        ownedUrls.delete(existing);
      }
      urlsByAssetId.set(assetId, url);
    },

    releaseAssetPreviewUrl(assetId: string) {
      const existing = urlsByAssetId.get(assetId);
      if (!existing) return;
      if (ownedUrls.has(existing)) {
        revokeFn(existing);
        ownedUrls.delete(existing);
      }
      urlsByAssetId.delete(assetId);
    },

    revokeAllOwnedPreviewUrls() {
      for (const ownedUrl of ownedUrls) {
        revokeFn(ownedUrl);
      }
      ownedUrls.clear();
      urlsByAssetId.clear();
    },

    isUrlOwned(assetId: string): boolean {
      const existing = urlsByAssetId.get(assetId);
      return Boolean(existing && ownedUrls.has(existing));
    },

    getPreviewMap(): Record<string, string> {
      return Object.fromEntries(urlsByAssetId.entries());
    },
  };
}

/* ==========================================
 * Layout, Float & Toolbar Clamping Helpers
 * ========================================== */

/**
 * Responsive text-wrapping and mobile-collapse CSS carried over from the accepted Sandbox.
 */
export const EDITORIAL_IMAGE_LAYOUT_CSS = `
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
`;

/**
 * Computes inline float and margin styles for RTL and LTR article flow,
 * preserving the accepted Sandbox behavior.
 */
export function computeEditorialImageFloatStyle(
  layout: EditorialImageLayoutV2,
  width: EditorialImageWidthV2,
  isRtl: boolean
): React.CSSProperties {
  const effectiveLayout: EditorialImageLayoutV2 =
    ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(layout) ? layout : "float-start";
  const effectiveWidth: EditorialImageWidthV2 =
    ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(width) ? width : "50%";

  if (effectiveLayout === "float-start") {
    if (effectiveWidth === "100%") {
      return {
        float: "none",
        display: "block",
        clear: "both",
        width: "100%",
        maxWidth: "100%",
        marginLeft: "0",
        marginRight: "0",
        marginBottom: "0.75rem",
      };
    }
    return isRtl
      ? {
          float: "right",
          width: effectiveWidth,
          maxWidth: "100%",
          marginLeft: "1.25rem",
          marginRight: "0",
          marginBottom: "0.75rem",
        }
      : {
          float: "left",
          width: effectiveWidth,
          maxWidth: "100%",
          marginRight: "1.25rem",
          marginLeft: "0",
          marginBottom: "0.75rem",
        };
  }

  if (effectiveLayout === "float-end") {
    if (effectiveWidth === "100%") {
      return {
        float: "none",
        display: "block",
        clear: "both",
        width: "100%",
        maxWidth: "100%",
        marginLeft: "0",
        marginRight: "0",
        marginBottom: "0.75rem",
      };
    }
    return isRtl
      ? {
          float: "left",
          width: effectiveWidth,
          maxWidth: "100%",
          marginRight: "1.25rem",
          marginLeft: "0",
          marginBottom: "0.75rem",
        }
      : {
          float: "right",
          width: effectiveWidth,
          maxWidth: "100%",
          marginLeft: "1.25rem",
          marginRight: "0",
          marginBottom: "0.75rem",
        };
  }

  if (effectiveLayout === "block-center") {
    return {
      float: "none",
      display: "block",
      clear: "both",
      width: effectiveWidth,
      maxWidth: "100%",
      marginLeft: "auto",
      marginRight: "auto",
      marginTop: "0.75rem",
      marginBottom: "0.75rem",
    };
  }

  // block-full
  return {
    float: "none",
    display: "block",
    clear: "both",
    width: "100%",
    maxWidth: "100%",
    marginLeft: "0",
    marginRight: "0",
    marginTop: "0.75rem",
    marginBottom: "0.75rem",
  };
}

export interface ToolbarBoundsInput {
  figureRect: { top: number; bottom: number; left: number; right: number; width: number };
  editorRect: { top: number; bottom: number; left: number; right: number; width: number };
  toolbarWidth: number;
  toolbarHeight: number;
}

export interface ToolbarBoundsComputation {
  shiftX: number;
  placement: "above" | "below";
}

/**
 * Clamps the contextual toolbar horizontally within editor bounds and
 * flips placement from "above" to "below" when near the top boundary.
 */
export function computeToolbarClampedPosition({
  figureRect,
  editorRect,
  toolbarWidth,
  toolbarHeight,
}: ToolbarBoundsInput): ToolbarBoundsComputation {
  const figureCenterX = figureRect.left + figureRect.width / 2;
  const idealLeft = figureCenterX - toolbarWidth / 2;
  const idealRight = figureCenterX + toolbarWidth / 2;

  const minLeftBoundary = editorRect.left + 8;
  const maxRightBoundary = editorRect.right - 8;

  let shiftX = 0;
  if (idealLeft < minLeftBoundary) {
    shiftX = minLeftBoundary - idealLeft;
  } else if (idealRight > maxRightBoundary) {
    shiftX = maxRightBoundary - idealRight;
  }

  const availableTopSpace = figureRect.top - editorRect.top;
  const requiredTopSpace = Math.max(toolbarHeight, 36) + 12;
  const placement: "above" | "below" =
    availableTopSpace < requiredTopSpace ? "below" : "above";

  return { shiftX, placement };
}

/* ==========================================
 * NodeView Interactive Action Handlers
 * ========================================== */

export interface EditorialImageNodeActionConfig {
  effectiveWidth: EditorialImageWidthV2;
  effectiveLayout: EditorialImageLayoutV2;
  isAr: boolean;
  updateAttributes: (attrs: Record<string, unknown>) => void;
  deleteNode: () => void;
}

export interface EditorialImageNodeActions {
  handleSetWidth: (newWidth: EditorialImageWidthV2) => void;
  handleSetLayout: (newLayout: EditorialImageLayoutV2) => void;
  handleCaptionChange: (value: string) => void;
  handleDeleteNode: () => void;
}

/**
 * Creates canonical V2 attribute mutation and deletion callbacks for the NodeView toolbar.
 * Guarantees that only allowed V2 attributes (`width`, `layout`, `captionAr`, `captionEn`)
 * are updated and never introduces legacy `alignment` or `src` keys.
 */
export function createEditorialImageNodeActions({
  effectiveWidth,
  effectiveLayout,
  isAr,
  updateAttributes,
  deleteNode,
}: EditorialImageNodeActionConfig): EditorialImageNodeActions {
  return {
    handleSetWidth(newWidth: EditorialImageWidthV2) {
      if (!ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(newWidth)) return;
      if (newWidth === "100%" && effectiveLayout !== "block-full") {
        updateAttributes({ width: "100%", layout: "block-full" });
      } else {
        updateAttributes({ width: newWidth });
      }
    },

    handleSetLayout(newLayout: EditorialImageLayoutV2) {
      if (!ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(newLayout)) return;
      if (newLayout === "block-full") {
        updateAttributes({ layout: "block-full", width: "100%" });
      } else if (effectiveWidth === "100%") {
        updateAttributes({ layout: newLayout, width: "50%" });
      } else {
        updateAttributes({ layout: newLayout });
      }
    },

    handleCaptionChange(value: string) {
      const sanitized = value.slice(0, 1000);
      if (containsForbiddenUrlOrStoragePattern(sanitized)) {
        return;
      }
      const nextValue = sanitized.length > 0 ? sanitized : null;
      if (isAr) {
        updateAttributes({ captionAr: nextValue });
      } else {
        updateAttributes({ captionEn: nextValue });
      }
    },

    handleDeleteNode() {
      deleteNode();
    },
  };
}

/* ==========================================
 * React NodeView Component
 * ========================================== */

export interface EditorialImageExtensionOptions {
  /**
   * Optional runtime preview lookup function or map.
   * Never persisted to document JSON or HTML attributes.
   */
  previewUrlsByAssetId?: Readonly<Record<string, string | undefined>>;
  getPreviewUrl?: (assetId: string) => string | undefined;
}

export function EditorialImageNodeView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode, selected, editor, extension } = props;

  const rawAttrs = (node.attrs || {}) as Partial<EditorialImageNodeAttrsV2>;
  const assetId = typeof rawAttrs.assetId === "string" ? rawAttrs.assetId : "";
  const altAr = typeof rawAttrs.altAr === "string" ? rawAttrs.altAr : "";
  const altEn = typeof rawAttrs.altEn === "string" ? rawAttrs.altEn : undefined;
  const captionAr =
    typeof rawAttrs.captionAr === "string" ? rawAttrs.captionAr : undefined;
  const captionEn =
    typeof rawAttrs.captionEn === "string" ? rawAttrs.captionEn : undefined;

  const effectiveWidth: EditorialImageWidthV2 =
    rawAttrs.width &&
    ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(rawAttrs.width as EditorialImageWidthV2)
      ? (rawAttrs.width as EditorialImageWidthV2)
      : "50%";

  const effectiveLayout: EditorialImageLayoutV2 =
    rawAttrs.layout &&
    ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(
      rawAttrs.layout as EditorialImageLayoutV2
    )
      ? (rawAttrs.layout as EditorialImageLayoutV2)
      : "float-start";

  const localeCtx = useContext(EditorialImageLocaleContext);
  const previewCtx = useContext(EditorialImagePreviewContext);

  const [isHovered, setIsHovered] = useState(false);
  const [toolbarShiftX, setToolbarShiftX] = useState(0);
  const [toolbarPlacement, setToolbarPlacement] = useState<"above" | "below">(
    "above"
  );

  const figureRef = useRef<HTMLElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const domDir = editor?.view?.dom?.getAttribute("dir");
  const isRtl = domDir ? domDir === "rtl" : localeCtx.dir === "rtl";
  const isAr = domDir ? domDir === "rtl" : localeCtx.lang === "ar";

  // Resolve runtime-only preview URL strictly by assetId
  const extensionOptions = (extension?.options ||
    {}) as EditorialImageExtensionOptions;
  const candidatePreviewUrl =
    (assetId && previewCtx.previewUrlsByAssetId?.[assetId]) ??
    (assetId && extensionOptions.previewUrlsByAssetId?.[assetId]) ??
    (assetId && extensionOptions.getPreviewUrl?.(assetId)) ??
    undefined;

  const resolvedPreviewUrl = isSafeRuntimePreviewUrl(candidatePreviewUrl)
    ? candidatePreviewUrl
    : undefined;

  const activeAltText = isAr ? altAr || altEn || "" : altEn || altAr || "";
  const activeCaptionText = isAr
    ? captionAr ?? captionEn ?? ""
    : captionEn ?? captionAr ?? "";

  const showToolbar = Boolean(selected || isHovered);

  const recalculateToolbarPosition = useCallback(() => {
    const figureEl = figureRef.current;
    const toolbarEl = toolbarRef.current;
    const editorDom = editor?.view?.dom;
    if (!figureEl || !toolbarEl || !editorDom) return;

    const figureRect = figureEl.getBoundingClientRect();
    const toolbarRect = toolbarEl.getBoundingClientRect();
    const editorRect = editorDom.getBoundingClientRect();

    const { shiftX, placement } = computeToolbarClampedPosition({
      figureRect,
      editorRect,
      toolbarWidth: toolbarRect.width,
      toolbarHeight: toolbarRect.height,
    });

    setToolbarShiftX(shiftX);
    setToolbarPlacement(placement);
  }, [editor]);

  useEffect(() => {
    if (!showToolbar) {
      setToolbarShiftX(0);
      setToolbarPlacement("above");
      return;
    }

    recalculateToolbarPosition();
    const rafId = requestAnimationFrame(recalculateToolbarPosition);
    window.addEventListener("resize", recalculateToolbarPosition);
    window.addEventListener("scroll", recalculateToolbarPosition, true);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", recalculateToolbarPosition);
      window.removeEventListener("scroll", recalculateToolbarPosition, true);
    };
  }, [showToolbar, effectiveWidth, effectiveLayout, isRtl, recalculateToolbarPosition]);

  const {
    handleSetWidth,
    handleSetLayout,
    handleCaptionChange,
    handleDeleteNode,
  } = createEditorialImageNodeActions({
    effectiveWidth,
    effectiveLayout,
    isAr,
    updateAttributes,
    deleteNode,
  });

  const floatStyle = computeEditorialImageFloatStyle(
    effectiveLayout,
    effectiveWidth,
    isRtl
  );
  const layoutClass = `pop-layout-${effectiveLayout}`;

  return (
    <NodeViewWrapper
      as="figure"
      ref={figureRef as any}
      data-testid="editorial-image-figure"
      data-drag-handle=""
      data-editorial-image=""
      data-asset-id={assetId}
      data-layout={effectiveLayout}
      data-width={effectiveWidth}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={floatStyle}
      className={`editorial-image-node-wrapper pop-editorial-figure ${layoutClass} group relative transition-all rounded-lg border-2 my-2 ${
        selected
          ? "border-emerald-600 ring-4 ring-emerald-500/20 shadow-lg"
          : "border-transparent hover:border-emerald-300"
      }`}
    >
      <style>{EDITORIAL_IMAGE_LAYOUT_CSS}</style>

      {/* Contextual Floating Action Toolbar */}
      <div
        ref={toolbarRef}
        data-testid="editorial-image-toolbar"
        data-toolbar-placement={toolbarPlacement}
        data-toolbar-visible={showToolbar ? "true" : "false"}
        contentEditable={false}
        style={{
          transform: `translateX(calc(-50% + ${Math.round(toolbarShiftX)}px))`,
        }}
        className={`absolute ${
          toolbarPlacement === "below"
            ? "top-full mt-2"
            : "bottom-full mb-2"
        } left-1/2 z-30 flex items-center gap-1 bg-gray-900/95 text-white px-2.5 py-1.5 rounded-lg shadow-xl text-xs whitespace-nowrap transition-opacity duration-150 ${
          showToolbar ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Drag Handle */}
        <span
          data-drag-handle=""
          data-testid="editorial-image-drag-handle"
          className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-white px-1 flex items-center"
          title={isAr ? "اسحب لتحريك الصورة" : "Drag to move image"}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </span>

        <div className="w-px h-4 bg-gray-700 mx-0.5" />

        {/* Width Presets */}
        <div className="flex items-center gap-0.5">
          {ALLOWED_EDITORIAL_IMAGE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              data-testid={`editorial-image-width-${w}`}
              onClick={(e) => {
                e.stopPropagation();
                handleSetWidth(w);
              }}
              className={`px-1.5 py-0.5 rounded font-mono text-[11px] transition-colors cursor-pointer ${
                effectiveWidth === w
                  ? "bg-emerald-600 text-white font-bold"
                  : "text-gray-300 hover:bg-gray-800"
              }`}
              title={isAr ? `عرض ${w}` : `Width ${w}`}
            >
              {w}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-gray-700 mx-1" />

        {/* Logical Alignment / Wrapping Controls */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            data-testid="editorial-image-layout-float-start"
            onClick={(e) => {
              e.stopPropagation();
              handleSetLayout("float-start");
            }}
            className={`p-1 rounded transition-colors cursor-pointer ${
              effectiveLayout === "float-start"
                ? "bg-emerald-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
            title={
              isAr
                ? "محاذاة لبداية السطر (يمين في العربية / التفاف النص)"
                : "Float Start (Left in English / Wrap text)"
            }
          >
            {isRtl ? (
              <AlignRight className="w-3.5 h-3.5" />
            ) : (
              <AlignLeft className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            data-testid="editorial-image-layout-block-center"
            onClick={(e) => {
              e.stopPropagation();
              handleSetLayout("block-center");
            }}
            className={`p-1 rounded transition-colors cursor-pointer ${
              effectiveLayout === "block-center"
                ? "bg-emerald-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
            title={
              isAr
                ? "توسيط مستقل بدون التفاف"
                : "Center Block (No text wrap)"
            }
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            data-testid="editorial-image-layout-float-end"
            onClick={(e) => {
              e.stopPropagation();
              handleSetLayout("float-end");
            }}
            className={`p-1 rounded transition-colors cursor-pointer ${
              effectiveLayout === "float-end"
                ? "bg-emerald-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
            title={
              isAr
                ? "محاذاة لنهاية السطر (يسار في العربية / التفاف النص)"
                : "Float End (Right in English / Wrap text)"
            }
          >
            {isRtl ? (
              <AlignLeft className="w-3.5 h-3.5" />
            ) : (
              <AlignRight className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            data-testid="editorial-image-layout-block-full"
            onClick={(e) => {
              e.stopPropagation();
              handleSetLayout("block-full");
            }}
            className={`p-1 rounded transition-colors cursor-pointer ${
              effectiveLayout === "block-full"
                ? "bg-emerald-600 text-white"
                : "text-gray-300 hover:bg-gray-800"
            }`}
            title={isAr ? "عرض كامل للمقال" : "Full Article Width"}
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="w-px h-4 bg-gray-700 mx-1" />

        {/* Delete Image Node */}
        <button
          type="button"
          data-testid="editorial-image-delete"
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteNode();
          }}
          className="p-1 rounded text-red-400 hover:bg-red-950/60 hover:text-red-300 transition-colors cursor-pointer"
          title={isAr ? "حذف الصورة من المقال" : "Remove image from article"}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Image Element OR Private Asset Placeholder */}
      {resolvedPreviewUrl ? (
        <img
          data-testid="editorial-image-preview-img"
          src={resolvedPreviewUrl}
          alt={activeAltText}
          className="w-full h-auto rounded-t-md object-cover block select-none"
          draggable={false}
        />
      ) : (
        <div
          data-testid="editorial-image-private-placeholder"
          contentEditable={false}
          className="w-full min-h-[140px] rounded-t-md bg-slate-100 border-b border-slate-200 p-4 flex flex-col items-center justify-center text-center gap-2 select-none"
        >
          <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center">
            {assetId ? (
              <ImageIcon className="w-4 h-4" />
            ) : (
              <ShieldAlert className="w-4 h-4" />
            )}
          </div>
          <p className="text-xs font-semibold text-slate-700">
            {isAr
              ? "معاينة الأصل الخاص غير متوفرة في الجلسة الحالية"
              : "Private editorial asset preview unavailable in current session"}
          </p>
          {activeAltText && (
            <p className="text-[11px] text-slate-600 max-w-md line-clamp-2">
              {activeAltText}
            </p>
          )}
          {assetId && (
            <span
              data-testid="editorial-image-placeholder-asset-id"
              className="px-2 py-0.5 rounded bg-slate-200/80 text-slate-700 font-mono text-[10px]"
            >
              {assetId}
            </span>
          )}
        </div>
      )}

      {/* Caption Display & Inline Editing Affordance */}
      {(activeCaptionText || selected) && (
        <figcaption
          data-testid="editorial-image-figcaption"
          contentEditable={false}
          className="bg-gray-50 px-3 py-2 text-xs text-gray-600 border-t border-gray-200 rounded-b-md flex flex-col gap-1.5"
        >
          {activeCaptionText && (
            <span
              data-testid="editorial-image-caption-text"
              className="font-medium text-gray-700 leading-snug"
            >
              {activeCaptionText}
            </span>
          )}
          {selected && (
            <input
              type="text"
              data-testid="editorial-image-caption-input"
              value={isAr ? captionAr ?? "" : captionEn ?? ""}
              onChange={(e) => handleCaptionChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder={
                isAr
                  ? "أضف أو عدّل التعليق التوضيحي للصورة (العربية)..."
                  : "Add or edit image caption (English)..."
              }
              className="w-full px-2 py-1 text-xs rounded border border-gray-300 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
          )}
        </figcaption>
      )}
    </NodeViewWrapper>
  );
}

/* ==========================================
 * Canonical Tiptap Node Extension (V2)
 * ========================================== */

export const EditorialImageExtension = Node.create<EditorialImageExtensionOptions>({
  name: "editorialImage",

  group: "block",

  atom: true,

  draggable: true,

  selectable: true,

  addOptions() {
    return {
      previewUrlsByAssetId: undefined,
      getPreviewUrl: undefined,
    };
  },

  addAttributes() {
    return {
      assetId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-asset-id") || "",
        renderHTML: (attributes) =>
          attributes.assetId ? { "data-asset-id": attributes.assetId } : {},
      },
      altAr: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-alt-ar") || "",
        renderHTML: (attributes) =>
          attributes.altAr ? { "data-alt-ar": attributes.altAr } : {},
      },
      altEn: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-alt-en") || null,
        renderHTML: (attributes) =>
          typeof attributes.altEn === "string"
            ? { "data-alt-en": attributes.altEn }
            : {},
      },
      captionAr: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-caption-ar") || null,
        renderHTML: (attributes) =>
          typeof attributes.captionAr === "string"
            ? { "data-caption-ar": attributes.captionAr }
            : {},
      },
      captionEn: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-caption-en") || null,
        renderHTML: (attributes) =>
          typeof attributes.captionEn === "string"
            ? { "data-caption-en": attributes.captionEn }
            : {},
      },
      width: {
        default: "50%" as EditorialImageWidthV2,
        parseHTML: (element) => {
          const w = element.getAttribute("data-width");
          return w &&
            ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(w as EditorialImageWidthV2)
            ? w
            : "50%";
        },
        renderHTML: (attributes) => ({
          "data-width": attributes.width || "50%",
        }),
      },
      layout: {
        default: "float-start" as EditorialImageLayoutV2,
        parseHTML: (element) => {
          const l = element.getAttribute("data-layout");
          return l &&
            ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(
              l as EditorialImageLayoutV2
            )
            ? l
            : "float-start";
        },
        renderHTML: (attributes) => ({
          "data-layout": attributes.layout || "float-start",
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-editorial-image]",
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const width: EditorialImageWidthV2 =
      ALLOWED_EDITORIAL_IMAGE_WIDTHS.includes(node.attrs.width)
        ? node.attrs.width
        : "50%";
    const layout: EditorialImageLayoutV2 =
      ALLOWED_EDITORIAL_IMAGE_LAYOUTS.includes(node.attrs.layout)
        ? node.attrs.layout
        : "float-start";
    const caption = node.attrs.captionAr || node.attrs.captionEn || "";

    return [
      "figure",
      mergeAttributes(HTMLAttributes, {
        "data-editorial-image": "",
        "data-asset-id": node.attrs.assetId || "",
        "data-layout": layout,
        "data-width": width,
        class: `pop-editorial-figure pop-layout-${layout}`,
        style: `width: ${layout === "block-full" ? "100%" : width}; max-width: 100%;`,
      }),
      [
        "div",
        {
          "data-editorial-asset-placeholder": node.attrs.assetId || "",
          "aria-label": node.attrs.altAr || node.attrs.altEn || "",
        },
      ],
      ...(caption ? [["figcaption", {}, caption]] : []),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EditorialImageNodeView);
  },
});

/**
 * Fail-closed helper to insert a canonical V2 editorialImage node into a Tiptap Editor.
 * Throws a descriptive validation error if unknown, forbidden, or malformed attributes are supplied.
 */
export function insertCanonicalEditorialImageNode(
  editor: { chain: () => any },
  candidateAttrs: unknown
): EditorialImageNodeAttrsV2 {
  const validation = validateCanonicalEditorialImageAttrs(candidateAttrs);
  if (!validation.valid || !validation.attrs) {
    throw new Error(
      `INVALID_EDITORIAL_IMAGE_ATTRS: ${validation.errors.join("; ")}`
    );
  }

  editor
    .chain()
    .focus()
    .insertContent({
      type: "editorialImage",
      attrs: validation.attrs,
    })
    .run();

  return validation.attrs;
}

export default EditorialImageExtension;
